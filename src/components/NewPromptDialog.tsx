import { useState, useRef, useEffect } from "react";
import type { Category } from "../types";

interface NewPromptDialogProps {
  categories: Category[];
  onSubmit: (title: string, categoryId: number | null, tags: string[]) => Promise<void>;
  onClose: () => void;
}

export default function NewPromptDialog({
  categories,
  onSubmit,
  onClose,
}: NewPromptDialogProps) {
  const [title, setTitle] = useState("");
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [tagInput, setTagInput] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleAddTag = () => {
    const tag = tagInput.trim().toLowerCase();
    if (tag && !tags.includes(tag)) {
      setTags((prev) => [...prev, tag]);
    }
    setTagInput("");
  };

  const handleRemoveTag = (t: string) => {
    setTags((prev) => prev.filter((x) => x !== t));
  };

  const handleSubmit = async () => {
    if (!title.trim()) return;
    setSubmitting(true);
    await onSubmit(title.trim(), categoryId, tags);
    setSubmitting(false);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/50" />

      <div
        className="relative w-full max-w-md bg-darcula-bg-light border border-darcula-border rounded-lg shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 py-3 border-b border-darcula-border">
          <h2 className="text-sm font-mono font-semibold text-darcula-text-bright">
            New Prompt
          </h2>
        </div>

        {/* Form */}
        <div className="px-4 py-3 space-y-3">
          {/* Title */}
          <div>
            <label className="text-2xs font-mono text-darcula-text-muted uppercase tracking-wider block mb-1">
              Title
            </label>
            <input
              ref={inputRef}
              type="text"
              placeholder="my_prompt.md"
              className="w-full bg-darcula-bg text-darcula-text font-mono text-sm px-3 py-2 rounded-sm border border-darcula-border outline-none focus:border-darcula-accent"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSubmit();
                if (e.key === "Escape") onClose();
              }}
            />
          </div>

          {/* Category */}
          <div>
            <label className="text-2xs font-mono text-darcula-text-muted uppercase tracking-wider block mb-1">
              Folder
            </label>
            <select
              className="w-full bg-darcula-bg text-darcula-text font-mono text-sm px-3 py-2 rounded-sm border border-darcula-border outline-none focus:border-darcula-accent"
              value={categoryId ?? ""}
              onChange={(e) =>
                setCategoryId(e.target.value ? Number(e.target.value) : null)
              }
            >
              <option value="">None (uncategorized)</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.parent_id ? "  └ " : ""}{cat.name}
                </option>
              ))}
            </select>
          </div>

          {/* Tags */}
          <div>
            <label className="text-2xs font-mono text-darcula-text-muted uppercase tracking-wider block mb-1">
              Tags
            </label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="text-2xs font-mono px-1.5 py-0.5 rounded-sm bg-darcula-bg text-darcula-accent-bright inline-flex items-center gap-1"
                >
                  #{tag}
                  <button
                    className="text-darcula-text-muted hover:text-darcula-error text-xs"
                    onClick={() => handleRemoveTag(tag)}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
            <input
              type="text"
              placeholder="Add a tag and press Enter..."
              className="w-full bg-darcula-bg text-darcula-text font-mono text-sm px-3 py-2 rounded-sm border border-darcula-border outline-none focus:border-darcula-accent"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAddTag();
                }
              }}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-darcula-border">
          <button
            className="text-xs font-mono px-3 py-1.5 rounded-sm text-darcula-text-muted hover:text-darcula-text transition-colors"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="text-xs font-mono px-3 py-1.5 rounded-sm bg-darcula-accent text-white hover:bg-darcula-accent-bright transition-colors disabled:opacity-50"
            onClick={handleSubmit}
            disabled={!title.trim() || submitting}
          >
            {submitting ? "Creating..." : "Create Prompt"}
          </button>
        </div>
      </div>
    </div>
  );
}