# PromptVault — Boot Debugging Session Handoff
**Date:** 2026-03-13
**Repo:** https://github.com/testbedohio/PromptVault
**Branch:** `main`
**Status:** ✅ App boots and runs on macOS

---

## Summary

This session covered getting PromptVault running on a fresh macOS machine after all feature
development was complete. Seven bugs were found and fixed — none were logic errors in the
application; all were build/runtime configuration issues that only surface when compiling
outside the original development environment.

---

## Bugs Fixed (in order encountered)

### 1. FTS5 contentless table — prompts could not be saved

**Symptom:** Console showed `cannot DELETE from contentless fts5 table: prompts_fts`.
Creating a prompt appeared to work (status bar showed "1 prompts") but the sidebar stayed
empty and the prompt was inaccessible.

**Root cause:** The `prompts_fts` FTS5 virtual table was created with `content=''`, making
it a contentless table. Contentless FTS5 tables are append-only — `DELETE` and `INSERT` with
existing rowids both fail. `update_prompt` and `delete_prompt` both call
`DELETE FROM prompts_fts WHERE rowid = ?1` which threw the error.

**Fix (`db.rs`):**
- Removed `content=''` from the `CREATE VIRTUAL TABLE prompts_fts` statement.
- Added `migrate_fts_contentless()` — detects an existing contentless table via
  `prompts_fts_config WHERE k = 'content'`, drops and recreates it as a regular FTS5 table,
  then re-indexes all existing prompts. No-op on fresh installs.

---

### 2. Missing Cargo.toml dependencies — would not compile

**Symptom:** Three compile errors on first build:
- `E0432: unresolved import rusqlite::backup` — `backup` feature not listed
- `E0432: unresolved import argon2` — crate not in Cargo.toml
- `E0433: unresolved module getrandom` — crate not in Cargo.toml

**Root cause:** The user's local `Cargo.toml` was a pre-session version (stashed during
a `git stash` / merge conflict) that predated the encryption sprint. It was missing:
```toml
rusqlite = { version = "0.31", features = ["bundled-sqlcipher-vendored-openssl", "backup"] }
argon2 = "0.5"
getrandom = "0.2"
```

**Fix:** `git reset --hard origin/main` restored the correct `Cargo.toml`. The stash
conflict arose because the user had run `npm install` which generated a local
`package-lock.json`, causing git to flag the working tree as dirty.

---

### 3. E0597 — `stmt` does not live long enough (`db.rs`)

**Symptom:** Compile error in `get_all_embeddings`.

**Root cause:** The `if/else` branching structure declared `stmt` inside each arm and
immediately used it as the arm's tail expression. Rust dropped `stmt` at the closing `}`
of the arm while the `MappedRows` iterator still held a borrow of it.

**Fix (`db.rs`):** Refactored to declare both prepared statements (`stmt_with`, `stmt_all`)
before the `if/else`, then call `query_map` inside the branches. With both statements alive
for the full scope of the function, the borrow checker is satisfied.

---

### 4. E0382 — borrow of moved value in `set_shortcut` (`lib.rs`)

**Symptom:** Compile error: `action` moved into `shortcuts.insert()` then borrowed for the
`defaults` lookup on the same line.

**Fix (`lib.rs`):** Read the default value into a local variable before the insert:
```rust
let default_val = defaults.get(action.as_str()).cloned().unwrap_or_default();
shortcuts.insert(action, default_val);
```

---

### 5. Invalid PNG icons — window title bar only, no content

**Symptom:** `proc macro panicked: failed to read icon 32x32.png: Invalid PNG signature`

**Root cause:** The icon files in `src-tauri/icons/` were placeholder files written by
the `generate_icons.py` script with incorrect PNG signatures.

**Fix:** Rewrote `generate_icons.py` output inline with a minimal valid PNG generator
(correct IHDR/IDAT/IEND chunks, proper CRC32, zlib-compressed scanlines). Generated
`32x32.png`, `128x128.png`, `128x128@2x.png`, and `icon.png`.

---

### 6. Non-exhaustive match on `StepResult` (`db.rs`)

**Symptom:** `E0004: non-exhaustive patterns: _ not covered` in `restore_from()`.

**Root cause:** `rusqlite::backup::StepResult` is marked `#[non_exhaustive]`, meaning
the compiler requires a wildcard arm even when all known variants are covered.

**Fix (`db.rs`):** Added `_ => break` as a final catch-all arm.

---

### 7. `tokio::spawn` before Tauri runtime — panic on launch

**Symptom:** App compiled and opened a window, but immediately panicked:
`there is no reactor running, must be called from the context of a Tokio 1.x runtime`

**Root cause:** `tokio::spawn(run_sync_worker(...))` was called in `run()` before
`tauri::Builder::run()` — Tauri sets up its Tokio runtime during `.run()`, so any
`tokio::spawn` call before that point has no reactor.

**Attempted fix 1:** Moved `tokio::spawn` into `.setup()`. Still panicked — Tauri v2's
`.setup()` hook runs on the main thread before the async runtime is fully initialised.

**Fix (`lib.rs`):** Replaced `tokio::spawn` with `tauri::async_runtime::spawn`.
Tauri exposes its own runtime handle via `tauri::async_runtime` specifically for this
use case — spawning tasks that need to outlive the setup hook.

```rust
// Before (panics):
tokio::spawn(run_sync_worker(...));

// After (correct):
tauri::async_runtime::spawn(run_sync_worker(...));
```

---

### 8. Stale `ShortcutsDialog.tsx` — blank white window

**Symptom:** App launched but rendered a completely blank white window.
Console showed: `SyntaxError: Importing binding name 'saveShortcuts' is not found.`

**Root cause:** The `ShortcutsDialog.tsx` file in the repo was a stale version from before
this feature was built. It imported `saveShortcuts` and `ShortcutsConfig` from
`../api/commands` — neither of which exist. The correct exports are `setShortcut`,
`getShortcuts`, `resetShortcuts`, and `ShortcutMap`. The stale file survived
`git reset --hard` because it was already committed to `main` from an earlier session.

**Fix:** Overwrote `ShortcutsDialog.tsx` with the correct implementation that matches
the actual `commands.ts` exports.

---

## Current Known Issues / Watch Points

| Area | Notes |
|------|-------|
| Local embeddings | The `all-MiniLM-L6-v2` ONNX model downloads from HuggingFace on first use. This is a ~30 MB download and will fail silently if the CDN is unreachable. Configure a Gemini or Voyage API key in the Brain Selector as a reliable alternative. |
| Icon quality | Icons were regenerated as solid-color PNGs. For a production build, replace `src-tauri/icons/` with proper branded assets and re-run `cargo tauri icon path/to/source.png`. |
| Database location | `~/Library/Application Support/com.promptvault.app/prompt_vault.db` — safe to delete if the DB gets into a bad state during development. |

---

## Environment Confirmed Working

| Component | Version |
|-----------|---------|
| macOS | Sequoia (Apple Silicon) |
| Rust | stable (rustc 4a4ef493e) |
| Node.js | via npm, Vite 6.4.1 |
| Tauri CLI | 2.x |
| Target | `target/debug/promptvault` (dev build) |

---

## Session Operating Rules (carry forward)

- Always verify GitHub pushes after every file push
- Alert user when within 20% of context window
- Generate .md handoff document at end of every session
- Ask questions one at a time in main chat (not popup)
- Consult before significant architectural decisions
- Build incrementally, commit each phase to `main`

## GitHub Webhook

```
URL:   https://testbed999.app.n8n.cloud/webhook/gh-api-v3
Token: 22d971dc8e8bb79f09153545e8201f07875c7f6150d0291bc0192a38eb6d4d8f
Skill: /mnt/skills/user/github-passthrough/SKILL.md
```
