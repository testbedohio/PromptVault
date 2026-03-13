# PromptVault — Session Handoff
**Date:** 2026-03-13  
**Repo:** https://github.com/testbedohio/PromptVault  
**Branch:** `main`  
**Last commit:** Task 5 — SQLCipher encryption

---

## All 5 Tasks — COMPLETE ✅

| # | Task | Status | Key files changed |
|---|------|--------|-------------------|
| 1 | sqlite-vec persistence (Option B, per-provider) | ✅ Done (prev session) | `db.rs`, `lib.rs`, `commands.ts`, `useEmbeddings.ts` |
| 2 | OAuth callback server (localhost:8741) | ✅ Done (was already in repo) | `sync.rs` |
| 3 | Background sync worker + auto-sync toggle | ✅ Done | `sync.rs`, `lib.rs`, `commands.ts`, `SyncPanel.tsx` |
| 4 | Merge/Override conflict UI (last-write-wins) | ✅ Done | `db.rs`, `sync.rs`, `lib.rs`, `commands.ts`, `ConflictDialog.tsx`, `App.tsx` |
| 5 | SQLCipher encryption + master password UI | ✅ Done | `Cargo.toml`, `db.rs`, `lib.rs`, `commands.ts`, `UnlockDialog.tsx`, `SetPasswordDialog.tsx`, `App.tsx` |

---

## Repo File Structure (current, 42 files)

```
Root:         .gitignore, HANDOFF.md, README.md, index.html, package.json,
              postcss.config.js, tailwind.config.js, tsconfig.json, vite.config.ts
src/:         main.tsx, App.tsx, types.ts, vite-env.d.ts
src/styles/:  globals.css
src/api/:     commands.ts
src/hooks/:   useAppData.ts
src/editor/:  darculaTheme.ts, MonacoEditor.tsx
src/embeddings/: service.ts, useEmbeddings.ts
src/components/: Sidebar.tsx, EditorPanel.tsx, Inspector.tsx, StatusBar.tsx,
                 CommandPalette.tsx, NewPromptDialog.tsx, BrainSelector.tsx,
                 DiffViewer.tsx, SyncPanel.tsx, ConflictDialog.tsx,
                 UnlockDialog.tsx, SetPasswordDialog.tsx
src-tauri/:   Cargo.toml, build.rs, tauri.conf.json
src-tauri/migrations/: 001_init.sql
src-tauri/src/: main.rs, lib.rs, db.rs, sync.rs
scripts/:     generate_icons.py
```

---

## Architecture Reference

### Tech Stack
| Layer | Technology |
|-------|-----------|
| Desktop shell | Tauri v2 (Rust) |
| Frontend | React 19 + TypeScript + Vite 6 |
| Styling | Tailwind CSS 3 (Darcula palette) |
| Editor | Monaco Editor `@monaco-editor/react ^4.6.0` |
| Database | SQLite via SQLCipher (rusqlite 0.31, bundled-sqlcipher-vendored-openssl) |
| Embeddings | `@xenova/transformers ^2.17.0` (local), Gemini API, Voyage AI |
| Sync | Google Drive API v3 via `reqwest 0.12` |
| Encryption | SQLCipher AES-256, Argon2id key derivation |

### Database Schema
```sql
categories      (id, name, parent_id, created_at)
prompts         (id, title, category_id, created_at, updated_at)
prompt_versions (id, prompt_id, content_text, version_number, embedding_vector BLOB, created_at)
tags            (id, name UNIQUE)
prompt_tags     (prompt_id, tag_id)  -- composite PK
prompts_fts     VIRTUAL TABLE USING fts5(title, content)  -- tokenize='porter unicode61'
embeddings      (prompt_id, vector BLOB, model TEXT, provider TEXT, dimensions INTEGER, updated_at)
                -- PRIMARY KEY (prompt_id, provider)  ← composite, per-provider storage
```

### Key State Design
- `db` in AppState uses `std::sync::Mutex` — sync commands only, never held across `.await`
- `sync` in AppState uses `Arc<tokio::sync::Mutex>` — async, cloneable into spawned tasks
- `db_locked: Arc<AtomicBool>` — true when DB is encrypted but key not yet applied
- `sync_worker_tx: Arc<watch::Sender<SyncWorkerCtl>>` — live config updates to background worker

---

## Task 3 Detail — Background Sync Worker

**Design:**  
A `tokio::spawn`-ed task (`run_sync_worker`) lives for the entire app lifetime. It uses `tokio::select!` on a sleep future and a `watch::Receiver`, so config changes (enable/disable, interval change) take effect immediately without restarting the task.

**New Tauri command:** `set_auto_sync(enabled: bool, interval_mins: u32)`  
- Persists to `sync_config.json` via `SyncConfig.auto_sync_enabled / auto_sync_interval_mins`  
- Sends updated `SyncWorkerCtl` through the watch channel  
- Worker idles (waits for channel change) when `enabled = false`

**UI:** `SyncPanel.tsx` — connected state now shows a pill toggle + 4-button interval selector (5/15/30/60 min).

---

## Task 4 Detail — Conflict Resolution

**Policy:** Last-write-wins. Remote `modifiedTime` (RFC 3339) is compared against local `last_sync`. The newer one is used automatically when the user clicks "Accept Newest."

**New Tauri commands:**
- `get_conflict_info` — called on startup (after confirming Drive is connected). Returns `ConflictInfo { remote_modified, local_last_sync, remote_is_newer }` or `null`.
- `resolve_conflict(strategy)` — `"accept_newest"` re-checks timestamps at call time (TOCTOU-safe), downloads remote if still newer via `DriveSync::download_db()`, restores into the live connection via `Database::restore_from()` (SQLite backup API — no close/reopen needed), then updates `last_sync`. Returns `{ data_replaced: bool }`.

**Restore mechanism (`db.rs::restore_from`):**  
Uses `rusqlite::backup::Backup::new(src, &mut self.conn)` to copy pages into the live connection in 1000-page steps. The connection handle never changes — no pointer invalidation, safe on Windows.

**UI flow:** `App.tsx` checks for conflict on startup (`useEffect([loading])`), stores in `conflict` state. `ConflictDialog.tsx` shows remote/local timestamps, "Accept Newest" button, "Keep local" and "Decide later" secondaries. If `data_replaced = true`, calls `window.location.reload()` to flush stale React state.

---

## Task 5 Detail — SQLCipher Encryption

### Cryptographic design
| Component | Choice | Rationale |
|-----------|--------|-----------|
| Cipher | SQLCipher AES-256-CBC | Industry standard for SQLite encryption |
| Key derivation | Argon2id, 64 MB / 3 iter / 4 threads → 32-byte key | Memory-hard, OWASP recommended |
| Salt | 32 random bytes, hex-encoded to `<app_data>/PromptVault/db.salt` | Side-channel free detection |
| SQLite backend | `rusqlite 0.31` with `bundled-sqlcipher-vendored-openssl` | No system OpenSSL dep required |

### Encryption is opt-in
Existing plaintext databases continue to work as before. The user enables encryption via the 🔒/🔓 header button which opens `SetPasswordDialog`. Encryption state is detected purely from the presence/absence of the salt file.

### Salt file layout
```
<platform app data>/PromptVault/db.salt   →   64 hex chars (32 bytes, no newline)
```
macOS: `~/Library/Application Support/PromptVault/db.salt`  
Windows: `%LOCALAPPDATA%\PromptVault\db.salt`  
Linux: `~/.local/share/PromptVault/db.salt`

### Key application timing
`PRAGMA key = "x'<64 hex>'"` **must** be the first statement on a new connection before any query. `db_locked: Arc<AtomicBool>` starts `true` when the salt file is present, `false` otherwise. The `UnlockDialog` blocks all app rendering until the key is successfully applied.

### New Tauri commands
| Command | Args | Effect |
|---------|------|--------|
| `get_db_lock_status` | — | Returns `{ encrypted: bool, unlocked: bool }` |
| `unlock_database` | `password: String` | Derives key, applies `PRAGMA key`, verifies, clears `db_locked` |
| `set_db_password` | `current: Option<String>, new_password: Option<String>` | Set / change / remove password; uses `PRAGMA rekey` |

### Password operations matrix
| current | new_password | Effect |
|---------|-------------|--------|
| null | "pw" | Encrypt plaintext DB (generate salt, PRAGMA rekey) |
| "old" | "new" | Change password (new salt, PRAGMA rekey) |
| "old" | null | Remove encryption (PRAGMA rekey = "", delete salt file) |

### App.tsx unlock flow
```
mount → getDbLockStatus()
  ├─ { encrypted: false } → setLockState("unlocked"), data loads normally
  └─ { encrypted: true }  → setLockState("locked")
       → <UnlockDialog> rendered full-screen
            → user types password → unlockDatabase(pw)
                 ├─ success → setLockState("unlocked"), reload()
                 └─ failure → "Incorrect password", input cleared, focus restored
```

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

## Spec Doc
`/mnt/user-data/uploads/PromptVault__Specification_v0_1.docx`

---

## Known Build Notes
- `bundled-sqlcipher-vendored-openssl` compiles OpenSSL from source. First build will be ~5–10 min slower than normal. Subsequent incremental builds are unaffected.
- The `backup` feature must be listed explicitly in rusqlite's features for `restore_from` to compile (`rusqlite::backup` module).
- `argon2 = "0.5"` uses the `Argon2::hash_password_into` low-level API. No `password-hash` wrapper crate required.
- `getrandom = "0.2"` is already a transitive dep via `uuid/v4`; adding it explicitly makes the salt generation import unambiguous.

## What's Next (beyond the original 5 tasks)
The spec doc references several V1.1 items that were explicitly out-of-scope for this sprint:
- **sqlite-vec SQL queries** — `sqlite-vec = "0"` crate is already in Cargo.toml; extension init + `vec_distance_cosine` queries deferred to Phase 6
- **Tauri CSP hardening** — `tauri.conf.json` has `"csp": null`; tighten for production release
- **Download endpoint** for exporting prompts as Markdown/JSON
- **Keyboard shortcut customisation** via settings panel
- **Team/multi-device sync** (currently single-user Drive appDataFolder)
