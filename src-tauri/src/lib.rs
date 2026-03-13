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

// ─── Shortcuts Config ─────────────────────────────────────────────────────────

/// Keyboard shortcut configuration.
///
/// Each field is a shortcut string like "ctrl+k" or "ctrl+shift+s".
/// An empty string means "no shortcut assigned" for that action.
/// Persisted to `<app_data>/PromptVault/shortcuts_config.json`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShortcutsConfig {
    /// Open the Command Palette (default: ctrl+k)
    #[serde(default = "default_cmd_palette")]
    pub command_palette: String,
    /// Create a new prompt (default: ctrl+n)
    #[serde(default = "default_new_prompt")]
    pub new_prompt: String,
    /// Open the Brain Selector (default: ctrl+b)
    #[serde(default = "default_brain_selector")]
    pub brain_selector: String,
    /// Toggle the Inspector panel (default: ctrl+i)
    #[serde(default = "default_toggle_inspector")]
    pub toggle_inspector: String,
    /// Open the Sync Panel (default: ctrl+shift+s)
    #[serde(default = "default_sync_panel")]
    pub sync_panel: String,
    /// Open the Export Dialog (default: ctrl+shift+e)
    #[serde(default = "default_export")]
    pub export: String,
    /// Open Shortcuts settings (default: ctrl+,)
    #[serde(default = "default_shortcuts")]
    pub shortcuts: String,
}

fn default_cmd_palette()      -> String { "ctrl+k".to_string() }
fn default_new_prompt()       -> String { "ctrl+n".to_string() }
fn default_brain_selector()   -> String { "ctrl+b".to_string() }
fn default_toggle_inspector() -> String { "ctrl+i".to_string() }
fn default_sync_panel()       -> String { "ctrl+shift+s".to_string() }
fn default_export()           -> String { "ctrl+shift+e".to_string() }
fn default_shortcuts()        -> String { "ctrl+,".to_string() }

impl Default for ShortcutsConfig {
    fn default() -> Self {
        ShortcutsConfig {
            command_palette: default_cmd_palette(),
            new_prompt: default_new_prompt(),
            brain_selector: default_brain_selector(),
            toggle_inspector: default_toggle_inspector(),
            sync_panel: default_sync_panel(),
            export: default_export(),
            shortcuts: default_shortcuts(),
        }
    }
}

fn shortcuts_path() -> PathBuf {
    let mut p = dirs::data_local_dir().unwrap_or_else(|| PathBuf::from("."));
    p.push("PromptVault");
    std::fs::create_dir_all(&p).ok();
    p.push("shortcuts_config.json");
    p
}

fn load_shortcuts() -> ShortcutsConfig {
    let path = shortcuts_path();
    if path.exists() {
        std::fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    } else {
        ShortcutsConfig::default()
    }
}

fn save_shortcuts_to_disk(cfg: &ShortcutsConfig) -> Result<(), String> {
    let path = shortcuts_path();
    let data = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    std::fs::write(&path, data).map_err(|e| e.to_string())
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

// ─── Phase 6: SQL Vector Search ──────────────────────────────────────────────

/// Perform a SQL-level cosine similarity search using sqlite-vec's
/// `vec_distance_cosine` function.
///
/// Returns the top-K most similar prompts for `provider`, ordered by
/// descending similarity (1.0 = identical direction, 0.0 = orthogonal).
///
/// Falls back gracefully if sqlite-vec failed to load: the frontend catches
/// the error and uses its existing JS-side cosine similarity instead.
#[tauri::command]
fn vector_search(
    query_vector: Vec<f32>,
    provider: String,
    top_k: usize,
    state: State<AppState>,
) -> ApiResult<Vec<VectorSearchResult>> {
    if query_vector.is_empty() {
        return err("query_vector must not be empty");
    }
    let top_k = top_k.max(1).min(200);
    match state.db.lock().unwrap().vector_search(&query_vector, &provider, top_k) {
        Ok(results) => ok(results),
        Err(e) => err(&e.to_string()),
    }
}

// ─── Export Commands ─────────────────────────────────────────────────────────

/// Export all prompts to a string in the requested format.
///
/// `format` must be one of:
///   - `"json"` → a pretty-printed JSON document containing all prompts,
///     categories, and tags.  Suitable for import into other tools.
///   - `"markdown"` → a single Markdown document with one section per prompt.
///     Suitable for browsing or sharing without PromptVault installed.
///
/// The returned string is meant to be delivered to the frontend, which
/// creates a Blob and triggers a browser-style download.  No file is written
/// to disk by this command.
#[tauri::command]
fn get_export_data(format: String, state: State<AppState>) -> ApiResult<String> {
    let db = state.db.lock().unwrap();

    let prompts = match db.get_prompts() {
        Ok(p) => p,
        Err(e) => return err(&e.to_string()),
    };

    let categories = match db.get_categories() {
        Ok(c) => c,
        Err(e) => return err(&e.to_string()),
    };

    let tags = match db.get_all_tags() {
        Ok(t) => t,
        Err(e) => return err(&e.to_string()),
    };

    let exported_at = chrono::Utc::now().to_rfc3339();

    match format.as_str() {
        "json" => {
            #[derive(Serialize)]
            struct Export {
                exported_at: String,
                version: u32,
                prompts: Vec<Prompt>,
                categories: Vec<Category>,
                tags: Vec<Tag>,
            }

            let export = Export {
                exported_at,
                version: 1,
                prompts,
                categories,
                tags,
            };

            match serde_json::to_string_pretty(&export) {
                Ok(json) => ok(json),
                Err(e) => err(&e.to_string()),
            }
        }

        "markdown" => {
            let mut md = String::new();
            md.push_str("# PromptVault Export\n\n");
            md.push_str(&format!("_Exported: {}_\n\n", exported_at));

            // Build a category lookup: id → name
            let cat_map: std::collections::HashMap<i64, &str> = categories
                .iter()
                .map(|c| (c.id, c.name.as_str()))
                .collect();

            for prompt in &prompts {
                md.push_str("---\n\n");
                md.push_str(&format!("## {}\n\n", prompt.title));

                if let Some(cat_id) = prompt.category_id {
                    if let Some(cat_name) = cat_map.get(&cat_id) {
                        md.push_str(&format!("**Category:** {}  \n", cat_name));
                    }
                }

                if !prompt.tags.is_empty() {
                    let tag_list = prompt.tags.iter()
                        .map(|t| format!("#{}", t))
                        .collect::<Vec<_>>()
                        .join(" ");
                    md.push_str(&format!("**Tags:** {}  \n", tag_list));
                }

                md.push_str(&format!("**ID:** {}  \n", prompt.id));
                md.push_str(&format!("**Created:** {}  \n", prompt.created_at));
                md.push_str(&format!("**Modified:** {}  \n\n", prompt.updated_at));
                md.push_str(&prompt.content);
                md.push_str("\n\n");
            }

            ok(md)
        }

        _ => err(&format!("Unknown export format '{}'. Use 'json' or 'markdown'.", format)),
    }
}

// ─── Shortcut Commands ────────────────────────────────────────────────────────

/// Load the persisted keyboard shortcuts configuration.
///
/// Returns the defaults if no configuration has been saved yet.
#[tauri::command]
fn get_shortcuts() -> ApiResult<ShortcutsConfig> {
    ok(load_shortcuts())
}

/// Persist the keyboard shortcuts configuration to disk.
#[tauri::command]
fn save_shortcuts(config: ShortcutsConfig) -> ApiResult<bool> {
    match save_shortcuts_to_disk(&config) {
        Ok(_) => ok(true),
        Err(e) => err(&e),
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
        // Personal mode — clear team mode flag
        config.team_mode = false;
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

/// Start the Google Drive OAuth flow with `drive.file` scope (team mode).
///
/// Unlike personal OAuth (which uses `drive.appdata`), team OAuth creates files
/// in the user's regular Drive root that can be shared with teammates.
///
/// After the user completes sign-in, poll `get_sync_config` until
/// `sync_status` changes to `Connected`.  Then call `sync_to_drive` to
/// upload the vault and receive the team file ID.
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
        // Enable team mode so the first upload goes to Drive root
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

    tokio::spawn(async move {
        match sync::await_oauth_callback().await {
            Ok(code) => {
                let mut sync = sync_arc.lock().await;
                if let Err(e) = sync.exchange_code(&code).await {
                    let mut config = sync.get_config().clone();
                    config.sync_status = SyncStatus::Error(e.clone());
                    sync.update_config(config).ok();
                    eprintln!("[PromptVault] Team OAuth exchange failed: {}", e);
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

/// Connect this device to an existing shared team vault by its Drive file ID.
///
/// The user must already be authenticated (personal or team OAuth) before
/// calling this. After calling, `sync_to_drive` will read/write the team file.
#[tauri::command]
async fn connect_team_vault(
    file_id: String,
    state: State<'_, AppState>,
) -> Result<ApiResult<bool>, ()> {
    if file_id.trim().is_empty() {
        return Ok(err("File ID must not be empty"));
    }
    let mut sync = state.sync.lock().await;
    match sync.connect_team_vault(file_id.trim()) {
        Ok(_) => Ok(ok(true)),
        Err(e) => Ok(err(&e)),
    }
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

    // Need a file to compare against
    let has_remote = config.remote_file_id.is_some() ||
        (config.team_mode && config.team_file_id.is_some());

    if !has_remote {
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

// ─── App Entry ───────────────────────────────────────────────────

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

    let worker_sync = Arc::clone(&sync_arc);
    let worker_db_path = db_path.clone();
    tokio::spawn(run_sync_worker(worker_sync, worker_db_path, worker_rx));

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(AppState {
            db: StdMutex::new(db),
            sync: sync_arc,
            db_path,
            sync_worker_tx: Arc::new(worker_tx),
            db_locked,
        })
        .invoke_handler(tauri::generate_handler![
            // Data
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
            // Embeddings
            save_embedding,
            get_all_embeddings,
            delete_embeddings_by_provider,
            // Phase 6: SQL vector search
            vector_search,
            // Export
            get_export_data,
            // Shortcuts
            get_shortcuts,
            save_shortcuts,
            // Sync (personal)
            start_oauth_flow,
            get_sync_config,
            update_sync_config,
            get_auth_url,
            exchange_auth_code,
            sync_to_drive,
            check_sync_status,
            set_auto_sync,
            // Sync (team)
            start_team_oauth_flow,
            connect_team_vault,
            // Conflict
            get_conflict_info,
            resolve_conflict,
            // Encryption
            get_db_lock_status,
            unlock_database,
            set_db_password,
        ])
        .run(tauri::generate_context!())
        .expect("error while running PromptVault");
}