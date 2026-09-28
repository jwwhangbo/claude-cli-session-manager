import { spawn } from "node:child_process";
import { chmodSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

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
function cleanEnv(source = process.env): NodeJS.ProcessEnv {
  const env = { ...source };
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

const isSsh = (env: NodeJS.ProcessEnv) => !!(env.SSH_CONNECTION || env.SSH_CLIENT || env.SSH_TTY);

/**
 * Whether a new desktop terminal window would actually show up in front of the user. Over SSH a
 * window would open on the remote machine's screen (or fail with "can't open display"), except
 * with X forwarding (`ssh -X`), which sets DISPLAY.
 */
function canOpenWindow(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): boolean {
  if (platform === "win32" || platform === "darwin") return !isSsh(env);
  return !!(env.DISPLAY || env.WAYLAND_DISPLAY);
}

function candidates(argv: string[], cwd: string, env = process.env, platform = process.platform): [label: string, cmd: string[]][] {
  const list: [string, string[]][] = [];
  if (env.CSM_TERMINAL) list.push([`CSM_TERMINAL (${env.CSM_TERMINAL})`, fromOverride(env.CSM_TERMINAL, argv)]);
  if (env.TMUX) {
    // Popups inherit the tmux server's environment, not ours.
    const passEnv = env.CLAUDE_CONFIG_DIR ? ["-e", `CLAUDE_CONFIG_DIR=${env.CLAUDE_CONFIG_DIR}`] : [];
    list.push(["tmux popup", ["tmux", "display-popup", "-E", "-w", "90%", "-h", "90%", "-d", cwd, ...passEnv, ...argv]]);
  }
  if (env.ZELLIJ) list.push(["zellij floating pane", ["zellij", "run", "--floating", "--close-on-exit", "--cwd", cwd, "--", ...argv]]);

  if (!canOpenWindow(env, platform)) return list;

  if (platform === "win32") {
    list.push(["Windows Terminal", ["wt.exe", "-d", cwd, ...argv]]);
    // A detached process gets its own console window on Windows.
    list.push(["new console window", argv]);
    return list;
  }
  if (platform === "darwin") {
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

/** How long a launched terminal must survive to count as opened; "can't open display" failures exit sooner. */
const EARLY_EXIT_MS = 700;

/**
 * Resolves undefined once the terminal is up, or the reason it failed. A quick exit with code 0 counts
 * as success: kitty and gnome-terminal hand the window to an already-running instance and exit.
 */
function trySpawn(cmd: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<string | undefined> {
  return new Promise((resolve) => {
    const child = spawn(cmd[0]!, cmd.slice(1), { cwd, env, detached: true, stdio: "ignore", windowsHide: false });
    child.once("error", (err: NodeJS.ErrnoException) => resolve(err.code === "ENOENT" ? "not installed" : err.message));
    child.once("spawn", () => {
      const timer = setTimeout(() => {
        child.removeAllListeners("exit");
        child.unref();
        resolve(undefined);
      }, EARLY_EXIT_MS);
      child.once("exit", (code, signal) => {
        clearTimeout(timer);
        resolve(code === 0 ? undefined : signal ? `killed by ${signal}` : `exited with code ${code}`);
      });
    });
  });
}

/** An absolute command for running the picker by hand, so it works without csm on PATH. */
function manualCommand(): string {
  const bin = join(dirname(process.argv[1]!), "..", "bin", "csm");
  return existsSync(bin) ? bin : `${process.execPath} ${process.argv[1]}`;
}

function noWindowMessage(env: NodeJS.ProcessEnv, platform: NodeJS.Platform, tried: string[]): string {
  const manual = manualCommand();
  const triedNote = tried.length ? ` (tried: ${tried.join(", ")})` : "";
  if (isSsh(env) && !canOpenWindow(env, platform)) {
    return `You're connected over SSH without a display, so csm can't open a new window${triedNote}. Start Claude inside tmux or zellij on this machine to get a popup, or run the picker from another SSH session: ${manual}`;
  }
  if (!canOpenWindow(env, platform)) {
    return `No graphical display (DISPLAY and WAYLAND_DISPLAY are unset), so csm can't open a new window${triedNote}. Run Claude inside tmux or zellij to get a popup, or run the picker in another terminal: ${manual}`;
  }
  return `Could not open a terminal${triedNote}. Set CSM_TERMINAL, e.g. CSM_TERMINAL="alacritty -e", or run the picker in another terminal: ${manual}`;
}

/** Opens `csm [args]` in a new terminal, re-running this same runtime and bundle so PATH does not matter. */
export async function openInTerminal(args: string[], cwd = process.cwd(), env = process.env, platform = process.platform): Promise<OpenResult> {
  const argv = [process.execPath, process.argv[1]!, ...args];
  const childEnv = cleanEnv(env);
  const tried: string[] = [];
  for (const [label, cmd] of candidates(argv, cwd, env, platform)) {
    const failure = await trySpawn(cmd, cwd, childEnv);
    if (!failure) return { via: label };
    // Absent emulators are just probing noise; only report the ones that actually ran and failed.
    if (failure !== "not installed") tried.push(`${label}: ${failure}`);
  }
  throw new Error(noWindowMessage(env, platform, tried));
}

export const _test = { candidates, fromOverride, currentTerminal, cleanEnv, canOpenWindow, trySpawn };
