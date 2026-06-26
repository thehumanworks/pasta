---
goal_id: "pasta-08-github-release-artifacts"
title: "GitHub Release Artifacts"
status: "active"
confidence_floor: 90
created: "2026-06-26"
updated: "2026-06-26"
---

# Goal: GitHub Release Artifacts

Publish standalone CLI release assets so `mise use -g github:thehumanworks/pasta`
can install Pasta from GitHub tags on macOS, Linux, and Windows.

## 1. Invariants

- GitHub release artifacts are the primary path for mise's `github:` backend.
- npm remains a fallback path only under a scoped package name; the unscoped `pasta` name is already taken.
- Release tags, package metadata, and CLI `--version` must agree.
- Release artifacts must not contain credentials, local config, or generated secret stores.
- Existing Bun GitHub package distribution remains supported.

## 2. Definition of Done - INVARIANT

- [ ] **DoD-1** - GitHub Actions builds standalone release assets for macOS, Linux, and Windows. - *verify by:* release workflow run and artifact list.
- [ ] **DoD-2** - A GitHub tag has release assets consumable by mise's GitHub backend. - *verify by:* `mise use -g github:thehumanworks/pasta` in an isolated mise home.
- [x] **DoD-3** - npm fallback has a documented decision. - *verify by:* npm package-name and auth checks recorded.

## 3. Exit Conditions

- **DONE** - Tagged release artifacts install with mise and run `pasta --version`.
- **BLOCKED-DEP** - GitHub Actions, GitHub Releases, or runner availability blocks artifact generation.
- **SCOPE-CHANGE** - User requires npm publication or signed installers before GitHub release artifacts.

## 4. Tasks - INVARIANT

### T1 - Release Builder - [x]

- Add a Bun release builder for standalone executables.
- Package one root-level `pasta` or `pasta.exe` binary per archive.
- Generate checksums and release notes.
- Fail if release tag, package version, and CLI version differ.

Verification Contract:

- `mise exec -- bun run build:release` exits 0.
- Local host artifact runs `--version`.
- Archive listing shows root-level executable names.

**Confidence:** 95/100
**Depends on:** Goal 05
**Closes:** DoD-1
**Evidence:**
- 2026-06-26 - `mise exec -- bun run build:release` - exit 0; generated `RELEASE_NOTES.md`, `checksums.txt`, and eight archives for macOS arm64/x64, Linux arm64/x64 glibc+musl, and Windows arm64/x64.
- 2026-06-26 - `tar -tzf dist/release/pasta-v0.1.1-macos-arm64.tar.gz` - exit 0; archive contains root-level `pasta`.
- 2026-06-26 - `unzip -l dist/release/pasta-v0.1.1-windows-x64.zip` - exit 0; archive contains root-level `pasta.exe`.
- 2026-06-26 - extracted `dist/release/pasta-v0.1.1-macos-arm64.tar.gz` and ran `pasta --version` - exit 0; output `0.1.1`.
- 2026-06-26 - `shasum -a 256 -c checksums.txt` from `dist/release` - exit 0; all eight archive checksums verified.

### T2 - Release Workflow - [ ]

- Add a tag-triggered and manually dispatchable GitHub Actions workflow.
- Run package checks before building release assets.
- Upload workflow artifacts.
- Create or update the GitHub Release for the tag.

Verification Contract:

- Workflow run exits 0 for the release tag.
- Release contains expected archives and checksum manifest.

**Confidence:** 0/100
**Depends on:** Task 1
**Closes:** DoD-1, DoD-2
**Evidence:**

### T3 - mise Install Proof - [ ]

- Run `mise use -g github:thehumanworks/pasta` with isolated mise directories.
- Confirm the installed `pasta --version` matches the release tag.
- Record macOS proof locally; GitHub Actions covers Linux build/check execution.

Verification Contract:

- Isolated `mise use -g github:thehumanworks/pasta` exits 0.
- Isolated `mise exec github:thehumanworks/pasta -- pasta --version` exits 0.

**Confidence:** 0/100
**Depends on:** Task 2
**Closes:** DoD-2
**Evidence:**

### T4 - npm Decision - [x]

- Check npm package-name availability.
- Check local npm publish authentication.
- Document whether npm publication is in scope.

Verification Contract:

- `npm view pasta ...` result is recorded.
- `npm whoami` result is recorded without exposing credentials.

**Confidence:** 95/100
**Depends on:** none
**Closes:** DoD-3
**Evidence:**
- 2026-06-26 - `npm view pasta name version repository dist-tags --json` - exit 0; unscoped `pasta` exists at version `0.4.1` and points to `github.com/nrn/pasta.git`, so this project cannot publish that name.
- 2026-06-26 - `npm whoami` - exit 1 with `E401 Unauthorized`; local npm publish credentials are not available.
- 2026-06-26 - Decision: do not publish npm in this change; future npm fallback must use a scoped package such as `@thehumanworks/pasta` plus npm auth.

## 5. Decisions

- 2026-06-26 - Prefer GitHub release artifacts for the exact `mise use github:thehumanworks/pasta` command. Scope impact: npm publication is optional fallback, not required for done.

## 6. Learnings
