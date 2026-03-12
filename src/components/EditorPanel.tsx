import { useState, useEffect, useCallback } from "react";
import MonacoEditorWrapper from "../editor/MonacoEditor";
import { useAutoSave } from "../hooks/useAppData";
import type { Prompt } from "../types";

interface EditorPanelProps {
  prompts: Prompt[];
  openTabs: number[];
  activeTab: number;
  onSelectTab: (id: number) => void;
  onCloseTab: (id: number) => void;
  onSave: (
    id: number,
    updates: { title?: string; content?: string; tags?: string[] }
  ) => Promise<Prompt | null>;
}

function EditorContent({
  snippet,
  onSave,
}: {
  snippet: Prompt;
  onSave: EditorPanelProps["onSave"];
}) {
  const [content, setContent] = useState(snippet.content);

  // Auto-save with debounce
  const { saving, lastSavedAt } = useAutoSave(snippet.id, content, onSave);

  // Sync content when switching between snippets
  useEffect(() => {
    setContent(snippet.content);
  }, [snippet.id, snippet.content]);

  const handleChange = useCallback((newValue: string) => {
    setContent(newValue);
  }, []);

  const lineCount = content.split("\n").length;
  const wordCount = content.split(/\s+/).filter(Boolean).length;

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-1 bg-darcula-bg-light border-b border-darcula-border flex-shrink-0">
        <div className="flex items-center gap-3 text-2xs font-mono text-darcula-text-muted">
          <span>{snippet.title}</span>
          <span className="text-darcula-border">|</span>
          <span>{lineCount} lines</span>
          <span className="text-darcula-border">|</span>
          <span>{wordCount} words</span>
        </div>
        <div className="flex items-center gap-2 text-2xs font-mono text-darcula-text-muted">
          {saving && <span className="text-darcula-warning">Saving...</span>}
          {!saving && lastSavedAt && (
            <span className="text-darcula-success">
              Saved {lastSavedAt.toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>

      {/* Monaco Editor */}
      <div className="flex-1 overflow-hidden">
        <MonacoEditorWrapper
          value={content}
          onChange={handleChange}
          fileName={snippet.title}
        />
      </div>
    </div>
  );
}

export default function EditorPanel({
  prompts,
  openTabs,
  activeTab,
  onSelectTab,
  onCloseTab,
  onSave,
}: EditorPanelProps) {
  const activeSnippet = prompts.find((s) => s.id === activeTab);

  return (
    <div className="flex flex-col h-full bg-darcula-bg overflow-hidden">
      {/* Tab Bar */}
      <div className="flex items-center bg-darcula-bg-light border-b border-darcula-border overflow-x-auto flex-shrink-0">
        {openTabs.map((tabId) => {
          const snippet = prompts.find((s) => s.id === tabId);
          if (!snippet) return null;
          const isActive = tabId === activeTab;
          return (
            <div
              key={tabId}
              className={`editor-tab ${isActive ? "active" : ""}`}
              onClick={() => onSelectTab(tabId)}
            >
              <span className="text-darcula-string text-2xs">◇</span>
              <span className="truncate max-w-[140px]">{snippet.title}</span>
              <button
                className="ml-1 text-darcula-text-muted hover:text-darcula-error transition-colors text-xs leading-none"
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseTab(tabId);
                }}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>

      {/* Editor Content */}
      <div className="flex-1 overflow-hidden">
        {activeSnippet ? (
          <EditorContent
            key={activeSnippet.id}
            snippet={activeSnippet}
            onSave={onSave}
          />
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="text-center text-darcula-text-muted">
              <div className="text-4xl mb-3 opacity-20">⬡</div>
              <div className="font-mono text-sm">No file open</div>
              <div className="text-xs mt-1">
                Select a prompt from the sidebar or press{" "}
                <kbd className="bg-darcula-bg-lighter px-1.5 py-0.5 rounded text-2xs font-mono">
                  Ctrl+K
                </kbd>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}