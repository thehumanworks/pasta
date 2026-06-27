---
goal_id: "pasta-16-ios-binary-file-provider-handoff"
title: "Native iOS Binary And File Provider Handoff"
status: "blocked"
confidence_floor: 90
created: "2026-06-27"
updated: "2026-06-27"
---

# Goal: Native iOS Binary And File Provider Handoff

## 1. Invariants · the rules that must not break

This file is the only state for this delivery subgoal — if it isn't written here,
it didn't happen. Scope freezes only after user confirmation of §3 and §5.
Tasks and DoD are ticked only with evidence and Confidence ≥ `confidence_floor`.
Scope changes stop execution and surface to the user.

---

## 2. References

- `docs/goals/15-ios-publish-surfaces.md` — prerequisite binary publish
  surfaces.
- `docs-site/content/native-ios.md` — binary and directory handling contract.
- `docs/binary-payloads.md` — encrypted image/file/directory payload semantics.
- `src/cli/directory-zip.ts` — directory bundle invariants to preserve in Swift.
- Apple File Provider docs linked from `docs-site/content/native-ios.md`.

---

## 3. Definition of Done · INVARIANT

- [ ] **DoD-1** — Non-text clips in the keyboard are never direct-insert items;
  they offer Copy to iPhone Clipboard, Open in Pasta, Share/Export, or Delete
  actions as appropriate. — *verify by:* keyboard/app simulator smoke.
- [ ] **DoD-2** — iOS can retrieve and hand off image and file clips from Pasta
  history without persisting plaintext payloads longer than required. — *verify
  by:* simulator/device file smoke and storage review.
- [ ] **DoD-3** — Directory bundles preserve the existing contract: local zip,
  Pasta directory MIME, encrypted metadata, local extraction, and normal `.zip`
  files remain normal files. — *verify by:* Swift tests against directory bundle
  fixtures and simulator file smoke.
- [ ] **DoD-4** — File Provider integration is either implemented and verified
  for file/directory history in Files, or explicitly deferred with a documented
  UX/review rationale and equivalent document-picker/share fallback. — *verify
  by:* File Provider smoke or accepted deferral ADR/update.
- [ ] **DoD-5** — Binary handoff does not change Worker-visible metadata beyond
  the existing payload kind, MIME, byte length, device, sequence, and timing
  boundary. — *verify by:* API/log inspection and tests.

---

## 4. Exit Conditions

- **`DONE`** — iOS handles images, files, and directory bundles through native
  handoff surfaces while preserving Pasta's metadata boundary. *(primary)*
- **`BLOCKED-DEP`** — Goal 15 is incomplete, or File Provider feasibility cannot
  be resolved without App Store/developer-account input.
- **`SCOPE-CHANGE`** — binary handoff requires treating files/directories as
  text, leaking names/paths, or changing Worker storage semantics.
- **`CONFIDENCE-STALL`** — a task cannot reach 90 confidence after two attempts.
- **`BUDGET`** — one implementation pass plus one verification-fix loop is
  exhausted.

---

## 5. Tasks · INVARIANT

### T1 · Add Non-Text Keyboard Actions · [ ]

**Steps**
- [ ] Render images, files, and directories as handoff-only history items.
- [ ] Add actions for copy to clipboard, open in app, share/export, and delete.
- [ ] Keep disabled direct-insert affordances clear.

**Verification Contract**
- *Check:* Keyboard never inserts binary clips as text.
- *Method:* keyboard/app simulator smoke.
- *Expected:* Non-text clips expose handoff actions only.

**Confidence:** 0 / 90 · **Depends on:** Goal 15 · **Closes:** DoD-1

**Evidence (required before tick; append-only)**

---

### T2 · Implement Image And File Retrieval Handoff · [ ]

**Steps**
- [ ] Download encrypted file payloads through existing file endpoints.
- [ ] Decrypt to extension-safe temporary files.
- [ ] Present clipboard/share/document export actions and clean up temporary
  plaintext promptly.

**Verification Contract**
- *Check:* iOS can use Pasta image/file history without persistent plaintext
  leaks.
- *Method:* simulator/device file smoke plus storage review.
- *Expected:* Exported payload is correct; app containers do not retain stray
  plaintext copies.

**Confidence:** 0 / 90 · **Depends on:** T1 · **Closes:** DoD-2, DoD-5

**Evidence (required before tick; append-only)**

---

### T3 · Port Directory Bundle Handling · [ ]

**Steps**
- [ ] Port or reimplement directory zip creation/extraction invariants in Swift.
- [ ] Preserve MIME-based directory detection.
- [ ] Reject path traversal and keep normal zips as normal file clips.

**Verification Contract**
- *Check:* Directory bundles round-trip on iOS like desktop.
- *Method:* Swift fixture tests and simulator Files smoke.
- *Expected:* Pasta directory MIME extracts locally; generic `.zip` does not
  auto-extract.

**Confidence:** 0 / 90 · **Depends on:** T2 · **Closes:** DoD-3, DoD-5

**Evidence (required before tick; append-only)**

---

### T4 · Decide And Implement Or Defer File Provider · [ ]

**Steps**
- [ ] Evaluate File Provider UX, App Review, caching, and security cost after
  app/share/binary handoff works.
- [ ] Implement a File Provider extension if it materially improves file and
  directory history.
- [ ] If deferred, document the rationale and the document-picker/share fallback.

**Verification Contract**
- *Check:* File Provider is not left as an ambiguous half-plan.
- *Method:* File Provider simulator smoke or ADR/docs deferral review.
- *Expected:* Either Files integration works, or deferral is explicit and
  user-facing handoff remains complete.

**Confidence:** 0 / 90 · **Depends on:** T3 · **Closes:** DoD-4

**Evidence (required before tick; append-only)**

---

### T5 · Verify Binary Metadata Boundary · [ ]

**Steps**
- [ ] Inspect Worker-visible payloads for image, file, and directory flows.
- [ ] Run desktop/iOS cross-device binary handoff smoke.
- [ ] Run Swift and TypeScript binary payload tests.

**Verification Contract**
- *Check:* iOS binary handoff remains compatible with desktop and backend.
- *Method:* simulator/device smoke, API/log inspection, `swift test`, and
  `mise exec -- bun test`.
- *Expected:* No plaintext names, paths, or payload bytes appear server-side.

**Confidence:** 0 / 90 · **Depends on:** T4 · **Closes:** DoD-1, DoD-2, DoD-3, DoD-4, DoD-5

**Evidence (required before tick; append-only)**

## 6. Decisions · LIVE (append-only)

- 2026-06-27 - File Provider is useful for a polished Files experience, but it is
  not allowed to block the core keyboard/share/app handoff unless this goal's
  feasibility task proves it is essential. Scope impact: none.
- 2026-06-27 - Self adversarial review found the largest technical risk is
  conflating generic zip files with Pasta directory bundles. MIME-based directory
  detection is an explicit DoD. Scope impact: none.

---

## 7. Learnings · LIVE (append-only)

*(none yet)*

---

## 8. Skills · LIVE (append-only)

*(none yet)*
