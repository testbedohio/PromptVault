import { useState, useCallback, useRef, useEffect } from "react";
import { useAppData } from "./hooks/useAppData";
import { useEmbeddings } from "./embeddings/useEmbeddings";
import Sidebar from "./components/Sidebar";
import EditorPanel from "./components/EditorPanel";
import Inspector from "./components/Inspector";
import StatusBar from "./components/StatusBar";
import CommandPalette from "./components/CommandPalette";
import NewPromptDialog from "./components/NewPromptDialog";
import BrainSelector from "./components/BrainSelector";
import SyncPanel from "./components/SyncPanel";
import ConflictDialog from "./components/ConflictDialog";
import UnlockDialog from "./components/UnlockDialog";
import SetPasswordDialog from "./components/SetPasswordDialog";
import ShortcutsDialog from "./components/ShortcutsDialog";
import {
  getConflictInfo,
  getSyncConfig,
  isSyncConnected,
  getDbLockStatus,
  getShortcuts,
  type ConflictInfo,
  type ShortcutMap,
} from "./api/commands";

/** Default shortcuts — kept in sync with Rust's `default_shortcuts()`. */
const DEFAULT_SHORTCUTS: ShortcutMap = {
  commandPalette: "Ctrl+K",
  newPrompt:      "Ctrl+N",
  brainSelector:  "Ctrl+B",
  syncPanel:      "Ctrl+Shift+S",
  shortcuts:      "Ctrl+,",
};

/**
 * Parse an accelerator string like "Ctrl+Shift+K" into a KeyboardEvent matcher.
 * Returns true if the given event matches the accelerator.
 */
function matchesAccelerator(e: KeyboardEvent, accel: string): boolean {
  const parts = accel.split("+").map((p) => p.trim().toLowerCase());
  const key = parts[parts.length - 1];
  const needsCtrl  = parts.includes("ctrl");
  const needsAlt   = parts.includes("alt");
  const needsShift = parts.includes("shift");

  const eventKey = e.key === " " ? "space" : e.key.toLowerCase();
  return (
    eventKey === key &&
    (e.ctrlKey || e.metaKey) === needsCtrl &&
    e.altKey   === needsAlt &&
    e.shiftKey === needsShift
  );
}

export default function App() {
  // Panel widths
  const [sidebarWidth, setSidebarWidth] = useState(260);
  const [inspectorWidth, setInspectorWidth] = useState(280);
  const [inspectorOpen, setInspectorOpen] = useState(true);

  // Modal state
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [newPromptDialogOpen, setNewPromptDialogOpen] = useState(false);
  const [brainSelectorOpen, setBrainSelectorOpen] = useState(false);
  const [syncPanelOpen, setSyncPanelOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [conflict, setConflict] = useState<ConflictInfo | null>(null);

  // Encryption state
  const [lockState, setLockState]             = useState<"checking" | "locked" | "unlocked">("checking");
  const [isEncrypted, setIsEncrypted]         = useState(false);
  const [setPasswordOpen, setSetPasswordOpen] = useState(false);

  // Keyboard shortcuts (loaded from disk; falls back to defaults in browser mode)
  const [shortcuts, setShortcuts] = useState<ShortcutMap>(DEFAULT_SHORTCUTS);

  // Data from Tauri backend (or browser fallback)
  const {
    prompts,
    categories,
    flatCategories,
    tags,
    loading,
    dbConnected,
    tauri,
    reload,
    addPrompt,
    savePrompt,
    removePrompt,
    addCategory,
    searchPrompts,
  } = useAppData();

  // Embedding engine
  const embeddings = useEmbeddings();

  // Tab state
  const [openTabs, setOpenTabs] = useState<number[]>([]);
  const [activeTab, setActiveTab] = useState<number>(0);
  const [selectedCategory, setSelectedCategory] = useState<number | null>(null);
  const [activeTagFilter, setActiveTagFilter] = useState<string | null>(null);

  // Load encryption status on mount
  useEffect(() => {
    getDbLockStatus()
      .then((status) => {
        setIsEncrypted(status.encrypted);
        setLockState(status.unlocked ? "unlocked" : "locked");
        if (status.unlocked && !status.encrypted) {
          reload();
        }
      })
      .catch(() => {
        setLockState("unlocked");
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Load keyboard shortcuts on mount (non-blocking — falls back to defaults)
  useEffect(() => {
    getShortcuts()
      .then(setShortcuts)
      .catch(() => { /* browser mode — use defaults */ });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (prompts.length > 0 && openTabs.length === 0) {
      setOpenTabs([prompts[0].id]);
      setActiveTab(prompts[0].id);
    }
  }, [prompts]);

  // Restore the embedding index from SQLite once prompts have loaded.
  useEffect(() => {
    if (!loading && prompts.length > 0 && !embeddings.restoreAttempted) {
      embeddings.restoreIndex();
    }
  }, [loading, prompts.length, embeddings.restoreAttempted, embeddings.restoreIndex]);

  // Check for a Drive conflict once on startup, after data has loaded.
  useEffect(() => {
    if (loading) return;
    getSyncConfig()
      .then((cfg) => {
        if (!isSyncConnected(cfg)) return;
        return getConflictInfo();
      })
      .then((info) => {
        if (info) setConflict(info);
      })
      .catch(() => {});
  }, [loading]); // eslint-disable-line react-hooks/exhaustive-deps

  const filteredPrompts = prompts.filter((p) => {
    if (selectedCategory !== null && p.category_id !== selectedCategory) return false;
    if (activeTagFilter && !p.tags.includes(activeTagFilter)) return false;
    return true;
  });

  const activeSnippet = prompts.find((s) => s.id === activeTab) || null;

  const openSnippet = useCallback(
    (id: number) => {
      if (!openTabs.includes(id)) {
        setOpenTabs((prev) => [...prev, id]);
      }
      setActiveTab(id);
    },
    [openTabs]
  );

  const closeTab = useCallback(
    (id: number) => {
      setOpenTabs((prev) => {
        const next = prev.filter((t) => t !== id);
        if (activeTab === id) {
          setActiveTab(next[next.length - 1] || 0);
        }
        return next;
      });
    },
    [activeTab]
  );

  const handleNewPrompt = useCallback(
    async (title: string, categoryId: number | null, tagList: string[]) => {
      const prompt = await addPrompt({
        title,
        content: `# ${title}\n\n`,
        category_id: categoryId,
        tags: tagList,
      });
      if (prompt) {
        openSnippet(prompt.id);
        embeddings.indexSinglePrompt(prompt);
      }
      setNewPromptDialogOpen(false);
    },
    [addPrompt, openSnippet, embeddings]
  );

  const handleDeletePrompt = useCallback(
    async (id: number) => {
      const ok = await removePrompt(id);
      if (ok) {
        closeTab(id);
        embeddings.removeFromIndex(id);
      }
    },
    [removePrompt, closeTab, embeddings]
  );

  // Resizable dividers
  const dragging = useRef<"sidebar" | "inspector" | null>(null);

  const onMouseDown = useCallback(
    (panel: "sidebar" | "inspector") => () => {
      dragging.current = panel;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    []
  );

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      if (dragging.current === "sidebar") {
        setSidebarWidth(Math.max(180, Math.min(450, e.clientX)));
      } else {
        setInspectorWidth(
          Math.max(200, Math.min(450, window.innerWidth - e.clientX))
        );
      }
    };
    const onMouseUp = () => {
      dragging.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  // Dynamic keyboard shortcuts — re-registered whenever the shortcuts map changes
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Shortcut customisation dialog takes capture priority
      if (shortcutsOpen) return;

      if (matchesAccelerator(e, shortcuts.commandPalette)) {
        e.preventDefault();
        setCommandPaletteOpen((prev) => !prev);
        return;
      }
      if (matchesAccelerator(e, shortcuts.newPrompt)) {
        e.preventDefault();
        setNewPromptDialogOpen(true);
        return;
      }
      if (matchesAccelerator(e, shortcuts.brainSelector)) {
        e.preventDefault();
        setBrainSelectorOpen((prev) => !prev);
        return;
      }
      if (matchesAccelerator(e, shortcuts.syncPanel)) {
        e.preventDefault();
        setSyncPanelOpen((prev) => !prev);
        return;
      }
      if (matchesAccelerator(e, shortcuts.shortcuts)) {
        e.preventDefault();
        setShortcutsOpen((prev) => !prev);
        return;
      }
      if (e.key === "Escape") {
        setCommandPaletteOpen(false);
        setNewPromptDialogOpen(false);
        setBrainSelectorOpen(false);
        setSyncPanelOpen(false);
        setShortcutsOpen(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [shortcuts, shortcutsOpen]);

  // ── Render: unlock gate ──────────────────────────────────────────
  if (lockState === "checking") {
    return (
      <div className="flex items-center justify-center h-screen w-screen bg-darcula-bg">
        <div className="text-4xl animate-pulse text-darcula-accent-bright">⬡</div>
      </div>
    );
  }

  if (lockState === "locked") {
    return (
      <UnlockDialog
        onUnlocked={() => {
          setLockState("unlocked");
          reload();
        }}
      />
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen w-screen bg-darcula-bg">
        <div className="text-center">
          <div className="text-4xl mb-3 animate-pulse">⬡</div>
          <div className="font-mono text-sm text-darcula-text-muted">
            Initializing PromptVault...
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-darcula-bg">
      {/* Title Bar */}
      <header
        className="flex items-center justify-between h-9 px-4 bg-darcula-bg-light border-b border-darcula-border flex-shrink-0 select-none"
        data-tauri-drag-region
      >
        <div className="flex items-center gap-2">
          <span className="text-darcula-accent-bright font-mono font-bold text-sm">
            ⬡ PromptVault
          </span>
          <span className="text-darcula-text-muted text-2xs font-mono">
            v1.0.0
          </span>
          {!dbConnected && (
            <span className="text-2xs font-mono px-1.5 py-0.5 rounded-sm bg-darcula-warning/20 text-darcula-warning">
              browser mode
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-darcula-text-muted text-xs font-mono">
          <button
            className="hover:text-darcula-text transition-colors"
            onClick={() => setNewPromptDialogOpen(true)}
            title={`New Prompt (${shortcuts.newPrompt})`}
          >
            + New
          </button>
          <button
            className="hover:text-darcula-text transition-colors"
            onClick={() => setBrainSelectorOpen(true)}
            title={`Brain Selector (${shortcuts.brainSelector})`}
          >
            🧠
          </button>
          <button
            className="hover:text-darcula-text transition-colors"
            onClick={() => setSyncPanelOpen(true)}
            title={`Google Drive Sync (${shortcuts.syncPanel})`}
          >
            ☁
          </button>
          <button
            className="hover:text-darcula-text transition-colors"
            onClick={() => setSetPasswordOpen(true)}
            title={isEncrypted ? "Database encrypted — manage password" : "Enable database encryption"}
          >
            {isEncrypted ? "🔒" : "🔓"}
          </button>
          <button
            className="hover:text-darcula-text transition-colors"
            onClick={() => setShortcutsOpen(true)}
            title={`Keyboard Shortcuts (${shortcuts.shortcuts})`}
          >
            ⌨
          </button>
          <button
            className="hover:text-darcula-text transition-colors"
            onClick={() => setCommandPaletteOpen(true)}
            title={`Command Palette (${shortcuts.commandPalette})`}
          >
            ⌘K
          </button>
          <button
            className="hover:text-darcula-text transition-colors"
            onClick={() => setInspectorOpen((p) => !p)}
            title="Toggle Inspector"
          >
            ☰
          </button>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex flex-1 overflow-hidden">
        <div style={{ width: sidebarWidth }} className="flex-shrink-0 overflow-hidden">
          <Sidebar
            categories={categories}
            tags={tags}
            prompts={filteredPrompts}
            allPrompts={prompts}
            selectedCategory={selectedCategory}
            activeTagFilter={activeTagFilter}
            onSelectCategory={setSelectedCategory}
            onSelectTag={setActiveTagFilter}
            onOpenSnippet={openSnippet}
            onNewPrompt={() => setNewPromptDialogOpen(true)}
            onNewCategory={addCategory}
          />
        </div>

        <div className="panel-divider" onMouseDown={onMouseDown("sidebar")} />

        <div className="flex-1 overflow-hidden">
          <EditorPanel
            prompts={prompts}
            openTabs={openTabs}
            activeTab={activeTab}
            onSelectTab={setActiveTab}
            onCloseTab={closeTab}
            onSave={savePrompt}
          />
        </div>

        {inspectorOpen && (
          <>
            <div className="panel-divider" onMouseDown={onMouseDown("inspector")} />
            <div style={{ width: inspectorWidth }} className="flex-shrink-0 overflow-hidden">
              <Inspector
                snippet={activeSnippet}
                onDelete={handleDeletePrompt}
                onSave={savePrompt}
                onOpenSync={() => setSyncPanelOpen(true)}
              />
            </div>
          </>
        )}
      </div>

      {/* Status Bar */}
      <StatusBar
        snippetCount={prompts.length}
        activeSnippet={activeSnippet}
        dbConnected={dbConnected}
        tauri={tauri}
      />

      {/* Modals */}
      {commandPaletteOpen && (
        <CommandPalette
          prompts={prompts}
          searchPrompts={searchPrompts}
          semanticSearch={embeddings.semanticSearch}
          semanticIndexSize={embeddings.indexSize}
          onSelect={(id) => {
            openSnippet(id);
            setCommandPaletteOpen(false);
          }}
          onClose={() => setCommandPaletteOpen(false)}
        />
      )}

      {newPromptDialogOpen && (
        <NewPromptDialog
          categories={flatCategories}
          onSubmit={handleNewPrompt}
          onClose={() => setNewPromptDialogOpen(false)}
        />
      )}

      {brainSelectorOpen && (
        <BrainSelector
          provider={embeddings.provider}
          geminiApiKey={embeddings.geminiApiKey}
          claudeApiKey={embeddings.claudeApiKey}
          isIndexing={embeddings.isIndexing}
          indexProgress={embeddings.indexProgress}
          indexSize={embeddings.indexSize}
          lastError={embeddings.lastError}
          totalPrompts={prompts.length}
          onSetProvider={embeddings.setProvider}
          onSetApiKey={embeddings.setApiKey}
          onReindex={() => embeddings.indexPrompts(prompts)}
          onClose={() => setBrainSelectorOpen(false)}
        />
      )}

      {syncPanelOpen && (
        <SyncPanel onClose={() => setSyncPanelOpen(false)} />
      )}

      {conflict && (
        <ConflictDialog
          conflict={conflict}
          onResolved={(dataReplaced) => {
            setConflict(null);
            if (dataReplaced) {
              window.location.reload();
            }
          }}
          onDismiss={() => setConflict(null)}
        />
      )}

      {setPasswordOpen && (
        <SetPasswordDialog
          isEncrypted={isEncrypted}
          onClose={() => setSetPasswordOpen(false)}
          onChanged={() => {
            setSetPasswordOpen(false);
            getDbLockStatus().then((s) => setIsEncrypted(s.encrypted)).catch(() => {});
          }}
        />
      )}

      {shortcutsOpen && (
        <ShortcutsDialog
          onClose={() => setShortcutsOpen(false)}
          onSaved={(updated) => {
            setShortcuts(updated);
            setShortcutsOpen(false);
          }}
        />
      )}
    </div>
  );
}