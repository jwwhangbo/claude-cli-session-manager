# claude-session-manager

A Claude Code plugin that ships `csm`, a prebuilt [Ink](https://github.com/vadimdemedes/ink) TUI that improves on the built-in `/resume` picker.

- **All projects at once:** fuzzy search across titles, prompts, project paths, branches and tags
- **Rich preview:** cwd, branch, model, tokens, cost, edited files and a scrollable transcript
- **Manage:** rename and tag (written as native entries, so `/resume` shows them too), star, archive/restore, delete, export to markdown
- **Resume or fork:** runs `claude --resume <id> [--fork-session]` in the session's original directory
- **Safe:** refuses to modify sessions that are open in a running Claude Code process

## Install

```sh
claude plugin marketplace add <this repo URL or local path>
claude plugin install claude-session-manager@claude-session-manager
```

Inside Claude Code, run `/sessions` to open the picker in a new window. To also run `csm` from your own shell, link it once:

```sh
ln -s ~/.claude/plugins/cache/claude-session-manager/claude-session-manager/*/bin/csm ~/.local/bin/csm
```

You need Node.js 22+ or Bun.

## Usage

```
csm [query]                  interactive picker (--here: current project only)
csm list [--here|--project <dir>] [--group <name>] [--archived] [--limit N] [--json]
csm search <query> [--json]
csm show <id> [--json]
csm export <id> [-o file]
csm rename <id> <title>
csm resume <id> [--fork]
csm group list | add <name> <id>… | rm <name> <id>… | rename <old> <new> | dissolve <name>
csm open [--here] [query]   # picker in a new terminal window / tmux popup
```

### From inside Claude Code

Claude Code owns its terminal, so the picker can't draw inside it. `/sessions` runs `csm open` instead, which opens the picker in:

1. a **tmux popup** or **zellij floating pane**, if Claude is running inside one
2. otherwise, a **new window** of the terminal Claude is running in (kitty, WezTerm, Ghostty, Alacritty, Konsole, foot, …), then `$TERMINAL`, then common emulators. On macOS it uses Terminal/iTerm, and on Windows, Windows Terminal or a new console window.

`csm open` never builds a shell command. It passes an argument list straight to the terminal and re-runs the same Node/Bun binary and bundle, so it works whatever your shell is (bash, zsh, fish, nushell, PowerShell) and doesn't need `csm` on PATH. It also clears Claude Code's session variables, so pressing Enter in the picker starts a normal, non-nested `claude --resume`.

To pick the terminal yourself, set `CSM_TERMINAL` to the command that precedes the program, for example `"alacritty -e"`, `"wezterm start --"` or `"foot"`. Use `{}` to place the program in the middle. You can set it in the `env` block of your Claude Code `settings.json`.

Other forms: `/sessions here` (picker for this project only), `/sessions <query>` (search results in chat), and `/sessions list | show <id> | export <id> | rename <id> <title>`.

In the picker, press `?` to see every key:
- **Move:** `j`/`k` or `↑`/`↓`; `→`/`l` focuses the preview and `←`/`h` goes back to the list
- **Open:** `/` search, `Enter` resume, `f` fork
- **Filter:** `p`/`b` project/branch, `*` starred only, `A` archive view
- **Select:** `Tab` selects and moves down, `Shift+Tab` deselects and moves up, `Ctrl+A` selects all visible, `Esc` clears the selection
- **Act:** `s` star, `t` tag, `r` rename, `a` archive, `d` delete, `e` export, `+`/`-` add to or remove from a group, `v` grouped view; `q` quits

### Groups

Groups are named collections you create yourself, for example one per feature or ticket. A session can be in several groups.
- **Create or add:** select sessions with `Tab` (or leave the cursor on one), press `+` and type a group name. An existing name adds to that group; a new name creates it.
- **Grouped view:** `v` switches between flat and grouped. Groups are listed by most recent activity, with **Ungrouped** last.
- **On a group header:**
  - `Enter`/`Space` collapses or expands it (collapsed state is remembered).
  - `Tab` selects the whole group.
  - `r` renames it; renaming onto an existing name merges the two groups.
  - `d` dissolves it. Only the group is removed; its sessions are kept.
  - `s`, `t`, `a`, `e` and `+` act on every session in the group.
- **Remove:** `-` takes the cursor or selected sessions out of the group the cursor is under. In the flat view it takes them out of every group.
- **Search:** `/` also matches group names, and groups stay expanded while a search is active.

Groups are csm-only: they're stored in `~/.claude/csm/meta.json`, so the built-in `/resume` doesn't see them. For a label that `/resume` does show, use the native tag (`t`).

When sessions are selected, `s`, `t`, `a`, `d` and `e` apply to all of them, including ones hidden by the current filter. Sessions open in a running Claude Code are skipped and counted in the status line. `r`, `Enter` and `f` always act on the row under the cursor.

## Development

```sh
bun install
bun run dev          # run from source
bun test
bun run typecheck
bun run build        # rebuild dist/csm.js; commit it, since the plugin ships it
```

`csm` keeps its own state (stars, index cache, archive) in `~/.claude/csm/`, and respects `CLAUDE_CONFIG_DIR`.
