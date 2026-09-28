// Data model shared by the backend (producer) and the frontend (consumer).
// Everything here is derived from observable machine state — nothing is invented.

export interface GitCounts {
  staged: number;
  modified: number;
  untracked: number;
  conflicted: number;
}

export interface GitCommit {
  hash: string;
  subject: string;
  author: string;
  at: number; // epoch ms
}

export interface GithubRef {
  owner: string;
  repo: string;
}

export interface RepoInfo {
  /** '' for a repo at the project root, otherwise path relative to the project */
  relPath: string;
  valid: boolean;
  error: string | null;
  branch: string | null;
  detached: boolean;
  upstream: string | null;
  ahead: number;
  behind: number;
  counts: GitCounts;
  clean: boolean;
  lastCommit: GitCommit | null;
  remoteName: string | null;
  remoteUrl: string | null;
  github: GithubRef | null;
  checkedAt: number;
}

export interface GithubMeta {
  fullName: string;
  owner: string;
  description: string | null;
  stars: number;
  visibility: string; // 'public' | 'private' | 'internal'
  defaultBranch: string;
  url: string;
  archived: boolean;
  pushedAt: string | null;
  language: string | null;
  fetchedAt: number;
  source: 'gh-cli' | 'rest-api';
}

export type GithubResult =
  | { status: 'ok'; data: GithubMeta }
  | { status: 'unavailable'; reason: string; checkedAt: number }
  | { status: 'pending' };

export type DescriptionSource = 'github' | 'github-subrepo' | 'readme' | 'none';

export interface ProjectDescription {
  text: string | null;
  source: DescriptionSource;
  /** which repo/README the text came from, e.g. "Arjun-Chandra-7/JARVIS" or "README.md" */
  from: string | null;
}

/** How we know what a Claude process is doing. */
export type ClaudeActivity =
  | 'working' // session metadata reports status "busy"
  | 'idle' // session metadata reports status "idle"
  | 'standby' // daemon pre-warmed spare process, no conversation yet
  | 'streaming' // office-launched PTY produced output in the last few seconds
  | 'unknown'; // live process, activity not observable

export interface ClaudeSession {
  id: string; // "proc:<pid>"
  pid: number;
  projectId: string;
  cwd: string;
  relCwd: string; // cwd relative to project ('' = project root)
  startedAt: number;
  procState: string; // kernel state letter: R, S, D, T, Z...
  kind: 'interactive' | 'background' | 'print' | 'unknown';
  activity: ClaudeActivity;
  activitySource: 'session-file' | 'pty-output' | 'none';
  rawStatus: string | null;
  name: string | null;
  version: string | null;
  sessionId: string | null;
  command: string; // executable + flags only (positional prompt text omitted)
  launchedBy: string | null; // office PTY session id, when launched from here
}

export interface ProjectActivity {
  dirMtime: number | null; // newest mtime among top-level entries (excluding heavy dirs)
  lastCommitAt: number | null;
  claudeTranscriptAt: number | null; // newest ~/.claude/projects/<encoded cwd>/*.jsonl mtime
}

export interface Project {
  id: string;
  name: string;
  path: string;
  kind: 'git' | 'nested-git' | 'plain';
  repos: RepoInfo[];
  github: Record<string, GithubResult>; // keyed by "owner/repo"
  description: ProjectDescription;
  activity: ProjectActivity;
  claude: {
    sessions: ClaudeSession[];
    live: number; // real (non-standby) processes
    working: number;
    standby: number;
  };
  slot: number;
}

export interface LaunchedSession {
  id: string;
  projectId: string;
  projectName: string;
  pid: number | null;
  state: 'running' | 'exited' | 'failed';
  startedAt: number;
  endedAt: number | null;
  exitCode: number | null;
  signal: number | null;
  error: string | null;
  lastOutputAt: number | null;
  promptPreview: string;
  clients: number;
}

export interface SystemInfo {
  root: string;
  rootExists: boolean;
  hostname: string;
  platform: string;
  node: string;
  claude: { available: boolean; path: string | null; version: string | null; error: string | null };
  git: { available: boolean; version: string | null };
  gh: { available: boolean; authenticated: boolean; account: string | null };
  procfs: boolean;
  startedAt: number;
}

export interface OfficeSnapshot {
  generatedAt: number;
  system: SystemInfo;
  projects: Project[];
  launched: LaunchedSession[];
  /** live Claude processes whose cwd is outside every project */
  unassignedClaude: number;
}

export type StateMessage = { type: 'snapshot'; data: OfficeSnapshot };

export type PtyServerMessage =
  | { type: 'replay'; data: string } // scrollback sent once on (re)connect — already answered, never re-answer
  | { type: 'output'; data: string }
  | { type: 'status'; session: LaunchedSession }
  | { type: 'error'; message: string };

export type PtyClientMessage =
  | { type: 'input'; data: string }
  | { type: 'resize'; cols: number; rows: number };
