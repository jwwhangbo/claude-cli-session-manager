import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, delimiter, dirname, join, resolve, sep } from "node:path";
import { claudeDir } from "./paths.ts";

/** First line after the shebang; marks a file as ours so install can overwrite it and uninstall can remove it. */
const MARKER = "# csm shim, written by `csm install`.";
const PLUGIN = "claude-session-manager@";

export interface InstallOptions {
  dir?: string;
  force?: boolean;
  env?: NodeJS.ProcessEnv;
  /** The bin/csm of the plugin copy that is running; defaults to the one next to this bundle. */
  bin?: string;
}

export interface InstallResult {
  file: string;
  /** True when the shim follows plugin updates, false when it's pinned to a checkout (e.g. --plugin-dir). */
  tracksPlugin: boolean;
  onPath: boolean;
  /** Another csm that comes earlier on PATH and would shadow this one. */
  shadowedBy?: string;
  pathHint?: string;
}

export const runningBin = () => resolve(dirname(process.argv[1]!), "..", "bin", "csm");

const sq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/**
 * A POSIX sh script that asks Node (or Bun) for the installPath of the installed plugin in
 * installed_plugins.json, so `/plugin update` swaps the version without reinstalling. When the plugin
 * isn't installed, or for a pinned checkout, it runs the fixed bin/csm instead.
 */
export function shimScript(fallback: string, tracksPlugin: boolean): string {
  const find = `const f=process.argv[1];try{const p=JSON.parse(require("fs").readFileSync(f,"utf8")).plugins||{};for(const k in p)if(k.startsWith(${JSON.stringify(PLUGIN)}))for(const e of p[k])if(e.installPath&&require("fs").existsSync(e.installPath+"/bin/csm")){process.stdout.write(e.installPath);process.exit(0)}}catch{}`;
  return `#!/bin/sh
${MARKER}
# Runs csm from the claude-session-manager Claude Code plugin. Re-run \`csm install\` to update it, or \`csm uninstall\` to remove it.
fallback=${sq(fallback)}
${
  tracksPlugin
    ? `root=""
for rt in node bun; do
  if command -v "$rt" >/dev/null 2>&1; then
    root=$("$rt" -e ${sq(find)} "\${CLAUDE_CONFIG_DIR:-$HOME/.claude}/plugins/installed_plugins.json" 2>/dev/null)
    break
  fi
done
[ -n "$root" ] && exec "$root/bin/csm" "$@"
`
    : ""
}[ -x "$fallback" ] && exec "$fallback" "$@"
echo "csm: can't find the claude-session-manager plugin. Reinstall it in Claude Code, then run /claude-session-manager:install-cli again." >&2
exit 127
`;
}

function isOurs(file: string): boolean {
  try {
    if (lstatSync(file).isSymbolicLink()) {
      // The README used to suggest symlinking the plugin's bin/csm; treat that as ours too.
      const target = realpathSync(file);
      return basename(target) === "csm" && target.includes("claude-session-manager");
    }
    return readFileSync(file, "utf8").split("\n", 3).includes(MARKER);
  } catch {
    return false;
  }
}

const pathDirs = (env: NodeJS.ProcessEnv) => (env.PATH ?? "").split(delimiter).filter(Boolean).map((d) => resolve(d));

function defaultDir(env: NodeJS.ProcessEnv): string {
  const home = env.HOME || homedir();
  const candidates = [join(home, ".local", "bin"), join(home, "bin")];
  const onPath = new Set(pathDirs(env));
  return candidates.find((d) => onPath.has(d)) ?? candidates[0]!;
}

/** The line to add to the user's shell config, for the shell in $SHELL. */
function pathHint(dir: string, env: NodeJS.ProcessEnv): string {
  const home = env.HOME || homedir();
  const shown = dir.startsWith(home + sep) ? "$HOME" + dir.slice(home.length) : dir;
  switch (basename(env.SHELL ?? "")) {
    case "fish":
      return `fish_add_path ${shown.replace("$HOME", "~")}`;
    case "zsh":
      return `echo 'export PATH="${shown}:$PATH"' >> ~/.zshrc`;
    case "nu":
      return `$env.PATH = ($env.PATH | prepend '${dir}')   # in your nushell config.nu`;
    default:
      return `echo 'export PATH="${shown}:$PATH"' >> ~/.bashrc`;
  }
}

/** Finds the csm the shell would run, if it isn't the one at `file`. */
function shadowing(file: string, env: NodeJS.ProcessEnv): string | undefined {
  for (const d of pathDirs(env)) {
    const candidate = join(d, "csm");
    if (candidate === file) return;
    if (existsSync(candidate)) return candidate;
  }
}

export function installCli({ dir, force = false, env = process.env, bin = runningBin() }: InstallOptions = {}): InstallResult {
  if (process.platform === "win32") {
    throw new Error(`csm install supports macOS and Linux. On Windows, run: node "${join(dirname(bin), "..", "dist", "csm.js")}"`);
  }
  if (!existsSync(bin)) throw new Error(`Can't find ${bin}; run csm install from the plugin's own csm.`);
  const target = resolve(dir ?? defaultDir(env));
  const file = join(target, "csm");
  if (existsSync(file) && !force && !isOurs(file)) {
    throw new Error(`${file} already exists and isn't a csm shim. Pass --force to replace it, or --dir to install elsewhere.`);
  }
  // Only a copy in Claude Code's plugin cache is managed by /plugin update; anything else (a
  // --plugin-dir checkout) is pinned to where it is.
  const tracksPlugin = resolve(bin).startsWith(join(claudeDir(), "plugins") + sep);
  mkdirSync(target, { recursive: true });
  rmSync(file, { force: true }); // replaces a symlink rather than writing through it
  writeFileSync(file, shimScript(resolve(bin), tracksPlugin));
  chmodSync(file, 0o755);
  const onPath = pathDirs(env).includes(target);
  return { file, tracksPlugin, onPath, shadowedBy: onPath ? shadowing(file, env) : undefined, pathHint: onPath ? undefined : pathHint(target, env) };
}

export function uninstallCli({ dir, env = process.env }: InstallOptions = {}): string | undefined {
  const file = join(resolve(dir ?? defaultDir(env)), "csm");
  if (!existsSync(file) && !isSymlink(file)) return;
  if (!isOurs(file)) throw new Error(`${file} isn't a csm shim; leaving it alone.`);
  rmSync(file, { force: true });
  return file;
}

function isSymlink(file: string) {
  try {
    return lstatSync(file).isSymbolicLink();
  } catch {
    return false;
  }
}
