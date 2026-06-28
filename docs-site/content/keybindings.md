---
title: Keybindings
slug: keybindings
description: Ergonomic, configurable Pasta copy and paste keybindings that work macOS-wide and avoid user-defined bindings.
nav_order: 9
---

<!-- @human -->
## Natural shortcuts

`pasta install-hotkeys` installs macOS-wide shortcuts for the same two moves users repeat all day:

| Action | First-choice chord | Fallback chord | Command |
| --- | --- | --- | --- |
| Publish current clipboard | `Hyper+C` | none | `pasta copy` |
| Pull latest Pasta clip into the OS clipboard | `Hyper+P` | none | `pasta paste --clipboard` |

These are real macOS global hotkeys. They work when another app has focus and do not require a terminal session. Pasta registers them through a user LaunchAgent and a tiny native macOS hotkey helper; it does not mutate Raycast, browser, editor, or system shortcut databases.

For Pasta, `Hyper` means the common launcher setup where Caps Lock sends `Ctrl+Opt+Shift+Cmd` on macOS. If Raycast is already turning Caps Lock into Hyper, `Hyper+C` and `Hyper+P` are the expected Pasta chords.

## Install

```bash
pasta install-hotkeys
```

On macOS this writes:

- a helper source and compiled helper under `$PASTA_HOME/hotkeys/macos/`;
- a LaunchAgent at `~/Library/LaunchAgents/work.thehumanworks.pasta.hotkeys.plist`;
- logs under `$PASTA_HOME/hotkeys/macos/`.

The helper is compiled at install time with `/usr/bin/swiftc`, so macOS needs Xcode or the Apple command line tools installed.

By default the installer resolves `pasta` from your current shell and stores the absolute command path in the helper. Use `--command <command>` only when you want the hotkeys to call a different Pasta binary or wrapper.

The installer checks for conflicts before enabling the LaunchAgent. If another app already owns the requested chord, Pasta exits without replacing it.

Shell integration is still available as a terminal-local fallback:

```bash
pasta install-shell
source ~/.config/pasta/shell.zsh
pasta install-shell --shell zsh
pasta install-shell --shell bash
pasta install-shell --shell fish
pasta install-shell --shell powershell
```

PowerShell users source the printed `.ps1` path from their profile:

```powershell
. $HOME\.config\pasta\shell.ps1
```

## Configure keys

The global defaults are `Hyper+C` and `Hyper+P`. Regenerate the LaunchAgent with another macOS chord when needed:

```bash
pasta install-hotkeys --copy-key alt+c --paste-key alt+p
pasta install-hotkeys --copy-key hyper+b --paste-key hyper+v
```

The terminal snippet still supports repeated fallback chords:

```bash
pasta install-shell --copy-key hyper+c --copy-key alt+c --paste-key hyper+p --paste-key alt+p
```

Environment variables are useful in dotfiles or machine setup scripts:

```bash
PASTA_COPY_KEY=alt+c PASTA_PASTE_KEY=alt+p pasta install-shell
```

Disable terminal keybindings while keeping aliases:

```bash
pasta install-shell --copy-key none --paste-key none
```

Supported global macOS chords are simultaneous modifier chords such as `hyper+<letter>`, `cmd+shift+<letter>`, `ctrl+opt+shift+cmd+<letter>`, and `none`.

Supported terminal chords are `hyper+<letter>`, `alt+<letter>`, `ctrl+x,<letter>`, and `none`.

## Conflict behavior

Pasta never overwrites an existing alias, function, or user-defined keybinding. Global macOS install registers the requested hotkeys in a check step first; if Carbon reports the chord is already taken, install fails with a conflict message. Shell install tries every requested terminal chord and binds only the chords that are still free. On zsh, Pasta treats the stock `Alt+C`/`Alt+P` widgets as replaceable defaults only when you explicitly ask for `alt+c` or `alt+p`; if your profile has put a custom binding there, Pasta leaves it alone. Bash has one extra guard: if your Bash build cannot list existing shell-command key handlers, Pasta skips Bash keybindings and installs aliases only.

```bash
pc  # pasta copy
pp  # pasta paste --clipboard
ph  # pasta history
```

This is why Pasta still does not bind `Ctrl+C`, `Cmd+C`, `Cmd+V`, or `Cmd+P`. Those are owned by the terminal, OS, or active app. Pasta's global defaults use Hyper so they stay out of ordinary app shortcuts.

## Uninstall

```bash
pasta uninstall-hotkeys
pasta uninstall-shell
```

`uninstall-hotkeys` unloads the LaunchAgent and removes Pasta's generated LaunchAgent/helper files. It does not modify Raycast or other hotkey managers.

`uninstall-shell` clears Pasta's generated snippet content in the Pasta config directory. It does not edit shell profile files, because profile ownership belongs to the user.

<!-- @agent -->
## Contract

Goal: make Pasta copy/paste feel like native copy/paste by providing macOS-wide Hyper shortcuts first and terminal-local shell bindings as fallback.

Non-goals:

- No mutation of Raycast/private app databases, browser/editor settings, or system-reserved shortcuts.
- No binding of `Ctrl+C`, `Cmd+C`, `Cmd+V`, `Cmd+P`, or app-level chords.
- No Linux/Windows global shortcut auto-registration in this slice; there is no single safe cross-desktop shortcut API comparable to macOS `RegisterEventHotKey`.
- No backend or protocol change.

Interfaces:

- `pasta install-hotkeys [--command <command>] [--provider auto|macos] [--copy-key <key>] [--paste-key <key>]`
- `pasta uninstall-hotkeys [--provider auto|macos]`
- `pasta install-shell [--command <command>] [--shell auto|zsh|bash|fish|powershell] [--copy-key <key>]... [--paste-key <key>]...`
- `pasta uninstall-shell [--shell auto|zsh|bash|fish|powershell|all]`
- `PASTA_COPY_KEY` and `PASTA_PASTE_KEY` configure install defaults when CLI flags are absent.
- `shellSnippet(command, shell, options)` remains pure for tests.

Generated macOS hotkey files:

- helper source: `$PASTA_HOME/hotkeys/macos/PastaHotkeys.swift`
- helper binary: `$PASTA_HOME/hotkeys/macos/PastaHotkeys`
- stdout log: `$PASTA_HOME/hotkeys/macos/stdout.log`
- stderr log: `$PASTA_HOME/hotkeys/macos/stderr.log`
- LaunchAgent: `~/Library/LaunchAgents/work.thehumanworks.pasta.hotkeys.plist`

Generated snippet files:

- zsh: `$PASTA_HOME/shell.zsh`
- bash: `$PASTA_HOME/shell.bash`
- fish: `$PASTA_HOME/shell.fish`
- PowerShell: `$PASTA_HOME/shell.ps1`

Global macOS key specs:

| Spec | Meaning |
| --- | --- |
| `hyper+<letter>` | `Ctrl+Opt+Shift+Cmd+<letter>` |
| `<mod>+...+<letter>` | simultaneous modifier chord using `cmd`, `command`, `ctrl`, `control`, `opt`, `option`, `alt`, `shift` |
| `none` | disables that action |

Terminal key specs:

| Spec | zsh key | Bash key | fish key | PowerShell chord |
| --- | --- | --- | --- | --- |
| `hyper+<letter>` | `^[[<code>;16u` | `\e[<code>;16u` | `\e\[<code>\;16u` | `Ctrl+Alt+Shift+<letter>` |
| `alt+<letter>` | `^[<letter>` | `\e<letter>` | `\e<letter>` | `Alt+<letter>` |
| `ctrl+x,<letter>` | `^X<letter>` | `\C-x<letter>` | `\cx<letter>` | `Ctrl+x,<letter>` |
| `none` | no binding | no binding | no binding | no binding |

Default key specs:

| Action | Specs |
| --- | --- |
| Copy | `hyper+c`, `ctrl+x,c` |
| Paste | `hyper+p`, `ctrl+x,p` |

Conflict checks:

| Shell | Copy candidates | Paste candidates | Conflict check |
| --- | --- | --- | --- |
| zsh | resolved from copy specs | resolved from paste specs | bind when undefined; for explicit `alt+c`/`alt+p`, stock widgets are replaceable defaults |
| bash | resolved from copy specs | resolved from paste specs | inspect `bind -p` and `bind -X`; skip Bash keybindings when shell-command handlers cannot be listed |
| fish | resolved from copy specs | resolved from paste specs | `bind --query` before `bind` |
| PowerShell | resolved from copy specs | resolved from paste specs | `Get-PSReadLineKeyHandler -Chord` before `Set-PSReadLineKeyHandler` |

Required invariants:

- `install-hotkeys` must not edit private Raycast/system shortcut storage;
- `install-hotkeys` must compile or install a user-owned macOS helper and LaunchAgent;
- `install-hotkeys` must run a conflict check before loading the LaunchAgent;
- `uninstall-hotkeys` must unload the LaunchAgent and remove generated hotkey files;
- snippets are deterministic text and do not eval remote code;
- generated aliases/functions do not override existing user commands;
- keybindings are skipped rather than overwritten when any candidate is occupied;
- default install binds Hyper copy/paste plus free `Ctrl+X` fallbacks;
- custom keys are supplied by repeated CLI flags or `PASTA_COPY_KEY`/`PASTA_PASTE_KEY`;
- unsupported key specs fail with usage guidance instead of silently generating broken snippets;
- install and uninstall are reversible inside `$PASTA_HOME` by writing or clearing generated snippet content;
- all generated command invocations quote the configured command path;
- behavior is covered by Bun tests with no dependency on the host user's real shell profile.

Research and source material:

- Local boundary: `AGENTS.md` says "Shell/keybinding integration comes before global OS hotkeys or OS services."
- Scope update: the user explicitly promoted global macOS hotkeys into scope on 2026-06-28 after confirming macOS-wide behavior is the expectation.
- macOS source: Carbon `RegisterEventHotKey` is the user-level API for application-wide hotkeys; `RegisterEventHotKey` reports conflicts instead of stealing an existing registration.
- macOS service source: `launchd.plist(5)` and `launchctl(1)` define per-user LaunchAgents under `~/Library/LaunchAgents`.
- Existing GDD contract: `docs/goals/05-distribution-and-terminal-integration.md` says terminal bindings are "explicit and reversible."
- Existing implementation: `src/cli/shell.ts` currently owns `installShell`, `uninstallShell`, and `shellSnippet`.
- Hyper encoding source: kitty's keyboard protocol documents `super` as Windows/Linux key or macOS Command, and encodes modifiers as `1 + actual modifiers`; Raycast-style `Ctrl+Alt+Shift+Super` therefore maps to CSI-u modifier value `16` ([kitty keyboard protocol](https://sw.kovidgoyal.net/kitty/keyboard-protocol/)).
- Bash source: GNU Bash documents `bind -x` as binding a key sequence to "a shell command" ([GNU Bash manual](https://www.gnu.org/software/bash/manual/html_node/Bash-Builtins.html#index-bind)).
- zsh source: zsh documents `bindkey` as the line-editor key binding interface ([zsh manual](https://zsh.sourceforge.io/Doc/Release/Zsh-Line-Editor.html#index-bindkey)).
- fish source: fish documents `bind` for key bindings and `bind --query` for lookup ([fish docs](https://fishshell.com/docs/current/cmds/bind.html)).
- PowerShell source: PSReadLine exposes `Set-PSReadLineKeyHandler` for custom key handlers and comma-separated key sequences ([Microsoft Learn](https://learn.microsoft.com/en-us/powershell/module/psreadline/set-psreadlinekeyhandler?view=powershell-7.6)).

Acceptance checks:

```bash
cd docs-site && bun run build -- --base /
PORT=4173 bun run serve.ts
curl -fsS http://localhost:4173/.well-known/agents.json
curl -fsS http://localhost:4173/human/keybindings/
curl -fsS http://localhost:4173/agent/keybindings/
curl -fsS -H 'Accept: text/markdown' http://localhost:4173/agent/keybindings.md
```

```bash
mise exec -- bun test test/bun/cli.test.ts --test-name-pattern hotkey
mise exec -- bun test test/bun/cli.test.ts
mise exec -- bun test test/bun/cli.test.ts --test-name-pattern key
mise exec -- bunx tsc --noEmit
git diff --check
```

macOS smoke:

```bash
PASTA_HOME="$(mktemp -d)" mise exec -- bun run src/cli.ts install-hotkeys --command "mise exec -- bun run src/cli.ts"
launchctl print "gui/$(id -u)/work.thehumanworks.pasta.hotkeys"
PASTA_HOME="$PASTA_HOME" mise exec -- bun run src/cli.ts uninstall-hotkeys
```
