import { useState, useCallback, useRef, useEffect } from "react";
import Sidebar from "./components/Sidebar";
import EditorPanel from "./components/EditorPanel";
import Inspector from "./components/Inspector";
import StatusBar from "./components/StatusBar";
import CommandPalette from "./components/CommandPalette";

interface Snippet {
  id: number;
  title: string;
  content: string;
  categoryId: number | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

interface Category {
  id: number;
  name: string;
  parentId: number | null;
  children: Category[];
}

export default function App() {
  // Panel widths
  const [sidebarWidth, setSidebarWidth] = useState(260);
  const [inspectorWidth, setInspectorWidth] = useState(280);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

  // Data state
  const [categories, setCategories] = useState<Category[]>([
    {
      id: 1,
      name: "System Prompts",
      parentId: null,
      children: [
        { id: 4, name: "Assistants", parentId: 1, children: [] },
        { id: 5, name: "Agents", parentId: 1, children: [] },
      ],
    },
    { id: 2, name: "Code Snippets", parentId: null, children: [] },
    { id: 3, name: "Templates", parentId: null, children: [] },
  ]);

  const [tags] = useState<string[]>([
    "python",
    "javascript",
    "sql",
    "gpt-4",
    "claude",
    "chain-of-thought",
    "few-shot",
    "system",
  ]);

  const [snippets] = useState<Snippet[]>([
    {
      id: 1,
      title: "code_review_agent.md",
      content:
        '# Code Review Agent\n\nYou are a senior software engineer conducting a thorough code review.\n\n## Guidelines\n- Check for **security vulnerabilities**\n- Ensure proper error handling\n- Verify naming conventions\n\n```python\ndef review(code: str) -> dict:\n    """Analyze code and return findings."""\n    findings = []\n    # Analysis logic here\n    return {"findings": findings, "score": 0.85}\n```',
      categoryId: 1,
      tags: ["python", "claude", "system"],
      createdAt: "2025-03-10T14:30:00Z",
      updatedAt: "2025-03-12T09:15:00Z",
    },
    {
      id: 2,
      title: "sql_optimizer.md",
      content:
        "# SQL Query Optimizer\n\nAnalyze the following SQL query and suggest optimizations.\n\nFocus on:\n- Index usage\n- JOIN efficiency\n- Subquery elimination",
      categoryId: 2,
      tags: ["sql", "gpt-4"],
      createdAt: "2025-03-08T10:00:00Z",
      updatedAt: "2025-03-11T16:45:00Z",
    },
    {
      id: 3,
      title: "few_shot_classifier.md",
      content:
        '# Few-Shot Classification Prompt\n\nClassify the following text into one of these categories: [Bug, Feature, Question]\n\n## Examples\n- "The app crashes on login" → Bug\n- "Can we add dark mode?" → Feature\n- "How do I export data?" → Question\n\n## Input\n{user_input}',
      categoryId: 3,
      tags: ["few-shot", "chain-of-thought"],
      createdAt: "2025-03-05T08:20:00Z",
      updatedAt: "2025-03-10T11:30:00Z",
    },
  ]);

  const [openTabs, setOpenTabs] = useState<number[]>([1]);
  const [activeTab, setActiveTab] = useState<number>(1);
  const [selectedCategory, setSelectedCategory] = useState<number | null>(null);

  const activeSnippet = snippets.find((s) => s.id === activeTab) || null;

  // Open a snippet in a tab
  const openSnippet = useCallback(
    (id: number) => {
      if (!openTabs.includes(id)) {
        setOpenTabs((prev) => [...prev, id]);
      }
      setActiveTab(id);
    },
    [openTabs]
  );

  // Close a tab
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

  // Cmd+K shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCommandPaletteOpen((prev) => !prev);
      }
      if (e.key === "Escape") {
        setCommandPaletteOpen(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-darcula-bg">
      {/* Title Bar */}
      <header className="flex items-center justify-between h-9 px-4 bg-darcula-bg-light border-b border-darcula-border flex-shrink-0 select-none"
        data-tauri-drag-region
      >
        <div className="flex items-center gap-2">
          <span className="text-darcula-accent-bright font-mono font-bold text-sm">
            ⬡ PromptVault
          </span>
          <span className="text-darcula-text-muted text-2xs font-mono">
            v1.0.0
          </span>
        </div>
        <div className="flex items-center gap-3 text-darcula-text-muted text-xs font-mono">
          <button
            className="hover:text-darcula-text transition-colors"
            onClick={() => setCommandPaletteOpen(true)}
            title="Command Palette (Ctrl+K)"
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
        {/* Sidebar */}
        <div style={{ width: sidebarWidth }} className="flex-shrink-0 overflow-hidden">
          <Sidebar
            categories={categories}
            tags={tags}
            snippets={snippets}
            selectedCategory={selectedCategory}
            onSelectCategory={setSelectedCategory}
            onOpenSnippet={openSnippet}
          />
        </div>

        {/* Divider */}
        <div className="panel-divider" onMouseDown={onMouseDown("sidebar")} />

        {/* Editor Panel */}
        <div className="flex-1 overflow-hidden">
          <EditorPanel
            snippets={snippets}
            openTabs={openTabs}
            activeTab={activeTab}
            onSelectTab={setActiveTab}
            onCloseTab={closeTab}
          />
        </div>

        {/* Inspector */}
        {inspectorOpen && (
          <>
            <div
              className="panel-divider"
              onMouseDown={onMouseDown("inspector")}
            />
            <div
              style={{ width: inspectorWidth }}
              className="flex-shrink-0 overflow-hidden"
            >
              <Inspector snippet={activeSnippet} />
            </div>
          </>
        )}
      </div>

      {/* Status Bar */}
      <StatusBar
        snippetCount={snippets.length}
        activeSnippet={activeSnippet}
      />

      {/* Command Palette */}
      {commandPaletteOpen && (
        <CommandPalette
          snippets={snippets}
          onSelect={(id) => {
            openSnippet(id);
            setCommandPaletteOpen(false);
          }}
          onClose={() => setCommandPaletteOpen(false)}
        />
      )}
    </div>
  );
}