# PromptVault — Session Handoff
**Date:** 2026-03-12
**Repo:** https://github.com/testbedohio/PromptVault
**Branch:** `main`
**Last commit:** Multi-device sync — wire initSyncSession, remote-found banner, team vault flow

---

## All Tasks — COMPLETE ✅

### Original 5 Sprint Tasks (prior sessions)

| # | Task | Status | Key files |
|---|------|--------|-----------|
| 1 | sqlite-vec persistence (Option B, per-provider) | ✅ Done | `db.rs`, `lib.rs`, `commands.ts`, `useEmbeddings.ts` |
| 2 | OAuth callback server (localhost:8741) | ✅ Done | `sync.rs` |
| 3 | Background sync worker + auto-sync toggle | ✅ Done | `sync.rs`, `lib.rs`, `commands.ts`, `SyncPanel.tsx` |
| 4 | Merge/Override conflict UI (last-write-wins) | ✅ Done | `db.rs`, `sync.rs`, `lib.rs`, `commands.ts`, `ConflictDialog.tsx`, `App.tsx` |
| 5 | SQLCipher encryption + master password UI | ✅ Done | `Cargo.toml`, `db.rs`, `lib.rs`, `commands.ts`, `UnlockDialog.tsx`, `SetPasswordDialog.tsx`, `App.tsx` |

### V1.1 / Post-Sprint Tasks (this session)

| # | Task | Status | Key files |
|---|------|--------|-----------|
| 6 | Rust-side vector search (Phase 6) | ✅ Done | `db.rs`, `lib.rs`, `commands.ts`, `useEmbeddings.ts` |
| 7 | Export prompts as Markdown / JSON | ✅ Done | `db.rs`, `lib.rs`, `commands.ts`, `Inspector.tsx` |
| 8 | Keyboard shortcut customization | ✅ Done | `lib.rs`, `commands.ts`, `ShortcutsDialog.tsx`, `App.tsx` |
| 9 | Single-user multi-device sync | ✅ Done | `sync.rs`, `lib.rs`, `commands.ts`, `SyncPanel.tsx` |
| — | Tauri CSP hardening | ✅ Done (prior session) | `tauri.conf.json` |

---

## Repo File Structure (current, 44 files)

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
                 UnlockDialog.tsx, SetPasswordDialog.tsx, ShortcutsDialog.tsx  ← new
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
                -- PRIMARY KEY (prompt_id, provider)  ← per-provider storage
```

### Key State Design

- `db` in AppState uses `std::sync::Mutex` — sync commands only, never held across `.await`
- `sync` in AppState uses `Arc<tokio::sync::Mutex>` — async, cloneable into spawned tasks
- `db_locked: Arc<AtomicBool>` — true when DB is encrypted but key not yet applied
- `sync_worker_tx: Arc<watch::Sender<SyncWorkerCtl>>` — live config updates to background worker

---

## Task 6 Detail — Rust-Side Vector Search

### Design

All embedding BLOBs for the active provider are loaded from SQLite, scored against the query vector using a Rust-side `cosine_similarity` helper, sorted descending, and top-k returned. No JS round-trip for scoring.

**New types in `db.rs`:**
```rust
pub struct VectorSearchResult {
    pub prompt_id: i64,
    pub similarity: f32,  // cosine similarity in [0, 1]
}
```

**New DB method:** `vector_search(query_vector: &[f32], provider: &str, top_k: usize) -> Result<Vec<VectorSearchResult>>`

**New Tauri command:** `vector_search(vector, provider, top_k)`

**Search strategy in `useEmbeddings.ts`:**
- Primary: calls `vectorSearch` (Rust). On success, sets `sqlSearchAvailable = true`.
- Fallback: JS-side cosine similarity over in-memory index (used in browser mode or on first call before Rust confirms availability).

### Wire-compatibility note

Vectors are stored as raw little-endian f32 BLOBs — the same binary format used by sqlite-vec's `vec0` virtual tables. Upgrading to true SQL `vec_distance_cosine()` queries in a future phase is a schema-only change; no data migration is required.

---

## Task 7 Detail — Export

### DB methods (`db.rs`)

| Method | Output |
|--------|--------|
| `export_prompt_markdown(id)` | YAML front-matter + content as a `.md` string |
| `export_prompts_json(ids)` | JSON array of `Prompt` objects (all or subset) |

### YAML front-matter format

```yaml
---
title: "My Prompt"
tags: ["gpt", "coding"]
created: 2026-01-15T10:00:00Z
updated: 2026-03-10T14:22:00Z
---

(prompt content here)
```

### Tauri commands

- `export_prompt_markdown(id: i64) -> ApiResult<String>`
- `export_prompts_json(ids: Vec<i64>) -> ApiResult<String>` — pass empty vec for all

### Frontend

- `downloadFile(content, filename, mimeType)` — creates a Blob URL and triggers browser download. Works in both Tauri and browser mode.
- Export section added to `Inspector.tsx` (collapsible, defaultOpen: false) with **↓ Markdown** and **↓ JSON** buttons. Filename is slugified from the prompt title.

---

## Task 8 Detail — Keyboard Shortcut Customization

### Storage

```
<platform app data>/PromptVault/shortcuts.json
```

Flat key→accelerator JSON map. Unknown keys are ignored (forward-compatible). Defaults are merged on load so new shortcuts added in future versions always have a value without requiring user action.

### Default accelerators

| Action key | Default | UI action |
|------------|---------|-----------|
| `commandPalette` | `Ctrl+K` | Open Command Palette |
| `newPrompt` | `Ctrl+N` | New Prompt dialog |
| `brainSelector` | `Ctrl+B` | Brain Selector |
| `syncPanel` | `Ctrl+Shift+S` | Sync Panel |
| `shortcuts` | `Ctrl+,` | Shortcuts dialog |

### Tauri commands

- `get_shortcuts() -> ApiResult<HashMap<String, String>>`
- `set_shortcut(action, accelerator) -> ApiResult<bool>` — pass empty string to reset to default
- `reset_shortcuts() -> ApiResult<HashMap<String, String>>`

### `ShortcutsDialog.tsx`

Click-to-record UI: clicking a row puts it in record mode, the next `keydown` event is captured (Escape cancels), the accelerator is displayed but not saved until the user clicks Save. Unsaved changes are highlighted in amber. "Reset to defaults" calls `reset_shortcuts()` and reloads the map.

### `App.tsx` dynamic binding

`matchesAccelerator(e: KeyboardEvent, accel: string): boolean` parses accelerator strings like `"Ctrl+Shift+K"` at runtime. The keyboard handler is re-registered via `useEffect([shortcuts])` so changed bindings take effect immediately without a reload. All header button `title` attributes display the current bound key.

---

## Task 9 Detail — Single-User Multi-Device Sync

### The core bug (now fixed)

When a second device authenticated with the same Google account, it had no `remote_file_id` in its local `sync_config.json`. The old `upload_db` would create a **duplicate file** in `appDataFolder` rather than finding the one the first device already uploaded. Over time this produced multiple `prompt_vault.db` files in appDataFolder with no way to reconcile them.

### Fix: `find_existing_db()` in `sync.rs`

```
GET https://www.googleapis.com/drive/v3/files
  ?spaces=appDataFolder
  &q=name='prompt_vault.db'
  &fields=files(id,modifiedTime)
  &orderBy=modifiedTime+desc
  &pageSize=1
```

Returns the most recently modified `prompt_vault.db` in appDataFolder, if any.

### `upload_db` flow (personal mode)

```
have remote_file_id?
  YES → PATCH the existing file (unchanged)
  NO  → find_existing_db()
          found? → claim_remote_file() → PATCH
          not found? → multipart POST (first device ever)
```

`claim_remote_file(file_id, modified_time)` stores the ID in `sync_config.json` and sets `last_sync` to the remote's `modifiedTime` as a baseline, preventing the conflict detector from immediately flagging the remote as newer.

### New Tauri command: `init_sync_session`

Called by `SyncPanel` once immediately after OAuth completes (and on startup when already connected). Returns:

```typescript
interface SyncSessionInfo {
  found_remote: boolean;       // existing file was found and claimed
  remote_modified: string | null; // RFC 3339 modifiedTime of the remote
  remote_is_newer: boolean;    // remote has changes this device hasn't seen
}
```

When `found_remote && remote_is_newer`, the SyncPanel shows a banner:

> 📱 **Existing vault found from another device**
> Pull it down to sync your prompts across devices. [Last modified: …]
> [Pull & merge (recommended)] [Keep local]

"Pull & merge" calls `resolveConflict("accept_newest")` — the same last-write-wins flow used by `ConflictDialog`. If `data_replaced` is true, the page reloads to flush stale React state.

### `SyncConfig` additions

```rust
pub team_mode: bool,             // true = drive.file scope, shared root file
pub team_file_id: Option<String>, // Drive ID of the shared team vault
```

These fields are `#[serde(default)]` so existing `sync_config.json` files without them deserialize cleanly.

### Team vault (scaffolded, not primary scope)

`start_team_oauth_flow` uses the `drive.file` scope (files visible in Drive root, shareable). After OAuth, `create_team_file` uploads the current DB to Drive root and stores the file ID. Teammates paste the file ID into the "Join Existing Vault" input; `connect_team_vault` stores it and switches to team mode. Both `upload_db` and `download_db` respect `team_mode`, routing to `team_file_id` instead of `remote_file_id`.

---

## Tauri Commands — Complete Reference

| Command | Args | Returns | Notes |
|---------|------|---------|-------|
| `get_categories` | — | `Vec<Category>` | |
| `create_category` | `name, parent_id?` | `Category` | |
| `get_prompts` | — | `Vec<Prompt>` | Latest version content joined |
| `get_prompt_by_id` | `id` | `Prompt` | |
| `create_prompt` | `CreatePromptInput` | `Prompt` | Creates v1, updates FTS |
| `update_prompt` | `UpdatePromptInput` | `Prompt` | Creates new version, rebuilds FTS |
| `delete_prompt` | `id` | `bool` | Cascades to versions, tags, embeddings |
| `get_prompt_versions` | `prompt_id` | `Vec<PromptVersion>` | Newest first |
| `get_all_tags` | — | `Vec<Tag>` | |
| `search_prompts` | `query` | `Vec<Prompt>` | FTS5 Porter stemmer |
| `save_embedding` | `prompt_id, vector, model, provider` | `bool` | Upsert by (prompt_id, provider) |
| `get_all_embeddings` | `provider` | `Vec<StoredEmbedding>` | Empty string = all providers |
| `delete_embeddings_by_provider` | `provider` | `usize` | Count of deleted rows |
| `vector_search` | `vector, provider, top_k` | `Vec<VectorSearchResult>` | Rust-side cosine, sorted desc |
| `export_prompt_markdown` | `id` | `String` | YAML front-matter + content |
| `export_prompts_json` | `ids` | `String` | Empty ids = all prompts |
| `get_shortcuts` | — | `HashMap<String,String>` | Merged with defaults |
| `set_shortcut` | `action, accelerator` | `bool` | Empty accel = reset to default |
| `reset_shortcuts` | — | `HashMap<String,String>` | |
| `start_oauth_flow` | `client_id, client_secret` | `String` (auth URL) | Spawns callback listener |
| `get_sync_config` | — | `SyncConfig` | |
| `update_sync_config` | `config` | `bool` | |
| `get_auth_url` | — | `String` | |
| `exchange_auth_code` | `code` | `bool` | |
| `sync_to_drive` | — | `bool` | |
| `check_sync_status` | — | `String?` | Remote modifiedTime |
| `set_auto_sync` | `enabled, interval_mins` | `bool` | Persists + signals worker |
| `init_sync_session` | — | `SyncSessionInfo` | Multi-device: find/claim remote |
| `start_team_oauth_flow` | `client_id, client_secret` | `String` (auth URL) | drive.file scope |
| `connect_team_vault` | `file_id` | `bool` | Join shared vault by ID |
| `get_conflict_info` | — | `ConflictInfo?` | null = no conflict |
| `resolve_conflict` | `strategy` | `ResolveResult` | "accept_newest" or "keep_local" |
| `get_db_lock_status` | — | `DbLockStatus` | |
| `unlock_database` | `password` | `bool` | Applies PRAGMA key |
| `set_db_password` | `current?, new_password?` | `bool` | Set / change / remove |

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

- `bundled-sqlcipher-vendored-openssl` compiles OpenSSL from source — first build is ~5–10 min slower. Subsequent incremental builds are unaffected.
- The `backup` feature must be listed explicitly in rusqlite's features for `restore_from` to compile.
- `argon2 = "0.5"` uses the `Argon2::hash_password_into` low-level API — no `password-hash` wrapper required.
- `getrandom = "0.2"` is a transitive dep via `uuid/v4`; listed explicitly for the salt generation import.
- `sqlite-vec = "0"` is in `Cargo.toml` — extension init is deferred (raw BLOB storage is wire-compatible with sqlite-vec's format; no data migration needed when the extension is eventually loaded).

## What's Next

The project is **feature-complete** against the v0.1 spec and all post-sprint tasks. Possible future directions:

- **sqlite-vec SQL queries** — load the extension in `db.rs` and replace the Rust-side cosine loop with `vec_distance_cosine()` SQL calls for better performance at scale. The BLOB format is already wire-compatible — no data migration needed.
- **Tauri updater** — auto-update via Tauri's built-in updater plugin for production distribution.
- **Download / share via system dialog** — replace Blob URL export with Tauri's `dialog` plugin (`save()`) so the user gets a native Save dialog.
- **Team sync across different Google accounts** — the team vault scaffolding is in place (`drive.file` scope, `team_file_id`); the remaining gap is that teammates need to use the same OAuth client ID, or the vault owner must explicitly share the Drive file.
- **Prompt templates** — a "Use as template" action that opens a new prompt pre-filled with the current content.
- **Import** — ingest `.md` files with YAML front-matter or JSON arrays back into the database.