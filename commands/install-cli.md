---
description: Install or update the csm command so you can run the session picker from your own terminal
argument-hint: "[uninstall] [--dir <dir>]"
allowed-tools: Bash(csm install:*), Bash(csm uninstall:*)
---

Put the plugin's `csm` CLI on the user's shell PATH. Arguments: `$ARGUMENTS`

- No arguments, or `--dir <dir>`: run `csm install $ARGUMENTS`. Running it again updates an existing install, so use it for both installing and updating.
- `uninstall` (optionally with `--dir <dir>`): run `csm uninstall` with the remaining arguments.

`csm install` writes a small script (default `~/.local/bin/csm`) that runs whichever plugin version Claude Code has installed, so later `/plugin update`s apply without reinstalling.

Relay the result in a few lines:
- If it succeeded and the directory is on PATH, say where it was installed and that `csm` now works in any new terminal.
- If the output says the directory isn't on PATH, show the exact line it printed for the user's shell and offer to add it for them. Don't edit shell config files unless the user says yes.
- If it reports that another `csm` shadows it on PATH, pass that warning on.
- If it refuses because a different file already exists at that path, explain, and suggest `--dir <other dir>` or `--force` (which overwrites that file). Don't pass `--force` yourself unless the user asks.
- On any other error, relay the message as-is.
