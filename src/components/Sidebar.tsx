import { useState } from "react";

interface Category {
  id: number;
  name: string;
  parentId: number | null;
  children: Category[];
}

interface Snippet {
  id: number;
  title: string;
  content: string;
  categoryId: number | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

interface SidebarProps {
  categories: Category[];
  tags: string[];
  snippets: Snippet[];
  selectedCategory: number | null;
  onSelectCategory: (id: number | null) => void;
  onOpenSnippet: (id: number) => void;
}

function FolderIcon({ open }: { open: boolean }) {
  return (
    <span className="text-darcula-keyword text-xs">
      {open ? "▼" : "▶"}
    </span>
  );
}

function FileIcon() {
  return <span className="text-darcula-string text-xs">◇</span>;
}

function TreeNode({
  category,
  snippets,
  depth,
  selectedCategory,
  onSelectCategory,
  onOpenSnippet,
}: {
  category: Category;
  snippets: Snippet[];
  depth: number;
  selectedCategory: number | null;
  onSelectCategory: (id: number | null) => void;
  onOpenSnippet: (id: number) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const categorySnippets = snippets.filter(
    (s) => s.categoryId === category.id
  );
  const isSelected = selectedCategory === category.id;

  return (
    <div>
      <div
        className={`tree-item ${isSelected ? "active" : ""}`}
        style={{ paddingLeft: `${12 + depth * 16}px` }}
        onClick={() => {
          setExpanded(!expanded);
          onSelectCategory(isSelected ? null : category.id);
        }}
      >
        <FolderIcon open={expanded} />
        <span className="truncate">{category.name}</span>
        <span className="ml-auto text-2xs text-darcula-text-muted">
          {categorySnippets.length}
        </span>
      </div>

      {expanded && (
        <>
          {category.children.map((child) => (
            <TreeNode
              key={child.id}
              category={child}
              snippets={snippets}
              depth={depth + 1}
              selectedCategory={selectedCategory}
              onSelectCategory={onSelectCategory}
              onOpenSnippet={onOpenSnippet}
            />
          ))}
          {categorySnippets.map((snippet) => (
            <div
              key={snippet.id}
              className="tree-item"
              style={{ paddingLeft: `${28 + depth * 16}px` }}
              onClick={() => onOpenSnippet(snippet.id)}
            >
              <FileIcon />
              <span className="truncate text-darcula-text-bright text-xs">
                {snippet.title}
              </span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

export default function Sidebar({
  categories,
  tags,
  snippets,
  selectedCategory,
  onSelectCategory,
  onOpenSnippet,
}: SidebarProps) {
  const [activeTagFilter, setActiveTagFilter] = useState<string | null>(null);

  return (
    <div className="flex flex-col h-full bg-darcula-bg-light overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-darcula-border">
        <span className="text-xs font-mono font-semibold text-darcula-text-muted uppercase tracking-wider">
          Explorer
        </span>
        <button
          className="text-darcula-text-muted hover:text-darcula-text text-sm transition-colors"
          title="New Folder"
        >
          +
        </button>
      </div>

      {/* Folder Tree */}
      <div className="flex-1 overflow-y-auto py-1">
        <div className="px-3 py-1.5">
          <span className="text-2xs font-mono font-semibold text-darcula-text-muted uppercase tracking-wider">
            Folders
          </span>
        </div>
        {categories.map((cat) => (
          <TreeNode
            key={cat.id}
            category={cat}
            snippets={snippets}
            depth={0}
            selectedCategory={selectedCategory}
            onSelectCategory={onSelectCategory}
            onOpenSnippet={onOpenSnippet}
          />
        ))}
      </div>

      {/* Tag Cloud */}
      <div className="border-t border-darcula-border px-3 py-2">
        <span className="text-2xs font-mono font-semibold text-darcula-text-muted uppercase tracking-wider">
          Tags
        </span>
        <div className="flex flex-wrap gap-1.5 mt-2">
          {tags.map((tag) => (
            <button
              key={tag}
              onClick={() =>
                setActiveTagFilter(activeTagFilter === tag ? null : tag)
              }
              className={`text-2xs font-mono px-1.5 py-0.5 rounded-sm transition-colors ${
                activeTagFilter === tag
                  ? "bg-darcula-accent text-white"
                  : "bg-darcula-bg text-darcula-text-muted hover:text-darcula-text hover:bg-darcula-bg-lighter"
              }`}
            >
              #{tag}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}