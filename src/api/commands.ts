import { invoke } from "@tauri-apps/api/core";
import type {
  ApiResult,
  Category,
  Prompt,
  PromptVersion,
  Tag,
  CreatePromptInput,
  UpdatePromptInput,
} from "../types";

// ─── Helpers ─────────────────────────────────────────────────────

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const result = await invoke<ApiResult<T>>(command, args);
  if (!result.success || result.data === null) {
    throw new Error(result.error ?? `Command "${command}" failed`);
  }
  return result.data;
}

// ─── Categories ──────────────────────────────────────────────────

export async function getCategories(): Promise<Category[]> {
  return call<Category[]>("get_categories");
}

export async function createCategory(
  name: string,
  parentId: number | null = null
): Promise<Category> {
  return call<Category>("create_category", { name, parentId });
}

// ─── Prompts ─────────────────────────────────────────────────────

export async function getPrompts(): Promise<Prompt[]> {
  return call<Prompt[]>("get_prompts");
}

export async function getPromptById(id: number): Promise<Prompt> {
  return call<Prompt>("get_prompt_by_id", { id });
}

export async function createPrompt(input: CreatePromptInput): Promise<Prompt> {
  return call<Prompt>("create_prompt", { input });
}

export async function updatePrompt(input: UpdatePromptInput): Promise<Prompt> {
  return call<Prompt>("update_prompt", { input });
}

export async function deletePrompt(id: number): Promise<boolean> {
  return call<boolean>("delete_prompt", { id });
}

// ─── Versions ────────────────────────────────────────────────────

export async function getPromptVersions(promptId: number): Promise<PromptVersion[]> {
  return call<PromptVersion[]>("get_prompt_versions", { promptId });
}

// ─── Tags ────────────────────────────────────────────────────────

export async function getAllTags(): Promise<Tag[]> {
  return call<Tag[]>("get_all_tags");
}

// ─── Search ──────────────────────────────────────────────────────

export async function searchPrompts(query: string): Promise<Prompt[]> {
  return call<Prompt[]>("search_prompts", { query });
}