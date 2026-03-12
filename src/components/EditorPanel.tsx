import { useState } from "react";

interface Snippet {
  id: number;
  title: string;
  content: string;
  categoryId: number | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

interface EditorPanelProps {
  snippets: Snippet[];
  openTabs: number[];
  activeTab: number;
  onSelectTab: (id: number) => void;
  onCloseTab: (id: number) => void;
}

/**
 * Minimal markdown-aware renderer for Phase 1.
 * Monaco Editor will replace this in Phase 2.
 */
function MarkdownPreview({ content }: { content: string }) {
  const lines = content.split("\n");

  return (
    <div className="font-mono text-sm leading-relaxed">
      {lines.map((line, i) => {
        // Headings
        if (line.startsWith("### "))
          return (
            <h3
              key={i}
              className="text-darcula-keyword font-bold text-base mt-4 mb-1"
            >
              {line.slice(4)}
            </h3>
          );
        if (line.startsWith("## "))
          return (
            <h2
              key={i}
              className="text-darcula-keyword font-bold text-lg mt-5 mb-1"
            >
              {line.slice(3)}
            </h2>
          );
        if (line.startsWith("# "))
          return (
            <h1
              key={i}
              className="text-darcula-function font-bold text-xl mt-4 mb-2"
            >
              {line.slice(2)}
            </h1>
          );

        // Code block delimiters
        if (line.startsWith("```"))
          return (
            <div
              key={i}
              className="text-darcula-comment text-xs mt-2"
            >
              {line}
            </div>
          );

        // List items
        if (line.startsWith("- "))
          return (
            <div key={i} className="text-darcula-text pl-4">
              <span className="text-darcula-accent-bright">•</span>{" "}
              {renderInline(line.slice(2))}
            </div>
          );

        // Empty lines
        if (line.trim() === "") return <div key={i} className="h-3" />;

        // Regular text
        return (
          <div key={i} className="text-darcula-text">
            {renderInline(line)}
          </div>
        );
      })}
    </div>
  );
}

/** Handle basic inline markdown: **bold**, `code`, {vars} */
function renderInline(text: string) {
  const parts: (string | JSX.Element)[] = [];
  const regex = /(\*\*(.+?)\*\*|`(.+?)`|\{(.+?)\})/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    if (match[2]) {
      parts.push(
        <strong key={match.index} className="text-darcula-text-bright font-semibold">
          {match[2]}
        </strong>
      );
    } else if (match[3]) {
      parts.push(
        <code
          key={match.index}
          className="bg-darcula-bg-lighter text-darcula-string px-1 py-0.5 rounded-sm text-xs"
        >
          {match[3]}
        </code>
      );
    } else if (match[4]) {
      parts.push(
        <span key={match.index} className="text-darcula-number">
          {"{" + match[4] + "}"}
        </span>
      );
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return parts.length > 0 ? parts : text;
}

export default function EditorPanel({
  snippets,
  openTabs,
  activeTab,
  onSelectTab,
  onCloseTab,
}: EditorPanelProps) {
  const activeSnippet = snippets.find((s) => s.id === activeTab);
  const [lineNumbers] = useState(true);

  return (
    <div className="flex flex-col h-full bg-darcula-bg overflow-hidden">
      {/* Tab Bar */}
      <div className="flex items-center bg-darcula-bg-light border-b border-darcula-border overflow-x-auto flex-shrink-0">
        {openTabs.map((tabId) => {
          const snippet = snippets.find((s) => s.id === tabId);
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
      <div className="flex-1 overflow-y-auto">
        {activeSnippet ? (
          <div className="flex">
            {/* Line Numbers Gutter */}
            {lineNumbers && (
              <div className="flex-shrink-0 pt-4 pr-2 text-right select-none border-r border-darcula-border bg-darcula-bg-light w-12">
                {activeSnippet.content.split("\n").map((_, i) => (
                  <div
                    key={i}
                    className="text-2xs font-mono text-darcula-gutter leading-relaxed px-2"
                  >
                    {i + 1}
                  </div>
                ))}
              </div>
            )}

            {/* Content Area */}
            <div className="flex-1 p-4 pl-4">
              <MarkdownPreview content={activeSnippet.content} />
            </div>
          </div>
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