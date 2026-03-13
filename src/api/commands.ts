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

// ─── Embeddings ──────────────────────────────────────────────────

export interface StoredEmbedding {
  prompt_id: number;
  vector: number[];
  model: string;
  provider: string;
}

export async function saveEmbedding(
  promptId: number,
  vector: number[],
  model: string,
  provider: string
): Promise<boolean> {
  return call<boolean>("save_embedding", { promptId, vector, model, provider });
}

/**
 * Load all stored embeddings for a specific provider.
 *
 * Pass the provider name ("local", "gemini", or "voyage") to retrieve only
 * that provider's vectors.  Pass an empty string to retrieve every row.
 */
export async function getAllEmbeddings(provider: string = ""): Promise<StoredEmbedding[]> {
  return call<StoredEmbedding[]>("get_all_embeddings", { provider });
}

/**
 * Delete all stored embeddings for a specific provider.
 * Returns the number of rows deleted.
 */
export async function deleteEmbeddingsByProvider(provider: string): Promise<number> {
  return call<number>("delete_embeddings_by_provider", { provider });
}

// ─── Phase 6: SQL Vector Search ──────────────────────────────────

export interface VectorSearchResult {
  /** ID of the matching prompt. */
  prompt_id: number;
  /** Cosine similarity in [0, 1]; higher = more similar. */
  similarity: number;
}

/**
 * Perform a SQL-level cosine similarity search using sqlite-vec.
 *
 * Requires the sqlite-vec extension to be loaded (done automatically at
 * startup). If the extension failed to load, this will throw — the caller
 * should catch and fall back to JS-side cosine similarity.
 *
 * @param queryVector  Float32 embedding of the query text.
 * @param provider     Provider name matching stored embeddings ("local", "gemini", "claude").
 * @param topK         Maximum number of results to return (default 10).
 */
export async function vectorSearch(
  queryVector: number[],
  provider: string,
  topK: number = 10
): Promise<VectorSearchResult[]> {
  return call<VectorSearchResult[]>("vector_search", { queryVector, provider, topK });
}

// ─── Export ──────────────────────────────────────────────────────

/**
 * Export all prompts to a string in the requested format.
 *
 * @param format  `"json"` for a structured JSON document, or `"markdown"` for
 *                a human-readable Markdown file with one section per prompt.
 * @returns       The full export as a string — pass to a Blob to trigger a download.
 */
export async function getExportData(format: "json" | "markdown"): Promise<string> {
  return call<string>("get_export_data", { format });
}

// ─── Keyboard Shortcuts ───────────────────────────────────────────

export interface ShortcutsConfig {
  /** Open Command Palette  (default: ctrl+k) */
  command_palette: string;
  /** Create new prompt      (default: ctrl+n) */
  new_prompt: string;
  /** Open Brain Selector    (default: ctrl+b) */
  brain_selector: string;
  /** Toggle Inspector panel (default: ctrl+i) */
  toggle_inspector: string;
  /** Open Sync Panel        (default: ctrl+shift+s) */
  sync_panel: string;
  /** Open Export Dialog     (default: ctrl+shift+e) */
  export: string;
  /** Open Shortcuts dialog  (default: ctrl+,) */
  shortcuts: string;
}

export const DEFAULT_SHORTCUTS: ShortcutsConfig = {
  command_palette: "ctrl+k",
  new_prompt: "ctrl+n",
  brain_selector: "ctrl+b",
  toggle_inspector: "ctrl+i",
  sync_panel: "ctrl+shift+s",
  export: "ctrl+shift+e",
  shortcuts: "ctrl+,",
};

/**
 * Load the persisted keyboard shortcuts configuration.
 * Returns defaults if no configuration has been saved.
 */
export async function getShortcuts(): Promise<ShortcutsConfig> {
  return call<ShortcutsConfig>("get_shortcuts");
}

/**
 * Persist the keyboard shortcuts configuration to disk.
 */
export async function saveShortcuts(config: ShortcutsConfig): Promise<boolean> {
  return call<boolean>("save_shortcuts", { config });
}

// ─── Sync ────────────────────────────────────────────────────────

export interface SyncConfig {
  enabled: boolean;
  client_id: string;
  client_secret: string;
  access_token: string | null;
  refresh_token: string | null;
  token_expiry: number | null;
  remote_file_id: string | null;
  last_sync: string | null;
  sync_status: string | { Error: string };
  /** Whether the periodic background sync worker should run. */
  auto_sync_enabled: boolean;
  /** How often the worker uploads, in minutes (5 / 15 / 30 / 60). */
  auto_sync_interval_mins: number;
  /** Whether team/shared-vault mode is active. */
  team_mode: boolean;
  /** Drive File ID of the shared team vault. */
  team_file_id: string | null;
}

export function isSyncConnected(config: SyncConfig): boolean {
  return config.sync_status === "Connected" || config.sync_status === "Synced";
}

export function isSyncError(config: SyncConfig): boolean {
  return (
    typeof config.sync_status === "object" && "Error" in config.sync_status
  );
}

export function getSyncStatusLabel(config: SyncConfig): string {
  if (typeof config.sync_status === "object" && "Error" in config.sync_status) {
    return `Error: ${config.sync_status.Error}`;
  }
  return String(config.sync_status);
}

/**
 * Start the Google Drive OAuth 2.0 flow (personal mode — appDataFolder scope).
 *
 * Saves credentials, spawns a one-shot localhost:8741 callback listener,
 * and returns the Google authorization URL to open in the system browser.
 *
 * After calling this, poll `getSyncConfig()` until sync_status is "Connected".
 */
export async function startOAuthFlow(
  clientId: string,
  clientSecret: string
): Promise<string> {
  return call<string>("start_oauth_flow", { clientId, clientSecret });
}

/**
 * Start the Google Drive OAuth 2.0 flow in team mode (drive.file scope).
 *
 * Team mode creates files in the user's regular Drive root (not the hidden
 * appDataFolder), making them shareable with teammates via Google Drive's
 * sharing UI.
 *
 * After the user completes sign-in, call `syncToDrive()` to upload the vault
 * and receive the team file ID — then share that ID with teammates.
 */
export async function startTeamOAuthFlow(
  clientId: string,
  clientSecret: string
): Promise<string> {
  return call<string>("start_team_oauth_flow", { clientId, clientSecret });
}

/**
 * Connect this device to an existing shared team vault.
 *
 * The user must already be authenticated before calling this.  After calling,
 * `syncToDrive()` will read/write the specified team file.
 *
 * @param fileId  Drive File ID shared by the vault creator.
 */
export async function connectTeamVault(fileId: string): Promise<boolean> {
  return call<boolean>("connect_team_vault", { fileId });
}

export async function getSyncConfig(): Promise<SyncConfig> {
  return call<SyncConfig>("get_sync_config");
}

export async function updateSyncConfig(config: SyncConfig): Promise<boolean> {
  return call<boolean>("update_sync_config", { config });
}

export async function getAuthUrl(): Promise<string> {
  return call<string>("get_auth_url");
}

export async function exchangeAuthCode(code: string): Promise<boolean> {
  return call<boolean>("exchange_auth_code", { code });
}

export async function syncToDrive(): Promise<boolean> {
  return call<boolean>("sync_to_drive");
}

export async function checkSyncStatus(): Promise<string | null> {
  return call<string | null>("check_sync_status");
}

/**
 * Enable or disable the periodic background sync worker.
 *
 * @param enabled       Whether to run the worker.
 * @param intervalMins  Upload interval in minutes (5 / 15 / 30 / 60).
 */
export async function setAutoSync(
  enabled: boolean,
  intervalMins: number
): Promise<boolean> {
  return call<boolean>("set_auto_sync", { enabled, intervalMins });
}

// ─── Conflict Resolution ─────────────────────────────────────────

/** Returned by `getConflictInfo` when the remote DB is newer than local. */
export interface ConflictInfo {
  /** ISO 8601 timestamp of the remote file's last modification. */
  remote_modified: string;
  /** ISO 8601 timestamp of our last sync, or null if we've never synced. */
  local_last_sync: string | null;
  /** Always true when this object is returned (remote has unseen changes). */
  remote_is_newer: boolean;
}

/** Returned by `resolveConflict`. `data_replaced: true` means the local DB
 *  was overwritten with the remote and the frontend must reload all data. */
export interface ResolveResult {
  data_replaced: boolean;
}

/**
 * Check whether the remote database is newer than the local one.
 *
 * Returns `ConflictInfo` when a conflict exists, `null` when local is
 * up-to-date (or the user is not connected to Drive).
 *
 * Call this on app startup after confirming the user is connected.
 */
export async function getConflictInfo(): Promise<ConflictInfo | null> {
  return call<ConflictInfo | null>("get_conflict_info");
}

/**
 * Resolve a sync conflict.
 *
 * @param strategy
 *   - `"accept_newest"` — last-write-wins: pulls remote if it's newer,
 *     pushes local if local is newer.
 *   - `"keep_local"` — unconditionally push local, overwriting the remote.
 *
 * When `result.data_replaced` is `true`, the frontend must reload all data
 * (prompts, categories, tags) because the in-memory state is stale.
 */
export async function resolveConflict(
  strategy: "accept_newest" | "keep_local"
): Promise<ResolveResult> {
  return call<ResolveResult>("resolve_conflict", { strategy });
}

// ─── Encryption ──────────────────────────────────────────────────

export interface DbLockStatus {
  /** True when the DB is encrypted (salt file exists). */
  encrypted: boolean;
  /** True when the key has been applied this session — always true if not encrypted. */
  unlocked: boolean;
}

/**
 * Check whether the database is encrypted and, if so, whether it is currently
 * unlocked. Call this once on startup to determine whether to show the
 * UnlockDialog.
 */
export async function getDbLockStatus(): Promise<DbLockStatus> {
  return call<DbLockStatus>("get_db_lock_status");
}

/**
 * Unlock an encrypted database using the master password.
 *
 * Derives the key from the stored salt + password (Argon2id) and applies it
 * to the live SQLite connection. Returns `true` on success, throws on wrong
 * password.
 */
export async function unlockDatabase(password: string): Promise<boolean> {
  return call<boolean>("unlock_database", { password });
}

/**
 * Set, change, or remove the master password.
 *
 * | `current`      | `newPassword`  | Effect                                    |
 * |----------------|----------------|-------------------------------------------|
 * | `null`         | `"pw"`         | Enable encryption on a plaintext DB       |
 * | `"old"`        | `"new"`        | Change the password                       |
 * | `"old"`        | `null`         | Remove encryption                         |
 *
 * Throws if `current` is wrong or missing when the DB is already encrypted.
 */
export async function setDbPassword(
  current: string | null,
  newPassword: string | null
): Promise<boolean> {
  return call<boolean>("set_db_password", { current, newPassword });
}