// ─── Database Models ─────────────────────────────────────────────
// These mirror the Rust structs in src-tauri/src/db.rs

export interface Category {
  id: number;
  name: string;
  parent_id: number | null;
  created_at: string;
}

export interface CategoryTree extends Category {
  children: CategoryTree[];
}

export interface Tag {
  id: number;
  name: string;
}

export interface Prompt {
  id: number;
  title: string;
  content: string;
  category_id: number | null;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface PromptVersion {
  id: number;
  prompt_id: number;
  content_text: string;
  version_number: number;
  created_at: string;
}

// ─── API Payloads ────────────────────────────────────────────────

export interface CreatePromptInput {
  title: string;
  content: string;
  category_id: number | null;
  tags: string[];
}

export interface UpdatePromptInput {
  id: number;
  title?: string;
  content?: string;
  category_id?: number | null;
  tags?: string[];
}

// ─── API Response Wrapper ────────────────────────────────────────
// Matches the Rust ApiResult<T> struct

export interface ApiResult<T> {
  success: boolean;
  data: T | null;
  error: string | null;
}