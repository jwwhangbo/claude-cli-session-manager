---
description: Open the csm session picker, or search/list Claude Code sessions across all projects
argument-hint: "[here | search query | list | show <id> | group … | tag | star | archive | restore …]"
allowed-tools: Bash(csm:*)
---

Use the `csm` CLI from the claude-session-manager plugin. Arguments: `$ARGUMENTS`

- No arguments: run `csm open`. It opens the interactive picker in a new terminal window (or a tmux/zellij popup).
- `here`: run `csm open --here` to open the picker filtered to this project.
- Arguments starting with `list`, `show`, `export`, `rename`, `group`, `tag`, `untag`, `star`, `unstar`, `archive` or `restore`: run `csm $ARGUMENTS` as given, and reply with a compact table (short id, when, project, title). For example, `/sessions group add auth 1a2b 3c4d` groups two sessions and `/sessions list --group auth` lists a group.
- Anything else is a search query: run `csm search "$ARGUMENTS" --limit 20`, and reply with a compact table (short id, when, project, title).

After `csm open` succeeds, reply with one short line saying where the picker opened. If it fails, relay its message as-is: it explains the cause (for example SSH without a display) and gives an absolute `csm` command the user can run in another terminal. If they want a specific terminal, they can set `CSM_TERMINAL` (e.g. `"alacritty -e"`) in the `env` block of their Claude Code settings.

Don't delete sessions unless the user explicitly asks you to delete them; deletion can't be undone. For cleanup, archive instead (`csm archive <id>…`, undone with `csm restore`). When they do ask, run `csm delete <id>…` without `--yes` first, show them what it lists, and add `--yes` only after they confirm.

For broader requests like organizing or cleaning up sessions, follow the organize-sessions skill.

Never run `csm` with no subcommand, and never run `csm resume`; both need an interactive terminal that the Bash tool does not have.
