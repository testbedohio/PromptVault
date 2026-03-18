import { useState, useEffect, useCallback, useRef } from "react";
import * as api from "../api/commands";
import type {
  Prompt,
  Category,
  CategoryTree,
  Tag,
  PromptVersion,
  CreatePromptInput,
} from "../types";

// ─── Environment Detection ───────────────────────────────────────

/** Returns true when running inside Tauri, false in browser dev mode */
function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

// ─── Sample Data (browser fallback) ─────────────────────────────

const SAMPLE_CATEGORIES: Category[] = [
  { id: 1, name: "System Prompts", parent_id: null, created_at: "2025-03-01T00:00:00Z" },
  { id: 4, name: "Assistants", parent_id: 1, created_at: "2025-03-01T00:00:00Z" },
  { id: 5, name: "Agents", parent_id: 1, created_at: "2025-03-01T00:00:00Z" },
  { id: 2, name: "Code Snippets", parent_id: null, created_at: "2025-03-01T00:00:00Z" },
  { id: 3, name: "Templates", parent_id: null, created_at: "2025-03-01T00:00:00Z" },
];

const SAMPLE_PROMPTS: Prompt[] = [
  {
    id: 1,
    title: "code_review_agent.md",
    content:
      '# Code Review Agent\n\nYou are a senior software engineer conducting a thorough code review.\n\n## Guidelines\n- Check for **security vulnerabilities**\n- Ensure proper error handling\n- Verify naming conventions\n\n```python\ndef review(code: str) -> dict:\n    """Analyze code and return findings."""\n    findings = []\n    # Analysis logic here\n    return {"findings": findings, "score": 0.85}\n```',
    category_id: 1,
    icon: "robot",
    tags: ["python", "claude", "system"],
    created_at: "2025-03-10T14:30:00Z",
    updated_at: "2025-03-12T09:15:00Z",
  },
  {
    id: 2,
    title: "sql_optimizer.md",
    content:
      "# SQL Query Optimizer\n\nAnalyze the following SQL query and suggest optimizations.\n\nFocus on:\n- Index usage\n- JOIN efficiency\n- Subquery elimination",
    category_id: 2,
    icon: "database",
    tags: ["sql", "gpt-4"],
    created_at: "2025-03-08T10:00:00Z",
    updated_at: "2025-03-11T16:45:00Z",
  },
  {
    id: 3,
    title: "few_shot_classifier.md",
    content:
      '# Few-Shot Classification Prompt\n\nClassify the following text into one of these categories: [Bug, Feature, Question]\n\n## Examples\n- "The app crashes on login" → Bug\n- "Can we add dark mode?" → Feature\n- "How do I export data?" → Question\n\n## Input\n{user_input}',
    category_id: 3,
    icon: "lightbulb",
    tags: ["few-shot", "chain-of-thought"],
    created_at: "2025-03-05T08:20:00Z",
    updated_at: "2025-03-10T11:30:00Z",
  },
];

const SAMPLE_TAGS: Tag[] = [
  { id: 1, name: "python" },
  { id: 2, name: "javascript" },
  { id: 3, name: "sql" },
  { id: 4, name: "gpt-4" },
  { id: 5, name: "claude" },
  { id: 6, name: "chain-of-thought" },
  { id: 7, name: "few-shot" },
  { id: 8, name: "system" },
];

// ─── Tree Builder ────────────────────────────────────────────────

function buildCategoryTree(flat: Category[]): CategoryTree[] {
  const map = new Map<number, CategoryTree>();
  const roots: CategoryTree[] = [];

  for (const cat of flat) {
    map.set(cat.id, { ...cat, children: [] });
  }

  for (const cat of flat) {
    const node = map.get(cat.id)!;
    if (cat.parent_id && map.has(cat.parent_id)) {
      map.get(cat.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

// ─── useAppData Hook ─────────────────────────────────────────────

export function useAppData() {
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [categories, setCategories] = useState<CategoryTree[]>([]);
  const [flatCategories, setFlatCategories] = useState<Category[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dbConnected, setDbConnected] = useState(false);

  const tauri = isTauri();

  // Initial data load
  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);

    if (!tauri) {
      // Browser fallback — use sample data
      setFlatCategories(SAMPLE_CATEGORIES);
      setCategories(buildCategoryTree(SAMPLE_CATEGORIES));
      setPrompts(SAMPLE_PROMPTS);
      setTags(SAMPLE_TAGS);
      setDbConnected(false);
      setLoading(false);
      return;
    }

    try {
      const [cats, proms, tgs] = await Promise.all([
        api.getCategories(),
        api.getPrompts(),
        api.getAllTags(),
      ]);

      setFlatCategories(cats);
      setCategories(buildCategoryTree(cats));
      setPrompts(proms);
      setTags(tgs);
      setDbConnected(true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      console.error("Failed to load data:", msg);
      // Fall back to sample data
      setFlatCategories(SAMPLE_CATEGORIES);
      setCategories(buildCategoryTree(SAMPLE_CATEGORIES));
      setPrompts(SAMPLE_PROMPTS);
      setTags(SAMPLE_TAGS);
      setDbConnected(false);
    } finally {
      setLoading(false);
    }
  }, [tauri]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // ── CRUD Operations ────────────────────────────────────────────

  const addPrompt = useCallback(
    async (input: CreatePromptInput): Promise<Prompt | null> => {
      if (!tauri) {
        // Browser mock
        const mock: Prompt = {
          id: Date.now(),
          title: input.title,
          content: input.content,
          category_id: input.category_id,
          icon: null,
          tags: input.tags,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        setPrompts((prev) => [mock, ...prev]);
        return mock;
      }

      try {
        const prompt = await api.createPrompt(input);
        setPrompts((prev) => [prompt, ...prev]);
        // Refresh tags in case new ones were created
        const newTags = await api.getAllTags();
        setTags(newTags);
        return prompt;
      } catch (e) {
        console.error("Failed to create prompt:", e);
        return null;
      }
    },
    [tauri]
  );

  const savePrompt = useCallback(
    async (
      id: number,
      updates: { title?: string; content?: string; category_id?: number | null; tags?: string[]; icon?: string | null }
    ): Promise<Prompt | null> => {
      if (!tauri) {
        setPrompts((prev) =>
          prev.map((p) =>
            p.id === id
              ? {
                  ...p,
                  ...updates,
                  tags: updates.tags ?? p.tags,
                  updated_at: new Date().toISOString(),
                }
              : p
          )
        );
        return prompts.find((p) => p.id === id) ?? null;
      }

      try {
        const prompt = await api.updatePrompt({ id, ...updates });
        setPrompts((prev) => prev.map((p) => (p.id === id ? prompt : p)));
        if (updates.tags) {
          const newTags = await api.getAllTags();
          setTags(newTags);
        }
        return prompt;
      } catch (e) {
        console.error("Failed to save prompt:", e);
        return null;
      }
    },
    [tauri, prompts]
  );

  const removePrompt = useCallback(
    async (id: number): Promise<boolean> => {
      // Always remove from local state immediately for responsive UI
      setPrompts((prev) => prev.filter((p) => p.id !== id));

      if (!tauri) return true;

      try {
        await api.deletePrompt(id);
        return true;
      } catch (e) {
        console.error("Failed to delete prompt:", e);
        // Re-fetch to restore consistency if backend delete failed
        try {
          const proms = await api.getPrompts();
          setPrompts(proms);
        } catch { /* ignore */ }
        return false;
      }
    },
    [tauri]
  );

  const addCategory = useCallback(
    async (name: string, parentId: number | null = null): Promise<Category | null> => {
      if (!tauri) {
        const mock: Category = {
          id: Date.now(),
          name,
          parent_id: parentId,
          created_at: new Date().toISOString(),
        };
        setFlatCategories((prev) => {
          const next = [...prev, mock];
          setCategories(buildCategoryTree(next));
          return next;
        });
        return mock;
      }

      try {
        const cat = await api.createCategory(name, parentId);
        const cats = await api.getCategories();
        setFlatCategories(cats);
        setCategories(buildCategoryTree(cats));
        return cat;
      } catch (e) {
        console.error("Failed to create category:", e);
        return null;
      }
    },
    [tauri]
  );

  const renameCategory = useCallback(
    async (id: number, name: string): Promise<boolean> => {
      if (!tauri) {
        setFlatCategories((prev) => {
          const next = prev.map((c) => (c.id === id ? { ...c, name } : c));
          setCategories(buildCategoryTree(next));
          return next;
        });
        return true;
      }

      try {
        await api.renameCategory(id, name);
        const cats = await api.getCategories();
        setFlatCategories(cats);
        setCategories(buildCategoryTree(cats));
        return true;
      } catch (e) {
        console.error("Failed to rename category:", e);
        return false;
      }
    },
    [tauri]
  );

  const deleteCategory = useCallback(
    async (id: number): Promise<boolean> => {
      if (!tauri) {
        setFlatCategories((prev) => {
          const next = prev.filter((c) => c.id !== id);
          setCategories(buildCategoryTree(next));
          return next;
        });
        setPrompts((prev) =>
          prev.map((p) => (p.category_id === id ? { ...p, category_id: null } : p))
        );
        return true;
      }

      try {
        await api.deleteCategory(id);
        const [cats, proms] = await Promise.all([
          api.getCategories(),
          api.getPrompts(),
        ]);
        setFlatCategories(cats);
        setCategories(buildCategoryTree(cats));
        setPrompts(proms);
        return true;
      } catch (e) {
        console.error("Failed to delete category:", e);
        return false;
      }
    },
    [tauri]
  );

  const searchPromptsLocal = useCallback(
    async (query: string): Promise<Prompt[]> => {
      if (!query.trim()) return prompts;

      if (!tauri) {
        const q = query.toLowerCase();
        return prompts.filter(
          (p) =>
            p.title.toLowerCase().includes(q) ||
            p.content.toLowerCase().includes(q) ||
            p.tags.some((t) => t.toLowerCase().includes(q))
        );
      }

      try {
        return await api.searchPrompts(query);
      } catch {
        // Fallback to client-side filter
        const q = query.toLowerCase();
        return prompts.filter(
          (p) =>
            p.title.toLowerCase().includes(q) ||
            p.content.toLowerCase().includes(q) ||
            p.tags.some((t) => t.toLowerCase().includes(q))
        );
      }
    },
    [tauri, prompts]
  );

  return {
    prompts,
    categories,
    flatCategories,
    tags,
    loading,
    error,
    dbConnected,
    tauri,
    reload: loadData,
    addPrompt,
    savePrompt,
    removePrompt,
    addCategory,
    renameCategory,
    deleteCategory,
    searchPrompts: searchPromptsLocal,
  };
}

// ─── useVersions Hook ────────────────────────────────────────────

export function useVersions(promptId: number | null) {
  const [versions, setVersions] = useState<PromptVersion[]>([]);
  const [loading, setLoading] = useState(false);
  const tauri = isTauri();

  useEffect(() => {
    if (!promptId) {
      setVersions([]);
      return;
    }

    if (!tauri) {
      // Browser mock
      setVersions([
        {
          id: 3,
          prompt_id: promptId,
          content_text: "Current version",
          version_number: 3,
          created_at: new Date().toISOString(),
        },
        {
          id: 2,
          prompt_id: promptId,
          content_text: "Added examples",
          version_number: 2,
          created_at: new Date(Date.now() - 86400000).toISOString(),
        },
        {
          id: 1,
          prompt_id: promptId,
          content_text: "Initial draft",
          version_number: 1,
          created_at: new Date(Date.now() - 172800000).toISOString(),
        },
      ]);
      return;
    }

    setLoading(true);
    api
      .getPromptVersions(promptId)
      .then(setVersions)
      .catch((e) => console.error("Failed to load versions:", e))
      .finally(() => setLoading(false));
  }, [promptId, tauri]);

  return { versions, loading };
}

// ─── useDebounce Hook ────────────────────────────────────────────

export function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}

// ─── useAutoSave Hook ────────────────────────────────────────────

export function useAutoSave(
  promptId: number | null,
  content: string,
  save: (id: number, updates: { content: string }) => Promise<unknown>,
  delay: number = 1500
) {
  const debouncedContent = useDebounce(content, delay);
  const lastSaved = useRef<string>("");
  const [saving, setSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);

  useEffect(() => {
    if (!promptId) return;
    if (debouncedContent === lastSaved.current) return;
    if (!debouncedContent.trim()) return;

    setSaving(true);
    save(promptId, { content: debouncedContent })
      .then(() => {
        lastSaved.current = debouncedContent;
        setLastSavedAt(new Date());
      })
      .finally(() => setSaving(false));
  }, [promptId, debouncedContent, save]);

  // Reset ref when prompt changes
  useEffect(() => {
    lastSaved.current = content;
  }, [promptId]);

  return { saving, lastSavedAt };
}