import type { GitCounts, GithubRef, RepoInfo } from '../shared/types.ts';
import { run } from './exec.ts';

// Never take the index lock: we must not interfere with the user's own git commands.
const GIT_ENV = { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' };

const git = (cwd: string, args: string[], timeoutMs = 6000) =>
  run('git', ['-C', cwd, ...args], { timeoutMs, env: GIT_ENV });

export async function gitVersion(): Promise<string | null> {
  const r = await run('git', ['--version'], { timeoutMs: 3000 });
  return r.ok ? r.stdout.trim().replace(/^git version\s*/, '') : null;
}

/** Parse "owner/repo" out of any GitHub remote URL form (https, ssh, git@). */
export function parseGithubRemote(url: string | null): GithubRef | null {
  if (!url) return null;
  const m = url.trim().match(/github\.com[:/]+([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/i);
  if (!m) return null;
  return { owner: m[1], repo: m[2] };
}

/** Remote URLs may embed credentials (https://user:token@host/...). Never expose them. */
export function redactRemote(url: string): string {
  return url.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@]+@/i, '$1');
}

export function parseStatus(out: string) {
  const counts: GitCounts = { staged: 0, modified: 0, untracked: 0, conflicted: 0 };
  let branch: string | null = null;
  let upstream: string | null = null;
  let ahead = 0;
  let behind = 0;
  let detached = false;
  for (const line of out.split('\n')) {
    if (!line) continue;
    if (line.startsWith('## ')) {
      const head = line.slice(3);
      if (head.startsWith('HEAD (no branch)')) {
        detached = true;
      } else if (head.startsWith('No commits yet on ') || head.startsWith('Initial commit on ')) {
        branch = head.replace(/^(No commits yet on|Initial commit on) /, '');
      } else {
        const m = head.match(/^(.+?)(?:\.\.\.(\S+))?(?: \[(.+)\])?$/);
        if (m) {
          branch = m[1];
          upstream = m[2] ?? null;
          const a = m[3]?.match(/ahead (\d+)/);
          const b = m[3]?.match(/behind (\d+)/);
          ahead = a ? Number(a[1]) : 0;
          behind = b ? Number(b[1]) : 0;
        }
      }
      continue;
    }
    const x = line[0];
    const y = line[1];
    if (x === '?' && y === '?') counts.untracked++;
    else if (x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D')) counts.conflicted++;
    else {
      if (x !== ' ' && x !== '!') counts.staged++;
      if (y !== ' ' && y !== '!') counts.modified++;
    }
  }
  return { counts, branch, upstream, ahead, behind, detached };
}

export async function inspectRepo(repoPath: string, relPath: string): Promise<RepoInfo> {
  const base: RepoInfo = {
    relPath,
    valid: false,
    error: null,
    branch: null,
    detached: false,
    upstream: null,
    ahead: 0,
    behind: 0,
    counts: { staged: 0, modified: 0, untracked: 0, conflicted: 0 },
    clean: true,
    lastCommit: null,
    remoteName: null,
    remoteUrl: null,
    github: null,
    checkedAt: Date.now(),
  };

  // Confirm this really is the top of a working tree (a broken .git dir fails here).
  const top = await git(repoPath, ['rev-parse', '--show-toplevel']);
  if (!top.ok) {
    base.error =
      top.error === 'not-found'
        ? 'git is not installed'
        : (top.stderr.trim().split('\n')[0] || top.error || 'not a git repository').replace(/^fatal:\s*/, '');
    return base;
  }

  const [status, log, remotes] = await Promise.all([
    git(repoPath, ['status', '--porcelain=v1', '--branch', '--untracked-files=normal']),
    git(repoPath, ['log', '-1', '--format=%H%x1f%s%x1f%an%x1f%ct']),
    git(repoPath, ['remote']),
  ]);

  base.valid = true;
  if (status.ok) {
    const s = parseStatus(status.stdout);
    Object.assign(base, s);
    const c = s.counts;
    base.clean = c.staged + c.modified + c.untracked + c.conflicted === 0;
  } else {
    base.error = status.error === 'timeout' ? 'git status timed out' : 'git status failed';
  }

  if (log.ok && log.stdout.trim()) {
    const [hash, subject, author, ct] = log.stdout.trim().split('\x1f');
    base.lastCommit = { hash, subject, author, at: Number(ct) * 1000 };
  }

  if (remotes.ok) {
    const names = remotes.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
    const name = names.includes('origin') ? 'origin' : names[0];
    if (name) {
      const url = await git(repoPath, ['remote', 'get-url', name]);
      base.remoteName = name;
      base.remoteUrl = url.ok ? redactRemote(url.stdout.trim()) : null;
      base.github = parseGithubRemote(base.remoteUrl);
    }
  }
  return base;
}
