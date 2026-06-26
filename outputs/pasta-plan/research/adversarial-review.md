# Adversarial Review

Review date: 2026-06-26

## Findings

1. **P2P is out of scope, not a fallback.**
   - Risk: future agents may reintroduce Tailscale/WebRTC/LAN discovery as a "nice to have" and dilute the firewall-constrained requirement.
   - Decision: build only the central HTTPS relay with per-space Durable Objects. Say plainly that P2P is not a product consideration.
   - Verification impact: no P2P, LAN, SSH, tailnet, STUN/TURN, or WebRTC milestone is part of MVP.

2. **`routing_id` is required but must not become UX or auth.**
   - Risk: future agents may expose a random DO/account ID as something users must carry or treat it as a secret.
   - Decision: `routing_id` is internal routing metadata, embedded in QR/pairing payloads when needed and protected by signed device auth.
   - Verification impact: pairing tests must pass without manual entry of long random IDs.

3. **GitHub `bunx` is not proven enough to be the only distribution path.**
   - Risk: Bun's documented `bunx` page is npm-package oriented; empirical GitHub parsing does not prove full cross-platform execution.
   - Decision: keep GitHub `bunx` as a required smoke test and npm/compiled binaries as fallback paths.
   - Verification impact: public repo smoke on macOS, Linux, and Windows is required before "any user can run it" is done.

4. **Native dependencies can break the public repo run path.**
   - Risk: keychain or global-hotkey packages often require native builds or lifecycle scripts, which conflict with `bunx github:` and cross-arch use.
   - Decision: use `Bun.secrets`, OS clipboard command adapters, and no native hotkey package for MVP.
   - Verification impact: package install audit must prove no required install/build/postinstall scripts.

5. **Cloudflare auth must not creep back into MVP.**
   - Risk: Access/OAuth/passkeys via Cloudflare would lock the app to Cloudflare identity surfaces, against the requirement.
   - Decision: app-owned device keys and signatures are the auth layer; Cloudflare is only relay/storage.
   - Verification impact: backend tests must authenticate with device signatures only.

6. **Images and files are too large for the first invariant.**
   - Risk: adding binary payloads early forces R2 streaming, MIME handling, size limits, and retention semantics before the text path is stable.
   - Decision: text-first MVP. Images/files remain a separate goal behind R2 encrypted blob work.
   - Verification impact: text MVP should explicitly reject unsupported binary payloads with a controlled error.

7. **Pure JS crypto is a practical choice, not a magic shield.**
   - Risk: JS crypto libraries have side-channel and runtime caveats even when audited.
   - Decision: use audited noble packages with test vectors and narrow primitives; revisit native crypto only if the threat model demands it.
   - Verification impact: protocol tests must include deterministic vectors, bad-tag rejection, nonce uniqueness checks, and replay rejection.

8. **Desktop adapters are under-researched outside macOS.**
   - Risk: Linux Wayland/X11 and Windows clipboard behavior can diverge in daemon/headless contexts.
   - Decision: make adapter proof a required first task in the CLI goal.
   - Verification impact: do not claim cross-platform clipboard support until each OS has a live smoke test.

9. **History semantics can leak more metadata than expected.**
   - Risk: even with encrypted payloads, sequence counts, timestamps, sizes, MIME type, and origin device IDs are visible to Cloudflare.
   - Decision: accept this for MVP only if documented; payload plaintext and keys remain protected.
   - Verification impact: threat model must label metadata leakage explicitly.

10. **Daemon reliability can become unbounded scope.**
    - Risk: launch agents, systemd user services, Windows scheduled tasks/services, global hotkeys, and auto-updaters can consume the project before paste-pull works.
    - Decision: first daemon is a foreground/user-run process plus shell integration. Platform autostart is later.
    - Verification impact: MVP daemon proof is one local running process, not OS service installation.

## Required Changes To The Plan

- Preserve central-service-only transport as a hard invariant.
- Keep Goal 03 focused on text and shell/keybinding integration.
- Keep Goal 06 blocked until Goals 02-05 are complete.
- Add explicit verification for no plaintext in D1, DO storage, R2, config files, logs, and error messages.
- Add a public-repo distribution proof before telling users to rely on `bunx github:...`.
- Add a reset flow only after documenting that old encrypted history is unrecoverable.
