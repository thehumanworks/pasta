# Pasta Orchestration Runbook

This file is the fresh-session handoff for a Codex agent driving Pasta from plan to delivery.

## Start Here

1. Read root `AGENTS.md`.
2. Read `outputs/pasta-plan/GOAL.md`.
3. Read the active goal file under `outputs/pasta-plan/goals/`.
4. Run `git status --short --branch`.
5. Run `gdd_status.py --author` against the active goal before editing.

Current active goal:

```bash
python3 /Users/mish/.agents/skills/goal-driven-development/scripts/gdd_status.py outputs/pasta-plan/goals/01-protocol-and-threat-model.md --author
```

## Delivery Strategy

Work goals in this order:

1. `01-protocol-and-threat-model.md`
2. `02-cloudflare-relay-backend.md`
3. `03-bun-cli-daemon-text-mvp.md`
4. `04-pairing-and-device-management.md`
5. `05-distribution-and-terminal-integration.md`
6. `06-binary-payloads-and-hardening.md`

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

