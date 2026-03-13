mod db;
mod sync;

use db::{Database, Prompt, PromptVersion, Category, Tag, StoredEmbedding, VectorSearchResult};
use sync::{DriveSync, SyncConfig, SyncStatus};
use chrono::DateTime;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::{Arc, Mutex as StdMutex, atomic::{AtomicBool, Ordering}};
use tokio::sync::{watch, Mutex as TokioMutex};
use tokio::time::{sleep, Duration};
use tauri::State;

// ─── Background Sync Worker ───────────────────────────────────────────────────

#[derive(Clone, Debug)]
struct SyncWorkerCtl {
    enabled: bool,
    interval_secs: u64,
}

async fn run_sync_worker(
    sync: Arc<TokioMutex<DriveSync>>,
    db_path: String,
    mut ctl_rx: watch::Receiver<SyncWorkerCtl>,
) {
    loop {
        let ctl = ctl_rx.borrow().clone();

        if !ctl.enabled || ctl.interval_secs == 0 {
            if ctl_rx.changed().await.is_err() {
                break;
            }
            continue;
        }

        let sleep_fut = sleep(Duration::from_secs(ctl.interval_secs));
        tokio::select! {
            _ = sleep_fut => {
                let mut sync_guard = sync.lock().await;
                let status = sync_guard.get_config().sync_status.clone();
                let is_ready = matches!(status, SyncStatus::Connected | SyncStatus::Synced);

                if is_ready {
                    if let Err(e) = sync_guard.upload_db(&db_path).await {
                        eprintln!("[PromptVault] Background sync failed: {}", e);
                    }
                }
            }
            _ = ctl_rx.changed() => {
                continue;
            }
        }
    }
}

// ─── App State ────────────────────────────────────────────────────────────────

struct AppState {
    db: StdMutex<Database>,
    sync: Arc<TokioMutex<DriveSync>>,
    db_path: String,
    sync_worker_tx: Arc<watch::Sender<SyncWorkerCtl>>,
    db_locked: Arc<AtomicBool>,
}

// ─── Crypto Helpers ───────────────────────────────────────────────────────────

fn salt_path() -> PathBuf {
    let mut p = dirs::data_local_dir().unwrap_or_else(|| PathBuf::from("."));
    p.push("PromptVault");
    std::fs::create_dir_all(&p).ok();
    p.push("db.salt");
    p
}

fn is_encrypted_on_disk() -> bool {
    salt_path().exists()
}

fn bytes_to_hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{:02x}", x)).collect()
}

fn derive_key(password: &str, salt: &[u8]) -> Result<String, String> {
    use argon2::{Argon2, Algorithm, Version, Params};
    let params = Params::new(65536, 3, 4, Some(32))
        .map_err(|e| e.to_string())?;
    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut key = [0u8; 32];
    argon2.hash_password_into(password.as_bytes(), salt, &mut key)
        .map_err(|e| e.to_string())?;
    Ok(bytes_to_hex(&key))
}

fn load_salt() -> Result<Vec<u8>, String> {
    let hex = std::fs::read_to_string(salt_path()).map_err(|e| e.to_string())?;
    let clean = hex.trim();
    (0..clean.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&clean[i..i+2], 16).map_err(|e| e.to_string()))
        .collect()
}

fn create_salt() -> Result<Vec<u8>, String> {
    let mut salt = vec![0u8; 32];
    getrandom::getrandom(&mut salt).map_err(|e| e.to_string())?;
    std::fs::write(salt_path(), bytes_to_hex(&salt)).map_err(|e| e.to_string())?;
    Ok(salt)
}

// ─── Response Wrappers ───────────────────────────────────────────

#[derive(Serialize)]
struct ApiResult<T: Serialize> {
    success: bool,
    data: Option<T>,
    error: Option<String>,
}

fn ok<T: Serialize>(data: T) -> ApiResult<T> {
    ApiResult { success: true, data: Some(data), error: None }
}

fn err<T: Serialize>(msg: &str) -> ApiResult<T> {
    ApiResult { success: false, data: None, error: Some(msg.to_string()) }
}

// ─── Tauri Commands ──────────────────────────────────────────────

// -- Categories --

#[tauri::command]
fn get_categories(state: State<AppState>) -> ApiResult<Vec<Category>> {
    match state.db.lock().unwrap().get_categories() {
        Ok(cats) => ok(cats),
        Err(e) => err(&e.to_string()),
    }
}

#[tauri::command]
fn create_category(name: String, parent_id: Option<i64>, state: State<AppState>) -> ApiResult<Category> {
    match state.db.lock().unwrap().create_category(&name, parent_id) {
        Ok(cat) => ok(cat),
        Err(e) => err(&e.to_string()),
    }
}

// -- Prompts --

#[tauri::command]
fn get_prompts(state: State<AppState>) -> ApiResult<Vec<Prompt>> {
    match state.db.lock().unwrap().get_prompts() {
        Ok(prompts) => ok(prompts),
        Err(e) => err(&e.to_string()),
    }
}

#[tauri::command]
fn get_prompt_by_id(id: i64, state: State<AppState>) -> ApiResult<Prompt> {
    match state.db.lock().unwrap().get_prompt_by_id(id) {
        Ok(prompt) => ok(prompt),
        Err(e) => err(&e.to_string()),
    }
}

#[derive(Deserialize)]
struct CreatePromptInput {
    title: String,
    content: String,
    category_id: Option<i64>,
    tags: Vec<String>,
}

#[tauri::command]
fn create_prompt(input: CreatePromptInput, state: State<AppState>) -> ApiResult<Prompt> {
    let db = state.db.lock().unwrap();
    match db.create_prompt(&input.title, &input.content, input.category_id, &input.tags) {
        Ok(prompt) => ok(prompt),
        Err(e) => err(&e.to_string()),
    }
}

#[derive(Deserialize)]
struct UpdatePromptInput {
    id: i64,
    title: Option<String>,
    content: Option<String>,
    category_id: Option<i64>,
    tags: Option<Vec<String>>,
}

#[tauri::command]
fn update_prompt(input: UpdatePromptInput, state: State<AppState>) -> ApiResult<Prompt> {
    let db = state.db.lock().unwrap();
    match db.update_prompt(input.id, input.title.as_deref(), input.content.as_deref(), input.category_id, input.tags.as_deref()) {
        Ok(prompt) => ok(prompt),
        Err(e) => err(&e.to_string()),
    }
}

#[tauri::command]
fn delete_prompt(id: i64, state: State<AppState>) -> ApiResult<bool> {
    match state.db.lock().unwrap().delete_prompt(id) {
        Ok(_) => ok(true),
        Err(e) => err(&e.to_string()),
    }
}

// -- Version History --

#[tauri::command]
fn get_prompt_versions(prompt_id: i64, state: State<AppState>) -> ApiResult<Vec<PromptVersion>> {
    match state.db.lock().unwrap().get_prompt_versions(prompt_id) {
        Ok(versions) => ok(versions),
        Err(e) => err(&e.to_string()),
    }
}

// -- Tags --

#[tauri::command]
fn get_all_tags(state: State<AppState>) -> ApiResult<Vec<Tag>> {
    match state.db.lock().unwrap().get_all_tags() {
        Ok(tags) => ok(tags),
        Err(e) => err(&e.to_string()),
    }
}

// -- Search --

#[tauri::command]
fn search_prompts(query: String, state: State<AppState>) -> ApiResult<Vec<Prompt>> {
    match state.db.lock().unwrap().search_prompts(&query) {
        Ok(prompts) => ok(prompts),
        Err(e) => err(&e.to_string()),
    }
}

// ─── Embedding Commands ──────────────────────────────────────────

#[tauri::command]
fn save_embedding(
    prompt_id: i64,
    vector: Vec<f32>,
    model: String,
    provider: String,
    state: State<AppState>,
) -> ApiResult<bool> {
    match state.db.lock().unwrap().save_embedding(prompt_id, &vector, &model, &provider) {
        Ok(_) => ok(true),
        Err(e) => err(&e.to_string()),
    }
}

#[tauri::command]
fn get_all_embeddings(provider: String, state: State<AppState>) -> ApiResult<Vec<StoredEmbedding>> {
    let filter = if provider.is_empty() { None } else { Some(provider.as_str()) };
    match state.db.lock().unwrap().get_all_embeddings(filter) {
        Ok(embeddings) => ok(embeddings),
        Err(e) => err(&e.to_string()),
    }
}

#[tauri::command]
fn delete_embeddings_by_provider(provider: String, state: State<AppState>) -> ApiResult<usize> {
    match state.db.lock().unwrap().delete_embeddings_by_provider(&provider) {
        Ok(count) => ok(count),
        Err(e) => err(&e.to_string()),
    }
}

// ─── Vector Search (Phase 6) ─────────────────────────────────────

/// Semantic vector search — finds the most similar stored prompts to the
/// given query vector using Rust-side cosine similarity.
///
/// `provider` restricts the search to a single embedding backend so that
/// dimension-mismatched vectors from other providers are never compared.
///
/// Returns up to `top_k` results sorted by similarity descending.
/// Returns an empty array (not an error) when no embeddings exist yet.
#[tauri::command]
fn vector_search(
    vector: Vec<f32>,
    provider: String,
    top_k: usize,
    state: State<AppState>,
) -> ApiResult<Vec<VectorSearchResult>> {
    let top_k = top_k.max(1).min(100); // clamp to sane range
    match state.db.lock().unwrap().vector_search(&vector, &provider, top_k) {
        Ok(results) => ok(results),
        Err(e) => err(&e.to_string()),
    }
}

// ─── Export Commands ─────────────────────────────────────────────

/// Export a single prompt as Markdown with YAML front-matter.
///
/// Returns the Markdown string — the frontend is responsible for
/// triggering the file download (via a Blob URL) so no file-system
/// plugin is required.
#[tauri::command]
fn export_prompt_markdown(id: i64, state: State<AppState>) -> ApiResult<String> {
    match state.db.lock().unwrap().export_prompt_markdown(id) {
        Ok(md) => ok(md),
        Err(e) => err(&e.to_string()),
    }
}

/// Export all prompts (or a specific subset by ID) as a JSON array.
///
/// Pass an empty `ids` array to export every prompt.
/// Returns the JSON string — the frontend triggers the download.
#[tauri::command]
fn export_prompts_json(ids: Vec<i64>, state: State<AppState>) -> ApiResult<String> {
    let id_filter = if ids.is_empty() { None } else { Some(ids.as_slice()) };
    match state.db.lock().unwrap().export_prompts_json(id_filter) {
        Ok(json) => ok(json),
        Err(e) => err(&e.to_string()),
    }
}

// ─── Sync Commands ───────────────────────────────────────────────

#[tauri::command]
async fn start_oauth_flow(
    client_id: String,
    client_secret: String,
    state: State<'_, AppState>,
) -> Result<ApiResult<String>, ()> {
    let auth_url = {
        let mut sync = state.sync.lock().await;
        let mut config = sync.get_config().clone();
        config.client_id = client_id;
        config.client_secret = client_secret;
        if let Err(e) = sync.update_config(config) {
            return Ok(err(&e));
        }
        match sync.get_auth_url() {
            Ok(url) => url,
            Err(e) => return Ok(err(&e)),
        }
    };

    let sync_arc = Arc::clone(&state.sync);

    tokio::spawn(async move {
        match sync::await_oauth_callback().await {
            Ok(code) => {
                let mut sync = sync_arc.lock().await;
                if let Err(e) = sync.exchange_code(&code).await {
                    let mut config = sync.get_config().clone();
                    config.sync_status = SyncStatus::Error(e.clone());
                    sync.update_config(config).ok();
                    eprintln!("[PromptVault] OAuth exchange failed: {}", e);
                }
            }
            Err(e) => {
                let mut sync = sync_arc.lock().await;
                let mut config = sync.get_config().clone();
                config.sync_status = SyncStatus::Error(e.clone());
                sync.update_config(config).ok();
                eprintln!("[PromptVault] OAuth callback error: {}", e);
            }
        }
    });

    Ok(ok(auth_url))
}

#[tauri::command]
async fn get_sync_config(state: State<'_, AppState>) -> Result<ApiResult<SyncConfig>, ()> {
    let sync = state.sync.lock().await;
    Ok(ok(sync.get_config().clone()))
}

#[tauri::command]
async fn update_sync_config(config: SyncConfig, state: State<'_, AppState>) -> Result<ApiResult<bool>, ()> {
    let mut sync = state.sync.lock().await;
    match sync.update_config(config) {
        Ok(_) => Ok(ok(true)),
        Err(e) => Ok(err(&e)),
    }
}

#[tauri::command]
async fn get_auth_url(state: State<'_, AppState>) -> Result<ApiResult<String>, ()> {
    let sync = state.sync.lock().await;
    match sync.get_auth_url() {
        Ok(url) => Ok(ok(url)),
        Err(e) => Ok(err(&e)),
    }
}

#[tauri::command]
async fn exchange_auth_code(code: String, state: State<'_, AppState>) -> Result<ApiResult<bool>, ()> {
    let mut sync = state.sync.lock().await;
    match sync.exchange_code(&code).await {
        Ok(_) => Ok(ok(true)),
        Err(e) => Ok(err(&e)),
    }
}

#[tauri::command]
async fn sync_to_drive(state: State<'_, AppState>) -> Result<ApiResult<bool>, ()> {
    let db_path = state.db_path.clone();
    let mut sync = state.sync.lock().await;
    match sync.upload_db(&db_path).await {
        Ok(_) => Ok(ok(true)),
        Err(e) => Ok(err(&e)),
    }
}

#[tauri::command]
async fn check_sync_status(state: State<'_, AppState>) -> Result<ApiResult<Option<String>>, ()> {
    let sync = state.sync.lock().await;
    match sync.check_remote_status().await {
        Ok(modified) => Ok(ok(modified)),
        Err(e) => Ok(err(&e)),
    }
}

#[tauri::command]
async fn set_auto_sync(
    enabled: bool,
    interval_mins: u32,
    state: State<'_, AppState>,
) -> Result<ApiResult<bool>, ()> {
    let interval_mins = interval_mins.max(1).min(60);

    {
        let mut sync = state.sync.lock().await;
        let mut config = sync.get_config().clone();
        config.auto_sync_enabled = enabled;
        config.auto_sync_interval_mins = interval_mins;
        if let Err(e) = sync.update_config(config) {
            return Ok(err(&e));
        }
    }

    let _ = state.sync_worker_tx.send(SyncWorkerCtl {
        enabled,
        interval_secs: (interval_mins as u64) * 60,
    });

    Ok(ok(true))
}

// ─── Conflict Resolution Commands ────────────────────────────────────────────

#[derive(Serialize)]
struct ConflictInfo {
    remote_modified: String,
    local_last_sync: Option<String>,
    remote_is_newer: bool,
}

#[tauri::command]
async fn get_conflict_info(state: State<'_, AppState>) -> Result<ApiResult<Option<ConflictInfo>>, ()> {
    let sync = state.sync.lock().await;
    let config = sync.get_config();

    if config.remote_file_id.is_none() {
        return Ok(ok(None));
    }
    if !matches!(config.sync_status, SyncStatus::Connected | SyncStatus::Synced | SyncStatus::Conflict) {
        return Ok(ok(None));
    }

    let remote_modified = match sync.check_remote_status().await {
        Ok(Some(t)) => t,
        Ok(None) => return Ok(ok(None)),
        Err(_) => return Ok(ok(None)),
    };

    let local_last_sync = config.last_sync.clone();

    let remote_is_newer = match &local_last_sync {
        None => true,
        Some(last) => {
            let remote_ts = DateTime::parse_from_rfc3339(&remote_modified).ok();
            let local_ts  = DateTime::parse_from_rfc3339(last).ok();
            match (remote_ts, local_ts) {
                (Some(r), Some(l)) => r > l,
                _ => false,
            }
        }
    };

    if !remote_is_newer {
        return Ok(ok(None));
    }

    Ok(ok(Some(ConflictInfo {
        remote_modified,
        local_last_sync,
        remote_is_newer,
    })))
}

#[derive(Serialize)]
struct ResolveResult {
    data_replaced: bool,
}

#[tauri::command]
async fn resolve_conflict(
    strategy: String,
    state: State<'_, AppState>,
) -> Result<ApiResult<ResolveResult>, ()> {
    let db_path = state.db_path.clone();

    match strategy.as_str() {
        "accept_newest" => {
            let remote_modified = {
                let sync = state.sync.lock().await;
                match sync.check_remote_status().await {
                    Ok(Some(t)) => t,
                    Ok(None) => return Ok(err("No remote file found")),
                    Err(e) => return Ok(err(&e)),
                }
            };

            let local_last_sync = {
                let sync = state.sync.lock().await;
                sync.get_config().last_sync.clone()
            };

            let remote_is_newer = match &local_last_sync {
                None => true,
                Some(last) => {
                    let r = DateTime::parse_from_rfc3339(&remote_modified).ok();
                    let l = DateTime::parse_from_rfc3339(last).ok();
                    matches!((r, l), (Some(rv), Some(lv)) if rv > lv)
                }
            };

            if remote_is_newer {
                let incoming_path = db_path.replace("prompt_vault.db", "prompt_vault_incoming.db");

                {
                    let mut sync = state.sync.lock().await;
                    if let Err(e) = sync.download_db(&incoming_path).await {
                        return Ok(err(&e));
                    }
                }

                {
                    let mut db = state.db.lock().unwrap();
                    if let Err(e) = db.restore_from(&incoming_path) {
                        let _ = std::fs::remove_file(&incoming_path);
                        return Ok(err(&format!("Restore failed: {}", e)));
                    }
                }

                let _ = std::fs::remove_file(&incoming_path);

                {
                    let mut sync = state.sync.lock().await;
                    let mut config = sync.get_config().clone();
                    config.last_sync = Some(remote_modified);
                    config.sync_status = SyncStatus::Synced;
                    if let Err(e) = sync.update_config(config) {
                        return Ok(err(&e));
                    }
                }

                Ok(ok(ResolveResult { data_replaced: true }))
            } else {
                let mut sync = state.sync.lock().await;
                match sync.upload_db(&db_path).await {
                    Ok(_) => Ok(ok(ResolveResult { data_replaced: false })),
                    Err(e) => Ok(err(&e)),
                }
            }
        }

        "keep_local" => {
            let mut sync = state.sync.lock().await;
            match sync.upload_db(&db_path).await {
                Ok(_) => Ok(ok(ResolveResult { data_replaced: false })),
                Err(e) => Ok(err(&e)),
            }
        }

        _ => Ok(err(&format!("Unknown strategy: '{}'. Use 'accept_newest' or 'keep_local'.", strategy))),
    }
}

// ─── Encryption Commands ─────────────────────────────────────────────────────

#[derive(Serialize)]
struct DbLockStatus {
    encrypted: bool,
    unlocked: bool,
}

#[tauri::command]
fn get_db_lock_status(state: State<AppState>) -> ApiResult<DbLockStatus> {
    let encrypted = is_encrypted_on_disk();
    let unlocked  = !state.db_locked.load(Ordering::SeqCst);
    ok(DbLockStatus { encrypted, unlocked })
}

#[tauri::command]
fn unlock_database(password: String, state: State<AppState>) -> ApiResult<bool> {
    let salt = match load_salt() {
        Ok(s) => s,
        Err(_) => {
            state.db_locked.store(false, Ordering::SeqCst);
            return ok(true);
        }
    };

    let key_hex = match derive_key(&password, &salt) {
        Ok(k) => k,
        Err(e) => return err(&e),
    };

    let db = state.db.lock().unwrap();
    match db.apply_key(&key_hex) {
        Ok(_) => {
            state.db_locked.store(false, Ordering::SeqCst);
            ok(true)
        }
        Err(_) => err("Incorrect password"),
    }
}

#[tauri::command]
fn set_db_password(
    current: Option<String>,
    new_password: Option<String>,
    state: State<AppState>,
) -> ApiResult<bool> {
    let db = state.db.lock().unwrap();

    if is_encrypted_on_disk() {
        let old_pw = match &current {
            Some(pw) => pw,
            None => return err("Current password required to change or remove encryption"),
        };
        let salt = match load_salt() {
            Ok(s) => s,
            Err(e) => return err(&e),
        };
        let old_key = match derive_key(old_pw, &salt) {
            Ok(k) => k,
            Err(e) => return err(&e),
        };
        if db.apply_key(&old_key).is_err() {
            return err("Incorrect current password");
        }
    }

    match &new_password {
        Some(new_pw) => {
            let new_salt = match create_salt() {
                Ok(s) => s,
                Err(e) => return err(&e),
            };
            let new_key = match derive_key(new_pw, &new_salt) {
                Ok(k) => k,
                Err(e) => {
                    let _ = std::fs::remove_file(salt_path());
                    return err(&e);
                }
            };
            if let Err(e) = db.rekey(Some(&new_key)) {
                let _ = std::fs::remove_file(salt_path());
                return err(&e.to_string());
            }
            state.db_locked.store(false, Ordering::SeqCst);
            ok(true)
        }
        None => {
            if let Err(e) = db.rekey(None) {
                return err(&e.to_string());
            }
            let _ = std::fs::remove_file(salt_path());
            state.db_locked.store(false, Ordering::SeqCst);
            ok(true)
        }
    }
}

// ─── Keyboard Shortcut Commands ───────────────────────────────────────────────
//
// Shortcuts are stored in <app_data>/PromptVault/shortcuts.json as a flat
// key→accelerator map.  Unknown keys are ignored, so adding new shortcuts
// in a future version is forward-compatible.
//
// Default accelerators mirror the hardcoded values that existed before this
// feature was added, so existing users see no change on first launch.

fn shortcuts_path() -> PathBuf {
    let mut p = dirs::data_local_dir().unwrap_or_else(|| PathBuf::from("."));
    p.push("PromptVault");
    std::fs::create_dir_all(&p).ok();
    p.push("shortcuts.json");
    p
}

fn default_shortcuts() -> std::collections::HashMap<String, String> {
    let mut m = std::collections::HashMap::new();
    m.insert("commandPalette".into(), "Ctrl+K".into());
    m.insert("newPrompt".into(),      "Ctrl+N".into());
    m.insert("brainSelector".into(),  "Ctrl+B".into());
    m.insert("syncPanel".into(),      "Ctrl+Shift+S".into());
    m.insert("shortcuts".into(),      "Ctrl+,".into());
    m
}

fn load_shortcuts() -> std::collections::HashMap<String, String> {
    let path = shortcuts_path();
    if path.exists() {
        if let Ok(data) = std::fs::read_to_string(&path) {
            if let Ok(map) = serde_json::from_str(&data) {
                // Merge with defaults so new keys always have a value
                let mut defaults = default_shortcuts();
                let saved: std::collections::HashMap<String, String> = map;
                defaults.extend(saved);
                return defaults;
            }
        }
    }
    default_shortcuts()
}

fn save_shortcuts(shortcuts: &std::collections::HashMap<String, String>) -> Result<(), String> {
    let data = serde_json::to_string_pretty(shortcuts).map_err(|e| e.to_string())?;
    std::fs::write(shortcuts_path(), data).map_err(|e| e.to_string())
}

/// Return the current keyboard shortcut map.
///
/// Keys: `commandPalette`, `newPrompt`, `brainSelector`, `syncPanel`, `shortcuts`.
/// Values: accelerator strings like `"Ctrl+K"`, `"Ctrl+Shift+S"`.
#[tauri::command]
fn get_shortcuts() -> ApiResult<std::collections::HashMap<String, String>> {
    ok(load_shortcuts())
}

/// Update a single keyboard shortcut.
///
/// `action` must be one of the known action keys.
/// `accelerator` is a human-readable string like `"Ctrl+Alt+P"`.
/// Pass an empty string to reset the action to its default.
#[tauri::command]
fn set_shortcut(action: String, accelerator: String) -> ApiResult<bool> {
    let mut shortcuts = load_shortcuts();
    let defaults = default_shortcuts();

    if !defaults.contains_key(&action) {
        return err(&format!("Unknown action: '{}'", action));
    }

    if accelerator.is_empty() {
        // Reset to default — clone key before move
        let default_val = defaults.get(action.as_str()).cloned().unwrap_or_default();
        shortcuts.insert(action, default_val);
    } else {
        shortcuts.insert(action, accelerator);
    }

    match save_shortcuts(&shortcuts) {
        Ok(_) => ok(true),
        Err(e) => err(&e),
    }
}

/// Reset all keyboard shortcuts to their defaults.
#[tauri::command]
fn reset_shortcuts() -> ApiResult<std::collections::HashMap<String, String>> {
    let defaults = default_shortcuts();
    match save_shortcuts(&defaults) {
        Ok(_) => ok(defaults),
        Err(e) => err(&e),
    }
}

// ─── App Entry ───────────────────────────────────────────────────


// ─── Multi-device / Team Sync Commands ───────────────────────────────────────

/// Result returned by `init_sync_session`.
///
/// Called once immediately after OAuth completes (or on startup when already
/// connected). Searches appDataFolder for an existing `prompt_vault.db` and
/// claims it if found — preventing a second device from creating a duplicate.
///
/// `found_remote` is `true` when a file was found that predates the local
/// `last_sync` (i.e. another device has already uploaded data). The frontend
/// should offer to pull the remote DB down when this is true.
#[derive(Serialize)]
struct SyncSessionInfo {
    /// True when an existing remote file was found (and its ID was claimed).
    found_remote: bool,
    /// The remote file's RFC 3339 modifiedTime, when found.
    remote_modified: Option<String>,
    /// True when the remote is newer than our last_sync (conflict-style check).
    remote_is_newer: bool,
}

#[tauri::command]
async fn init_sync_session(
    state: State<'_, AppState>,
) -> Result<ApiResult<SyncSessionInfo>, ()> {
    let mut sync = state.sync.lock().await;
    let config = sync.get_config().clone();

    // Already has a remote file ID — nothing to discover.
    // Just report whether the remote is newer (reuses existing conflict logic).
    if config.remote_file_id.is_some() || config.team_mode {
        let remote_modified = match sync.check_remote_status().await {
            Ok(Some(t)) => Some(t),
            _ => None,
        };
        let remote_is_newer = match (&remote_modified, &config.last_sync) {
            (Some(r), Some(l)) => {
                use chrono::DateTime;
                let rt = DateTime::parse_from_rfc3339(r).ok();
                let lt = DateTime::parse_from_rfc3339(l).ok();
                matches!((rt, lt), (Some(rv), Some(lv)) if rv > lv)
            }
            (Some(_), None) => true,
            _ => false,
        };
        return Ok(ok(SyncSessionInfo {
            found_remote: config.remote_file_id.is_some(),
            remote_modified,
            remote_is_newer,
        }));
    }

    // No remote_file_id — search appDataFolder for an existing file.
    match sync.find_existing_db().await {
        Ok(Some((file_id, modified_time))) => {
            // Claim the existing file so future uploads update it, not a new one.
            if let Err(e) = sync.claim_remote_file(&file_id, &modified_time) {
                return Ok(err(&e));
            }

            // The remote is always "newer" on first discovery from a new device —
            // the user should decide whether to pull it down.
            Ok(ok(SyncSessionInfo {
                found_remote: true,
                remote_modified: Some(modified_time),
                remote_is_newer: true,
            }))
        }
        Ok(None) => {
            // First device ever — no remote file exists yet.
            Ok(ok(SyncSessionInfo {
                found_remote: false,
                remote_modified: None,
                remote_is_newer: false,
            }))
        }
        Err(e) => Ok(err(&e)),
    }
}

/// Start the Google Drive OAuth flow with the `drive.file` scope (team mode).
///
/// The `drive.file` scope allows creating and updating files the app created,
/// but stored in the user's Drive root rather than the hidden appDataFolder.
/// This makes it possible to share the file with teammates via Google Drive's
/// sharing UI.
///
/// After OAuth completes, call `init_sync_session` to discover the file, then
/// use the returned file ID as the team vault ID.
#[tauri::command]
async fn start_team_oauth_flow(
    client_id: String,
    client_secret: String,
    state: State<'_, AppState>,
) -> Result<ApiResult<String>, ()> {
    let auth_url = {
        let mut sync = state.sync.lock().await;
        let mut config = sync.get_config().clone();
        config.client_id = client_id;
        config.client_secret = client_secret;
        config.team_mode = true;
        if let Err(e) = sync.update_config(config) {
            return Ok(err(&e));
        }
        match sync.get_team_auth_url() {
            Ok(url) => url,
            Err(e) => return Ok(err(&e)),
        }
    };

    let sync_arc = Arc::clone(&state.sync);
    let db_path = state.db_path.clone();

    tokio::spawn(async move {
        match sync::await_oauth_callback().await {
            Ok(code) => {
                let mut sync = sync_arc.lock().await;
                if let Err(e) = sync.exchange_code(&code).await {
                    let mut config = sync.get_config().clone();
                    config.sync_status = SyncStatus::Error(e.clone());
                    sync.update_config(config).ok();
                    eprintln!("[PromptVault] Team OAuth exchange failed: {}", e);
                    return;
                }
                // Automatically create the team file so the user gets a file ID immediately.
                if let Err(e) = sync.create_team_file(&db_path).await {
                    eprintln!("[PromptVault] Team file creation failed: {}", e);
                }
            }
            Err(e) => {
                let mut sync = sync_arc.lock().await;
                let mut config = sync.get_config().clone();
                config.sync_status = SyncStatus::Error(e.clone());
                sync.update_config(config).ok();
                eprintln!("[PromptVault] Team OAuth callback error: {}", e);
            }
        }
    });

    Ok(ok(auth_url))
}

/// Connect to an existing team vault by its Drive file ID.
///
/// Teammates paste the file ID (shared by the vault creator) here.
/// After calling this, `sync_to_drive` will update the shared file and
/// `resolve_conflict` / `get_conflict_info` will compare against it.
///
/// Requires the user to already be authenticated (personal OAuth is sufficient
/// if the file has been shared with them via Google Drive sharing).
#[tauri::command]
async fn connect_team_vault(
    file_id: String,
    state: State<'_, AppState>,
) -> Result<ApiResult<bool>, ()> {
    let mut sync = state.sync.lock().await;
    match sync.connect_team_vault(&file_id) {
        Ok(_) => Ok(ok(true)),
        Err(e) => Ok(err(&e)),
    }
}

pub fn run() {
    let db = Database::new().expect("Failed to initialize database");
    let db_path = db.get_db_path();
    let sync = DriveSync::new();

    let saved_cfg = sync.get_config().clone();
    let initial_ctl = SyncWorkerCtl {
        enabled: saved_cfg.auto_sync_enabled,
        interval_secs: (saved_cfg.auto_sync_interval_mins.max(1) as u64) * 60,
    };

    let (worker_tx, worker_rx) = watch::channel(initial_ctl);
    let sync_arc = Arc::new(TokioMutex::new(sync));

    let db_locked = Arc::new(AtomicBool::new(is_encrypted_on_disk()));

    // Clone before the setup closure captures ownership via `move`.
    let sync_arc_worker = Arc::clone(&sync_arc);
    let db_path_worker  = db_path.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(move |_app| {
            tauri::async_runtime::spawn(run_sync_worker(sync_arc_worker, db_path_worker, worker_rx));
            Ok(())
        })
        .manage(AppState {
            db: StdMutex::new(db),
            sync: sync_arc,
            db_path,
            sync_worker_tx: Arc::new(worker_tx),
            db_locked,
        })
        .invoke_handler(tauri::generate_handler![
            get_categories,
            create_category,
            get_prompts,
            get_prompt_by_id,
            create_prompt,
            update_prompt,
            delete_prompt,
            get_prompt_versions,
            get_all_tags,
            search_prompts,
            save_embedding,
            get_all_embeddings,
            delete_embeddings_by_provider,
            vector_search,
            export_prompt_markdown,
            export_prompts_json,
            start_oauth_flow,
            init_sync_session,
            start_team_oauth_flow,
            connect_team_vault,
            get_sync_config,
            update_sync_config,
            get_auth_url,
            exchange_auth_code,
            sync_to_drive,
            check_sync_status,
            set_auto_sync,
            get_conflict_info,
            resolve_conflict,
            get_db_lock_status,
            unlock_database,
            set_db_password,
            get_shortcuts,
            set_shortcut,
            reset_shortcuts,
        ])
        .run(tauri::generate_context!())
        .expect("error while running PromptVault");
}