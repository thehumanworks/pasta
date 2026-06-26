# Pasta Agent Instructions

These project-local instructions apply to this repository.

## Product Boundary

- The app name is **Pasta**. CLI/package references should use `pasta`.
- Transport is central-service only: Cloudflare Worker over HTTPS plus one Durable Object per clipboard space.
- P2P, LAN discovery, SSH, tailnets, STUN/TURN, and WebRTC traversal are out of scope. Do not reintroduce them as a fallback or future MVP path.
- Devices own interactions: copy publishes ciphertext, paste pulls latest/history, pairing approval wraps keys, reset starts a new encrypted space.
- Cloudflare must never receive clipboard plaintext or raw group keys.
- Cloudflare auth products are not part of MVP auth. Use app-owned device keys and signed requests.

## Execution Entry Point

- Read `outputs/pasta-plan/GOAL.md`.
- Read `outputs/pasta-plan/ORCHESTRATION.md`.
- Work the goal files in `outputs/pasta-plan/goals/` using the local GDD workflow.
- Before changing a goal, run `gdd_status.py` on it and preserve its DoD/task coverage.
- Record evidence in the task's `Evidence` block before marking any task or DoD complete.

## Scope Discipline

- Text MVP comes before images/files.
- Shell/keybinding integration comes before global OS hotkeys or OS services.
- Keep implementation changes narrow to the active goal.
- Do not store secrets in config files, logs, fixtures, or docs.

