---
title: Keybindings
slug: keybindings
description: Ergonomic Pasta copy and paste keybindings that install only when they do not collide with existing shell bindings.
nav_order: 9
---

<!-- @human -->
## Natural terminal shortcuts

`pasta install-shell` installs terminal-local shortcuts for the same two moves users repeat all day:

| Action | First-choice chord | Fallback chord | Command |
| --- | --- | --- | --- |
| Publish current clipboard | `Alt+C` | `Ctrl+X C` | `pasta copy` |
| Pull latest Pasta clip into the OS clipboard | `Alt+P` | `Ctrl+X P` | `pasta paste --clipboard` |

These are shell keybindings, not global OS hotkeys. They work in the terminal session where the snippet is sourced and stay out of macOS, Windows, Linux desktop, browser, editor, and app-level shortcuts.

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

## Conflict behavior

Pasta never overwrites an existing alias, function, or keybinding. For each action it tries the first-choice chord, then the fallback chord. If both are already used by your shell or profile, Pasta leaves your setup unchanged and the aliases still work. Bash has one extra guard: if your Bash build cannot list existing shell-command key handlers, Pasta skips Bash keybindings and installs aliases only.

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

- `pasta install-shell [--command <command>] [--shell auto|zsh|bash|fish|powershell]`
- `pasta uninstall-shell [--shell auto|zsh|bash|fish|powershell|all]`
- `shellSnippet(command, shell)` remains pure for tests.

Generated snippet files:

- zsh: `$PASTA_HOME/shell.zsh`
- bash: `$PASTA_HOME/shell.bash`
- fish: `$PASTA_HOME/shell.fish`
- PowerShell: `$PASTA_HOME/shell.ps1`

Bindings:

| Shell | Copy candidates | Paste candidates | Conflict check |
| --- | --- | --- | --- |
| zsh | `^[c`, `^Xc` | `^[p`, `^Xp` | inspect `bindkey` result and bind only when undefined |
| bash | `\ec`, `\C-xc` | `\ep`, `\C-xp` | inspect `bind -p` and `bind -X`; skip Bash keybindings when shell-command handlers cannot be listed |
| fish | `\ec`, `\cxc` | `\ep`, `\cxp` | `bind --query` before `bind` |
| PowerShell | `Alt+c`, `Ctrl+x,c` | `Alt+p`, `Ctrl+x,p` | `Get-PSReadLineKeyHandler -Chord` before `Set-PSReadLineKeyHandler` |

Required invariants:

- snippets are deterministic text and do not eval remote code;
- generated aliases/functions do not override existing user commands;
- keybindings are skipped rather than overwritten when any candidate is occupied;
- install and uninstall are reversible inside `$PASTA_HOME` by writing or clearing generated snippet content;
- all generated command invocations quote the configured command path;
- behavior is covered by Bun tests with no dependency on the host user's real shell profile.

Research and source material:

- Local boundary: `AGENTS.md` says "Shell/keybinding integration comes before global OS hotkeys or OS services."
- Existing GDD contract: `docs/goals/05-distribution-and-terminal-integration.md` says terminal bindings are "explicit and reversible."
- Existing implementation: `src/cli/shell.ts` currently owns `installShell`, `uninstallShell`, and `shellSnippet`.
- Bash source: GNU Bash documents `bind -x` as binding a key sequence to "a shell command" ([GNU Bash manual](https://www.gnu.org/software/bash/manual/html_node/Bash-Builtins.html#index-bind)).
- zsh source: zsh documents `bindkey` as the line-editor key binding interface ([zsh manual](https://zsh.sourceforge.io/Doc/Release/Zsh-Line-Editor.html#index-bindkey)).
- fish source: fish documents `bind` for key bindings and `bind --query` for lookup ([fish docs](https://fishshell.com/docs/current/cmds/bind.html)).
- PowerShell source: PSReadLine exposes `Set-PSReadLineKeyHandler` for custom key handlers ([Microsoft Learn](https://learn.microsoft.com/powershell/module/psreadline/set-psreadlinekeyhandler)).

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
mise exec -- bunx tsc --noEmit
git diff --check
```
