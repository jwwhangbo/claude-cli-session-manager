import { render } from "ink";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import pkg from "../package.json" with { type: "json" };
import { archiveSession, deleteSession, exportSession, renameSession, sessionToMarkdown, tagSession, unarchiveSession } from "./core/actions.ts";
import { findSession, loadSessions, type SessionRecord } from "./core/index.ts";
import { launchClaude, type LaunchRequest } from "./core/launch.ts";
import { addToGroup, dissolveGroup, groupsBySession, loadMeta, removeFromGroup, renameGroup, setStarred } from "./core/meta.ts";
import { installCli, uninstallCli } from "./core/install.ts";
import { openInTerminal } from "./core/open.ts";
import { parseTranscript } from "./core/parse.ts";
import { shortPath } from "./core/paths.ts";
import { filterSessions } from "./core/search.ts";
import { App } from "./ui/App.tsx";
import { fit, relTime } from "./ui/format.ts";

const USAGE = `csm ${pkg.version} — a better session manager for Claude Code

Usage:
  csm [query]                  interactive picker across all projects (--here: this project only)
  csm list [--here|--project <dir>] [--group <name>] [--archived] [--limit N] [--json]
  csm search <query> [--limit N] [--json]
  csm show <id> [--json]       metadata and transcript as markdown
  csm export <id> [-o file]    write the transcript to a markdown file
  csm rename <id> <title>      set the title shown here and in /resume
  csm resume <id> [--fork]     resume in the session's original directory
  csm tag <tag> <id>…          set the native tag (shown in /resume); csm untag <id>… clears it
  csm star <id>… | unstar <id>…
  csm archive <id>…            move sessions out of /resume into csm's archive (undo with restore)
  csm restore <id>…            move archived sessions back
  csm delete <id>… --yes       permanently delete; without --yes it only lists what would go
  csm group list [--json]      groups with their sessions
  csm group add <name> <id>…   add sessions to a group (creates it)
  csm group rm <name> <id>…    remove sessions from a group
  csm group rename <old> <new> rename (or merge into an existing) group
  csm group dissolve <name>    delete a group; its sessions are kept
  csm open [--here] [query]    open the picker in a new terminal window, tmux popup or zellij pane
                               (for use from inside Claude Code; override with CSM_TERMINAL="alacritty -e")
  csm install [--dir <dir>] [--force]
                               put csm on your shell's PATH (default ~/.local/bin); it follows plugin updates
  csm uninstall [--dir <dir>]  remove it again

<id> may be any unique prefix of a session id. Sessions open in a running Claude Code are skipped.`;

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    here: { type: "boolean" },
    project: { type: "string" },
    group: { type: "string" },
    archived: { type: "boolean" },
    limit: { type: "string" },
    json: { type: "boolean" },
    fork: { type: "boolean" },
    yes: { type: "boolean", short: "y" },
    output: { type: "string", short: "o" },
    dir: { type: "string" },
    force: { type: "boolean" },
    help: { type: "boolean", short: "h" },
    version: { type: "boolean", short: "v" },
  },
});

const COMMANDS = new Set(["list", "search", "show", "export", "rename", "resume", "open", "group", "install", "uninstall", "tag", "untag", "star", "unstar", "archive", "restore", "delete"]);

function printList(sessions: SessionRecord[]) {
  const limit = opts.limit ? Number(opts.limit) : opts.json ? Infinity : 30;
  const shown = sessions.slice(0, limit);
  if (opts.json) {
    const meta = loadMeta();
    const groupsOf = groupsBySession(meta.groups);
    const rows = shown.map(({ file, size, mtime, ...s }) => ({ ...s, starred: !!meta.stars[s.id], groups: groupsOf.get(s.id) ?? [], file }));
    return console.log(JSON.stringify(rows, null, 2));
  }
  const width = process.stdout.columns || 120;
  for (const s of shown) {
    const title = s.tag ? `#${s.tag} ${s.title}` : s.title;
    console.log(`${s.id.slice(0, 8)}  ${relTime(s.updated).padStart(4)}  ${fit(shortPath(s.cwd), 30)}  ${fit(title, Math.max(20, width - 48))}`);
  }
  if (sessions.length > shown.length) console.log(`… ${sessions.length - shown.length} more (use --limit)`);
}

function requireArg(value: string | undefined, name: string): string {
  if (!value) throw new Error(`Missing <${name}>.\n\n${USAGE}`);
  return value;
}

function groupCommand([sub, ...args]: string[], sessions: SessionRecord[]) {
  const ids = () => args.slice(1).map((prefix) => findSession(prefix, sessions).id);
  switch (sub) {
    case "list":
    case undefined: {
      const { groups } = loadMeta();
      const byId = new Map(sessions.map((s) => [s.id, s]));
      if (opts.json) return console.log(JSON.stringify(groups, null, 2));
      if (!Object.keys(groups).length) return console.log("No groups yet. Create one with: csm group add <name> <id>…");
      for (const [name, members] of Object.entries(groups).sort(([a], [b]) => a.localeCompare(b))) {
        console.log(`${name} (${members.length})`);
        for (const id of members) console.log(`  ${id.slice(0, 8)}  ${byId.get(id)?.title ?? "(missing session)"}`);
      }
      return;
    }
    case "add": {
      const name = requireArg(args[0], "name");
      const added = ids();
      if (!added.length) throw new Error("Missing <id>.");
      addToGroup(name, added);
      return console.log(`Added ${added.length} to "${name.trim()}"`);
    }
    case "rm": {
      const name = requireArg(args[0], "name");
      removeFromGroup(name, ids());
      return console.log(`Removed from "${name}"`);
    }
    case "rename":
      renameGroup(requireArg(args[0], "old"), requireArg(args[1], "new"));
      return console.log(`Renamed "${args[0]}" to "${args[1]!.trim()}"`);
    case "dissolve":
      dissolveGroup(requireArg(args[0], "name"));
      return console.log(`Dissolved "${args[0]}" (sessions kept)`);
    default:
      throw new Error(`Unknown group command "${sub}".\n\n${USAGE}`);
  }
}

const plural = (n: number) => `${n} session${n === 1 ? "" : "s"}`;
const describe = (s: SessionRecord) => `${s.id.slice(0, 8)}  ${fit(shortPath(s.cwd), 30)}  ${s.title}`;

/** Applies fn to each session, reporting (and skipping) the ones it refuses, e.g. running sessions. */
function bulk(verb: string, prefixes: string[], sessions: SessionRecord[], fn: (s: SessionRecord) => void) {
  if (!prefixes.length) throw new Error(`Missing <id>.\n\n${USAGE}`);
  const targets = [...new Map(prefixes.map((p) => findSession(p, sessions)).map((s) => [s.id, s])).values()];
  let done = 0;
  for (const s of targets) {
    try {
      fn(s);
      done++;
    } catch (err) {
      console.error(`skipped ${s.id.slice(0, 8)}: ${(err as Error).message}`);
      process.exitCode = 1;
    }
  }
  console.log(`${verb} ${plural(done)}`);
}

async function runTui(query: string) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("The interactive picker needs a terminal. Use `csm open` to launch it in a new window, or `csm list` / `csm search`.");
  }
  let launch: LaunchRequest | undefined;
  const cwd = opts.here ? process.cwd() : opts.project ? resolve(opts.project) : undefined;
  const app = render(<App initialCwd={cwd} initialQuery={query} onLaunch={(req) => (launch = req)} />, { alternateScreen: true });
  await app.waitUntilExit();
  if (launch) process.exitCode = launchClaude(launch);
}

async function main() {
  if (opts.version) return console.log(pkg.version);
  if (opts.help) return console.log(USAGE);
  const [first, ...rest] = positionals;
  const command = first && COMMANDS.has(first) ? first : undefined;
  if (!command) return runTui(positionals.join(" "));

  if (command === "open") {
    const project = opts.here ? process.cwd() : opts.project && resolve(opts.project);
    const { via } = await openInTerminal([...(project ? ["--project", project] : []), ...rest]);
    return console.log(`Opened the csm picker (${via}).`);
  }

  if (command === "install") {
    const r = installCli({ dir: opts.dir, force: opts.force });
    const lines = [`Installed csm at ${r.file}.`];
    lines.push(
      r.tracksPlugin
        ? "It runs whichever plugin version Claude Code has installed, so /plugin update updates it too."
        : `It's pinned to this checkout (${resolve(process.argv[1]!, "..", "..")}), not the installed plugin.`,
    );
    if (r.pathHint) lines.push(`${dirname(r.file)} isn't on your PATH. Add it with:\n  ${r.pathHint}\nthen open a new terminal.`);
    else if (r.shadowedBy) lines.push(`Warning: ${r.shadowedBy} comes first on your PATH, so \`csm\` runs that one instead.`);
    else lines.push("Run `csm` in any terminal to open the picker.");
    return console.log(lines.join("\n"));
  }
  if (command === "uninstall") {
    const file = uninstallCli({ dir: opts.dir });
    return console.log(file ? `Removed ${file}.` : "csm isn't installed there; nothing to remove.");
  }

  const sessions = loadSessions();
  switch (command) {
    case "list": {
      const cwd = opts.here ? process.cwd() : opts.project ? resolve(opts.project) : undefined;
      const groupsOf = groupsBySession(loadMeta().groups);
      return printList(filterSessions(sessions, { cwd, group: opts.group, groupsOf, showArchived: opts.archived }));
    }
    case "search": {
      const groupsOf = groupsBySession(loadMeta().groups);
      return printList(filterSessions(sessions, { query: requireArg(rest.join(" "), "query"), groupsOf, showArchived: opts.archived }));
    }
    case "group":
      return groupCommand(rest, sessions);
    case "show": {
      const s = findSession(requireArg(rest[0], "id"), sessions);
      if (opts.json) {
        return console.log(JSON.stringify({ ...s, transcript: parseTranscript(s.file) }, null, 2));
      }
      return console.log(sessionToMarkdown(s));
    }
    case "export": {
      const s = findSession(requireArg(rest[0], "id"), sessions);
      return console.log(`Exported to ${exportSession(s, opts.output && resolve(opts.output))}`);
    }
    case "rename": {
      const s = findSession(requireArg(rest[0], "id"), sessions);
      renameSession(s, requireArg(rest.slice(1).join(" "), "title"));
      return console.log(`Renamed ${s.id.slice(0, 8)}`);
    }
    case "tag": {
      const tag = requireArg(rest[0], "tag");
      return bulk(`Tagged #${tag}:`, rest.slice(1), sessions, (s) => tagSession(s, tag));
    }
    case "untag":
      return bulk("Cleared the tag on", rest, sessions, (s) => tagSession(s, ""));
    case "star":
    case "unstar":
      return bulk(command === "star" ? "Starred" : "Unstarred", rest, sessions, (s) => setStarred([s.id], command === "star"));
    case "archive":
      return bulk("Archived", rest, sessions, archiveSession);
    case "restore":
      return bulk("Restored", rest, sessions, unarchiveSession);
    case "delete": {
      if (!opts.yes) {
        const targets = [...new Set(rest)].map((p) => findSession(p, sessions));
        if (!targets.length) throw new Error(`Missing <id>.\n\n${USAGE}`);
        console.log(`This would permanently delete ${plural(targets.length)}:`);
        for (const s of targets) console.log(`  ${describe(s)}`);
        console.log("Nothing was deleted. Re-run with --yes to delete them, or use `csm archive` to set them aside reversibly.");
        process.exitCode = 1;
        return;
      }
      return bulk("Deleted", rest, sessions, deleteSession);
    }
    case "resume": {
      const s = findSession(requireArg(rest[0], "id"), sessions);
      process.exitCode = launchClaude({ session: s, fork: !!opts.fork });
      return;
    }
  }
}

main().catch((err) => {
  console.error(`csm: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
