import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { metaFile } from "./paths.ts";

/** csm-only state that has no native Claude Code session entry. */
export interface CsmMeta {
  stars: Record<string, true>;
}

export function loadMeta(): CsmMeta {
  try {
    const meta = JSON.parse(readFileSync(metaFile(), "utf8"));
    return { stars: meta.stars ?? {} };
  } catch {
    return { stars: {} };
  }
}

export function saveMeta(meta: CsmMeta) {
  mkdirSync(dirname(metaFile()), { recursive: true });
  writeFileSync(metaFile(), JSON.stringify(meta, null, 2));
}

export function setStarred(ids: string[], starred: boolean) {
  const meta = loadMeta();
  for (const id of ids) {
    if (starred) meta.stars[id] = true;
    else delete meta.stars[id];
  }
  saveMeta(meta);
}

export function toggleStar(id: string): boolean {
  const starred = !loadMeta().stars[id];
  setStarred([id], starred);
  return starred;
}
