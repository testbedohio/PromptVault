# PromptVault

A cross-platform desktop application for organizing, searching, and version-controlling LLM prompts and code snippets. Built with Tauri v2, React 19, TypeScript, Monaco Editor, and SQLite.

## Features

- **IDE-Style Interface** — 3-pane layout (Sidebar, Editor, Inspector) with JetBrains Darcula theme
- **Monaco Editor** — Full VS Code editing engine with syntax highlighting, bracket matching, and minimap
- **Version History** — Every save creates a version; side-by-side visual diff comparison (red/green)
- **Hybrid Search** — FTS5 keyword search + semantic search via embeddings
- **Brain Selector** — Toggle between Local (Transformers.js), Google Gemini, or Voyage AI embeddings
- **Google Drive Sync** — OAuth 2.0 backup to Drive's hidden appDataFolder
- **Command Palette** — `Ctrl+K` to search across all prompts with Tab to toggle keyword/semantic mode
- **Local-First** — Fully functional offline; SQLite database with WAL mode

## Prerequisites

### 1. Rust (1.80+)
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustc --version
```

### 2. Node.js (20+)
```bash
nvm install 20 && nvm use 20
node --version
```

### 3. Tauri CLI
```bash
npm install -g @tauri-apps/cli@^2
```

### 4. Python 3 + Pillow (for icon generation)
```bash
pip3 install Pillow
```

### 5. System Dependencies

**macOS:** `xcode-select --install`

**Ubuntu/Debian:**
```bash
sudo apt update
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

**Windows:** Install [Visual Studio C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) and [WebView2](https://developer.microsoft.com/en-us/microsoft-edge/webview2/)

## Getting Started

```bash
npm install

# Generate app icons (required on first clone)
python3 scripts/generate_icons.py

npm run tauri dev
```

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+K` | Command Palette |
| `Ctrl+N` | New Prompt |
| `Ctrl+B` | Brain Selector |
| `Ctrl+S` | Force Save |
| `Tab` (in palette) | Toggle keyword/semantic search |
| `Esc` | Close modal |

## Project Structure

```
PromptVault/
├── src/                        # React frontend
│   ├── api/commands.ts         # Tauri invoke API layer
│   ├── components/
│   │   ├── Sidebar.tsx         # Folder tree + tag cloud
│   │   ├── EditorPanel.tsx     # Tabbed Monaco editor
│   │   ├── Inspector.tsx       # Metadata, history, tags, diff, actions
│   │   ├── StatusBar.tsx       # Bottom status bar
│   │   ├── CommandPalette.tsx  # Hybrid keyword/semantic search
│   │   ├── NewPromptDialog.tsx # Create prompt modal
│   │   ├── BrainSelector.tsx   # Embedding provider selector
│   │   ├── DiffViewer.tsx      # Side-by-side visual diff
│   │   └── SyncPanel.tsx       # Google Drive sync settings
│   ├── editor/
│   │   ├── MonacoEditor.tsx    # Monaco wrapper with Darcula theme
│   │   └── darculaTheme.ts     # JetBrains color definitions
│   ├── embeddings/
│   │   ├── service.ts          # Local/Gemini/Voyage embedding providers
│   │   └── useEmbeddings.ts    # React hook for indexing and search
│   ├── hooks/useAppData.ts     # Data hooks, CRUD, auto-save
│   ├── types.ts                # Shared TypeScript types
│   ├── App.tsx                 # Main layout
│   └── main.tsx                # Entry point
├── src-tauri/                  # Rust backend
│   ├── src/
│   │   ├── main.rs             # Tauri entry
│   │   ├── lib.rs              # Commands (CRUD, search, sync)
│   │   ├── db.rs               # SQLite with FTS5
│   │   └── sync.rs             # Google Drive OAuth + upload
│   ├── migrations/001_init.sql
│   ├── Cargo.toml
│   └── tauri.conf.json
├── tailwind.config.js          # Darcula palette
├── vite.config.ts
└── package.json
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Shell | Tauri v2 (Rust) |
| Frontend | React 19 + TypeScript + Vite |
| Styling | Tailwind CSS (Darcula theme) |
| Editor | Monaco Editor |
| Database | SQLite + FTS5 |
| Embeddings | Transformers.js (local) / Gemini / Voyage AI |
| Sync | Google Drive API v3 (OAuth 2.0) |