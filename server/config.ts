import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const APP_DIR = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

/** The only directory whose children become offices. */
export const DEV_ROOT = path.resolve(process.env.DEV_OFFICE_ROOT ?? path.join(os.homedir(), 'Madara', 'Dev'));

/** Curated portfolio content (titles, summaries, links, about, folder merges). Hot-reloaded. */
export const CONTENT_FILE = path.resolve(process.env.DEV_OFFICE_CONTENT ?? path.join(APP_DIR, 'content', 'portfolio.json'));

/**
 * Local-only by default. DEV_OFFICE_PUBLIC=1 binds 0.0.0.0 and accepts any Host/Origin so the
 * portfolio can sit behind a tunnel / reverse proxy. That is safe because the API is read-only and
 * exposes nothing but project names, statuses and curated content.
 */
export const PUBLIC = process.env.DEV_OFFICE_PUBLIC === '1';
export const HOST = PUBLIC ? '0.0.0.0' : '127.0.0.1';
export const PORT = Number(process.env.DEV_OFFICE_PORT ?? 4317);

export const DATA_DIR = path.resolve(process.env.DEV_OFFICE_DATA ?? path.join(APP_DIR, '.data'));
export const CLAUDE_HOME = path.join(os.homedir(), '.claude');
export const IS_PROD = process.env.NODE_ENV === 'production';

export const IGNORED_TOP_LEVEL = new Set(['node_modules', '__pycache__', 'lost+found']);

export const INTERVALS = {
  claudeScanMs: 3000,
  rootRescanMs: 15000, // fallback in case fs.watch misses an event
};
