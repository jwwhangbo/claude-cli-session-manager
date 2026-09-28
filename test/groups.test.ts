import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionRecord } from "../src/core/index.ts";
import { addToGroup, dissolveGroup, forgetSession, groupsBySession, loadMeta, removeFromGroup, renameGroup, toggleCollapsed } from "../src/core/meta.ts";
import { filterSessions } from "../src/core/search.ts";
import { buildRows, UNGROUPED } from "../src/ui/rows.ts";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "csm-groups-"));
  process.env.CLAUDE_CONFIG_DIR = root;
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const session = (id: string, updated: number, title = id): SessionRecord =>
  ({ id, updated, created: updated, title, cwd: "/w", archived: false, running: false, tokens: {} }) as unknown as SessionRecord;

describe("group storage", () => {
  test("add is idempotent, names are normalized, sessions can be in several groups", () => {
    addToGroup("  auth   refactor ", ["a", "b"]);
    addToGroup("auth refactor", ["b", "c"]);
    addToGroup("docs", ["a"]);
    const { groups } = loadMeta();
    expect(groups).toEqual({ "auth refactor": ["a", "b", "c"], docs: ["a"] });
    expect(groupsBySession(groups).get("a")).toEqual(["auth refactor", "docs"]);
    expect(() => addToGroup("   ", ["a"])).toThrow(/empty/);
  });

  test("removing the last member drops the group; undefined name removes from all", () => {
    addToGroup("x", ["a"]);
    addToGroup("y", ["a", "b"]);
    toggleCollapsed("x");
    removeFromGroup("x", ["a"]);
    expect(loadMeta()).toMatchObject({ groups: { y: ["a", "b"] }, collapsed: [] });
    removeFromGroup(undefined, ["a"]);
    expect(loadMeta().groups).toEqual({ y: ["b"] });
  });

  test("rename moves collapsed state and merges into an existing group", () => {
    addToGroup("old", ["a", "b"]);
    addToGroup("new", ["b", "c"]);
    toggleCollapsed("old");
    renameGroup("old", "new");
    expect(loadMeta()).toMatchObject({ groups: { new: ["b", "c", "a"] }, collapsed: ["new"] });
    expect(() => renameGroup("nope", "x")).toThrow(/No group/);
  });

  test("dissolve and forgetSession", () => {
    addToGroup("g", ["a", "b"]);
    addToGroup("h", ["a"]);
    forgetSession("a");
    expect(loadMeta().groups).toEqual({ g: ["b"] });
    dissolveGroup("g");
    expect(loadMeta().groups).toEqual({});
  });
});

describe("buildRows", () => {
  const visible = [session("s1", 50), session("s2", 40), session("s3", 30), session("s4", 20)];
  const groups = { old: ["s4"], recent: ["s2", "s1"], both: ["s1", "s3"], empty: ["gone"] };

  test("flat view is one row per session", () => {
    expect(buildRows(visible, { grouped: false, groups, collapsed: [] }).map((r) => r.key)).toEqual(["s1", "s2", "s3", "s4"]);
  });

  test("groups ordered by latest member, members in visible order, Ungrouped last, empty groups hidden", () => {
    const rows = buildRows([...visible, session("s5", 10)], { grouped: true, groups, collapsed: [] });
    const outline = rows.map((r) => (r.kind === "header" ? `# ${r.group || "Ungrouped"} (${r.ids.length})` : `  ${r.session.id}`));
    expect(outline).toEqual(["# both (2)", "  s1", "  s3", "# recent (2)", "  s1", "  s2", "# old (1)", "  s4", "# Ungrouped (1)", "  s5"]);
  });

  test("a session in two groups gets distinct row keys", () => {
    const keys = buildRows(visible, { grouped: true, groups, collapsed: [] }).map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test("collapsed groups keep their header and ids; expandAll overrides", () => {
    const rows = buildRows(visible, { grouped: true, groups, collapsed: ["both"] });
    expect(rows[0]).toMatchObject({ kind: "header", group: "both", collapsed: true, ids: ["s1", "s3"] });
    expect(rows[1]).toMatchObject({ kind: "header", group: "recent" });
    expect(buildRows(visible, { grouped: true, groups, collapsed: ["both"], expandAll: true })[1]).toMatchObject({ kind: "session" });
  });

  test("Ungrouped can be collapsed via its sentinel name", () => {
    const rows = buildRows([session("lonely", 1)], { grouped: true, groups: {}, collapsed: [UNGROUPED] });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "header", group: UNGROUPED, collapsed: true });
  });
});

test("search matches group names and --group filters by membership", () => {
  const all = [session("a", 2, "Fix login"), session("b", 1, "Translate README")];
  const groupsOf = groupsBySession({ "auth refactor": ["a"] });
  expect(filterSessions(all, { query: "refactor", groupsOf }).map((s) => s.id)).toEqual(["a"]);
  expect(filterSessions(all, { group: "auth refactor", groupsOf }).map((s) => s.id)).toEqual(["a"]);
});

test("group names drop control characters from the terminal", () => {
  addToGroup("translations\u0015korean docs", ["a"]);
  expect(Object.keys(loadMeta().groups)).toEqual(["translationskorean docs"]);
});
