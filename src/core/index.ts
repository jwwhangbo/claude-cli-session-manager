import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { archiveDir, indexFile, liveSessionsDir, projectsDir } from "./paths.ts";
import { parseSessionMeta, type SessionMeta } from "./parse.ts";

const INDEX_VERSION = 3;

interface IndexCache {
  version: number;
  entries: Record<string, SessionMeta>;
}

export interface SessionRecord extends SessionMeta {
  archived: boolean;
  running: boolean;
}

function listSessionFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  const files: string[] = [];
  for (const dir of readdirSync(root, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const full = join(root, dir.name);
    for (const f of readdirSync(full)) if (f.endsWith(".jsonl")) files.push(join(full, f));
  }
  return files;
}

function loadCache(): IndexCache {
  try {
    const cache = JSON.parse(readFileSync(indexFile(), "utf8"));
    if (cache.version === INDEX_VERSION) return cache;
  } catch {}
  return { version: INDEX_VERSION, entries: {} };
}

function saveCache(cache: IndexCache) {
  try {
    mkdirSync(dirname(indexFile()), { recursive: true });
    writeFileSync(indexFile(), JSON.stringify(cache));
  } catch {
    // The cache is an optimization; a read-only config dir is fine.
  }
}

/** Session ids of Claude Code processes that are alive right now, from ~/.claude/sessions/<pid>.json. */
export function runningSessionIds(): Set<string> {
  const ids = new Set<string>();
  const dir = liveSessionsDir();
  if (!existsSync(dir)) return ids;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    try {
      const s = JSON.parse(readFileSync(join(dir, f), "utf8"));
      process.kill(s.pid, 0);
      if (s.sessionId) ids.add(s.sessionId);
    } catch {}
  }
  if (process.env.CLAUDE_CODE_SESSION_ID) ids.add(process.env.CLAUDE_CODE_SESSION_ID);
  return ids;
}

export function loadSessions({ includeArchived = true } = {}): SessionRecord[] {
  const cache = loadCache();
  const fresh: IndexCache = { version: INDEX_VERSION, entries: {} };
  const running = runningSessionIds();
  const out: SessionRecord[] = [];
  const roots: [string, boolean][] = [[projectsDir(), false]];
  if (includeArchived) roots.push([archiveDir(), true]);

  for (const [root, archived] of roots) {
    for (const file of listSessionFiles(root)) {
      let meta: SessionMeta;
      try {
        const st = statSync(file);
        const cached = cache.entries[file];
        meta = cached && cached.mtime === st.mtimeMs && cached.size === st.size ? cached : parseSessionMeta(file);
      } catch {
        continue;
      }
      fresh.entries[file] = meta;
      if (meta.replyCount === 0) continue; // never got a reply, e.g. only ran /model
      out.push({ ...meta, archived, running: running.has(meta.id) });
    }
  }
  saveCache(fresh);
  return out.sort((a, b) => b.updated - a.updated);
}

export function findSession(idPrefix: string, sessions = loadSessions()): SessionRecord {
  const matches = sessions.filter((s) => s.id.startsWith(idPrefix));
  if (matches.length === 1) return matches[0]!;
  throw new Error(matches.length ? `Ambiguous session id "${idPrefix}" (${matches.length} matches)` : `No session matches "${idPrefix}"`);
}
