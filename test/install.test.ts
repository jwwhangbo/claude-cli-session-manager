import { afterAll, beforeAll, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { installCli, uninstallCli } from "../src/core/install.ts";

let root: string;
let cfg: string;
const prevConfig = process.env.CLAUDE_CONFIG_DIR;

/** A fake plugin copy whose bin/csm prints its version and args. */
function fakePlugin(dir: string, version: string) {
  const bin = join(dir, "bin", "csm");
  mkdirSync(dirname(bin), { recursive: true });
  writeFileSync(bin, `#!/bin/sh\necho "${version} $*"\n`);
  chmodSync(bin, 0o755);
  return bin;
}

function setInstalled(installPath?: string) {
  const plugins = installPath ? { "claude-session-manager@some-marketplace": [{ scope: "user", installPath }] } : {};
  writeFileSync(join(cfg, "plugins", "installed_plugins.json"), JSON.stringify({ version: 2, plugins }));
}

const runShim = (file: string) =>
  spawnSync(file, ["list", "--here"], { encoding: "utf8", env: { PATH: dirname(process.execPath) + ":/usr/bin:/bin", CLAUDE_CONFIG_DIR: cfg } });

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "csm-install-"));
  cfg = join(root, "cfg");
  mkdirSync(join(cfg, "plugins"), { recursive: true });
  process.env.CLAUDE_CONFIG_DIR = cfg;
});
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  if (prevConfig === undefined) delete process.env.CLAUDE_CONFIG_DIR;
  else process.env.CLAUDE_CONFIG_DIR = prevConfig;
});

test("the shim follows the installed plugin version across updates", () => {
  const cache = join(cfg, "plugins", "cache", "mp", "claude-session-manager");
  const v1 = fakePlugin(join(cache, "0.1.0"), "v0.1.0");
  fakePlugin(join(cache, "0.2.0"), "v0.2.0");
  setInstalled(join(cache, "0.1.0"));
  const binDir = join(root, "bin");
  const r = installCli({ dir: binDir, bin: v1, env: { HOME: root, PATH: `/usr/bin:${binDir}`, SHELL: "/usr/bin/fish" } });
  expect(r).toMatchObject({ file: join(binDir, "csm"), tracksPlugin: true, onPath: true });
  expect(runShim(r.file).stdout).toBe("v0.1.0 list --here\n");

  setInstalled(join(cache, "0.2.0"));
  expect(runShim(r.file).stdout).toBe("v0.2.0 list --here\n");

  // Plugin missing from the registry: falls back to the copy install ran from.
  setInstalled();
  expect(runShim(r.file).stdout).toBe("v0.1.0 list --here\n");
});

test("a checkout outside the plugin cache is pinned", () => {
  const dev = fakePlugin(join(root, "checkout"), "dev");
  setInstalled(join(cfg, "plugins", "cache", "mp", "claude-session-manager", "0.2.0"));
  const r = installCli({ dir: join(root, "bin-dev"), bin: dev, env: { HOME: root, PATH: "/usr/bin" } });
  expect(r.tracksPlugin).toBe(false);
  expect(runShim(r.file).stdout).toBe("dev list --here\n");
});

test("reports a missing PATH entry with a hint for the user's shell", () => {
  const bin = fakePlugin(join(root, "p"), "x");
  const dir = join(root, ".local", "bin");
  expect(installCli({ bin, env: { HOME: root, PATH: "/usr/bin", SHELL: "/bin/zsh" } })).toMatchObject({
    file: join(dir, "csm"),
    onPath: false,
    pathHint: `echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc`,
  });
  expect(installCli({ bin, env: { HOME: root, PATH: "/usr/bin", SHELL: "/usr/bin/fish" } }).pathHint).toBe("fish_add_path ~/.local/bin");
});

test("warns when another csm comes first on PATH", () => {
  const bin = fakePlugin(join(root, "p"), "x");
  const other = join(root, "other");
  mkdirSync(other, { recursive: true });
  writeFileSync(join(other, "csm"), "#!/bin/sh\n");
  const dir = join(root, "bin-shadow");
  expect(installCli({ dir, bin, env: { HOME: root, PATH: `${other}:${dir}` } }).shadowedBy).toBe(join(other, "csm"));
});

test("won't overwrite or remove a file it didn't write, but replaces an old symlink", () => {
  const bin = fakePlugin(join(root, "p"), "x");
  const dir = join(root, "bin-foreign");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "csm"), "#!/bin/sh\necho someone else\n");
  expect(() => installCli({ dir, bin, env: { HOME: root } })).toThrow("isn't a csm shim");
  expect(() => uninstallCli({ dir, env: { HOME: root } })).toThrow("leaving it alone");
  expect(installCli({ dir, bin, force: true, env: { HOME: root } }).file).toBe(join(dir, "csm"));

  const linkDir = join(root, "bin-link");
  const oldPlugin = fakePlugin(join(root, "cache", "claude-session-manager", "0.0.9"), "old");
  mkdirSync(linkDir, { recursive: true });
  symlinkSync(oldPlugin, join(linkDir, "csm"));
  installCli({ dir: linkDir, bin, env: { HOME: root } });
  expect(runShim(join(linkDir, "csm")).stdout).toBe("x list --here\n");
  expect(existsSync(oldPlugin)).toBe(true); // replaced the link, didn't write through it

  expect(uninstallCli({ dir: linkDir, env: { HOME: root } })).toBe(join(linkDir, "csm"));
  expect(existsSync(join(linkDir, "csm"))).toBe(false);
  expect(uninstallCli({ dir: linkDir, env: { HOME: root } })).toBeUndefined();
});
