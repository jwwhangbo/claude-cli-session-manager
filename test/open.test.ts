import { describe, expect, test } from "bun:test";
import { _test } from "../src/core/open.ts";

const { candidates, fromOverride, currentTerminal, canOpenWindow, trySpawn } = _test;
const argv = ["/usr/bin/node", "/plugin/dist/csm.js", "--here"];
const labels = (env: Record<string, string>, platform: NodeJS.Platform = "linux") => candidates(argv, "/work", env, platform).map(([label]) => label);

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
  const order = labels({ CSM_TERMINAL: "foot", TMUX: "/tmp/tmux", KITTY_PID: "1", TERMINAL: "alacritty", WAYLAND_DISPLAY: "wayland-1" });
  expect(order.slice(0, 4)).toEqual(["CSM_TERMINAL (foot)", "tmux popup", "kitty", "alacritty"]);
  expect(order.filter((l) => l === "kitty")).toHaveLength(1);
  expect(order).toContain("xterm");
});

test.skipIf(process.platform !== "linux")("commands are argv arrays that end with the csm invocation", () => {
  for (const [, cmd] of candidates(argv, "/work", { TMUX: "x", ZELLIJ: "0", DISPLAY: ":0" }, "linux")) {
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

describe("windows only where the user can see them", () => {
  const ssh = { SSH_CONNECTION: "10.0.0.2 51000 10.0.0.1 22" };

  test("Linux needs a display; ssh -X counts because it sets DISPLAY", () => {
    expect(canOpenWindow({}, "linux")).toBe(false);
    expect(canOpenWindow({ ...ssh }, "linux")).toBe(false);
    expect(canOpenWindow({ ...ssh, DISPLAY: "localhost:10.0" }, "linux")).toBe(true);
    expect(canOpenWindow({ WAYLAND_DISPLAY: "wayland-1" }, "linux")).toBe(true);
  });

  test("macOS and Windows never open a window for an SSH session", () => {
    expect(canOpenWindow({}, "darwin")).toBe(true);
    expect(canOpenWindow({ ...ssh }, "darwin")).toBe(false);
    expect(canOpenWindow({ ...ssh }, "win32")).toBe(false);
  });

  test("over SSH without a display only popups and CSM_TERMINAL remain", () => {
    // TERM=xterm-kitty is forwarded over SSH but must not trigger a kitty window on the remote host.
    expect(labels({ ...ssh, TERM: "xterm-kitty" })).toEqual([]);
    expect(labels({ ...ssh, TMUX: "/tmp/tmux", CSM_TERMINAL: "foot" })).toEqual(["CSM_TERMINAL (foot)", "tmux popup"]);
    expect(labels({ ...ssh }, "darwin")).toEqual([]);
  });

  test("openInTerminal explains the SSH case and gives an absolute command", async () => {
    const { openInTerminal } = await import("../src/core/open.ts");
    const err = await openInTerminal([], "/", { ...ssh, TERM: "xterm-kitty" }, "linux").catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/over SSH without a display.*tmux or zellij.*another SSH session: \//);
  });
});

describe.skipIf(process.platform === "win32")("trySpawn", () => {
  test("a missing program is reported as not installed", async () => {
    expect(await trySpawn(["csm-no-such-terminal"], "/", process.env)).toBe("not installed");
  });
  test("an early non-zero exit (e.g. xterm: can't open display) is a failure", async () => {
    expect(await trySpawn(["sh", "-c", "exit 3"], "/", process.env)).toBe("exited with code 3");
  });
  test("a quick exit with code 0 (handoff to a running instance) is a success", async () => {
    expect(await trySpawn(["true"], "/", process.env)).toBeUndefined();
  });
  test("a terminal that stays up is a success", async () => {
    expect(await trySpawn(["sleep", "2"], "/", process.env)).toBeUndefined();
  });
});
