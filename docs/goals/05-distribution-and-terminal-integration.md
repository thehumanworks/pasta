---
goal_id: "pasta-05-distribution-terminal-integration"
title: "Distribution and Terminal Integration"
status: "done"
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

- [x] **DoD-1** - `package.json#bin` and shebang CLI entrypoint work locally. - *verify by:* `bun run` and package smoke.
- [x] **DoD-2** - `bunx --bun github:thehumanworks/pasta...` works from a clean cache against the public repo. - *verify by:* real command after repo publish.
- [x] **DoD-3** - npm fallback package path is packable and contains only intended files. - *verify by:* pack dry-run/list.
- [x] **DoD-4** - macOS, Linux, and Windows at least run `--version`, `doctor`, and help via chosen distribution path. - *verify by:* OS smoke matrix.
- [x] **DoD-5** - Shell/keybinding integration docs and installer are reversible. - *verify by:* install/uninstall smoke.

## 4. Exit Conditions

- **DONE** - Public repo execution and terminal integration proof are recorded.
- **BLOCKED-DEP** - Repo not public, Bun regression, or OS matrix unavailable.
- **SCOPE-CHANGE** - User requires signed installers/autoupdate before CLI MVP.
- **CONFIDENCE-STALL** - Windows or Linux command execution cannot be proven.
- **BUDGET** - Stop with exact distribution command and error.

## 5. Tasks - INVARIANT

### T1 - Package Execution Contract - [x]

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
- 2026-06-26 - `mise exec -- bun run src/cli.ts --version` - exit 0; output `0.1.0`.
- 2026-06-26 - `mise exec -- bunx --bun -p file:$PWD pasta --version` - exit 0; local package `bin` execution output `0.1.0`.
- 2026-06-26 - package review `package.json` - no `install`, `postinstall`, or `prepare` lifecycle scripts.

### T2 - GitHub Bunx Proof - [x]

- Publish or use public repo.
- Run GitHub `bunx` command from clean cache.
- Test default branch and pinned tag/SHA.

Verification Contract:

- `bunx --bun -p github:thehumanworks/pasta pasta --version` exits 0.
- `bunx --bun github:thehumanworks/pasta#v0.1.0 --version` exits 0 after tag exists.

**Confidence:** 95/100
**Depends on:** Task 1 and public repo
**Closes:** DoD-2
**Evidence:**
- 2026-06-26 - `git ls-remote origin HEAD refs/heads/main refs/tags/v0.1.0` - exit 0; origin main exists at `fa184def4d6930923e803a34c951406648d82732`; no `v0.1.0` tag returned.
- 2026-06-26 - `MISE_EXPERIMENTAL=1 mise exec -- bunx --bun -p github:thehumanworks/pasta pasta --version` - exit 1; GitHub tarball API returned 404, so public GitHub execution cannot be proven from the unpushed/unpublished current worktree.
- 2026-06-26 - clean-cache `bunx` proof with temporary `BUN_INSTALL_CACHE_DIR`: `bunx --bun -p github:thehumanworks/pasta pasta --version` and `bunx --bun github:thehumanworks/pasta#v0.1.0 --version` - both exit 1; GitHub tarball API returned 404 for default branch and `v0.1.0`.
- 2026-06-26 - `curl -fsS -I https://api.github.com/repos/thehumanworks/pasta/tarball/` - exit 0 from shell pipeline while `curl` reported HTTP 404; unauthenticated GitHub tarball API cannot access the repo/package artifact yet.
- 2026-06-26 - `gh repo view thehumanworks/pasta --json nameWithOwner,visibility,isPrivate,url` after approved visibility change - exit 0; repo reports `visibility: PUBLIC`, `isPrivate: false`.
- 2026-06-26 - `curl -fsSI https://api.github.com/repos/thehumanworks/pasta/tarball/` - exit 0; unauthenticated GitHub tarball API returned HTTP 302 to codeload for `refs/heads/main`.
- 2026-06-26 - clean-cache `BUN_INSTALL_CACHE_DIR=$(mktemp -d) bunx --bun -p github:thehumanworks/pasta pasta --version` - exit 0; output `0.1.0`.
- 2026-06-26 - clean-cache `BUN_INSTALL_CACHE_DIR=$(mktemp -d) bunx --bun github:thehumanworks/pasta#v0.1.0 --version` - exit 0; output `0.1.0`.

### T3 - Npm Fallback - [x]

- Add package file allowlist.
- Run pack dry-run/list.
- Optionally publish under chosen scope.

Verification Contract:

- Package contains CLI source, README, license, and required runtime files only.
- No secrets, local config, or generated credentials appear.

**Confidence:** 95/100
**Depends on:** Task 1
**Closes:** DoD-3
**Evidence:**
- 2026-06-26 - `mise exec -- bun run pack:list` - exit 0; dry-run listed 20 intended package files and no local config, generated credential stores, `.wrangler`, or secret files.
- 2026-06-26 - `mise exec -- bun pm pack` - exit 0; pack metadata reported `pasta-0.1.0.tgz`, 20 files, 0.63MB unpacked; generated tarball removed after inspection.
- 2026-06-26 - `mise exec -- bun run pack:list` after adding package license metadata - exit 0; dry-run listed 21 intended files including `LICENSE`, README, runtime source, migration, Worker config/types, and no local config, generated credential stores, `.wrangler`, or secret files.

### T4 - OS Smoke Matrix - [x]

- macOS: run installed command.
- Linux: run installed command.
- Windows: run installed command.
- Include `--version`, `doctor`, `paste --help`, and `daemon --dry-run`.

Verification Contract:

- Each OS records command, Bun version, exit code, and output.

**Confidence:** 90/100
**Depends on:** Tasks 1-3
**Closes:** DoD-4
**Evidence:**
- 2026-06-26 - macOS smoke `mise exec -- bun run src/cli.ts --version`, `doctor`, `paste --help`, and `daemon --dry-run` - exit 0; Bun 1.3.14; doctor found `macos-pbcopy`; dry-run returned `{"published":0}`.
- 2026-06-26 - user-approved proof standard - Linux/Windows live smoke unavailable in this macOS-only environment; reasonable assumptions are based on deterministic command-plan tests for Linux `wl-copy/wl-paste`, `xclip`, `xsel` and Windows `powershell.exe`/`pwsh`.

### T5 - Terminal Integration - [x]

- Provide shell snippets or explicit `install-shell` command.
- Bind copy/paste/history commands without global OS hotkeys.
- Provide uninstall.

Verification Contract:

- Install then uninstall leaves shell config in expected state.
- Keybinding invokes CLI command in an interactive shell.

**Confidence:** 95/100
**Depends on:** Goal 03 Tasks 4-7
**Closes:** DoD-5
**Evidence:**
- 2026-06-26 - `mise exec -- bun run test` - exit 0; install-shell writes reversible snippet and uninstall-shell clears it.
- 2026-06-26 - `docs/distribution.md` review - documents local package shape, public GitHub proof commands, and shell integration behavior.

## 6. Decisions

- Do not promise GitHub `bunx` until public repo proof passes.
- Prefer tagged GitHub specs over mutable branch docs.
- Keep npm fallback even if GitHub `bunx` works.
- 2026-06-26 - DoD-2 remains uncheckpointed because this implementation is not committed/tagged/published to the public GitHub repo in this turn; public `bunx github:thehumanworks/pasta` would test old remote state. Scope impact: none.
- 2026-06-26 - DoD-4 checkpoint uses macOS live proof plus user-approved Linux/Windows assumptions; `container` and `modal` are installed locally if a future stricter Linux cloud/container proof is requested, but Windows still requires an actual Windows runner. Scope impact: none.
- 2026-06-26 - Goal 05 is blocked only on public GitHub/tag proof for DoD-2; pushing commits, creating tags, or changing repo visibility are external effects and were not performed without explicit approval. Scope impact: none.
- 2026-06-26 - User approved commit/tag/push and making `thehumanworks/pasta` public; default-branch and `v0.1.0` clean-cache `bunx` proofs now pass. Scope impact: none.

## 7. Learnings

- Bun GitHub specs resolve today, but end-to-end command execution must be verified against this package.

## 8. Skills

- Use coding-excellence supply-chain guidance before publishing.
