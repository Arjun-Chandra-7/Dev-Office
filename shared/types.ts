// Public data model: exactly what a portfolio visitor may see. No paths, PIDs, commands,
// repository state or session names ever leave the server.

/** online = a live Claude session; working = a session reporting busy; offline = none. */
export type ProjectStatus = 'online' | 'working' | 'offline';

export type AgentActivity = 'working' | 'idle';

export interface PublicAgent {
  /** opaque, stable per session (hash) — only used to vary the agent's look */
  id: string;
  activity: AgentActivity;
}

export interface PortfolioProject {
  id: string;
  name: string; // folder name
  title: string; // display name (curated) or the folder name
  status: ProjectStatus;
  slot: number;
  agents: PublicAgent[];
  summary: string | null;
  github: string[];
  link: string | null;
}

export interface AboutInfo {
  name: string;
  tagline: string;
  photo: string;
  paragraphs: string[];
}

export interface PortfolioSnapshot {
  generatedAt: number;
  /** false when this server cannot observe Claude sessions (e.g. no /proc) */
  statusAvailable: boolean;
  about: AboutInfo | null;
  projects: PortfolioProject[];
}

export type StateMessage = { type: 'snapshot'; data: PortfolioSnapshot };
