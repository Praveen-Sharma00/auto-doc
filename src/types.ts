// Shared types across the onboard CLI. Kept in one file so module boundaries
// can move without rippling imports through every callsite.

export type SectionKey =
  | 'how-to-run'
  | 'mental-model'
  | 'modules'
  | 'flows'
  | 'where-to-start'
  | 'gotchas';

export const REQUIRED_SECTIONS: readonly SectionKey[] = [
  'how-to-run',
  'mental-model',
  'modules',
  'flows',
  'where-to-start',
  'gotchas',
] as const;

export interface ScannedFile {
  /** Repo-relative POSIX path. */
  path: string;
  /** UTF-8 contents. Files that fail the text heuristic are excluded entirely. */
  contents: string;
  /** Size in bytes of the contents string. */
  bytes: number;
}

export interface ScanResult {
  repoRoot: string;
  /** Files actually packed into the initial bundle, in include order. */
  files: ScannedFile[];
  /** Names of top-level entries (dirs and files) in the repo root. */
  topLevel: string[];
  /** Files that exist but were skipped, with a brief reason. */
  skipped: { path: string; reason: string }[];
  /** Total bytes packed (sum of files[].bytes). */
  totalBytes: number;
}

export interface Section {
  key: SectionKey;
  /** Markdown body, no leading heading — the renderer applies the heading. */
  body: string;
}

export interface AgentRunResult {
  sections: Section[];
  /** Number of model turns consumed (one turn = one assistant response). */
  turns: number;
  /** Why the loop exited: all-sections, max-turns, end_turn, or stop_sequence. */
  stopReason: string;
}
