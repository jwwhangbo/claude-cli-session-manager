---
name: organize-sessions
description: Find, review, clean up and organize the user's past Claude Code sessions with the csm CLI. Use when the user asks to find an old conversation, list or search their sessions, or tidy them up by grouping, renaming, tagging, starring or archiving them.
allowed-tools: Bash(csm list:*), Bash(csm search:*), Bash(csm show:*), Bash(csm group list:*)
---

# Organizing Claude Code sessions with csm

`csm` (from the claude-session-manager plugin, on PATH in your Bash tool) reads and manages the session transcripts in `~/.claude/projects/` across every project. Run `csm --help` for the full usage.

## Never delete unless explicitly asked

Deleting a session permanently removes its transcript, and it can't be recovered. **Do not delete sessions unless the user explicitly asks you to delete them.**
- "Clean up", "tidy", "get rid of clutter", "remove old sessions" and similar requests are not requests to delete. Archive instead (`csm archive`): it hides sessions from `/resume` and csm's main list, and `csm restore` brings them back.
- Never propose deletion as part of a plan the user didn't ask for. At most, mention that archived sessions can be deleted later if they want.
- When the user does ask to delete, first run `csm delete <id>…` without `--yes`. That only prints what would be deleted. Show the user that list and get a clear yes before re-running it with `--yes`.

## Reading sessions

- `csm list --json` gives every non-archived session. Each has `id`, `title`, `cwd`, `gitBranch`, `created`/`updated` (epoch ms), `firstPrompt`, `lastPrompt`, `tag`, `starred`, `groups`, `messageCount`, `filesTouched`, `costUSD`, `running`, `archived`. Add `--archived` for the archive, `--here` or `--project <dir>` for one project, and `--group <name>` for one group.
- `csm search <query> --json` does a fuzzy search over titles, prompts, paths, branches, tags and group names.
- `csm show <id>` prints one transcript as markdown. Use it sparingly; it can be long.
- `csm group list --json` maps group names to session ids.

Session ids can be shortened to any unique prefix; the first 8 characters are enough.

## Changing sessions

| Goal | Command | Undo |
| --- | --- | --- |
| Put sessions in a named collection (csm only; a session can be in several) | `csm group add <name> <id>…` | `csm group rm <name> <id>…` |
| Rename or merge a group / remove a group but keep its sessions | `csm group rename <old> <new>` / `csm group dissolve <name>` | re-create it |
| Set the title (also shown in `/resume`) | `csm rename <id> <title>` | rename again |
| Set the native tag (also shown in `/resume`; one per session) | `csm tag <tag> <id>…` | `csm untag <id>…` |
| Star / unstar | `csm star <id>…` / `csm unstar <id>…` | the opposite |
| Hide from `/resume` without losing it | `csm archive <id>…` | `csm restore <id>…` |
| Delete permanently (only when explicitly asked; see above) | `csm delete <id>… --yes` | none |

Sessions open in a running Claude Code (`"running": true`, which includes this conversation) can't be renamed, tagged, archived or deleted; csm skips them and says so. Leave them out of your plan.

## Workflow for "organize my sessions"

1. Read with `csm list --json`, scoped (`--here`, `--project`) if the user named a project. For a large list, summarize from `title`, `cwd`, `gitBranch`, `updated` and `firstPrompt` rather than dumping it.
2. Propose a plan before changing anything. Keep it short, with counts and a few examples per item. For example:
   - groups by feature, ticket or project
   - clearer titles for sessions whose title is just a raw first prompt or a slash command
   - archiving stale or trivial sessions (very few messages, long untouched, superseded by a later session)
3. Apply only what the user approves, batching ids into as few commands as possible.
4. Report what changed, and mention the undo commands for anything archived.

The user can browse the result interactively with `/sessions`, which opens the picker in a new window; `v` there toggles the grouped view.
