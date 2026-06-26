---
goal_id: "pasta-05-distribution-terminal-integration"
title: "Distribution and Terminal Integration"
status: "blocked"
confidence_floor: 90
created: "2026-06-26"
updated: "2026-06-26"
---

# Goal: Distribution and Terminal Integration

Make the public repo runnable through Bun, provide stable fallback distribution, and expose terminal-friendly commands/keybindings.

## 1. Invariants

- Public repo command works only after live proof.
- GitHub branch installs are documented as mutable; tags/SHA are preferred.
- No required lifecycle scripts or native build steps for MVP.
- Terminal bindings are explicit and reversible.
- Compiled binaries are convenience artifacts, not required for text MVP unless chosen later.

## 2. References

- [Bun distribution findings](../research/consolidated-findings.md#bun-distribution)
- [CLI goal](03-bun-cli-daemon-text-mvp.md)
- [Adversarial review](../research/adversarial-review.md)

## 3. Definition of Done - INVARIANT

- [ ] **DoD-1** - `package.json#bin` and shebang CLI entrypoint work locally. - *verify by:* `bun run` and package smoke.
- [ ] **DoD-2** - `bunx --bun github:thehumanworks/pasta...` works from a clean cache against the public repo. - *verify by:* real command after repo publish.
- [ ] **DoD-3** - npm fallback package path is packable and contains only intended files. - *verify by:* pack dry-run/list.
- [ ] **DoD-4** - macOS, Linux, and Windows at least run `--version`, `doctor`, and help via chosen distribution path. - *verify by:* OS smoke matrix.
- [ ] **DoD-5** - Shell/keybinding integration docs and installer are reversible. - *verify by:* install/uninstall smoke.

## 4. Exit Conditions

- **DONE** - Public repo execution and terminal integration proof are recorded.
- **BLOCKED-DEP** - Repo not public, Bun regression, or OS matrix unavailable.
- **SCOPE-CHANGE** - User requires signed installers/autoupdate before CLI MVP.
- **CONFIDENCE-STALL** - Windows or Linux command execution cannot be proven.
- **BUDGET** - Stop with exact distribution command and error.

## 5. Tasks - INVARIANT

### T1 - Package Execution Contract - [ ]

- Add root `package.json`.
- Add `bin` entry for `pasta`.
- Add shebang `#!/usr/bin/env bun`.
- Avoid required lifecycle scripts.

Verification Contract:

- `bun run src/cli.ts --version` exits 0.
- Local package execution exits 0.
- `package.json` has no required `prepare`, `install`, or `postinstall`.

**Confidence:** 90/100
**Depends on:** Goal 03 Task 1
**Closes:** DoD-1
**Evidence:**
- none yet

### T2 - GitHub Bunx Proof - [ ]

- Publish or use public repo.
- Run GitHub `bunx` command from clean cache.
- Test default branch and pinned tag/SHA.

Verification Contract:

- `bunx --bun -p github:thehumanworks/pasta pasta --version` exits 0.
- `bunx --bun github:thehumanworks/pasta#v0.1.0 --version` exits 0 after tag exists.

**Confidence:** 70/100
**Depends on:** Task 1 and public repo
**Closes:** DoD-2
**Evidence:**
- none yet

### T3 - Npm Fallback - [ ]

- Add package file allowlist.
- Run pack dry-run/list.
- Optionally publish under chosen scope.

Verification Contract:

- Package contains CLI source, README, license, and required runtime files only.
- No secrets, local config, or generated credentials appear.

**Confidence:** 85/100
**Depends on:** Task 1
**Closes:** DoD-3
**Evidence:**
- none yet

### T4 - OS Smoke Matrix - [ ]

- macOS: run installed command.
- Linux: run installed command.
- Windows: run installed command.
- Include `--version`, `doctor`, `paste --help`, and `daemon --dry-run`.

Verification Contract:

- Each OS records command, Bun version, exit code, and output.

**Confidence:** 65/100
**Depends on:** Tasks 1-3
**Closes:** DoD-4
**Evidence:**
- none yet

### T5 - Terminal Integration - [ ]

- Provide shell snippets or explicit `install-shell` command.
- Bind copy/paste/history commands without global OS hotkeys.
- Provide uninstall.

Verification Contract:

- Install then uninstall leaves shell config in expected state.
- Keybinding invokes CLI command in an interactive shell.

**Confidence:** 80/100
**Depends on:** Goal 03 Tasks 4-7
**Closes:** DoD-5
**Evidence:**
- none yet

## 6. Decisions

- Do not promise GitHub `bunx` until public repo proof passes.
- Prefer tagged GitHub specs over mutable branch docs.
- Keep npm fallback even if GitHub `bunx` works.

## 7. Learnings

- Bun GitHub specs resolve today, but end-to-end command execution must be verified against this package.

## 8. Skills

- Use coding-excellence supply-chain guidance before publishing.

