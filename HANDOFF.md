# PromptVault — Session Handoff Document

**Generated:** 2026-03-12  
**Repo:** https://github.com/testbedohio/PromptVault  
**Status:** Phases 1–4 complete + Phase 5.1 (persistent embeddings) + Phase 5.2 (OAuth callback server)

---

## 1. What Is This Project

PromptVault is a cross-platform desktop app for power users to organize, search, and version-control LLM prompts and code snippets. The spec calls for a JetBrains-style "Darcula" IDE aesthetic, local-first SQLite storage, hybrid keyword/semantic search, and Google Drive backup.

The original PRD is `PromptVault__Specification_v0_1.docx`.

---

## 2. Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Desktop shell | Tauri v2 (Rust) | `^2` |
| Frontend | React 19 + TypeScript | `^19.0.0` / `^5.7.0` |
| Bundler | Vite 6 | `^6.0.0` |
| Styling | Tailwind CSS 3 | `^3.4.17` |
| Editor | Monaco Editor | `^0.52.0` via `@monaco-editor/react ^4.6.0` |
| Database | SQLite (rusqlite 0.31, bundled) + FTS5 | — |
| Vector storage | `sqlite-vec = "0"` (BLOB format, extension init deferred) | — |
| Embeddings | `@xenova/transformers ^2.17.0` (local), Gemini API, Voyage AI | — |
| Sync | Google Drive API v3 via `reqwest 0.12` | — |

---

## 3. What Has Been Built (Phase by Phase)

### Phase 1 — Foundation
- Tauri v2 + React 19 + Vite boilerplate
- Tailwind configured with full Darcula color palette (`tailwind.config.js`)
- JetBrains Mono font loaded via Google Fonts
- SQLite schema auto-created on first launch: `prompts`, `prompt_versions`, `categories`, `tags`, `prompt_tags`, `prompts_fts` (FTS5)
- WAL mode, foreign keys enabled
- 3-pane resizable layout (Sidebar, Editor, Inspector)
- Status bar, Command Palette (Ctrl+K)

### Phase 2a — Rust ↔ React Bridge
- TypeScript types (`src/types.ts`) mirroring Rust structs
- API layer (`src/api/commands.ts`) wrapping all `invoke()` calls with error handling
- `useAppData` hook: loads categories/prompts/tags, provides CRUD functions, detects Tauri vs browser mode
- `useVersions`, `useDebounce`, `useAutoSave` hooks
- Browser fallback: sample data when Tauri runtime is absent (enables `npm run dev` previews)
- New Prompt dialog, folder creation, tag add/remove, delete with confirmation

### Phase 2b — Monaco Editor
- `src/editor/darculaTheme.ts`: full JetBrains Darcula color mapping (60+ token rules, 30+ editor colors)
- `src/editor/MonacoEditor.tsx`: wrapper with language detection from filename, Ctrl+S save action, markdown word-wrap, font ligatures
- EditorPanel rewritten to use Monaco instead of textarea
- Toolbar shows line/word count and auto-save status

### Phase 3 — Intelligence & Search
- `src/embeddings/service.ts`: unified `embed()` function supporting 3 providers:
  - **Local:** `@xenova/transformers` with `all-MiniLM-L6-v2` (384d, Wasm, fully offline)
  - **Gemini:** `text-embedding-004` (768d, requires API key)
  - **Voyage AI (Claude ecosystem):** `voyage-3-lite` (512d, requires API key)
- `src/embeddings/useEmbeddings.ts`: in-memory vector index, indexing progress tracking, cosine similarity ranking
- Brain Selector UI (`Ctrl+B`): provider cards, API key inputs, index rebuild button, progress bar
- Command Palette upgraded: Tab toggles between 🔍 Keyword (FTS5) and 🧠 Semantic mode; semantic results show similarity percentage

### Phase 4 — Sync & Polish
- `src-tauri/src/sync.rs`: Rust module for Google Drive OAuth 2.0 flow, token exchange, DB upload to `appDataFolder`, remote modified-time check
- Sync commands registered in `lib.rs`: `get_sync_config`, `update_sync_config`, `get_auth_url`, `exchange_auth_code`, `sync_to_drive`, `check_sync_status`
- `src/components/SyncPanel.tsx`: credential entry, sign-in button, sync-now, disconnect
- `src/components/DiffViewer.tsx`: full-screen side-by-side diff using LCS algorithm, red/green highlighting, line numbers, +/- stats
- Inspector's History section: click any past version to open diff against current

### Phase 5.1 — Persistent Embeddings (sqlite-vec)
- **New `embeddings` table** in SQLite: one row per prompt, upserted on every (re)embed.  
  Schema: `(prompt_id PK, vector BLOB, model TEXT, provider TEXT, dimensions INTEGER, updated_at TEXT)`
- **BLOB format** is raw little-endian f32 bytes — wire-compatible with sqlite-vec's native `vec` type.  
  When SQL-level similarity queries are needed (`vec_distance_cosine`), adding a `vec0` virtual table is schema-only with no data migration.
- **`db.rs`** additions: `StoredEmbedding` struct; `floats_to_blob` / `blob_to_floats` helpers; `save_embedding(prompt_id, vector, model, provider)` (INSERT OR REPLACE); `get_all_embeddings(model_filter)` (optionally filtered by model for efficient per-provider restore)
- **`lib.rs`** additions: `save_embedding` and `get_all_embeddings` Tauri commands, both registered
- **`commands.ts`** additions: `saveEmbedding()` and `getAllEmbeddings()` wrappers with JSDoc
- **`useEmbeddings.ts`** additions:
  - `restoreIndex()`: loads stored embeddings from SQLite on startup, filters to current provider's model, populates `indexRef` — index survives app restarts without re-embedding
  - `restoreAttempted` flag: prevents duplicate restore calls; resets on provider switch so the new provider's stored rows are loaded immediately
  - `indexPrompts` and `indexSinglePrompt` now call `saveEmbedding` (fire-and-forget) after every successful embed
  - `removeFromIndex` leaves DB cleanup to `ON DELETE CASCADE` — no manual delete call needed
- **`App.tsx`**: `useEffect` fires once after prompts load to call `restoreIndex()`; also re-fires on provider change via `restoreAttempted` dependency

### Phase 5.2 — OAuth Callback Server
- **`await_oauth_callback()`** in `sync.rs`: standalone async function (not a method, so it can be called from spawned tasks)
  - Binds `TcpListener` on `127.0.0.1:8741`; fails with a clear message if port is busy
  - Waits up to 3 minutes (`tokio::time::timeout`) for Google's redirect
  - Parses `?code=` / `?error=` from the raw HTTP request line
  - Sends a polished Darcula-themed HTML response to the browser tab before returning
- **`refresh_access_token()`** and **`ensure_fresh_token()`** added to `DriveSync`: tokens expire in 1 hour; `upload_db` now auto-refreshes before every sync
- **`AppState.sync`** changed from `TokioMutex<DriveSync>` to `Arc<TokioMutex<DriveSync>>` so the Arc can be cloned into `tokio::spawn` tasks
- **`start_oauth_flow(client_id, client_secret)`** Tauri command:
  1. Saves credentials to disk
  2. Builds and returns the Google authorization URL to the frontend
  3. Spawns a background task that calls `await_oauth_callback()` then `exchange_code()` — the frontend never handles the code
  4. On error, writes `SyncStatus::Error(msg)` to the persisted config so the frontend poll sees it
- **`SyncPanel.tsx`** fully reworked as a self-contained smart component:
  - Owns credentials form → `startOAuthFlow` → `openUrl` (shell plugin + `window.open` fallback) → polling (1.5s interval, 200s timeout) → auto-transition
  - Three visual phases: setup form, spinning "waiting for browser" state, connected controls
  - Disconnect clears tokens without touching credentials
- **`App.tsx`**: `☁` button in title bar; `Escape` closes SyncPanel; passes `onOpenSync` callback to Inspector
- **`Inspector.tsx`**: sync placeholder replaced with "Google Drive / Configure →" that opens SyncPanel

---

## 4. File Inventory (37 files)

```
Root (10 files)
├── .gitignore
├── HANDOFF.md
├── README.md
├── index.html
├── package.json
├── postcss.config.js
├── tailwind.config.js
├── tsconfig.json
└── vite.config.ts

src/ (18 files)
├── main.tsx                        Entry point
├── App.tsx                         Main layout, state, modals (SyncPanel wired)
├── types.ts                        Shared TS types
├── vite-env.d.ts
├── styles/globals.css              Tailwind + Darcula base
├── api/commands.ts                 Tauri invoke wrappers (+ saveEmbedding, getAllEmbeddings, startOAuthFlow)
├── hooks/useAppData.ts             CRUD hooks, auto-save, browser fallback
├── editor/darculaTheme.ts          Monaco theme definition
├── editor/MonacoEditor.tsx         Editor wrapper
├── embeddings/service.ts           3-provider embed + cosine similarity
├── embeddings/useEmbeddings.ts     Index management + restoreIndex + SQLite persistence
├── components/Sidebar.tsx          Folder tree + tag cloud
├── components/EditorPanel.tsx      Tabbed Monaco editor
├── components/Inspector.tsx        Metadata, versions, diff, tags, delete, sync link
├── components/StatusBar.tsx
├── components/CommandPalette.tsx   Hybrid keyword/semantic search
├── components/NewPromptDialog.tsx
├── components/BrainSelector.tsx    Embedding provider picker
├── components/DiffViewer.tsx       Side-by-side visual diff
└── components/SyncPanel.tsx        Google Drive OAuth flow (self-contained)

src-tauri/ (7 files)
├── Cargo.toml                      (+ sqlite-vec = "0")
├── build.rs
├── tauri.conf.json
├── migrations/001_init.sql         Reference schema
├── src/main.rs                     Entry
├── src/lib.rs                      All Tauri commands (+ save_embedding, get_all_embeddings, start_oauth_flow)
├── src/db.rs                       SQLite + FTS5 + versioning + embeddings table
└── src/sync.rs                     Google Drive OAuth + callback server + token refresh

scripts/ (1 file)
└── generate_icons.py               Icon generation (requires Pillow)
```

---

## 5. Database Schema

```sql
categories      (id, name, parent_id, created_at)
prompts         (id, title, category_id, created_at, updated_at)
prompt_versions (id, prompt_id, content_text, version_number, embedding_vector BLOB, created_at)
tags            (id, name UNIQUE)
prompt_tags     (prompt_id, tag_id)  -- composite PK
prompts_fts     VIRTUAL TABLE USING fts5(title, content)  -- tokenize='porter unicode61'

-- Added Phase 5.1
embeddings      (prompt_id PK → prompts.id CASCADE,
                 vector BLOB NOT NULL,          -- raw f32 LE bytes, sqlite-vec compatible
                 model TEXT NOT NULL,           -- e.g. "all-MiniLM-L6-v2"
                 provider TEXT NOT NULL,        -- "local" | "gemini" | "claude"
                 dimensions INTEGER NOT NULL,
                 updated_at TEXT NOT NULL)
-- Index: idx_embeddings_model ON embeddings(model)
```

Every `update_prompt` call with new `content` creates a new `prompt_versions` row. The FTS5 index is rebuilt on each content update. The `embeddings` table is upserted (INSERT OR REPLACE) on every embed call.

---

## 6. Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Ctrl+K | Command Palette |
| Ctrl+N | New Prompt |
| Ctrl+B | Brain Selector |
| Ctrl+S | Force save (also auto-saves with 1.5s debounce) |
| Tab (in Command Palette) | Toggle keyword ↔ semantic search |
| Esc | Close any modal |

---

## 7. GitHub Access

- **Owner:** `testbedohio`
- **Repo:** `PromptVault`
- **Webhook:** `https://testbed999.app.n8n.cloud/webhook/gh-api-v3`
- **Auth token:** `22d971dc8e8bb79f09153545e8201f07875c7f6150d0291bc0192a38eb6d4d8f`
- **Skill location:** `/mnt/skills/user/github-passthrough/SKILL.md`
- **Method:** Always use `bash_tool` with `curl` + `jq`. Never use `n8n:execute_workflow`.
- **File updates require SHA:** fetch with `get_file` first, then pass `sha` in `create_or_update_file`.

---

## 8. Known Limitations & Open Work

### Not yet implemented

1. **Merge/Override conflict UI** — `check_sync_status` returns the remote modified time and `check_remote_status` is wired, but no UI prompts the user to "Merge" or "Override" when the remote is newer than `last_sync`. The PRD requires this on startup. Implementation: call `check_sync_status` in `App.tsx` after `useAppData` loads, compare timestamps, and show a modal if remote is newer.

2. **Background sync worker** — `sync.rs` has upload/check methods but no periodic timer. Needs a `tokio::spawn` loop in `lib.rs` that wakes every 5 minutes, checks token freshness (`ensure_fresh_token` is already implemented), and calls `upload_db`. Gate it on `config.enabled`.

3. **SQLCipher encryption** — PRD mentions optional database encryption with a master password. Not implemented. Would require swapping `rusqlite` for `rusqlite` with the `sqlcipher` feature flag and threading a password through `Database::new()`.

4. **Tauri icons** — Icons are generated via `scripts/generate_icons.py` (requires Python 3 + Pillow). Must be run locally after cloning — binary PNGs are `.gitignore`d.

5. **SQL-level vector similarity** (`sqlite-vec` extension init) — The `sqlite-vec` crate is in `Cargo.toml` and the BLOB format is compatible, but the extension is not yet loaded at connection time. When SQL queries like `vec_distance_cosine` are needed, add `conn.load_extension(sqlite_vec::path(), None)?` in `Database::new()` and create a `vec0` virtual table. No data migration required.

### Potential issues to watch

- **`tauri.conf.json` CSP** — Currently `"csp": null` (permissive) to allow Monaco web workers. Should be tightened for production.
- **Port 8741 conflicts** — The OAuth callback listener will return a clear error if the port is in use. If this is a concern in CI or shared environments, the port could be made configurable.
- **Transformers.js Wasm loading** — First load of local embeddings downloads ~30MB model. A loading indicator exists in BrainSelector but there is no pre-download step on first launch.
- **FTS5 rebuild on update** — Current approach deletes and re-inserts the FTS row on every content change. At scale, consider using FTS5 content-sync tables instead.
- **`reqwest` in Tauri** — The sync module uses `reqwest` with `async`. The `sync` field uses `Arc<tokio::sync::Mutex>` (not `std::sync::Mutex`) so the guard can be held across `.await` points and cloned into spawned tasks.

---

## 9. How to Run

```bash
# Clone
git clone https://github.com/testbedohio/PromptVault.git
cd PromptVault

# Install frontend deps
npm install

# Install Pillow and generate app icons (required on first clone)
pip3 install Pillow
python3 scripts/generate_icons.py

# Dev mode (Tauri + Vite hot reload)
npm run tauri dev

# Browser-only preview (no Rust, uses sample data)
npm run dev
# → http://localhost:1420

# Production build
npm run tauri build
```

Prerequisites: Rust 1.80+, Node 20+, Tauri CLI v2, Python 3 + Pillow, platform-specific C/WebKit libs (see README).

---

## 10. Google Drive Setup (for end users)

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a project → enable the **Google Drive API**
3. Create an **OAuth 2.0 Client ID** (Desktop application type)
4. Add `http://localhost:8741/callback` as an authorized redirect URI
5. Copy the Client ID and Client Secret
6. In PromptVault: click the **☁** button in the title bar (or "Configure →" in the Inspector's Sync section), paste the credentials, and click **Sign in with Google**
7. Complete consent in the browser tab that opens — PromptVault will detect the callback automatically

---

## 11. User Preferences

- User welcomes clarifying questions
- Prefers building incrementally and committing each phase to `main`
- Chose "both with a toggle" for embedding providers
- Target is cross-platform (macOS, Windows, Linux)
- Started from scratch (deleted any prior project files)