import fuzzysort from "fuzzysort";
import type { SessionRecord } from "./index.ts";

const KEYS = ["title", "firstPrompt", "lastPrompt", "cwd", "gitBranch", "tag", "agentName", "id"] as const;

export interface Filters {
  query?: string;
  cwd?: string;
  branch?: string;
  starredOnly?: boolean;
  showArchived?: boolean;
  stars?: Record<string, true>;
}

/** Filtered sessions: newest first, or by fuzzy relevance while a query is active. */
export function filterSessions(sessions: SessionRecord[], f: Filters): SessionRecord[] {
  const pool = sessions.filter(
    (s) =>
      (f.showArchived ? s.archived : !s.archived) &&
      (!f.cwd || s.cwd === f.cwd) &&
      (!f.branch || s.gitBranch === f.branch) &&
      (!f.starredOnly || f.stars?.[s.id]),
  );
  const query = f.query?.trim();
  if (!query) return pool;
  return fuzzysort.go(query, pool, { keys: KEYS as unknown as string[], threshold: 0.3 }).map((r) => r.obj);
}
