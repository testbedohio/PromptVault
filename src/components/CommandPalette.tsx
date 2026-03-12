import { useState, useRef, useEffect, useCallback } from "react";
import type { Prompt } from "../types";

interface CommandPaletteProps {
  prompts: Prompt[];
  searchPrompts: (query: string) => Promise<Prompt[]>;
  semanticSearch: (
    query: string,
    prompts: Prompt[],
    topK?: number
  ) => Promise<{ prompt: Prompt; score: number }[]>;
  semanticIndexSize: number;
  onSelect: (id: number) => void;
  onClose: () => void;
}

type SearchMode = "keyword" | "semantic";

export default function CommandPalette({
  prompts,
  searchPrompts,
  semanticSearch,
  semanticIndexSize,
  onSelect,
  onClose,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ prompt: Prompt; score?: number }[]>(
    prompts.map((p) => ({ prompt: p }))
  );
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [searching, setSearching] = useState(false);
  const [mode, setMode] = useState<SearchMode>("keyword");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Search on query or mode change
  useEffect(() => {
    if (!query.trim()) {
      setResults(prompts.map((p) => ({ prompt: p })));
      setSelectedIndex(0);
      return;
    }

    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        if (mode === "semantic" && semanticIndexSize > 0) {
          const scored = await semanticSearch(query, prompts);
          setResults(scored.map((r) => ({ prompt: r.prompt, score: r.score })));
        } else {
          const found = await searchPrompts(query);
          setResults(found.map((p) => ({ prompt: p })));
        }
      } catch {
        // Fallback to client filter
        const q = query.toLowerCase();
        setResults(
          prompts
            .filter(
              (s) =>
                s.title.toLowerCase().includes(q) ||
                s.content.toLowerCase().includes(q) ||
                s.tags.some((t) => t.toLowerCase().includes(q))
            )
            .map((p) => ({ prompt: p }))
        );
      }
      setSelectedIndex(0);
      setSearching(false);
    }, mode === "semantic" ? 300 : 150);

    return () => clearTimeout(timer);
  }, [query, mode, prompts, searchPrompts, semanticSearch, semanticIndexSize]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter" && results[selectedIndex]) {
        onSelect(results[selectedIndex].prompt.id);
      } else if (e.key === "Tab") {
        e.preventDefault();
        setMode((m) => (m === "keyword" ? "semantic" : "keyword"));
      }
    },
    [results, selectedIndex, onSelect]
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/50" />

      <div
        className="relative w-full max-w-lg bg-darcula-bg-light border border-darcula-border rounded-lg shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search Mode Toggle + Input */}
        <div className="border-b border-darcula-border">
          <div className="flex items-center gap-1 px-4 pt-2">
            <button
              className={`text-2xs font-mono px-2 py-0.5 rounded-t-sm transition-colors ${
                mode === "keyword"
                  ? "bg-darcula-bg text-darcula-text-bright border border-b-0 border-darcula-border"
                  : "text-darcula-text-muted hover:text-darcula-text"
              }`}
              onClick={() => setMode("keyword")}
            >
              🔍 Keyword
            </button>
            <button
              className={`text-2xs font-mono px-2 py-0.5 rounded-t-sm transition-colors ${
                mode === "semantic"
                  ? "bg-darcula-bg text-darcula-text-bright border border-b-0 border-darcula-border"
                  : "text-darcula-text-muted hover:text-darcula-text"
              }`}
              onClick={() => setMode("semantic")}
              title={
                semanticIndexSize === 0
                  ? "No embeddings yet — use Brain Selector to build index"
                  : `${semanticIndexSize} prompts indexed`
              }
            >
              🧠 Semantic
              {semanticIndexSize > 0 && (
                <span className="ml-1 text-darcula-success">●</span>
              )}
            </button>
          </div>

          <div className="flex items-center gap-2 px-4 py-2">
            <span className="text-darcula-text-muted text-sm">
              {mode === "keyword" ? "⌘" : "🧠"}
            </span>
            <input
              ref={inputRef}
              type="text"
              placeholder={
                mode === "keyword"
                  ? "Search prompts by keyword..."
                  : "Describe what you're looking for..."
              }
              className="flex-1 bg-transparent text-darcula-text font-mono text-sm outline-none placeholder:text-darcula-text-muted"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
            />
            {searching && (
              <span className="text-2xs text-darcula-warning font-mono animate-pulse">
                {mode === "semantic" ? "thinking..." : "..."}
              </span>
            )}
            <kbd className="text-2xs font-mono text-darcula-text-muted bg-darcula-bg px-1.5 py-0.5 rounded">
              ESC
            </kbd>
          </div>
        </div>

        {/* Results */}
        <div className="max-h-[300px] overflow-y-auto">
          {results.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm font-mono text-darcula-text-muted">
              {mode === "semantic" && semanticIndexSize === 0
                ? "No embeddings yet. Open Brain Selector (🧠) to build index."
                : "No results found"}
            </div>
          ) : (
            results.map(({ prompt: snippet, score }, i) => (
              <div
                key={snippet.id}
                className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors ${
                  i === selectedIndex
                    ? "bg-darcula-selection"
                    : "hover:bg-darcula-bg-lighter"
                }`}
                onClick={() => onSelect(snippet.id)}
                onMouseEnter={() => setSelectedIndex(i)}
              >
                <span className="text-darcula-string text-xs">◇</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-mono text-darcula-text-bright truncate">
                    {snippet.title}
                  </div>
                  <div className="text-2xs font-mono text-darcula-text-muted truncate mt-0.5">
                    {snippet.content.slice(0, 80).replace(/\n/g, " ")}...
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  {score !== undefined && (
                    <span className="text-2xs font-mono text-darcula-number">
                      {(score * 100).toFixed(0)}%
                    </span>
                  )}
                  {snippet.tags.slice(0, 2).map((tag) => (
                    <span
                      key={tag}
                      className="text-2xs font-mono px-1 py-0.5 rounded-sm bg-darcula-bg text-darcula-accent-bright"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-4 px-4 py-2 border-t border-darcula-border text-2xs font-mono text-darcula-text-muted">
          <span>
            <kbd className="bg-darcula-bg px-1 rounded">↑↓</kbd> navigate
          </span>
          <span>
            <kbd className="bg-darcula-bg px-1 rounded">Tab</kbd> switch mode
          </span>
          <span>
            <kbd className="bg-darcula-bg px-1 rounded">↵</kbd> open
          </span>
          <span className="ml-auto">{results.length} results</span>
        </div>
      </div>
    </div>
  );
}