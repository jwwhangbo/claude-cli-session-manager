import { afterEach, beforeEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeProjectDir } from "../src/core/paths.ts";

const CWD = "/work/app";
const IDS = ["aaaa1111-0000-0000-0000-000000000000", "bbbb2222-0000-0000-0000-000000000000"];
let root: string;

function writeSession(id: string, prompt: string) {
  const dir = join(root, "projects", encodeProjectDir(CWD));
  mkdirSync(dir, { recursive: true });
  const entries = [
    { type: "user", cwd: CWD, sessionId: id, timestamp: "2026-01-01T00:00:00Z", message: { role: "user", content: prompt } },
    { type: "assistant", cwd: CWD, timestamp: "2026-01-01T00:00:01Z", message: { id: "m", role: "assistant", content: [{ type: "text", text: "ok" }] } },
  ];
  writeFileSync(join(dir, `${id}.jsonl`), entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
}

/** Runs the CLI against the temp config, without this process's Claude session in the env. */
function csm(...args: string[]) {
  const { CLAUDE_CODE_SESSION_ID, ...env } = process.env;
  const r = spawnSync(process.execPath, [join(import.meta.dir, "..", "src", "cli.tsx"), ...args], { encoding: "utf8", env: { ...env, CLAUDE_CONFIG_DIR: root } });
  return { out: r.stdout + r.stderr, code: r.status };
}
const list = (...args: string[]) => JSON.parse(csm("list", "--json", ...args).out) as { id: string; tag?: string; starred: boolean; archived: boolean }[];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "csm-cli-"));
  writeSession(IDS[0]!, "Fix login");
  writeSession(IDS[1]!, "Add signup");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

test("tag, untag, star and unstar several sessions", () => {
  expect(csm("tag", "auth", "aaaa", "bbbb").out).toContain("Tagged #auth: 2 sessions");
  expect(list().map((s) => s.tag)).toEqual(["auth", "auth"]);
  csm("untag", "aaaa");
  expect(list().find((s) => s.id === IDS[0])?.tag).toBeFalsy();

  expect(csm("star", "aaaa", "aaaa1111").out).toContain("Starred 1 session"); // duplicates count once
  expect(list().filter((s) => s.starred).map((s) => s.id)).toEqual([IDS[0]!]);
  csm("unstar", "aaaa");
  expect(list().some((s) => s.starred)).toBe(false);
});

test("archive and restore", () => {
  expect(csm("archive", "aaaa").out).toContain("Archived 1 session");
  expect(list().map((s) => s.id)).toEqual([IDS[1]!]);
  expect(list("--archived").map((s) => s.id)).toEqual([IDS[0]!]);
  csm("restore", "aaaa");
  expect(list()).toHaveLength(2);
});

test("delete without --yes only lists what would be deleted", () => {
  const file = join(root, "projects", encodeProjectDir(CWD), `${IDS[0]}.jsonl`);
  const dry = csm("delete", "aaaa");
  expect(dry.code).toBe(1);
  expect(dry.out).toContain("This would permanently delete 1 session:");
  expect(dry.out).toContain("Nothing was deleted");
  expect(existsSync(file)).toBe(true);

  expect(csm("delete", "aaaa", "--yes").out).toContain("Deleted 1 session");
  expect(existsSync(file)).toBe(false);
});

test("skips running sessions and exits non-zero", () => {
  mkdirSync(join(root, "sessions"), { recursive: true });
  writeFileSync(join(root, "sessions", `${process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId: IDS[0] }));
  const r = csm("archive", "aaaa", "bbbb");
  expect(r.code).toBe(1);
  expect(r.out).toContain("skipped aaaa1111");
  expect(r.out).toContain("Archived 1 session");
});

test("unknown ids fail before changing anything", () => {
  const r = csm("archive", "bbbb", "zzzz");
  expect(r.code).toBe(1);
  expect(list()).toHaveLength(2);
});
