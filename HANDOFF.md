# PromptVault — Session Handoff Document

**Generated:** 2026-03-12
**Repo:** https://github.com/testbedohio/PromptVault
**Status:** All 4 phases complete, all files pushed to `main`

---

## 1. What Is This Project

PromptVault is a cross-platform desktop app for power users to organize, search, and version-control LLM prompts and code snippets. The spec calls for a JetBrains-style "Darcula" IDE aesthetic, local-first SQLite storage, hybrid keyword/semantic search, and Google Drive backup.

The original PRD is attached in the conversation as `PromptVault__IDE-Style_Prompt_Manager.docx`.

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

---

## 4. File Inventory (36 files)

```
Root (10 files)
├── .gitignore                     25 lines
├── README.md                     116 lines
├── index.html                     18 lines
├── package.json                   32 lines
├── postcss.config.js               6 lines
├── tailwind.config.js             55 lines
├── tsconfig.json                  23 lines
└── vite.config.ts                 25 lines

src/ (17 files, ~2,885 lines)
├── main.tsx                       10 lines   Entry point
├── App.tsx                       334 lines   Main layout, state, modals
├── types.ts                       62 lines   Shared TS types
├── vite-env.d.ts                   1 line
├── styles/globals.css             82 lines   Tailwind + Darcula base
├── api/commands.ts               111 lines   Tauri invoke wrappers + sync API
├── hooks/useAppData.ts           422 lines   CRUD hooks, auto-save, browser fallback
├── editor/darculaTheme.ts        140 lines   Monaco theme definition
├── editor/MonacoEditor.tsx       187 lines   Editor wrapper
├── embeddings/service.ts         227 lines   3-provider embed + cosine similarity
├── embeddings/useEmbeddings.ts   196 lines   Index management hook
├── components/Sidebar.tsx        258 lines   Folder tree + tag cloud
├── components/EditorPanel.tsx    140 lines   Tabbed Monaco editor
├── components/Inspector.tsx      284 lines   Metadata, versions, diff, tags, delete
├── components/StatusBar.tsx       44 lines
├── components/CommandPalette.tsx  234 lines   Hybrid keyword/semantic search
├── components/NewPromptDialog.tsx 161 lines
├── components/BrainSelector.tsx  200 lines   Embedding provider picker
├── components/DiffViewer.tsx     212 lines   Side-by-side visual diff
└── components/SyncPanel.tsx      173 lines   Google Drive settings

src-tauri/ (7 files, ~1,079 lines)
├── Cargo.toml                     23 lines
├── build.rs                        3 lines
├── tauri.conf.json                40 lines
├── migrations/001_init.sql        56 lines   Reference schema
├── src/main.rs                     6 lines   Entry
├── src/lib.rs                    233 lines   All Tauri commands
├── src/db.rs                     463 lines   SQLite + FTS5 + versioning
└── src/sync.rs                   318 lines   Google Drive OAuth + upload
```

---

## 5. Database Schema

```sql
categories    (id, name, parent_id, created_at)
prompts       (id, title, category_id, created_at, updated_at)
prompt_versions (id, prompt_id, content_text, version_number, embedding_vector BLOB, created_at)
tags          (id, name UNIQUE)
prompt_tags   (prompt_id, tag_id)  -- composite PK
prompts_fts   VIRTUAL TABLE USING fts5(title, content)  -- tokenize='porter unicode61'
```

Every `update_prompt` call with new `content` creates a new `prompt_versions` row and increments `version_number`. The FTS5 index is rebuilt on each content update (delete + re-insert by rowid).

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
1. **sqlite-vec extension** — The PRD calls for `sqlite-vec` for persisting embedding vectors in SQLite. Currently embeddings are in-memory only (cleared on reload). Requires adding the `sqlite-vec` Rust crate and storing/loading vectors from the `embedding_vector BLOB` column.
2. **Background sync worker** — `sync.rs` has upload/check methods but no periodic background task. Needs a Tauri async background thread that syncs on a timer (e.g., every 5 minutes when connected).
3. **OAuth callback server** — `exchange_code` expects a `code` param but there's no local HTTP listener to receive the Google redirect. Needs a temporary `localhost:8741/callback` server in Rust (or use Tauri's deep-link plugin).
4. **Merge/Override conflict UI** — The PRD specifies prompting the user to "Merge" or "Override" when the remote is newer. `check_sync_status` returns the remote modified time but no UI acts on it yet.
5. **SQLCipher encryption** — PRD mentions optional database encryption with a master password. Not implemented.
6. **Tauri icons** — The `src-tauri/icons/` directory is empty. Need to generate platform icons (`.icns`, `.ico`, PNGs).

### Potential issues to watch
- **Transformers.js Wasm loading** — First load of local embeddings downloads ~30MB model. May need a loading indicator or pre-download step.
- **`reqwest` in Tauri** — The sync module uses `reqwest` with `async`. Tauri v2 commands marked `async` work, but the `Mutex<DriveSync>` pattern may cause deadlocks under heavy concurrent use. Consider switching to `tokio::sync::Mutex` if issues arise.
- **Monaco + Tauri CSP** — Monaco Editor loads web workers. The `tauri.conf.json` has `"csp": null` (permissive). For production, this should be tightened.
- **FTS5 rebuild on update** — Current approach deletes and re-inserts the FTS row on every content change. At scale, consider using FTS5 content-sync tables instead.

---

## 9. How to Run

```bash
# Clone
git clone https://github.com/testbedohio/PromptVault.git
cd PromptVault

# Install frontend deps
npm install

# Dev mode (Tauri + Vite hot reload)
npm run tauri dev

# Browser-only preview (no Rust, uses sample data)
npm run dev
# → http://localhost:1420

# Production build
npm run tauri build
```

Prerequisites: Rust 1.80+, Node 20+, Tauri CLI v2, platform-specific C/WebKit libs (see README).

---

## 10. User Preferences

- User welcomes clarifying questions
- Prefers building incrementally and committing each phase to `main`
- Chose "both with a toggle" for embedding providers
- Target is cross-platform (macOS, Windows, Linux)
- Started from scratch (deleted any prior project files)