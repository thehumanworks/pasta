---
title: Daemon & Shell
slug: daemon-shell
description: Auto-publish clipboard changes and integrate Pasta into your terminal workflow.
nav_order: 8
---

<!-- @human -->
## The daemon

By default, Pasta is **pull-on-paste**. The daemon adds **push-on-copy** for text by polling your OS clipboard and publishing when content changes.

```bash
pasta daemon                    # loop every 750ms
pasta daemon --interval-ms 2000 # slower poll
pasta daemon --once             # single poll + publish if changed
pasta daemon --dry-run          # poll without config/network publish
```

Output is JSON on stdout describing what happened (useful for logging or systemd units).

## Echo suppression

When you `pasta paste --clipboard`, Pasta records a hash of the pasted text in `config.json` as `lastRemotePasteHash`. The daemon compares against this hash so it **won't immediately republish** text you just pulled from another device.

## Typical setup

Run the daemon in tmux, systemd user service, or a terminal tab on the machine where you copy most often:

```bash
pasta daemon >> ~/.config/pasta/daemon.log 2>&1
```

Paste on other machines with `pasta paste --clipboard` or shell aliases.

## Shell integration

Install a reversible snippet:

```bash
pasta install-shell
source ~/.config/pasta/shell.zsh   # path printed by install
```

The snippet adds short aliases for common flows (copy, paste-to-clipboard, history) and terminal-local keybindings when the chosen chords are still free. Pasta supports zsh, fish, PowerShell, and Bash builds that can safely inspect existing shell-command bindings:

```bash
pasta install-shell --shell bash
pasta install-shell --shell fish
pasta install-shell --shell powershell
```

For local development:

```bash
pasta install-shell --command "$PWD/src/cli.ts"
```

Remove it:

```bash
pasta uninstall-shell
```

Implementation lives in `src/cli/shell.ts`. The snippet is a plain shell file — no eval of remote code and no override of existing aliases, functions, or shell keybindings.

## Platform notes

- Daemon watches **text** clipboard only in v0.1.9.
- Image auto-sync is not daemon-driven; use explicit `copy --image` / `paste --image`.
- Clipboard adapter availability varies — run `pasta doctor` first.

## What's intentionally deferred

Global OS hotkeys, menu bar apps, and background OS services are out of MVP scope. Shell/keybinding integration comes first.

<!-- @agent -->
## Daemon implementation (`src/cli/daemon.ts`)

`runDaemonLoop(clipboard, publishFn, getLastRemoteHash, options)`:

| Option | Default | Effect |
| --- | --- | --- |
| `intervalMs` | 750 | Poll interval |
| `once` | false | Exit after one iteration |
| `dryRun` | false | Skip publishFn; config optional |

Loop reads text via `clipboard.readText()`, compares to last seen + `lastRemotePasteHash`, calls publish on change.

## CLI wiring (cli.ts `daemon` command)

- `--once` and `--dry-run` both set `once: true` in loop options
- `dryRun` allows missing config (catch → null config)
- Real publish uses `publishText()` → signed POST

## lastRemotePasteHash

Set in `paste --clipboard` handler via `sha256Base64Url(plaintext)` in config.

Daemon reads via `() => config?.lastRemotePasteHash`.

## Shell module (`src/cli/shell.ts`)

- `installShell(paths, command, shell)` — writes a zsh, bash, fish, or PowerShell snippet under Pasta home
- `uninstallShell(paths, shell)` — clears one generated snippet or all generated snippets
- `shellSnippet(command, shell)` — pure shell-specific template used by CLI help/tests
- Full keybinding contract: `docs-site/content/keybindings.md`

## Clipboard adapter (`src/cli/clipboard.ts`)

`SystemClipboardAdapter` — platform-specific text/image read/write. Injected in tests.

## Future scope boundary

Do NOT implement global hotkeys or OS services without a new GDD goal. AGENTS.md: shell integration before global OS hotkeys.
