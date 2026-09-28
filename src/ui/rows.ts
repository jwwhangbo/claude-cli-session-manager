import type { SessionRecord } from "../core/index.ts";

/** Group names are never empty, so "" safely stands for the Ungrouped bucket (also in `collapsed`). */
export const UNGROUPED = "";

export type Row =
  | { kind: "header"; key: string; group: string; ids: string[]; collapsed: boolean }
  | { kind: "session"; key: string; group?: string; session: SessionRecord };

interface Options {
  grouped: boolean;
  groups: Record<string, string[]>;
  collapsed: string[];
  /** Ignore collapsed state, e.g. while searching so matches aren't hidden. */
  expandAll?: boolean;
}

/**
 * Turns the filtered session list into list rows. Grouped: one header per group with visible
 * members (most recently active group first), then Ungrouped. A session in several groups
 * appears under each, so row keys are "<group>\0<id>".
 */
export function buildRows(visible: SessionRecord[], { grouped, groups, collapsed, expandAll }: Options): Row[] {
  if (!grouped) return visible.map((s) => ({ kind: "session", key: s.id, session: s }));

  const collapsedSet = new Set(expandAll ? [] : collapsed);
  const inAnyGroup = new Set<string>();
  const sections: { group: string; members: SessionRecord[]; latest: number }[] = [];
  for (const [group, ids] of Object.entries(groups)) {
    const idSet = new Set(ids);
    // Keep the order of `visible` (recency or search relevance).
    const members = visible.filter((s) => idSet.has(s.id));
    for (const id of ids) inAnyGroup.add(id);
    if (members.length) sections.push({ group, members, latest: Math.max(...members.map((s) => s.updated)) });
  }
  sections.sort((a, b) => b.latest - a.latest || a.group.localeCompare(b.group));
  const ungrouped = visible.filter((s) => !inAnyGroup.has(s.id));
  if (ungrouped.length) sections.push({ group: UNGROUPED, members: ungrouped, latest: 0 });

  const rows: Row[] = [];
  for (const { group, members } of sections) {
    const isCollapsed = collapsedSet.has(group);
    rows.push({ kind: "header", key: `${group}\0`, group, ids: members.map((s) => s.id), collapsed: isCollapsed });
    if (!isCollapsed) for (const s of members) rows.push({ kind: "session", key: `${group}\0${s.id}`, group, session: s });
  }
  return rows;
}

export const groupLabel = (group: string) => (group === UNGROUPED ? "Ungrouped" : group);
