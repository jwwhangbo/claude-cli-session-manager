import { spawn } from "node:child_process";
import { chmodSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

/**
 * Opens the csm picker in a new terminal surface. Everything is launched as an argv array
 * (never a shell string), so it works the same under bash, zsh, fish, nushell or PowerShell.
 */

export interface OpenResult {
  via: string;
}

/** Argument placement for known terminal emulators: argv is appended after these flags. */
const TERMINALS: Record<string, string[]> = {
  kitty: [],
  foot: [],
  alacritty: ["-e"],
  wezterm: ["start", "--"],
  ghostty: ["-e"],
  "gnome-terminal": ["--"],
  kgx: ["--"],
  konsole: ["-e"],
  "xfce4-terminal": ["-x"],
  tilix: ["-e"],
  terminator: ["-x"],
  "x-terminal-emulator": ["-e"],
  urxvt: ["-e"],
  st: ["-e"],
  xterm: ["-e"],
};

/** Env vars that would make the resumed `claude` think it is nested inside this Claude Code session. */
function cleanEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key === "CLAUDECODE" || key === "CLAUDE_PID" || key === "CLAUDE_EFFORT" || key.startsWith("CLAUDE_CODE_")) delete env[key];
  }
  return env;
}

/** The terminal csm itself is running in, from the env vars each emulator exports. */
function currentTerminal(env = process.env): string | undefined {
  if (env.KITTY_PID || env.TERM === "xterm-kitty") return "kitty";
  if (env.WEZTERM_PANE || env.TERM_PROGRAM === "WezTerm") return "wezterm";
  if (env.GHOSTTY_RESOURCES_DIR || env.TERM_PROGRAM === "ghostty") return "ghostty";
  if (env.ALACRITTY_WINDOW_ID || env.ALACRITTY_SOCKET) return "alacritty";
  if (env.KONSOLE_VERSION) return "konsole";
  if (env.TERM?.startsWith("foot")) return "foot";
  if (env.GNOME_TERMINAL_SCREEN) return "gnome-terminal";
  if (env.TILIX_ID) return "tilix";
}

/** `CSM_TERMINAL` is an argv prefix such as "alacritty -e"; a bare known name gets its usual flags. `{}` marks where argv goes. */
function fromOverride(spec: string, argv: string[]): string[] {
  const parts = spec.trim().split(/\s+/);
  const slot = parts.indexOf("{}");
  if (slot >= 0) return [...parts.slice(0, slot), ...argv, ...parts.slice(slot + 1)];
  const flags = parts.length === 1 ? TERMINALS[basename(parts[0]!)] ?? ["-e"] : [];
  return [...parts, ...flags, ...argv];
}

function candidates(argv: string[], cwd: string, env = process.env): [label: string, cmd: string[]][] {
  const list: [string, string[]][] = [];
  if (env.CSM_TERMINAL) list.push([`CSM_TERMINAL (${env.CSM_TERMINAL})`, fromOverride(env.CSM_TERMINAL, argv)]);
  if (env.TMUX) {
    // Popups inherit the tmux server's environment, not ours.
    const passEnv = env.CLAUDE_CONFIG_DIR ? ["-e", `CLAUDE_CONFIG_DIR=${env.CLAUDE_CONFIG_DIR}`] : [];
    list.push(["tmux popup", ["tmux", "display-popup", "-E", "-w", "90%", "-h", "90%", "-d", cwd, ...passEnv, ...argv]]);
  }
  if (env.ZELLIJ) list.push(["zellij floating pane", ["zellij", "run", "--floating", "--close-on-exit", "--cwd", cwd, "--", ...argv]]);

  if (process.platform === "win32") {
    list.push(["Windows Terminal", ["wt.exe", "-d", cwd, ...argv]]);
    // A detached process gets its own console window on Windows.
    list.push(["new console window", argv]);
    return list;
  }
  if (process.platform === "darwin") {
    const app = env.TERM_PROGRAM === "iTerm.app" ? "iTerm" : env.TERM_PROGRAM === "WezTerm" ? "WezTerm" : env.TERM_PROGRAM === "ghostty" ? "Ghostty" : "Terminal";
    list.push([app, ["open", "-a", app, commandFile(argv, cwd)]]);
    return list;
  }

  const current = currentTerminal(env);
  const order = [...(current ? [current] : []), ...(env.TERMINAL ? [env.TERMINAL] : []), ...Object.keys(TERMINALS)];
  for (const term of new Set(order)) list.push([basename(term), [term, ...(TERMINALS[basename(term)] ?? ["-e"]), ...argv]]);
  return list;
}

/** macOS terminals open files, not argv. A /bin/sh shebang keeps this independent of the user's login shell. */
function commandFile(argv: string[], cwd: string): string {
  const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
  const file = join(tmpdir(), `csm-open-${process.pid}.command`);
  writeFileSync(file, `#!/bin/sh\ncd ${q(cwd)} || exit 1\nrm -f "$0"\nexec ${argv.map(q).join(" ")}\n`);
  chmodSync(file, 0o755);
  return file;
}

/** Resolves true once the process has started, false if the executable does not exist. */
function trySpawn(cmd: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(cmd[0]!, cmd.slice(1), { cwd, env, detached: true, stdio: "ignore", windowsHide: false });
    child.once("error", () => resolve(false));
    child.once("spawn", () => {
      child.unref();
      resolve(true);
    });
  });
}

/** Opens `csm [args]` in a new terminal, re-running this same runtime and bundle so PATH does not matter. */
export async function openInTerminal(args: string[], cwd = process.cwd()): Promise<OpenResult> {
  const argv = [process.execPath, process.argv[1]!, ...args];
  const env = cleanEnv();
  const tried: string[] = [];
  for (const [label, cmd] of candidates(argv, cwd)) {
    if (await trySpawn(cmd, cwd, env)) return { via: label };
    tried.push(label);
  }
  throw new Error(`Could not find a terminal to open (tried: ${tried.join(", ")}). Set CSM_TERMINAL, e.g. CSM_TERMINAL="alacritty -e".`);
}

export const _test = { candidates, fromOverride, currentTerminal, cleanEnv };
