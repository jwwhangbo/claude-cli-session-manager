import { describe, expect, test } from "bun:test";
import { _test } from "../src/core/open.ts";

const { candidates, fromOverride, currentTerminal } = _test;
const argv = ["/usr/bin/node", "/plugin/dist/csm.js", "--here"];
const labels = (env: Record<string, string>) => candidates(argv, "/work", env).map(([label]) => label);

describe("fromOverride", () => {
  test("appends argv to a prefix", () => {
    expect(fromOverride("alacritty -e", argv)).toEqual(["alacritty", "-e", ...argv]);
  });
  test("a bare known terminal gets its usual flags", () => {
    expect(fromOverride("wezterm", argv)).toEqual(["wezterm", "start", "--", ...argv]);
    expect(fromOverride("/usr/bin/kitty", argv)).toEqual(["/usr/bin/kitty", ...argv]);
  });
  test("{} places argv mid-command", () => {
    expect(fromOverride("foo --run {} --hold", argv)).toEqual(["foo", "--run", ...argv, "--hold"]);
  });
});

test("detects the terminal csm runs in", () => {
  expect(currentTerminal({ KITTY_PID: "1" })).toBe("kitty");
  expect(currentTerminal({ TERM_PROGRAM: "WezTerm" })).toBe("wezterm");
  expect(currentTerminal({ TERM: "foot" })).toBe("foot");
  expect(currentTerminal({})).toBeUndefined();
});

test.skipIf(process.platform !== "linux")("candidate order: override, multiplexer, current terminal, $TERMINAL, fallbacks", () => {
  const order = labels({ CSM_TERMINAL: "foot", TMUX: "/tmp/tmux", KITTY_PID: "1", TERMINAL: "alacritty" });
  expect(order.slice(0, 4)).toEqual(["CSM_TERMINAL (foot)", "tmux popup", "kitty", "alacritty"]);
  expect(order.filter((l) => l === "kitty")).toHaveLength(1);
  expect(order).toContain("xterm");
});

test.skipIf(process.platform !== "linux")("commands are argv arrays that end with the csm invocation", () => {
  for (const [, cmd] of candidates(argv, "/work", { TMUX: "x", ZELLIJ: "0" })) {
    expect(cmd.slice(-argv.length)).toEqual(argv);
  }
});

test("strips Claude Code session env so the resumed claude is not treated as nested", () => {
  const saved = { ...process.env };
  Object.assign(process.env, { CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "abc", CLAUDE_CONFIG_DIR: "/cfg" });
  const env = _test.cleanEnv();
  process.env = saved;
  expect(env.CLAUDECODE).toBeUndefined();
  expect(env.CLAUDE_CODE_SESSION_ID).toBeUndefined();
  expect(env.CLAUDE_CONFIG_DIR).toBe("/cfg");
});
