# Pasta Orchestration Runbook

This file is the fresh-session handoff for a Codex agent driving Pasta from plan to delivery.

## Start Here

1. Read root `AGENTS.md`.
2. Read `GOAL.md`.
3. Create the Moo orchestration workspace `pasta`.
4. Spawn Moo agent sessions only for the current bounded verification or review slice.
5. Read the active goal file under `docs/goals/`.
6. Run `git status --short --branch`.
7. Run `gdd_status.py --author` against the active goal before editing.

Use the `moo` MCP server as the coordination plane. The first Moo MCP call in a fresh session is:

```json
{
  "tool": "moo_create_workspace",
  "arguments": {
    "workspace": "pasta",
    "cwd": "/Users/mish/projects/pasta"
  }
}
```

Current active goal:

```bash
python3 "$HOME/.agents/skills/goal-driven-development/scripts/gdd_status.py" --author docs/goals/11-ios-build-environment.md
```

Native iOS expansion starts at Goal 11. Goals 12-17 remain blocked until their
prerequisite goals have verified evidence and the user confirms the DoD + Tasks
for execution.

## Moo Agent Orchestration

The lead agent owns coordination, final integration, and verification. Worker agents do bounded work in Moo sessions inside the `pasta` workspace. Do not use untracked local panes, ad hoc terminal windows, or memory-only task assignment for delivery work.

Historical initial fanout:

1. `goal-01-protocol`: implementation owner for `docs/goals/01-protocol-and-threat-model.md`.
2. `review-01-protocol`: read-only adversarial review of Goal 01 outputs, threat model, and crypto contract.
3. `scout-02-backend`: read-only Cloudflare Worker/Durable Object scout for Goal 02 interfaces and blockers.
4. `scout-03-cli`: read-only Bun CLI/daemon scout for Goal 03 interfaces and platform constraints.

Those sessions are obsolete once Goals 01-10 are checkpointed done. For native
iOS goals, use narrow sessions only when the user asks for delegated work or the
current goal is explicitly split into independent review/verification slices.

Spawn each session with `moo_create_session` using `workspace: "pasta"`, a descriptive `name`, and `agent: "codex"` unless a task explicitly needs another installed agent runtime. Send the full task brief with `moo_send_input` after creation. Each brief must include:

- exact goal file and task scope;
- allowed files and write permissions;
- dependency gates that must not be crossed;
- required verification command or artifact;
- instruction to preserve user and other-agent changes;
- expected final response format with evidence paths and blockers.

Example spawn shape:

```json
{
  "tool": "moo_create_session",
  "arguments": {
    "workspace": "pasta",
    "name": "goal-01-protocol",
    "agent": "codex",
    "rows": 40,
    "cols": 120
  }
}
```

Then send the scoped brief:

```json
{
  "tool": "moo_send_input",
  "arguments": {
    "workspace": "pasta",
    "session": "goal-01-protocol",
    "text": "Read AGENTS.md, GOAL.md, docs/ORCHESTRATION.md, and docs/goals/01-protocol-and-threat-model.md. Run gdd_status.py --author on the goal. Work only the reported next_task unless you find a blocker. Record dated Evidence in the goal file before marking tasks or DoD complete. Preserve user and other-agent changes. Report changed files, commands run, evidence, and blockers.",
    "enter": true
  }
}
```

## Monitor, Steer, Iterate

Run this loop until the active goal reaches its completion criteria:

1. Inspect live state with `moo_get_session` and `moo_get_transcript` for every active session.
2. Compare worker claims against the worktree with `git status`, `git diff`, file reads, and the relevant verification command.
3. Steer promptly with `moo_send_input` when an agent drifts, duplicates another agent's edits, lacks evidence, or hits a blocker.
4. Use `moo_send_slash_command` with `compact` before a long-running session loses useful context; use `clear` only when intentionally resetting that session with a fresh brief.
5. Keep dependencies strict: downstream scouts may research and report interfaces, but they must not implement blocked goals until upstream evidence has landed.
6. Merge one coherent slice at a time. If two sessions touch the same file, pause one session and reconcile manually before more edits continue.
7. After consuming a worker result, either send the next bounded task or terminate the session with `moo_delete_session`.
8. Rerun `gdd_status.py --author` after every accepted slice and use its output to choose the next task.

Treat worker self-reports as leads, not proof. A task is done only after the lead agent verifies the changed files, command output, and Evidence block directly.

## Delivery Strategy

Work goals in this order:

1. `docs/goals/01-protocol-and-threat-model.md`
2. `docs/goals/02-cloudflare-relay-backend.md`
3. `docs/goals/03-bun-cli-daemon-text-mvp.md`
4. `docs/goals/04-pairing-and-device-management.md`
5. `docs/goals/05-distribution-and-terminal-integration.md`
6. `docs/goals/06-binary-payloads-and-hardening.md`
7. `docs/goals/07-unified-copy-paste-ux.md`
8. `docs/goals/08-github-release-artifacts.md`
9. `docs/goals/09-image-copy-and-history-delete.md`
10. `docs/goals/10-directory-copy-paste.md`
11. `docs/goals/11-ios-build-environment.md`
12. `docs/goals/12-ios-shared-core.md`
13. `docs/goals/13-ios-app-shell-pairing-history.md`
14. `docs/goals/14-ios-keyboard-extension.md`
15. `docs/goals/15-ios-publish-surfaces.md`
16. `docs/goals/16-ios-binary-file-provider-handoff.md`
17. `docs/goals/17-ios-integration-release-readiness.md`

Do not start a blocked goal until its dependency goal has enough verified output to unblock it. If a goal is still marked `blocked` but its dependencies have landed, update the status and explain the evidence in that goal's Decisions or Learnings section.

## Operating Loop

For each goal:

1. Run `gdd_status.py --author <goal-file>`.
2. Work the reported `next_task`.
3. Implement the smallest artifact that satisfies that task's Verification Contract.
4. Run the strongest practical verification.
5. Add dated Evidence with command/check, outcome, and artifact path when relevant.
6. Raise task confidence to at least the goal's `confidence_floor` only when evidence supports it.
7. Tick the task only after its task-level verification passes.
8. Tick a DoD only after its own `verify by:` check passes.
9. Rerun `gdd_status.py --author <goal-file>`.
10. Commit once the goal or a coherent slice is verified.

## Non-Negotiable Architecture

- Pasta is central-service only.
- The backend is a Cloudflare Worker over HTTPS plus a Durable Object per clipboard space.
- Every meaningful action is initiated by a device.
- The service coordinates encrypted state. It does not own clipboard intent and does not see plaintext.
- P2P, LAN discovery, SSH, tailnets, STUN/TURN, and WebRTC traversal are not implementation candidates.

## Verification Gates

- Protocol: deterministic crypto vectors pass in Bun and Worker runtime.
- Backend: Workers integration tests prove signed auth, D1 registry, DO sequencing, no plaintext storage, pairing, revoke, and retention alarms.
- CLI: local text copy/paste/pull works with mock and real backend paths.
- Pairing: two clean device profiles can pair without typing a durable account ID or high-entropy secret.
- CI pairing: a clean noninteractive profile can join with `PASTA_JOIN_TOKEN`; default joins remain trusted until explicit revocation, while joins created with `--device-ttl` use the clipboard before `device_expires_at` and fail with revoked-device auth after expiry.
- Distribution: `bunx --bun -p github:thehumanworks/pasta pasta --version` works from a clean cache after public repo/package shape exists.
- Cross-platform: macOS, Linux, Windows smoke at least `--version`, `doctor`, and the supported clipboard adapter path.

## Blocker Rules

Mark a goal blocked only when a required external dependency or unresolved design decision prevents the next task. Do not mark blocked merely because the task is large.

When blocked, record:

- exact failed command or missing dependency;
- why a narrower local task cannot proceed;
- the smallest condition that would unblock work.

## Commit Hygiene

- Keep commits tied to a goal or coherent verified slice.
- Do not commit local secrets, test credentials, or generated credential stores.
- Before pushing, run `git status --short --branch`, `git diff --check`, and every relevant goal validator.
