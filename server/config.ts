import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const APP_DIR = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

/** The only directory whose children become projects. Everything is resolved against it. */
export const DEV_ROOT = path.resolve(process.env.DEV_OFFICE_ROOT ?? path.join(os.homedir(), 'Madara', 'Dev'));

/** Local-only by design: the server never binds a public interface. */
export const HOST = '127.0.0.1';
export const PORT = Number(process.env.DEV_OFFICE_PORT ?? 4317);

export const DATA_DIR = path.resolve(process.env.DEV_OFFICE_DATA ?? path.join(APP_DIR, '.data'));
export const CLAUDE_HOME = path.join(os.homedir(), '.claude');

export const IS_PROD = process.env.NODE_ENV === 'production';

/** Top-level directory names that are never projects. */
export const IGNORED_TOP_LEVEL = new Set(['node_modules', '__pycache__', 'lost+found']);

/** Directory names skipped when searching for nested repos / computing activity. */
export const HEAVY_DIRS = new Set([
  'node_modules', '.git', '.venv', 'venv', 'env', '__pycache__', 'dist', 'build', '.next', '.nuxt',
  '.cache', '.turbo', 'target', 'coverage', '.idea', '.vscode', '.pytest_cache', '.mypy_cache',
  'site-packages', '.claude',
]);

export const INTERVALS = {
  claudeScanMs: 2500,
  rootRescanMs: 15000, // fallback in case fs.watch misses an event
  gitRefreshMs: 20000,
  activityRefreshMs: 30000,
  githubTtlOkMs: 30 * 60_000,
  githubTtlFailMs: 5 * 60_000,
};

export const LIMITS = {
  promptMaxChars: 20_000,
  ptyBufferBytes: 512 * 1024,
  maxRunningPtys: 12,
  exitedSessionRetentionMs: 30 * 60_000,
};
