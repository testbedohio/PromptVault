use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

/// Google Drive sync configuration and state
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncConfig {
    pub enabled: bool,
    pub client_id: String,
    pub client_secret: String,
    pub access_token: Option<String>,
    pub refresh_token: Option<String>,
    pub token_expiry: Option<i64>,
    pub remote_file_id: Option<String>,
    pub last_sync: Option<String>,
    pub sync_status: SyncStatus,
    /// Whether the periodic background sync worker should run.
    #[serde(default)]
    pub auto_sync_enabled: bool,
    /// How often the background worker uploads, in minutes. Default: 5.
    #[serde(default = "default_interval")]
    pub auto_sync_interval_mins: u32,

    // ── Team / Shared Vault ──────────────────────────────────────
    //
    // When `team_mode` is true, PromptVault syncs to a regular Drive file
    // (drive.file scope) identified by `team_file_id`.  This file can be
    // shared with teammates via the normal Google Drive sharing UI.
    //
    // When `team_mode` is false (default), the app uses the private
    // appDataFolder (drive.appdata scope) stored in `remote_file_id`.
    //
    // Switching modes requires re-authorising with the appropriate scope.

    /// True when team mode (drive.file scope, shared vault) is active.
    #[serde(default)]
    pub team_mode: bool,

    /// Drive file ID for the shared vault (team mode only).
    /// Set automatically after the first team upload, or manually
    /// via `connect_team_vault` when joining an existing vault.
    #[serde(default)]
    pub team_file_id: Option<String>,
}

fn default_interval() -> u32 { 5 }

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum SyncStatus {
    Disconnected,
    Connected,
    Syncing,
    Synced,
    Conflict,
    Error(String),
}

impl Default for SyncConfig {
    fn default() -> Self {
        SyncConfig {
            enabled: false,
            client_id: String::new(),
            client_secret: String::new(),
            access_token: None,
            refresh_token: None,
            token_expiry: None,
            remote_file_id: None,
            last_sync: None,
            sync_status: SyncStatus::Disconnected,
            auto_sync_enabled: false,
            auto_sync_interval_mins: 5,
            team_mode: false,
            team_file_id: None,
        }
    }
}

impl SyncConfig {
    fn config_path() -> PathBuf {
        let mut path = dirs::data_local_dir().unwrap_or_else(|| PathBuf::from("."));
        path.push("PromptVault");
        fs::create_dir_all(&path).ok();
        path.push("sync_config.json");
        path
    }

    pub fn load() -> Self {
        let path = Self::config_path();
        if path.exists() {
            match fs::read_to_string(&path) {
                Ok(data) => serde_json::from_str(&data).unwrap_or_default(),
                Err(_) => Self::default(),
            }
        } else {
            Self::default()
        }
    }

    pub fn save(&self) -> Result<(), String> {
        let path = Self::config_path();
        let data = serde_json::to_string_pretty(self).map_err(|e| e.to_string())?;
        fs::write(&path, data).map_err(|e| e.to_string())
    }
}

// ─── OAuth Callback Server ────────────────────────────────────────────────────

const CALLBACK_PORT: u16 = 8741;
const CALLBACK_TIMEOUT_SECS: u64 = 180;

const SUCCESS_HTML: &str = r#"<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>PromptVault — Connected</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'JetBrains Mono', 'Fira Code', monospace;
      background: #2b2b2b; color: #a9b7c6;
      display: flex; align-items: center; justify-content: center;
      height: 100vh;
    }
    .card {
      text-align: center; padding: 2.5rem 3rem;
      border: 1px solid #3c3f41; border-radius: 8px;
      background: #313335;
    }
    .icon { font-size: 2.5rem; margin-bottom: 0.75rem; }
    h1 { color: #6a8759; font-size: 1.25rem; margin-bottom: 0.5rem; }
    p { color: #808080; font-size: 0.8rem; }
    .sub { margin-top: 0.75rem; font-size: 0.75rem; color: #606060; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">✓</div>
    <h1>Connected to Google Drive</h1>
    <p>PromptVault has been authorized successfully.</p>
    <p class="sub">You can close this tab and return to PromptVault.</p>
  </div>
</body>
</html>"#;

const ERROR_HTML: &str = r#"<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>PromptVault — Authorization Failed</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'JetBrains Mono', 'Fira Code', monospace;
      background: #2b2b2b; color: #a9b7c6;
      display: flex; align-items: center; justify-content: center;
      height: 100vh;
    }
    .card {
      text-align: center; padding: 2.5rem 3rem;
      border: 1px solid #3c3f41; border-radius: 8px;
      background: #313335;
    }
    .icon { font-size: 2.5rem; margin-bottom: 0.75rem; }
    h1 { color: #cf6679; font-size: 1.25rem; margin-bottom: 0.5rem; }
    p { color: #808080; font-size: 0.8rem; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">✗</div>
    <h1>Authorization Failed</h1>
    <p>Google sign-in was cancelled or encountered an error.</p>
    <p style="margin-top:0.5rem;">Return to PromptVault and try again.</p>
  </div>
</body>
</html>"#;

pub async fn await_oauth_callback() -> Result<String, String> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;
    use tokio::time::{timeout, Duration};

    let listener = TcpListener::bind(format!("127.0.0.1:{}", CALLBACK_PORT))
        .await
        .map_err(|e| format!("Failed to start OAuth callback server on port {}: {}. Is port {} already in use?", CALLBACK_PORT, e, CALLBACK_PORT))?;

    let (mut stream, _addr) = timeout(
        Duration::from_secs(CALLBACK_TIMEOUT_SECS),
        listener.accept(),
    )
    .await
    .map_err(|_| format!("OAuth sign-in timed out after {} seconds. Please try again.", CALLBACK_TIMEOUT_SECS))?
    .map_err(|e| format!("Callback server accept error: {}", e))?;

    let mut buf = [0u8; 8192];
    let n = timeout(Duration::from_secs(5), stream.read(&mut buf))
        .await
        .map_err(|_| "Timed out reading callback request".to_string())?
        .map_err(|e| format!("Failed to read callback: {}", e))?;

    let request = String::from_utf8_lossy(&buf[..n]);

    let request_line = request.lines().next().unwrap_or("");
    let path_and_query = request_line.split_whitespace().nth(1).unwrap_or("");
    let query_string = path_and_query.split('?').nth(1).unwrap_or("");

    let code = query_string
        .split('&')
        .find(|p| p.starts_with("code="))
        .map(|p| urlencoding::decode(&p[5..]));

    let error = query_string
        .split('&')
        .find(|p| p.starts_with("error="))
        .map(|p| urlencoding::decode(&p[6..]));

    let (status_line, response_body) = if code.is_some() {
        ("HTTP/1.1 200 OK", SUCCESS_HTML)
    } else {
        ("HTTP/1.1 400 Bad Request", ERROR_HTML)
    };

    let response = format!(
        "{}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        status_line,
        response_body.len(),
        response_body
    );
    stream.write_all(response.as_bytes()).await.ok();
    stream.shutdown().await.ok();

    if let Some(err_msg) = error {
        return Err(format!("Google declined authorization: {}", err_msg));
    }

    code.ok_or_else(|| "No authorization code in callback URL — unexpected redirect format".to_string())
}

// ─── Google Drive API Client ──────────────────────────────────────────────────

pub struct DriveSync {
    config: SyncConfig,
}

impl DriveSync {
    pub fn new() -> Self {
        DriveSync {
            config: SyncConfig::load(),
        }
    }

    pub fn get_config(&self) -> &SyncConfig {
        &self.config
    }

    pub fn update_config(&mut self, config: SyncConfig) -> Result<(), String> {
        config.save()?;
        self.config = config;
        Ok(())
    }

    // ── OAuth URL Builders ────────────────────────────────────────

    /// Build the personal mode OAuth URL (drive.appdata scope — hidden, per-user folder).
    pub fn get_auth_url(&self) -> Result<String, String> {
        if self.config.client_id.is_empty() {
            return Err("Client ID not configured".to_string());
        }
        self.build_auth_url("https://www.googleapis.com/auth/drive.appdata")
    }

    /// Build the team mode OAuth URL (drive.file scope — can create/access shared files).
    ///
    /// Unlike `drive.appdata`, `drive.file` grants access to files created by
    /// PromptVault in the user's regular Drive, which can then be shared with
    /// teammates via normal Drive sharing.
    pub fn get_team_auth_url(&self) -> Result<String, String> {
        if self.config.client_id.is_empty() {
            return Err("Client ID not configured".to_string());
        }
        self.build_auth_url("https://www.googleapis.com/auth/drive.file")
    }

    fn build_auth_url(&self, scope: &str) -> Result<String, String> {
        let redirect = format!("http://localhost:{}/callback", CALLBACK_PORT);
        Ok(format!(
            "https://accounts.google.com/o/oauth2/v2/auth?\
            client_id={}&\
            redirect_uri={}&\
            response_type=code&\
            scope={}&\
            access_type=offline&\
            prompt=consent",
            self.config.client_id,
            urlencoding::encode(&redirect),
            urlencoding::encode(scope)
        ))
    }

    // ── Token Exchange & Refresh ──────────────────────────────────

    pub async fn exchange_code(&mut self, code: &str) -> Result<(), String> {
        let redirect = format!("http://localhost:{}/callback", CALLBACK_PORT);
        let client = reqwest::Client::new();
        let response = client
            .post("https://oauth2.googleapis.com/token")
            .form(&[
                ("code", code),
                ("client_id", &self.config.client_id),
                ("client_secret", &self.config.client_secret),
                ("redirect_uri", &redirect),
                ("grant_type", "authorization_code"),
            ])
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !response.status().is_success() {
            let err_body = response.text().await.unwrap_or_default();
            return Err(format!("Token exchange failed: {}", err_body));
        }

        #[derive(Deserialize)]
        struct TokenResponse {
            access_token: String,
            refresh_token: Option<String>,
            expires_in: i64,
        }

        let tokens: TokenResponse = response.json().await.map_err(|e| e.to_string())?;

        self.config.access_token = Some(tokens.access_token);
        if let Some(rt) = tokens.refresh_token {
            self.config.refresh_token = Some(rt);
        }
        self.config.token_expiry = Some(Utc::now().timestamp() + tokens.expires_in);
        self.config.sync_status = SyncStatus::Connected;
        self.config.enabled = true;
        self.config.save()?;

        Ok(())
    }

    pub async fn refresh_access_token(&mut self) -> Result<(), String> {
        let refresh_token = self
            .config
            .refresh_token
            .as_ref()
            .ok_or("No refresh token stored — please sign in again")?
            .clone();

        let client = reqwest::Client::new();
        let response = client
            .post("https://oauth2.googleapis.com/token")
            .form(&[
                ("refresh_token", refresh_token.as_str()),
                ("client_id", &self.config.client_id),
                ("client_secret", &self.config.client_secret),
                ("grant_type", "refresh_token"),
            ])
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !response.status().is_success() {
            let err_body = response.text().await.unwrap_or_default();
            return Err(format!("Token refresh failed: {}", err_body));
        }

        #[derive(Deserialize)]
        struct RefreshResponse {
            access_token: String,
            expires_in: i64,
        }

        let tokens: RefreshResponse = response.json().await.map_err(|e| e.to_string())?;
        self.config.access_token = Some(tokens.access_token);
        self.config.token_expiry = Some(Utc::now().timestamp() + tokens.expires_in);
        self.config.save()?;

        Ok(())
    }

    pub async fn ensure_fresh_token(&mut self) -> Result<(), String> {
        let expiry = self.config.token_expiry.unwrap_or(0);
        if Utc::now().timestamp() + 60 >= expiry {
            self.refresh_access_token().await?;
        }
        Ok(())
    }

    // ── Upload ────────────────────────────────────────────────────
    //
    // Routes to personal (appDataFolder) or team (drive.file) based on
    // the `team_mode` flag in the config.

    pub async fn upload_db(&mut self, db_path: &str) -> Result<(), String> {
        if self.config.team_mode {
            self.upload_db_team(db_path).await
        } else {
            self.upload_db_personal(db_path).await
        }
    }

    /// Personal sync: upload to the hidden appDataFolder.
    /// File is not visible in the user's regular Drive view.
    async fn upload_db_personal(&mut self, db_path: &str) -> Result<(), String> {
        self.ensure_fresh_token().await?;

        let token = self
            .config
            .access_token
            .as_ref()
            .ok_or("Not authenticated")?
            .clone();

        let db_bytes = fs::read(db_path).map_err(|e| e.to_string())?;
        let client = reqwest::Client::new();

        self.config.sync_status = SyncStatus::Syncing;

        if let Some(ref file_id) = self.config.remote_file_id.clone() {
            let url = format!(
                "https://www.googleapis.com/upload/drive/v3/files/{}?uploadType=media",
                file_id
            );
            let response = client
                .patch(&url)
                .bearer_auth(&token)
                .header("Content-Type", "application/x-sqlite3")
                .body(db_bytes)
                .send()
                .await
                .map_err(|e| e.to_string())?;

            if !response.status().is_success() {
                let err = response.text().await.unwrap_or_default();
                self.config.sync_status = SyncStatus::Error(format!("Upload failed: {}", err));
                self.config.save().ok();
                return Err(format!("Upload failed: {}", err));
            }
        } else {
            let metadata = serde_json::json!({
                "name": "prompt_vault.db",
                "parents": ["appDataFolder"]
            });

            let boundary = "prompt_vault_boundary";
            let header_part = format!(
                "--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{}\r\n--{boundary}\r\nContent-Type: application/x-sqlite3\r\n\r\n",
                metadata
            );

            let mut full_body = header_part.into_bytes();
            full_body.extend_from_slice(&db_bytes);
            full_body.extend_from_slice(format!("\r\n--{boundary}--").as_bytes());

            let url = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart";
            let response = client
                .post(url)
                .bearer_auth(&token)
                .header(
                    "Content-Type",
                    format!("multipart/related; boundary={}", boundary),
                )
                .body(full_body)
                .send()
                .await
                .map_err(|e| e.to_string())?;

            if !response.status().is_success() {
                let err = response.text().await.unwrap_or_default();
                self.config.sync_status = SyncStatus::Error(format!("Create failed: {}", err));
                self.config.save().ok();
                return Err(format!("Create failed: {}", err));
            }

            #[derive(Deserialize)]
            struct FileResponse { id: String }

            let file: FileResponse = response.json().await.map_err(|e| e.to_string())?;
            self.config.remote_file_id = Some(file.id);
        }

        self.config.last_sync = Some(Utc::now().to_rfc3339());
        self.config.sync_status = SyncStatus::Synced;
        self.config.save()?;
        Ok(())
    }

    /// Team sync: upload to a regular Drive file (visible, shareable).
    ///
    /// On first use, creates a new file and stores its ID in `team_file_id`.
    /// Subsequent uploads patch the same file.  The ID can be shared with
    /// teammates who then call `connect_team_vault` to link their local vault.
    async fn upload_db_team(&mut self, db_path: &str) -> Result<(), String> {
        self.ensure_fresh_token().await?;

        let token = self
            .config
            .access_token
            .as_ref()
            .ok_or("Not authenticated")?
            .clone();

        let db_bytes = fs::read(db_path).map_err(|e| e.to_string())?;
        let client = reqwest::Client::new();

        self.config.sync_status = SyncStatus::Syncing;

        if let Some(ref file_id) = self.config.team_file_id.clone() {
            // Update existing shared file
            let url = format!(
                "https://www.googleapis.com/upload/drive/v3/files/{}?uploadType=media",
                file_id
            );
            let response = client
                .patch(&url)
                .bearer_auth(&token)
                .header("Content-Type", "application/x-sqlite3")
                .body(db_bytes)
                .send()
                .await
                .map_err(|e| e.to_string())?;

            if !response.status().is_success() {
                let err = response.text().await.unwrap_or_default();
                self.config.sync_status = SyncStatus::Error(format!("Team upload failed: {}", err));
                self.config.save().ok();
                return Err(format!("Team upload failed: {}", err));
            }
        } else {
            // Create a new shared file in Drive root (no parent = My Drive root)
            let metadata = serde_json::json!({
                "name": "prompt_vault_shared.db",
                "description": "PromptVault shared prompt database"
            });

            let boundary = "promptvault_team_boundary";
            let header_part = format!(
                "--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{}\r\n--{boundary}\r\nContent-Type: application/x-sqlite3\r\n\r\n",
                metadata
            );

            let mut full_body = header_part.into_bytes();
            full_body.extend_from_slice(&db_bytes);
            full_body.extend_from_slice(format!("\r\n--{boundary}--").as_bytes());

            let url = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart";
            let response = client
                .post(url)
                .bearer_auth(&token)
                .header(
                    "Content-Type",
                    format!("multipart/related; boundary={}", boundary),
                )
                .body(full_body)
                .send()
                .await
                .map_err(|e| e.to_string())?;

            if !response.status().is_success() {
                let err = response.text().await.unwrap_or_default();
                self.config.sync_status = SyncStatus::Error(format!("Team vault create failed: {}", err));
                self.config.save().ok();
                return Err(format!("Team vault create failed: {}", err));
            }

            #[derive(Deserialize)]
            struct FileResponse { id: String }

            let file: FileResponse = response.json().await.map_err(|e| e.to_string())?;
            self.config.team_file_id = Some(file.id);
        }

        self.config.last_sync = Some(Utc::now().to_rfc3339());
        self.config.sync_status = SyncStatus::Synced;
        self.config.save()?;
        Ok(())
    }

    // ── Download ──────────────────────────────────────────────────
    //
    // Routes to the correct file ID based on team_mode.

    /// Download the remote database file to `dest_path`.
    pub async fn download_db(&mut self, dest_path: &str) -> Result<(), String> {
        if self.config.team_mode {
            self.download_db_team(dest_path).await
        } else {
            self.download_db_personal(dest_path).await
        }
    }

    async fn download_db_personal(&mut self, dest_path: &str) -> Result<(), String> {
        self.ensure_fresh_token().await?;

        let token = self
            .config
            .access_token
            .as_ref()
            .ok_or("Not authenticated")?
            .clone();

        let file_id = self
            .config
            .remote_file_id
            .as_ref()
            .ok_or("No remote file ID — cannot download")?
            .clone();

        self.download_file_by_id(&token, &file_id, dest_path).await
    }

    async fn download_db_team(&mut self, dest_path: &str) -> Result<(), String> {
        self.ensure_fresh_token().await?;

        let token = self
            .config
            .access_token
            .as_ref()
            .ok_or("Not authenticated")?
            .clone();

        let file_id = self
            .config
            .team_file_id
            .as_ref()
            .ok_or("No team vault file ID — use 'Connect to existing vault' to link one")?
            .clone();

        self.download_file_by_id(&token, &file_id, dest_path).await
    }

    async fn download_file_by_id(&self, token: &str, file_id: &str, dest_path: &str) -> Result<(), String> {
        let client = reqwest::Client::new();
        let url = format!(
            "https://www.googleapis.com/drive/v3/files/{}?alt=media",
            file_id
        );

        let response = client
            .get(&url)
            .bearer_auth(token)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !response.status().is_success() {
            let err = response.text().await.unwrap_or_default();
            return Err(format!("Download failed: {}", err));
        }

        let bytes = response.bytes().await.map_err(|e| e.to_string())?;
        fs::write(dest_path, &bytes).map_err(|e| e.to_string())?;

        Ok(())
    }

    // ── Remote Status Check ───────────────────────────────────────
    //
    // Returns the modifiedTime of the active remote file (personal or team).

    pub async fn check_remote_status(&self) -> Result<Option<String>, String> {
        let token = self
            .config
            .access_token
            .as_ref()
            .ok_or("Not authenticated")?;

        let file_id = if self.config.team_mode {
            self.config
                .team_file_id
                .as_ref()
                .ok_or("No team file ID")?
        } else {
            self.config
                .remote_file_id
                .as_ref()
                .ok_or("No remote file")?
        };

        let client = reqwest::Client::new();
        let url = format!(
            "https://www.googleapis.com/drive/v3/files/{}?fields=modifiedTime",
            file_id
        );

        let response = client
            .get(&url)
            .bearer_auth(token)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !response.status().is_success() {
            return Err("Failed to check remote status".to_string());
        }

        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct FileInfo {
            modified_time: String,
        }

        let info: FileInfo = response.json().await.map_err(|e| e.to_string())?;
        Ok(Some(info.modified_time))
    }
}

// ─── URL encoding helpers ─────────────────────────────────────────────────────

mod urlencoding {
    pub fn encode(s: &str) -> String {
        s.chars()
            .flat_map(|c| {
                if c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '~') {
                    vec![c]
                } else {
                    c.to_string()
                        .as_bytes()
                        .iter()
                        .flat_map(|b| format!("%{:02X}", b).chars().collect::<Vec<_>>())
                        .collect()
                }
            })
            .collect()
    }

    pub fn decode(s: &str) -> String {
        let mut result = String::with_capacity(s.len());
        let mut chars = s.chars().peekable();
        while let Some(c) = chars.next() {
            if c == '%' {
                let h1 = chars.next().unwrap_or('0');
                let h2 = chars.next().unwrap_or('0');
                if let Ok(byte) = u8::from_str_radix(&format!("{}{}", h1, h2), 16) {
                    result.push(byte as char);
                }
            } else if c == '+' {
                result.push(' ');
            } else {
                result.push(c);
            }
        }
        result
    }
}