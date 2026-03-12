import { useState, useRef, useEffect } from "react";
import type { Prompt } from "../types";

interface CommandPaletteProps {
  prompts: Prompt[];
  searchPrompts: (query: string) => Promise<Prompt[]>;
  onSelect: (id: number) => void;
  onClose: () => void;
}

export default function CommandPalette({
  prompts,
  searchPrompts,
  onSelect,
  onClose,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Prompt[]>(prompts);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Search on query change
  useEffect(() => {
    if (!query.trim()) {
      setResults(prompts);
      setSelectedIndex(0);
      return;
    }

    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const found = await searchPrompts(query);
        setResults(found);
      } catch {
        // Fallback to client filter
        const q = query.toLowerCase();
        setResults(
          prompts.filter(
            (s) =>
              s.title.toLowerCase().includes(q) ||
              s.content.toLowerCase().includes(q) ||
              s.tags.some((t) => t.toLowerCase().includes(q))
          )
        );
      }
      setSelectedIndex(0);
      setSearching(false);
    }, 150);

    return () => clearTimeout(timer);
  }, [query, prompts, searchPrompts]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && results[selectedIndex]) {
      onSelect(results[selectedIndex].id);
    }
  };

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
        {/* Search Input */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-darcula-border">
          <span className="text-darcula-text-muted text-sm">⌘</span>
          <input
            ref={inputRef}
            type="text"
            placeholder="Search prompts, tags, or type a command..."
            className="flex-1 bg-transparent text-darcula-text font-mono text-sm outline-none placeholder:text-darcula-text-muted"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          {searching && (
            <span className="text-2xs text-darcula-warning font-mono animate-pulse">
              ...
            </span>
          )}
          <kbd className="text-2xs font-mono text-darcula-text-muted bg-darcula-bg px-1.5 py-0.5 rounded">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div className="max-h-[300px] overflow-y-auto">
          {results.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm font-mono text-darcula-text-muted">
              No results found
            </div>
          ) : (
            results.map((snippet, i) => (
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
                <div className="flex gap-1 flex-shrink-0">
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
            <kbd className="bg-darcula-bg px-1 rounded">↵</kbd> open
          </span>
          <span>
            <kbd className="bg-darcula-bg px-1 rounded">esc</kbd> close
          </span>
          <span className="ml-auto">{results.length} results</span>
        </div>
      </div>
    </div>
  );
}