import { useState, useRef } from "react";
import type { CategoryTree, Tag, Prompt } from "../types";
import { getIconEntry } from "../promptIcons";

interface SidebarProps {
  categories: CategoryTree[];
  tags: Tag[];
  allPrompts: Prompt[];
  selectedCategory: number | null;
  activeTagFilter: string | null;
  onSelectCategory: (id: number | null) => void;
  onSelectTag: (tag: string | null) => void;
  onOpenSnippet: (id: number) => void;
  onNewPrompt: () => void;
  onNewCategory: (name: string, parentId?: number | null) => void;
  onRenameCategory?: (id: number, name: string) => Promise<boolean>;
  onDeleteCategory?: (id: number) => Promise<boolean>;
  onMovePrompt?: (promptId: number, categoryId: number | null) => void;
}

function FolderIcon({ open }: { open: boolean }) {
  return (
    <span className="text-darcula-keyword text-xs">
      {open ? "\u25BC" : "\u25B6"}
    </span>
  );
}

function FileIcon({ icon }: { icon: string | null }) {
  const entry = getIconEntry(icon);
  return <span className="text-xs" title={entry.label}>{entry.char}</span>;
}

function PromptItem({
  prompt,
  depth,
  onOpenSnippet,
}: {
  prompt: Prompt;
  depth: number;
  onOpenSnippet: (id: number) => void;
}) {
  const [dragging, setDragging] = useState(false);

  return (
    <div
      className={`tree-item ${dragging ? "opacity-40" : ""}`}
      style={{ paddingLeft: `${28 + depth * 16}px` }}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("promptvault/prompt-id", String(prompt.id));
        e.dataTransfer.effectAllowed = "move";
        setDragging(true);
      }}
      onDragEnd={() => setDragging(false)}
      onClick={() => onOpenSnippet(prompt.id)}
    >
      <FileIcon icon={prompt.icon} />
      <span className="truncate text-darcula-text-bright text-xs">
        {prompt.title}
      </span>
    </div>
  );
}

function TreeNode({
  category,
  allPrompts,
  depth,
  selectedCategory,
  onSelectCategory,
  onOpenSnippet,
  onRenameCategory,
  onDeleteCategory,
  onMovePrompt,
}: {
  category: CategoryTree;
  allPrompts: Prompt[];
  depth: number;
  selectedCategory: number | null;
  onSelectCategory: (id: number | null) => void;
  onOpenSnippet: (id: number) => void;
  onRenameCategory?: (id: number, name: string) => Promise<boolean>;
  onDeleteCategory?: (id: number) => Promise<boolean>;
  onMovePrompt?: (promptId: number, categoryId: number | null) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [dropTarget, setDropTarget] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(category.name);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const dragCounter = useRef(0);
  const categoryPrompts = allPrompts.filter(
    (p) => p.category_id === category.id
  );
  const isSelected = selectedCategory === category.id;

  const handleDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes("promptvault/prompt-id")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    }
  };

  const handleDragEnter = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes("promptvault/prompt-id")) {
      e.preventDefault();
      dragCounter.current++;
      setDropTarget(true);
    }
  };

  const handleDragLeave = () => {
    dragCounter.current--;
    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
      setDropTarget(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = 0;
    setDropTarget(false);
    const promptId = Number(e.dataTransfer.getData("promptvault/prompt-id"));
    if (promptId && onMovePrompt) {
      onMovePrompt(promptId, category.id);
      if (!expanded) setExpanded(true);
    }
  };

  const handleRename = async () => {
    const trimmed = editName.trim();
    if (trimmed && trimmed !== category.name && onRenameCategory) {
      await onRenameCategory(category.id, trimmed);
    }
    setEditing(false);
  };

  const handleDelete = async () => {
    if (onDeleteCategory) {
      await onDeleteCategory(category.id);
    }
    setConfirmDelete(false);
  };

  return (
    <div>
      <div
        className={`tree-item group ${isSelected ? "active" : ""} ${dropTarget ? "!bg-darcula-accent/20 !border-l-2 !border-l-darcula-accent" : ""}`}
        style={{ paddingLeft: `${12 + depth * 16}px` }}
        onClick={() => {
          if (editing || confirmDelete) return;
          setExpanded(!expanded);
          onSelectCategory(isSelected ? null : category.id);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          setConfirmDelete(false);
          setEditing(true);
          setEditName(category.name);
        }}
        onDragOver={handleDragOver}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {editing ? (
          <>
            <FolderIcon open={expanded} />
            <input
              className="flex-1 bg-darcula-bg text-darcula-text text-xs font-mono px-1.5 py-0.5 rounded-sm border border-darcula-accent outline-none min-w-0"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleRename();
                if (e.key === "Escape") setEditing(false);
                e.stopPropagation();
              }}
              onClick={(e) => e.stopPropagation()}
              onBlur={handleRename}
              autoFocus
            />
          </>
        ) : confirmDelete ? (
          <>
            <span className="text-2xs font-mono text-darcula-error truncate">
              Delete "{category.name}"?
            </span>
            <div className="ml-auto flex gap-1 flex-shrink-0">
              <button
                className="text-2xs font-mono px-1.5 py-0.5 rounded-sm bg-darcula-error text-white hover:bg-red-600 transition-colors"
                onClick={(e) => { e.stopPropagation(); handleDelete(); }}
              >
                Yes
              </button>
              <button
                className="text-2xs font-mono px-1.5 py-0.5 rounded-sm bg-darcula-bg text-darcula-text-muted hover:text-darcula-text transition-colors"
                onClick={(e) => { e.stopPropagation(); setConfirmDelete(false); }}
              >
                No
              </button>
            </div>
          </>
        ) : (
          <>
            <FolderIcon open={expanded} />
            <span className="truncate">{category.name}</span>
            <span className="ml-auto flex items-center gap-1 flex-shrink-0">
              <span className="text-2xs text-darcula-text-muted">
                {categoryPrompts.length}
              </span>
              <button
                className="text-2xs text-darcula-text-muted hover:text-darcula-error opacity-0 group-hover:opacity-100 transition-opacity"
                title="Delete folder"
                onClick={(e) => { e.stopPropagation(); setConfirmDelete(true); }}
              >
                ×
              </button>
            </span>
          </>
        )}
      </div>

      {expanded && (
        <>
          {category.children.map((child) => (
            <TreeNode
              key={child.id}
              category={child}
              allPrompts={allPrompts}
              depth={depth + 1}
              selectedCategory={selectedCategory}
              onSelectCategory={onSelectCategory}
              onOpenSnippet={onOpenSnippet}
              onRenameCategory={onRenameCategory}
              onDeleteCategory={onDeleteCategory}
              onMovePrompt={onMovePrompt}
            />
          ))}
          {categoryPrompts.map((prompt) => (
            <PromptItem
              key={prompt.id}
              prompt={prompt}
              depth={depth}
              onOpenSnippet={onOpenSnippet}
            />
          ))}
        </>
      )}
    </div>
  );
}

function UncategorizedFolder({
  allPrompts,
  onOpenSnippet,
}: {
  allPrompts: Prompt[];
  onOpenSnippet: (id: number) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const uncategorized = allPrompts.filter((p) => p.category_id === null);

  if (uncategorized.length === 0) return null;

  return (
    <div className="mt-1">
      <div
        className="tree-item text-darcula-text-muted"
        style={{ paddingLeft: "12px" }}
        onClick={() => setExpanded(!expanded)}
      >
        <FolderIcon open={expanded} />
        <span className="truncate italic">Uncategorized Items</span>
        <span className="ml-auto text-2xs text-darcula-text-muted">
          {uncategorized.length}
        </span>
      </div>
      {expanded &&
        uncategorized.map((prompt) => (
          <PromptItem
            key={prompt.id}
            prompt={prompt}
            depth={0}
            onOpenSnippet={onOpenSnippet}
          />
        ))}
    </div>
  );
}

export default function Sidebar({
  categories,
  tags,
  allPrompts,
  selectedCategory,
  activeTagFilter,
  onSelectCategory,
  onSelectTag,
  onOpenSnippet,
  onNewPrompt,
  onNewCategory,
  onRenameCategory,
  onDeleteCategory,
  onMovePrompt,
}: SidebarProps) {
  const [newCategoryName, setNewCategoryName] = useState("");
  const [showNewCategory, setShowNewCategory] = useState(false);
  const [rootDropTarget, setRootDropTarget] = useState(false);
  const rootDragCounter = useRef(0);

  const handleCreateCategory = () => {
    const name = newCategoryName.trim();
    if (!name) return;
    onNewCategory(name, null);
    setNewCategoryName("");
    setShowNewCategory(false);
  };

  // Drop on root area = move to uncategorized
  const handleRootDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes("promptvault/prompt-id")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    }
  };

  const handleRootDragEnter = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes("promptvault/prompt-id")) {
      e.preventDefault();
      rootDragCounter.current++;
      setRootDropTarget(true);
    }
  };

  const handleRootDragLeave = () => {
    rootDragCounter.current--;
    if (rootDragCounter.current <= 0) {
      rootDragCounter.current = 0;
      setRootDropTarget(false);
    }
  };

  const handleRootDrop = (e: React.DragEvent) => {
    e.preventDefault();
    rootDragCounter.current = 0;
    setRootDropTarget(false);
    const promptId = Number(e.dataTransfer.getData("promptvault/prompt-id"));
    if (promptId && onMovePrompt) {
      onMovePrompt(promptId, null);
    }
  };

  return (
    <div className="flex flex-col h-full bg-darcula-bg-light overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-darcula-border">
        <span className="text-xs font-mono font-semibold text-darcula-text-muted uppercase tracking-wider">
          Explorer
        </span>
        <div className="flex items-center gap-1">
          <button
            className="text-darcula-text-muted hover:text-darcula-text text-xs font-mono px-1.5 py-0.5 rounded-sm hover:bg-darcula-bg-lighter transition-colors"
            title="New Prompt"
            onClick={onNewPrompt}
          >
            + File
          </button>
          <button
            className="text-darcula-text-muted hover:text-darcula-text text-xs font-mono px-1.5 py-0.5 rounded-sm hover:bg-darcula-bg-lighter transition-colors"
            title="New Folder"
            onClick={() => setShowNewCategory(true)}
          >
            + Folder
          </button>
        </div>
      </div>

      {/* New Category Input */}
      {showNewCategory && (
        <div className="px-3 py-2 border-b border-darcula-border">
          <div className="flex items-center gap-1">
            <span className="text-darcula-keyword text-xs">{"\u25B6"}</span>
            <input
              className="flex-1 bg-darcula-bg text-darcula-text text-xs font-mono px-2 py-1 rounded-sm border border-darcula-accent outline-none"
              placeholder="Folder name\u2026"
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreateCategory();
                if (e.key === "Escape") {
                  setShowNewCategory(false);
                  setNewCategoryName("");
                }
              }}
              onBlur={() => {
                if (!newCategoryName.trim()) {
                  setShowNewCategory(false);
                }
              }}
              autoFocus
            />
          </div>
        </div>
      )}

      {/* Folder Tree */}
      <div
        className={`flex-1 overflow-y-auto py-1 transition-colors ${rootDropTarget ? "bg-darcula-accent/10" : ""}`}
        onDragOver={handleRootDragOver}
        onDragEnter={handleRootDragEnter}
        onDragLeave={handleRootDragLeave}
        onDrop={handleRootDrop}
      >
        <div className="px-3 py-1.5">
          <span className="text-2xs font-mono font-semibold text-darcula-text-muted uppercase tracking-wider">
            Folders
          </span>
        </div>
        {categories.map((cat) => (
          <TreeNode
            key={cat.id}
            category={cat}
            allPrompts={allPrompts}
            depth={0}
            selectedCategory={selectedCategory}
            onSelectCategory={onSelectCategory}
            onOpenSnippet={onOpenSnippet}
            onRenameCategory={onRenameCategory}
            onDeleteCategory={onDeleteCategory}
            onMovePrompt={onMovePrompt}
          />
        ))}

        {/* Uncategorized Items */}
        <UncategorizedFolder
          allPrompts={allPrompts}
          onOpenSnippet={onOpenSnippet}
        />
      </div>

      {/* Tag Cloud */}
      <div className="border-t border-darcula-border px-3 py-2">
        <span className="text-2xs font-mono font-semibold text-darcula-text-muted uppercase tracking-wider">
          Tags
        </span>
        <div className="flex flex-wrap gap-1.5 mt-2">
          {tags.map((tag) => (
            <button
              key={tag.id}
              onClick={() =>
                onSelectTag(activeTagFilter === tag.name ? null : tag.name)
              }
              className={`text-2xs font-mono px-1.5 py-0.5 rounded-sm transition-colors ${
                activeTagFilter === tag.name
                  ? "bg-darcula-accent text-white"
                  : "bg-darcula-bg text-darcula-text-muted hover:text-darcula-text hover:bg-darcula-bg-lighter"
              }`}
            >
              #{tag.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
