interface Snippet {
  id: number;
  title: string;
  content: string;
  categoryId: number | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

interface InspectorProps {
  snippet: Snippet | null;
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
  return (
    <details open={defaultOpen} className="group">
      <summary className="flex items-center gap-2 px-3 py-2 cursor-pointer select-none border-b border-darcula-border hover:bg-darcula-bg-lighter transition-colors">
        <span className="text-2xs text-darcula-text-muted group-open:rotate-90 transition-transform">
          ▶
        </span>
        <span className="text-xs font-mono font-semibold text-darcula-text-muted uppercase tracking-wider">
          {title}
        </span>
      </summary>
      <div className="px-3 py-2 border-b border-darcula-border">
        {children}
      </div>
    </details>
  );
}

function MetadataRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-start py-1">
      <span className="text-2xs font-mono text-darcula-text-muted">
        {label}
      </span>
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

export default function Inspector({ snippet }: InspectorProps) {
  if (!snippet) {
    return (
      <div className="flex flex-col h-full bg-darcula-bg-light">
        <div className="flex items-center px-3 py-2 border-b border-darcula-border">
          <span className="text-xs font-mono font-semibold text-darcula-text-muted uppercase tracking-wider">
            Inspector
          </span>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <span className="text-xs text-darcula-text-muted font-mono">
            No selection
          </span>
        </div>
      </div>
    );
  }

  const wordCount = snippet.content.split(/\s+/).filter(Boolean).length;
  const charCount = snippet.content.length;
  const lineCount = snippet.content.split("\n").length;

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
        <MetadataRow label="Created" value={formatDate(snippet.createdAt)} />
        <MetadataRow label="Modified" value={formatDate(snippet.updatedAt)} />
        <MetadataRow label="Words" value={String(wordCount)} />
        <MetadataRow label="Characters" value={String(charCount)} />
        <MetadataRow label="Lines" value={String(lineCount)} />
      </Section>

      {/* Tags */}
      <Section title="Tags">
        <div className="flex flex-wrap gap-1.5">
          {snippet.tags.map((tag) => (
            <span
              key={tag}
              className="text-2xs font-mono px-1.5 py-0.5 rounded-sm bg-darcula-bg text-darcula-accent-bright"
            >
              #{tag}
            </span>
          ))}
          <button className="text-2xs font-mono px-1.5 py-0.5 rounded-sm bg-darcula-bg text-darcula-text-muted hover:text-darcula-text transition-colors">
            + add
          </button>
        </div>
      </Section>

      {/* Version History */}
      <Section title="History" defaultOpen={false}>
        <div className="space-y-1.5">
          {[
            { version: 3, date: snippet.updatedAt, label: "Current" },
            {
              version: 2,
              date: "2025-03-11T14:00:00Z",
              label: "Added examples",
            },
            {
              version: 1,
              date: snippet.createdAt,
              label: "Initial draft",
            },
          ].map((v) => (
            <div
              key={v.version}
              className="flex items-center gap-2 py-1 px-1 rounded-sm hover:bg-darcula-bg-lighter cursor-pointer transition-colors"
            >
              <span className="text-2xs font-mono text-darcula-number w-5">
                v{v.version}
              </span>
              <span className="text-2xs font-mono text-darcula-text truncate flex-1">
                {v.label}
              </span>
              <span className="text-2xs font-mono text-darcula-text-muted">
                {new Date(v.date).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                })}
              </span>
            </div>
          ))}
        </div>
      </Section>

      {/* Sync Status */}
      <Section title="Sync">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-darcula-success" />
          <span className="text-2xs font-mono text-darcula-text">
            Synced to Google Drive
          </span>
        </div>
        <div className="mt-1.5">
          <MetadataRow
            label="Last sync"
            value={formatDate(snippet.updatedAt)}
          />
        </div>
      </Section>
    </div>
  );
}