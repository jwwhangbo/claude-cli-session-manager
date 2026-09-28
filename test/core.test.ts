import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { archiveSession, deleteSession, renameSession, sessionToMarkdown, tagSession, unarchiveSession } from "../src/core/actions.ts";
import { findSession, loadSessions } from "../src/core/index.ts";
import { loadMeta, toggleStar } from "../src/core/meta.ts";
import { parseSessionMeta, parseTranscript } from "../src/core/parse.ts";
import { encodeProjectDir } from "../src/core/paths.ts";
import { filterSessions } from "../src/core/search.ts";

const CWD = "/work/my-app";
let root: string;

const user = (content: unknown, ts: string, extra = {}) => ({ type: "user", cwd: CWD, gitBranch: "main", sessionId: "x", timestamp: ts, message: { role: "user", content }, ...extra });
const assistant = (id: string, content: unknown[], ts: string, usage = { input_tokens: 10, output_tokens: 5 }) => ({
  type: "assistant",
  cwd: CWD,
  timestamp: ts,
  message: { id, model: "claude-opus-5-5", role: "assistant", content, usage },
});

function writeSession(id: string, entries: unknown[], opts: { cwd?: string; raw?: string } = {}) {
  const dir = join(root, "projects", encodeProjectDir(opts.cwd ?? CWD));
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${id}.jsonl`);
  const withCwd = entries.map((e: any) => (opts.cwd && e.cwd ? { ...e, cwd: opts.cwd } : e));
  writeFileSync(file, withCwd.map((e) => JSON.stringify(e)).join("\n") + "\n" + (opts.raw ?? ""));
  return file;
}

const basic = (title?: string) => [
  { type: "mode", mode: "normal", sessionId: "x" },
  user("<command-name>/model</command-name>", "2026-01-01T00:00:00Z"),
  user("Fix the login bug", "2026-01-01T00:00:01Z"),
  assistant("m1", [{ type: "text", text: "Looking." }], "2026-01-01T00:00:02Z"),
  assistant("m1", [{ type: "tool_use", name: "Edit", input: { file_path: "/work/my-app/login.ts" } }], "2026-01-01T00:00:03Z"),
  user([{ type: "tool_result", content: "ok" }], "2026-01-01T00:00:04Z"),
  assistant("m2", [{ type: "text", text: "Fixed." }], "2026-01-01T00:00:05Z"),
  ...(title ? [{ type: "ai-title", aiTitle: title, sessionId: "x" }] : []),
];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "csm-test-"));
  process.env.CLAUDE_CONFIG_DIR = root;
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("parseSessionMeta", () => {
  test("extracts metadata and skips tool results, commands and malformed lines", () => {
    const file = writeSession("aaaa1111", basic(), { raw: '{"type":"user", "trunc' });
    const m = parseSessionMeta(file);
    expect(m.id).toBe("aaaa1111");
    expect(m.cwd).toBe(CWD);
    expect(m.gitBranch).toBe("main");
    expect(m.title).toBe("Fix the login bug");
    expect(m.titleSource).toBe("prompt");
    expect(m.replyCount).toBe(2); // m1 split across two entries counts once
    expect(m.messageCount).toBe(4); // /model, prompt, m1, m2
    expect(m.tokens.output).toBe(10);
    expect(m.filesTouched).toEqual(["/work/my-app/login.ts"]);
    expect(m.model).toBe("claude-opus-5-5");
    expect(m.created).toBe(Date.parse("2026-01-01T00:00:00Z"));
    expect(m.updated).toBe(Date.parse("2026-01-01T00:00:05Z"));
  });

  test("custom title beats ai title beats first prompt; last one wins", () => {
    const file = writeSession("bbbb", [...basic("AI title"), { type: "custom-title", customTitle: "Old" }, { type: "custom-title", customTitle: "New" }]);
    expect(parseSessionMeta(file)).toMatchObject({ title: "New", titleSource: "custom" });
    expect(parseSessionMeta(writeSession("cccc", basic("AI title")))).toMatchObject({ title: "AI title", titleSource: "ai" });
  });

  test("relocated cwd overrides the recorded one", () => {
    const file = writeSession("dddd", [...basic(), { type: "relocated", relocatedCwd: "/new/place" }]);
    expect(parseSessionMeta(file).cwd).toBe("/new/place");
  });
});

test("parseTranscript merges an assistant turn across tool calls", () => {
  const items = parseTranscript(writeSession("eeee", basic()));
  expect(items.map((i) => i.role)).toEqual(["user", "user", "assistant"]);
  expect(items[1]!.text).toBe("Fix the login bug");
  expect(items[2]!.text).toBe("Looking.\n\nFixed.");
  expect(items[2]!.tools).toEqual(["Edit: /work/my-app/login.ts"]);
});

describe("loadSessions", () => {
  test("hides sessions without replies and sorts newest first", () => {
    writeSession("old", basic());
    writeSession("empty", [user("hello", "2026-02-01T00:00:00Z")]);
    writeSession("new", basic().map((e: any) => (e.timestamp ? { ...e, timestamp: e.timestamp.replace("2026-01", "2026-03") } : e)), { cwd: "/other" });
    expect(loadSessions().map((s) => s.id)).toEqual(["new", "old"]);
  });

  test("cache is invalidated when a file changes", () => {
    const file = writeSession("s1", basic());
    expect(loadSessions()[0]!.title).toBe("Fix the login bug");
    writeFileSync(file, readFileSync(file, "utf8") + JSON.stringify({ type: "custom-title", customTitle: "Renamed!" }) + "\n");
    expect(loadSessions()[0]!.title).toBe("Renamed!");
  });

  test("findSession resolves unique prefixes", () => {
    writeSession("abc123", basic());
    writeSession("abd456", basic());
    expect(findSession("abc").id).toBe("abc123");
    expect(() => findSession("ab")).toThrow(/Ambiguous/);
    expect(() => findSession("zz")).toThrow(/No session/);
  });
});

describe("actions", () => {
  test("rename and tag append native entries", () => {
    const file = writeSession("r1", basic());
    renameSession(findSession("r1"), "  My title ");
    tagSession(findSession("r1"), "bugfix");
    const lines = readFileSync(file, "utf8").trim().split("\n").slice(-2).map((l) => JSON.parse(l));
    expect(lines).toEqual([
      { type: "custom-title", customTitle: "My title", sessionId: "r1" },
      { type: "tag", tag: "bugfix", sessionId: "r1" },
    ]);
    expect(findSession("r1")).toMatchObject({ title: "My title", tag: "bugfix" });
  });

  test("refuses to modify a running session", () => {
    writeSession("live", basic());
    expect(() => renameSession({ ...findSession("live"), running: true }, "x")).toThrow(/running/);
  });

  test("archive moves the jsonl and its sibling dir, unarchive restores them", () => {
    const file = writeSession("ar1", basic());
    const sibling = join(file, "..", "ar1", "tool-results");
    mkdirSync(sibling, { recursive: true });
    archiveSession(findSession("ar1"));
    expect(existsSync(file)).toBe(false);
    expect(existsSync(sibling)).toBe(false);
    const archived = findSession("ar1");
    expect(archived.archived).toBe(true);
    expect(filterSessions(loadSessions(), {}).map((s) => s.id)).not.toContain("ar1");
    unarchiveSession(archived);
    expect(existsSync(file)).toBe(true);
    expect(existsSync(sibling)).toBe(true);
  });

  test("delete removes the session, sibling dir and star", () => {
    const file = writeSession("del1", basic());
    mkdirSync(join(file, "..", "del1"));
    toggleStar("del1");
    deleteSession(findSession("del1"));
    expect(existsSync(file)).toBe(false);
    expect(existsSync(join(file, "..", "del1"))).toBe(false);
    expect(loadMeta().stars).toEqual({});
  });

  test("markdown export includes metadata and transcript", () => {
    writeSession("md1", basic("Login fix"));
    const md = sessionToMarkdown(findSession("md1"));
    expect(md).toStartWith("# Login fix");
    expect(md).toContain("Fix the login bug");
    expect(md).toContain("> 🔧 Edit: /work/my-app/login.ts");
  });
});

test("filterSessions fuzzy-matches and filters by project and stars", () => {
  writeSession("a", basic("Hyprland keybinds"));
  writeSession("b", basic("README translation"), { cwd: "/docs" });
  const all = loadSessions();
  expect(filterSessions(all, { query: "hypr" }).map((s) => s.id)).toEqual(["a"]);
  expect(filterSessions(all, { cwd: "/docs" }).map((s) => s.id)).toEqual(["b"]);
  expect(filterSessions(all, { starredOnly: true, stars: { b: true } }).map((s) => s.id)).toEqual(["b"]);
});
