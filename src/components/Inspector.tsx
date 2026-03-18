import { useState } from "react";
import { useVersions } from "../hooks/useAppData";
import DiffViewer from "./DiffViewer";
import type { Prompt } from "../types";
import { PROMPT_ICONS, getIconEntry } from "../promptIcons";
import {
  exportPromptMarkdown,
  exportPromptsJson,
  downloadFile,
} from "../api/commands";

interface InspectorProps {
  snippet: Prompt | null;
  onDelete: (id: number) => Promise<void>;
  onOpenSync: () => void;
  onSave: (
    id: number,
    updates: { title?: string; content?: string; tags?: string[]; icon?: string | null }
  ) => Promise<Prompt | null>;
}

function Section({
  title,
  children,
  defaultOpen = true,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        className="flex items-center gap-2 px-3 py-2 w-full cursor-pointer select-none border-b border-darcula-border hover:bg-darcula-bg-lighter transition-colors text-left"
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className={`text-2xs text-darcula-text-muted transition-transform ${open ? "rotate-90" : ""}`}>
          ▶
        </span>
        <span className="text-xs font-mono font-semibold text-darcula-text-muted uppercase tracking-wider">
          {title}
        </span>
      </button>
      {open && (
        <div className="px-3 py-2 border-b border-darcula-border">
          {children}
        </div>
      )}
    </div>
  );
}

function MetadataRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-start py-1">
      <span className="text-2xs font-mono text-darcula-text-muted">{label}</span>
      <span className="text-2xs font-mono text-darcula-text text-right max-w-[140px] truncate">
        {value}
      </span>
    </div>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Slugify a prompt title for use as a filename. */
function toFilename(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "prompt";
}

export default function Inspector({ snippet, onDelete, onSave, onOpenSync }: InspectorProps) {
  const { versions, loading: versionsLoading } = useVersions(snippet?.id ?? null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editingTag, setEditingTag] = useState(false);
  const [newTag, setNewTag] = useState("");
  const [diffView, setDiffView] = useState<{
    oldText: string;
    newText: string;
    oldLabel: string;
    newLabel: string;
  } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [iconPickerOpen, setIconPickerOpen] = useState(false);

  if (!snippet) {
    return (
      <div className="flex flex-col h-full bg-darcula-bg-light">
        <div className="flex items-center px-3 py-2 border-b border-darcula-border">
          <span className="text-xs font-mono font-semibold text-darcula-text-muted uppercase tracking-wider">
            Inspector
          </span>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <span className="text-xs text-darcula-text-muted font-mono">No selection</span>
        </div>
      </div>
    );
  }

  const wordCount = snippet.content.split(/\s+/).filter(Boolean).length;
  const charCount = snippet.content.length;
  const lineCount = snippet.content.split("\n").length;

  const handleAddTag = async () => {
    const tag = newTag.trim().toLowerCase();
    if (!tag || snippet.tags.includes(tag)) {
      setNewTag("");
      setEditingTag(false);
      return;
    }
    await onSave(snippet.id, { tags: [...snippet.tags, tag] });
    setNewTag("");
    setEditingTag(false);
  };

  const handleRemoveTag = async (tagToRemove: string) => {
    await onSave(snippet.id, {
      tags: snippet.tags.filter((t) => t !== tagToRemove),
    });
  };

  // ── Export handlers ────────────────────────────────────────────

  const handleExportMarkdown = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const md = await exportPromptMarkdown(snippet.id);
      downloadFile(md, `${toFilename(snippet.title)}.md`, "text/markdown");
    } catch (e) {
      console.error("Export markdown failed:", e);
    } finally {
      setExporting(false);
    }
  };

  const handleExportJson = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const json = await exportPromptsJson([snippet.id]);
      downloadFile(json, `${toFilename(snippet.title)}.json`, "application/json");
    } catch (e) {
      console.error("Export JSON failed:", e);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-darcula-bg-light overflow-y-auto">
      {/* Header */}
      <div className="flex items-center px-3 py-2 border-b border-darcula-border flex-shrink-0">
        <span className="text-xs font-mono font-semibold text-darcula-text-muted uppercase tracking-wider">
          Inspector
        </span>
      </div>

      {/* Metadata */}
      <Section title="Properties">
        <MetadataRow label="Title" value={snippet.title} />
        <MetadataRow label="ID" value={`#${snippet.id}`} />
        <MetadataRow label="Created" value={formatDate(snippet.created_at)} />
        <MetadataRow label="Modified" value={formatDate(snippet.updated_at)} />
        <MetadataRow label="Words" value={String(wordCount)} />
        <MetadataRow label="Characters" value={String(charCount)} />
        <MetadataRow label="Lines" value={String(lineCount)} />
        {/* Icon picker */}
        <div className="flex justify-between items-center py-1">
          <span className="text-2xs font-mono text-darcula-text-muted">Icon</span>
          <button
            className="text-sm px-1.5 py-0.5 rounded-sm hover:bg-darcula-bg-lighter transition-colors"
            onClick={() => setIconPickerOpen((p) => !p)}
            title="Change icon"
          >
            {getIconEntry(snippet.icon).char}
          </button>
        </div>
        {iconPickerOpen && (
          <div className="grid grid-cols-6 gap-1 py-1.5">
            {PROMPT_ICONS.map((entry) => (
              <button
                key={entry.key}
                className={`text-sm p-1 rounded-sm transition-colors text-center ${
                  snippet.icon === entry.key || (!snippet.icon && entry.key === "file")
                    ? "bg-darcula-accent/30 ring-1 ring-darcula-accent"
                    : "hover:bg-darcula-bg-lighter"
                }`}
                title={entry.label}
                onClick={() => {
                  onSave(snippet.id, { icon: entry.key === "file" ? null : entry.key });
                  setIconPickerOpen(false);
                }}
              >
                {entry.char}
              </button>
            ))}
          </div>
        )}
      </Section>

      {/* Tags */}
      <Section title="Tags">
        <div className="flex flex-wrap gap-1.5">
          {snippet.tags.map((tag) => (
            <span
              key={tag}
              className="group text-2xs font-mono px-1.5 py-0.5 rounded-sm bg-darcula-bg text-darcula-accent-bright inline-flex items-center gap-1"
            >
              #{tag}
              <button
                className="text-darcula-text-muted hover:text-darcula-error opacity-0 group-hover:opacity-100 transition-opacity text-xs"
                onClick={() => handleRemoveTag(tag)}
              >
                ×
              </button>
            </span>
          ))}
          {editingTag ? (
            <input
              type="text"
              placeholder="tag name"
              className="bg-darcula-bg text-darcula-text text-2xs font-mono px-1.5 py-0.5 rounded-sm border border-darcula-accent outline-none w-20"
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAddTag();
                if (e.key === "Escape") {
                  setEditingTag(false);
                  setNewTag("");
                }
              }}
              onBlur={handleAddTag}
              autoFocus
            />
          ) : (
            <button
              className="text-2xs font-mono px-1.5 py-0.5 rounded-sm bg-darcula-bg text-darcula-text-muted hover:text-darcula-text transition-colors"
              onClick={() => setEditingTag(true)}
            >
              + add
            </button>
          )}
        </div>
      </Section>

      {/* Version History */}
      <Section title="History" defaultOpen={false}>
        {versionsLoading ? (
          <div className="text-2xs font-mono text-darcula-text-muted animate-pulse">
            Loading versions...
          </div>
        ) : versions.length > 0 ? (
          <div className="space-y-1.5">
            {versions.map((v, i) => (
              <div
                key={v.id}
                className="flex items-center gap-2 py-1 px-1 rounded-sm hover:bg-darcula-bg-lighter cursor-pointer transition-colors"
                onClick={() => {
                  if (i === 0 || versions.length < 2) return;
                  setDiffView({
                    oldText: v.content_text,
                    newText: versions[0].content_text,
                    oldLabel: `v${v.version_number} — ${new Date(v.created_at).toLocaleDateString()}`,
                    newLabel: `v${versions[0].version_number} (Current)`,
                  });
                }}
                title={i === 0 ? "Current version" : "Click to compare with current"}
              >
                <span className="text-2xs font-mono text-darcula-number w-5">
                  v{v.version_number}
                </span>
                <span className="text-2xs font-mono text-darcula-text truncate flex-1">
                  {i === 0 ? "Current" : `Version ${v.version_number}`}
                </span>
                {i > 0 && (
                  <span className="text-2xs font-mono text-darcula-accent-bright">
                    diff
                  </span>
                )}
                <span className="text-2xs font-mono text-darcula-text-muted">
                  {new Date(v.created_at).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  })}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-2xs font-mono text-darcula-text-muted">
            No version history
          </div>
        )}
      </Section>

      {/* Sync Status */}
      <Section title="Sync">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-darcula-text-muted" />
            <span className="text-2xs font-mono text-darcula-text-muted">
              Google Drive
            </span>
          </div>
          <button
            className="text-2xs font-mono text-darcula-accent-bright hover:underline"
            onClick={onOpenSync}
          >
            Configure →
          </button>
        </div>
      </Section>

      {/* Export */}
      <Section title="Export" defaultOpen={false}>
        <div className="space-y-2">
          <p className="text-2xs font-mono text-darcula-text-muted">
            Download this prompt as a file.
          </p>
          <div className="flex gap-2">
            <button
              className="flex-1 text-2xs font-mono px-2 py-1.5 rounded-sm bg-darcula-bg text-darcula-accent-bright border border-darcula-border hover:border-darcula-accent transition-colors disabled:opacity-40"
              onClick={handleExportMarkdown}
              disabled={exporting}
              title="Export as Markdown with YAML front-matter"
            >
              {exporting ? "Exporting…" : "↓ Markdown"}
            </button>
            <button
              className="flex-1 text-2xs font-mono px-2 py-1.5 rounded-sm bg-darcula-bg text-darcula-accent-bright border border-darcula-border hover:border-darcula-accent transition-colors disabled:opacity-40"
              onClick={handleExportJson}
              disabled={exporting}
              title="Export as JSON"
            >
              {exporting ? "Exporting…" : "↓ JSON"}
            </button>
          </div>
        </div>
      </Section>

      {/* Actions */}
      <Section title="Actions">
        {confirmDelete ? (
          <div className="space-y-2">
            <p className="text-2xs font-mono text-darcula-error">
              Delete "{snippet.title}" permanently?
            </p>
            <div className="flex gap-2">
              <button
                className="text-2xs font-mono px-2 py-1 rounded-sm bg-darcula-error text-white hover:bg-red-600 transition-colors"
                onClick={async () => {
                  setConfirmDelete(false);
                  await onDelete(snippet.id);
                }}
              >
                Confirm Delete
              </button>
              <button
                className="text-2xs font-mono px-2 py-1 rounded-sm bg-darcula-bg text-darcula-text-muted hover:text-darcula-text transition-colors"
                onClick={() => setConfirmDelete(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            className="text-2xs font-mono px-2 py-1 rounded-sm text-darcula-error hover:bg-darcula-error/10 transition-colors"
            onClick={() => setConfirmDelete(true)}
          >
            Delete Prompt
          </button>
        )}
      </Section>

      {/* Diff Viewer (full-screen overlay) */}
      {diffView && (
        <DiffViewer
          oldText={diffView.oldText}
          newText={diffView.newText}
          oldLabel={diffView.oldLabel}
          newLabel={diffView.newLabel}
          onClose={() => setDiffView(null)}
        />
      )}
    </div>
  );
}