---
title: Keybindings
slug: keybindings
description: Ergonomic, configurable Pasta copy and paste keybindings that avoid user-defined shell bindings.
nav_order: 9
---

<!-- @human -->
## Natural terminal shortcuts

`pasta install-shell` installs terminal-local shortcuts for the same two moves users repeat all day:

| Action | First-choice chord | Fallback chord | Command |
| --- | --- | --- | --- |
| Publish current clipboard | `Hyper+C` | `Ctrl+X C` | `pasta copy` |
| Pull latest Pasta clip into the OS clipboard | `Hyper+P` | `Ctrl+X P` | `pasta paste --clipboard` |

These are shell keybindings, not global OS hotkeys. They work in the terminal session where the snippet is sourced and stay out of macOS, Windows, Linux desktop, browser, editor, and app-level shortcuts.

For Pasta, `Hyper` means the common launcher setup where Caps Lock sends `Ctrl+Alt+Shift+Super`: on macOS that is the Raycast-style `Ctrl+Opt+Shift+Cmd`; on Windows and Linux terminals it is the closest shell-readable equivalent. A shell can only bind keys it receives. If your terminal or launcher consumes `Cmd`/`Super` instead of sending a terminal sequence, configure that terminal/launcher to emit the Hyper sequence or choose another Pasta key.

## Install

```bash
pasta install-shell
source ~/.config/pasta/shell.zsh
```

Pasta detects the current shell when it can. You can be explicit when installing on another shell:

```bash
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

The defaults are `Hyper+C` and `Hyper+P`, plus the `Ctrl+X` fallback chords when those fallback chords are free. You can regenerate the snippet with another chord:

```bash
pasta install-shell --copy-key alt+c --paste-key alt+p
pasta install-shell --copy-key ctrl+x,c --paste-key ctrl+x,p
```

Use repeated flags when you want more than one free chord bound for an action:

```bash
pasta install-shell --copy-key hyper+c --copy-key alt+c --paste-key hyper+p --paste-key alt+p
```

Environment variables are useful in dotfiles or machine setup scripts:

```bash
PASTA_COPY_KEY=alt+c PASTA_PASTE_KEY=alt+p pasta install-shell
```

Disable keybindings while keeping aliases:

```bash
pasta install-shell --copy-key none --paste-key none
```

Supported logical chords are `hyper+<letter>`, `alt+<letter>`, `ctrl+x,<letter>`, and `none`.

## Conflict behavior

Pasta never overwrites an existing alias, function, or user-defined keybinding. For each action it tries every requested chord and binds only the chords that are still free. On zsh, Pasta treats the stock `Alt+C`/`Alt+P` widgets as replaceable defaults only when you explicitly ask for `alt+c` or `alt+p`; if your profile has put a custom binding there, Pasta leaves it alone. Bash has one extra guard: if your Bash build cannot list existing shell-command key handlers, Pasta skips Bash keybindings and installs aliases only.

```bash
pc  # pasta copy
pp  # pasta paste --clipboard
ph  # pasta history
```

This is why Pasta does not bind `Ctrl+C`, `Cmd+C`, `Cmd+V`, or global desktop shortcuts. Those are owned by the terminal, OS, or active app. Pasta's installer is deliberately terminal-local and reversible.

## Uninstall

```bash
pasta uninstall-shell
```

`uninstall-shell` clears Pasta's generated snippet content in the Pasta config directory. It does not edit shell profile files, because profile ownership belongs to the user.

<!-- @agent -->
## Contract

Goal: make terminal use feel close to copy/paste muscle memory without claiming or stealing system-wide shortcuts.

Non-goals:

- No global OS hotkeys, menu bar helpers, background OS services, Accessibility automation, shell profile mutation, or desktop shortcut registration.
- No binding of `Ctrl+C`, `Cmd+C`, `Cmd+V`, `Cmd+P`, or app-level chords.
- No backend or protocol change.

Interfaces:

- `pasta install-shell [--command <command>] [--shell auto|zsh|bash|fish|powershell] [--copy-key <key>]... [--paste-key <key>]...`
- `pasta uninstall-shell [--shell auto|zsh|bash|fish|powershell|all]`
- `PASTA_COPY_KEY` and `PASTA_PASTE_KEY` configure install defaults when CLI flags are absent.
- `shellSnippet(command, shell, options)` remains pure for tests.

Generated snippet files:

- zsh: `$PASTA_HOME/shell.zsh`
- bash: `$PASTA_HOME/shell.bash`
- fish: `$PASTA_HOME/shell.fish`
- PowerShell: `$PASTA_HOME/shell.ps1`

Logical key specs:

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
mise exec -- bun test test/bun/cli.test.ts
mise exec -- bun test test/bun/cli.test.ts --test-name-pattern key
mise exec -- bunx tsc --noEmit
git diff --check
```
