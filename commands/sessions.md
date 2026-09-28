---
description: Open the csm session picker, or search/list Claude Code sessions across all projects
argument-hint: "[here | search query | list | show <id>]"
allowed-tools: Bash(csm:*)
---

Use the `csm` CLI from the claude-session-manager plugin. Arguments: `$ARGUMENTS`

- No arguments: run `csm open`. It opens the interactive picker in a new terminal window (or a tmux/zellij popup).
- `here`: run `csm open --here` to open the picker filtered to this project.
- Arguments starting with `list`, `show`, `export`, or `rename`: run `csm $ARGUMENTS` as given, and reply with a compact table (short id, when, project, title).
- Anything else is a search query: run `csm search "$ARGUMENTS" --limit 20`, and reply with a compact table (short id, when, project, title).

After `csm open` succeeds, reply with one short line saying where the picker opened. If it fails because no terminal was found, relay the error; the user can set `CSM_TERMINAL` (e.g. `"alacritty -e"`) in the `env` block of their Claude Code settings.

Never run `csm` with no subcommand, and never run `csm resume`; both need an interactive terminal that the Bash tool does not have.
