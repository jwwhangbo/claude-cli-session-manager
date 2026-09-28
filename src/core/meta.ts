import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { cleanText, metaFile } from "./paths.ts";

/** csm-only state that has no native Claude Code session entry. */
export interface CsmMeta {
  stars: Record<string, true>;
  /** Group name → member session ids. A session may belong to several groups. */
  groups: Record<string, string[]>;
  /** Group names collapsed in the grouped view. */
  collapsed: string[];
}

export function loadMeta(): CsmMeta {
  try {
    const meta = JSON.parse(readFileSync(metaFile(), "utf8"));
    return { stars: meta.stars ?? {}, groups: meta.groups ?? {}, collapsed: meta.collapsed ?? [] };
  } catch {
    return { stars: {}, groups: {}, collapsed: [] };
  }
}

export function saveMeta(meta: CsmMeta) {
  mkdirSync(dirname(metaFile()), { recursive: true });
  writeFileSync(metaFile(), JSON.stringify(meta, null, 2));
}

function update(fn: (meta: CsmMeta) => void) {
  const meta = loadMeta();
  fn(meta);
  saveMeta(meta);
}

export function setStarred(ids: string[], starred: boolean) {
  update((meta) => {
    for (const id of ids) {
      if (starred) meta.stars[id] = true;
      else delete meta.stars[id];
    }
  });
}

export function toggleStar(id: string): boolean {
  const starred = !loadMeta().stars[id];
  setStarred([id], starred);
  return starred;
}

export function normalizeGroupName(name: string): string {
  const clean = cleanText(name);
  if (!clean) throw new Error("Group name can't be empty.");
  return clean;
}

/** Session id → names of the groups it belongs to. */
export function groupsBySession(groups: Record<string, string[]>): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const [name, ids] of Object.entries(groups)) {
    for (const id of ids) out.set(id, [...(out.get(id) ?? []), name]);
  }
  return out;
}

export function addToGroup(name: string, ids: string[]) {
  const group = normalizeGroupName(name);
  update((meta) => {
    meta.groups[group] = [...new Set([...(meta.groups[group] ?? []), ...ids])];
  });
}

/** Removes ids from one group, or from every group when name is undefined. Empty groups are dropped. */
export function removeFromGroup(name: string | undefined, ids: string[]) {
  const drop = new Set(ids);
  update((meta) => {
    for (const group of name === undefined ? Object.keys(meta.groups) : [name]) {
      const left = (meta.groups[group] ?? []).filter((id) => !drop.has(id));
      if (left.length) meta.groups[group] = left;
      else {
        delete meta.groups[group];
        meta.collapsed = meta.collapsed.filter((g) => g !== group);
      }
    }
  });
}

/** Renaming onto an existing group merges the two. */
export function renameGroup(from: string, to: string) {
  const target = normalizeGroupName(to);
  update((meta) => {
    const ids = meta.groups[from];
    if (!ids) throw new Error(`No group named "${from}".`);
    if (target === from) return;
    delete meta.groups[from];
    meta.groups[target] = [...new Set([...(meta.groups[target] ?? []), ...ids])];
    meta.collapsed = meta.collapsed.map((g) => (g === from ? target : g));
  });
}

/** Deletes the group itself; its sessions are untouched. */
export function dissolveGroup(name: string) {
  update((meta) => {
    if (!meta.groups[name]) throw new Error(`No group named "${name}".`);
    delete meta.groups[name];
    meta.collapsed = meta.collapsed.filter((g) => g !== name);
  });
}

export function toggleCollapsed(name: string) {
  update((meta) => {
    meta.collapsed = meta.collapsed.includes(name) ? meta.collapsed.filter((g) => g !== name) : [...meta.collapsed, name];
  });
}

/** Forget a session everywhere csm keeps state about it. */
export function forgetSession(id: string) {
  update((meta) => {
    delete meta.stars[id];
    for (const [name, ids] of Object.entries(meta.groups)) {
      const left = ids.filter((x) => x !== id);
      if (left.length) meta.groups[name] = left;
      else delete meta.groups[name];
    }
  });
}
