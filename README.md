# drift

A Claude Code mod that tells you whether you are moving or hiding in the dark.

It watches a session through Claude Code's mod events and counts two things: what shipped (commits, pushes, deploys, passing test runs) and what you only tidied (edits to tooling, config, docs and plans). It is silent while you are moving. When you have gone a long stretch with nothing shipped, or most of your recent edits went to config and docs, or you keep rewriting one file, one plain line appears above the prompt. Once.

It uses no model tokens, makes no network calls, runs no processes and reads no files. It counts tool calls and keeps the totals in the mod's own store on your machine.

```
src/app.ts has been edited 4 times with nothing shipped. 12 of your last 20 edits were config and docs.
```

Needs Claude Code 2.1.287 or later (mods are on by default from that version).

## Install

```
claude plugin marketplace add <owner>/<repo>
claude plugin install drift@drift
```

Or from inside Claude Code: `/plugin`, add the marketplace `<owner>/<repo>`, install `drift`. Restart the session, then run `/drift`.

To try it from a clone without installing:

```
claude --plugin-dir ./drift
```

## What the band says

Nothing, until one of these is crossed. Each one speaks once per crossing, then stays quiet until the thing it measures drops back (a ship resets the first and third).

| Threshold | Line |
| --- | --- |
| 45 active minutes since anything shipped | `52 min since anything shipped.` |
| 60% or more of your last 20 edits (at least 10 edits) went to the dark | `14 of your last 20 edits were config and docs.` |
| The same file edited 4 times with nothing shipped between | `src/app.ts has been edited 4 times with nothing shipped.` |

The line stays above the prompt until you send your next prompt, or until something ships. A ship is a commit, push, deploy or test run that exited 0.

Active time counts only the gaps between events that are 10 minutes or shorter. Go for lunch and it is idle, not drift.

## `/drift`

| Command | What it does |
| --- | --- |
| `/drift` | Today's receipt and the last 7 days: active time, shipped count, time in the dark, churn files, failed tries, the goal and how long it has stood. No model turn. |
| `/drift goal <text>` | Sets one goal for this project (keyed by the repository root). The receipt says whether any edited path or commit message since then shares a meaningful word with it. |
| `/drift goal` | Shows the goal. `/drift goal clear` removes it. |
| `/drift off`, `/drift on` | Stop or resume counting in this project. |
| `/drift reset` | Clears this project's counters and history. Keeps the goal and the on/off switch. |

## The work and the dark

An edit is "in the dark" when its path matches one of these globs (case does not matter, a pattern with no slash matches a file name at any depth). Everything else is the work.

```
CLAUDE.md          AGENTS.md           **/.claude/**
*.config.*         package.json        tsconfig*          **/.github/**
.*                 **/.*/**            (dotfiles and dot folders)
docs/**/*.md       **/docs/**/*.md     plan.md  notes.md  todo.md  roadmap.md  readme.md
*.lock  *.lockb    package-lock.json   pnpm-lock.yaml     go.sum
```

The list lives in one place, `hooks/paths.ts`. To replace it, set the plugin option **Dark patterns** (a row for this plugin in `/config`) to a comma separated list of globs. A non empty value replaces the built in list, it does not add to it.

## What the mod events can and cannot see

The mod is built against the Claude Code 2.1.287 declarations. Here is what each part rests on.

**Edits.** `Edit`, `Write`, `MultiEdit` and `NotebookEdit` tool calls carry the path. An edit counts only if the call landed: a call that failed (`isError`) or was refused (`deny`) counts for nothing.

**Ships.** `Bash` tool calls carry the command text, which the mod reads for `git commit`, `git push`, `vercel deploy`, `wrangler deploy`, `npm publish`, `fly deploy`, `netlify deploy`, and `npm test`, `pnpm test`, `yarn test`, `bun test`, `pytest`, `go test`, `cargo test`, `vitest` and `jest`. Dry runs are ignored. Compound commands are split at `&&`, `||`, `;` and `|`, never inside quotes.

**Exit status.** The `Bash` tool result in 2.1.287 has no numeric exit code. Its fields are `stdout`, `stderr`, `interrupted`, `backgroundTaskId` and a few more. What the hook does see is `isError`, which the engine sets when the tool reported an error, and a non zero exit is one. In a live run, `T=1 npm test` (exit 1) arrived as `isError: true` and was counted as a failed try, and the same command with exit 0 counted as a passing test run. So the mod knows zero from not zero, and nothing finer. A command sent to the background has not finished and is not counted as shipped.

**What that does not catch.**

- A chain has one exit status. `git commit -m x && git push` exiting 0 means both ran. `a; b` and `a || b` can exit 0 with one part failed, and `npm test | tail` exits with `tail`'s status, so a failing test run piped through another command counts as a pass.
- Edits made through `Bash` (`sed -i`, `echo >> file`, a formatter) are not edits to the mod. Only the edit tools are.
- Ships it does not recognise: a release script (`npm run release`), a deploy from CI, a commit you make in another terminal.
- It does not see time spent thinking or typing. Active time is the sum of gaps of 10 minutes or less between tool calls, prompts and finished turns.
- A passing test run counts as a ship, because it is evidence of moving. It resets the clock since a ship like a commit does.

**Approximations.** "Time in the dark" is the active time whose closing event was an edit to a dark file. The dark share needs at least 10 edits in the window before it can speak, so three config edits in a row are not a verdict. A break of more than 8 hours starts a fresh run, so yesterday's edits do not count against today. The goal match is one shared word (lowercased, plurals folded, common words and file extensions ignored); it cannot read intent, it can only tell you that nothing you touched has mentioned the goal.

## Privacy

`claude plugin validate` lists every call the module makes: the clock, the session's root and repository, the mod's own state and store, and the command registration. It makes no `$.http`, `$.process`, `$.fs` or `$.model` call. Per project it stores the goal and, for the last 30 days, a few counts per day and the names of the files that churned. File paths are stored relative to the project root. The store is a JSON file in Claude Code's plugin store folder. Nothing is sent anywhere.

## Development

```
claude plugin test .                         # 65 tests, run by the engine's own host
claude plugin validate .claude-plugin/plugin.json
claude --plugin-dir .                        # try it live; the folder is watched and hot reloads
```

Claude Code writes its type declarations to `.claude-plugin/types/` every time it loads a plugin folder; that folder is git ignored. `npx -p typescript tsc -p tsconfig.json` type checks the hooks and tests against it.

The code is split so each piece can be tested on its own:

| File | What it holds |
| --- | --- |
| `hooks/paths.ts` | The dark list, the globs, the option |
| `hooks/ships.ts` | Finding commits, pushes, deploys and test runs in a command line |
| `hooks/goal.ts` | The goal and its shared word check |
| `hooks/tracker.ts` | Active time, the edit window, churn, ships, day totals, the three thresholds |
| `hooks/receipt.ts` | The text `/drift` prints |
| `hooks/mover-line.ts` | The one line that ends `/drift` |
| `hooks/register.ts` | The hooks: `tool.call`, `prompt.submit`, `turn.complete`, `session.start`, `session.end`, the `AbovePrompt` band, `command.run` |

Every hook does a constant amount of work and no disk scan. In a scripted run the engine's debug log showed the `tool.call` hook settling in 6 to 15 ms for an edit, with the edit itself included in that time.

## License

MIT, see `LICENSE`.

<!-- MOVER: the line that points to Mover OS goes here (and in hooks/mover-line.ts for /drift). -->
