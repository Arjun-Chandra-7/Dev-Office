import fs from 'node:fs';
import path from 'node:path';
import type { GithubMeta, GithubRef, GithubResult } from '../shared/types.ts';
import { DATA_DIR, INTERVALS } from './config.ts';
import { run } from './exec.ts';

interface CacheEntry {
  result: GithubResult;
  expiresAt: number;
}

const CACHE_FILE = path.join(DATA_DIR, 'github-cache.json');

/**
 * GitHub repository metadata with a small persistent cache.
 * Source order: authenticated `gh api` → anonymous REST API. Credentials are never stored:
 * `gh` keeps its own token in the system keyring and we only read its output.
 */
export class GithubClient {
  private cache = new Map<string, CacheEntry>();
  private inflight = new Map<string, Promise<void>>();
  private queue: string[] = [];
  private active = 0;
  ghAvailable = false;
  ghAuthenticated = false;
  ghAccount: string | null = null;

  constructor(private onUpdate: () => void) {
    try {
      const raw = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')) as Record<string, CacheEntry>;
      for (const [k, v] of Object.entries(raw)) if (v?.result?.status !== 'pending') this.cache.set(k, v);
    } catch {
      /* no cache yet */
    }
  }

  async detect() {
    const v = await run('gh', ['--version'], { timeoutMs: 4000 });
    this.ghAvailable = v.ok;
    if (!v.ok) return;
    const a = await run('gh', ['api', 'user', '--jq', '.login'], { timeoutMs: 8000 });
    this.ghAuthenticated = a.ok && !!a.stdout.trim();
    this.ghAccount = this.ghAuthenticated ? a.stdout.trim() : null;
  }

  static key(ref: GithubRef) {
    return `${ref.owner}/${ref.repo}`.toLowerCase();
  }

  /** Returns cached metadata immediately; schedules a fetch when missing or stale. */
  get(ref: GithubRef): GithubResult {
    const k = GithubClient.key(ref);
    const hit = this.cache.get(k);
    if (!hit || hit.expiresAt < Date.now()) this.schedule(k);
    return hit?.result ?? { status: 'pending' };
  }

  refresh(ref: GithubRef) {
    this.schedule(GithubClient.key(ref), true);
  }

  private schedule(k: string, force = false) {
    if (this.inflight.has(k) || this.queue.includes(k)) return;
    if (force) this.cache.delete(k);
    this.queue.push(k);
    this.pump();
  }

  private pump() {
    while (this.active < 3 && this.queue.length) {
      const k = this.queue.shift()!;
      this.active++;
      const p = this.fetchOne(k)
        .catch(() => undefined)
        .finally(() => {
          this.active--;
          this.inflight.delete(k);
          this.pump();
        });
      this.inflight.set(k, p);
    }
  }

  private async fetchOne(k: string) {
    const prev = this.cache.get(k)?.result;
    let result: GithubResult | null = null;
    let ghError: string | null = null;

    if (this.ghAvailable && this.ghAuthenticated) {
      const r = await run('gh', ['api', `repos/${k}`], { timeoutMs: 12000 });
      if (r.ok) result = { status: 'ok', data: toMeta(JSON.parse(r.stdout), 'gh-cli') };
      else ghError = /404|Not Found/i.test(r.stderr) ? 'Repository not found or no access' : r.stderr.trim() || r.error || 'gh failed';
    }

    if (!result) {
      try {
        const res = await fetch(`https://api.github.com/repos/${k}`, {
          headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'dev-office-local' },
          signal: AbortSignal.timeout(10000),
        });
        if (res.ok) result = { status: 'ok', data: toMeta(await res.json(), 'rest-api') };
        else
          result = {
            status: 'unavailable',
            reason:
              res.status === 404
                ? ghError ?? 'Repository not found, private, or deleted (anonymous API)'
                : res.status === 403
                  ? 'GitHub API rate-limited'
                  : `GitHub API HTTP ${res.status}`,
            checkedAt: Date.now(),
          };
      } catch (e) {
        result = {
          status: 'unavailable',
          reason: ghError ?? `GitHub unreachable (${(e as Error).name === 'TimeoutError' ? 'timeout' : 'network error'})`,
          checkedAt: Date.now(),
        };
      }
    }

    // Keep serving stale-but-real data if a refresh fails transiently (e.g. offline).
    if (result.status === 'unavailable' && prev?.status === 'ok' && !/not found/i.test(result.reason)) {
      this.cache.set(k, { result: prev, expiresAt: Date.now() + INTERVALS.githubTtlFailMs });
    } else {
      const ttl = result.status === 'ok' ? INTERVALS.githubTtlOkMs : INTERVALS.githubTtlFailMs;
      this.cache.set(k, { result, expiresAt: Date.now() + ttl });
    }
    this.persist();
    this.onUpdate();
  }

  private persist() {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(CACHE_FILE, JSON.stringify(Object.fromEntries(this.cache), null, 1));
    } catch {
      /* cache is best-effort */
    }
  }
}

function toMeta(j: any, source: GithubMeta['source']): GithubMeta {
  return {
    fullName: j.full_name,
    owner: j.owner?.login ?? '',
    description: j.description ?? null,
    stars: j.stargazers_count ?? 0,
    visibility: j.visibility ?? (j.private ? 'private' : 'public'),
    defaultBranch: j.default_branch ?? '',
    url: j.html_url,
    archived: !!j.archived,
    pushedAt: j.pushed_at ?? null,
    language: j.language ?? null,
    fetchedAt: Date.now(),
    source,
  };
}

/** First prose paragraph of a local README — used only when GitHub has no description. */
export function readmeDescription(dir: string): { text: string; file: string } | null {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return null;
  }
  const file = names.find((n) => /^readme(\.(md|markdown|txt|rst))?$/i.test(n));
  if (!file) return null;
  let raw: string;
  try {
    const fd = fs.openSync(path.join(dir, file), 'r');
    const buf = Buffer.alloc(16 * 1024);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    raw = buf.subarray(0, n).toString('utf8');
  } catch {
    return null;
  }
  raw = raw.replace(/<!--[\s\S]*?-->/g, '').replace(/```[\s\S]*?```/g, '');
  const para: string[] = [];
  for (const line0 of raw.split('\n')) {
    const line = line0.trim();
    const skip =
      !line ||
      line.startsWith('#') ||
      line.startsWith('![') ||
      line.startsWith('[![') ||
      line.startsWith('<') ||
      line.startsWith('|') ||
      /^[-=*_]{3,}$/.test(line) ||
      /^>\s*\[!/.test(line);
    if (skip) {
      if (para.length && !line.startsWith('#')) break;
      if (para.length) break;
      continue;
    }
    para.push(line.replace(/^>\s?/, ''));
  }
  let text = para
    .join(' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]{1,3}([^*_`]+)[*_`]{1,3}/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return null;
  if (text.length > 320) text = text.slice(0, 317).replace(/\s+\S*$/, '') + '…';
  return { text, file };
}
