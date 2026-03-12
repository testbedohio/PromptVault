# PromptVault

A cross-platform desktop application for organizing, searching, and version-controlling LLM prompts and code snippets. Built with Tauri v2, React 19, and SQLite.

## Prerequisites

Before you begin, make sure you have these installed:

### 1. Rust (1.80+)
```bash
# Install Rust via rustup
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Verify
rustc --version
```

### 2. Node.js (20+)
```bash
# Using nvm (recommended)
nvm install 20
nvm use 20

# Verify
node --version
```

### 3. Tauri CLI
```bash
# Install the Tauri CLI
npm install -g @tauri-apps/cli@^2
```

### 4. System Dependencies

**macOS:**
```bash
xcode-select --install
```

**Ubuntu/Debian:**
```bash
sudo apt update
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

**Windows:**
- Install [Visual Studio C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
- Install [WebView2](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) (usually pre-installed on Windows 10/11)

## Getting Started

```bash
# Install frontend dependencies
npm install

# Run in development mode (launches both Vite + Tauri)
npm run tauri dev

# Build for production
npm run tauri build
```

## Project Structure

```
PromptVault/
├── src/                    # React frontend
│   ├── components/         # UI components
│   │   ├── Sidebar.tsx     # Folder tree + tag cloud
│   │   ├── EditorPanel.tsx # Tabbed editor (Monaco in Phase 2)
│   │   ├── Inspector.tsx   # Metadata + history + sync status
│   │   ├── StatusBar.tsx   # Bottom status bar
│   │   └── CommandPalette.tsx  # Cmd+K search modal
│   ├── styles/globals.css  # Tailwind + Darcula theme
│   ├── App.tsx             # Main layout (3-pane)
│   └── main.tsx            # React entry point
├── src-tauri/              # Rust backend
│   ├── src/
│   │   ├── main.rs         # Tauri entry
│   │   ├── lib.rs          # Commands (CRUD API)
│   │   └── db.rs           # SQLite database layer
│   ├── migrations/
│   │   └── 001_init.sql    # Schema reference
│   ├── Cargo.toml          # Rust dependencies
│   └── tauri.conf.json     # Tauri v2 configuration
├── tailwind.config.js      # Darcula color palette
├── vite.config.ts          # Vite + Tauri settings
└── package.json            # Frontend dependencies
```

## Phase 1 (Current)
- [x] Tauri v2 + React 19 + Vite boilerplate
- [x] Tailwind CSS with JetBrains Darcula color palette
- [x] SQLite database with schema initialization
- [x] 3-pane layout (Sidebar / Editor / Inspector)
- [x] Command Palette (Ctrl+K)
- [x] Resizable panel dividers
- [x] FTS5 full-text search index
- [x] Version tracking on every save

## Upcoming Phases
- **Phase 2:** Monaco Editor, folder/tag navigation from DB, live save with versioning
- **Phase 3:** sqlite-vec embeddings, semantic search, Brain selector (Local/Cloud)
- **Phase 4:** Google Drive OAuth sync, visual diff UI, background sync worker