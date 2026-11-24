use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::BTreeSet,
    fs::{self, File},
    io::{BufReader, Write},
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{AppHandle, Manager};

pub type Result<T> = std::result::Result<T, String>;
pub fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

pub const DIRS: &[&str] = &[
    "datasetRoot",
    "videoDir",
    "soundDir",
    "annotationDir",
    "exportDir",
    "cacheDir",
    "tempDir",
    "projectDir",
];
pub const VIDEOS: &[&str] = &[
    "mp4", "mov", "m4v", "mkv", "webm", "avi", "mpeg", "mpg", "mts", "m2ts", "wmv",
];
pub const SOUNDS: &[&str] = &[
    "wav", "mp3", "ogg", "flac", "m4a", "aac", "aiff", "opus", "wma",
];
pub const VISUALS: &[&str] = &["png", "gif", "webp", "jpg", "jpeg"];
pub const PROJECTS: &[&str] = &["json", "txt", "foleymarks"];

pub fn ext(path: &Path, types: &[&str]) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| types.iter().any(|t| e.eq_ignore_ascii_case(t)))
}
pub fn read_json(path: &Path) -> Result<Value> {
    let f = File::open(path).map_err(err)?;
    if f.metadata().map_err(err)?.len() > 64 * 1024 * 1024 {
        return Err("Metadata exceeds 64 MiB.".into());
    }
    serde_json::from_reader(BufReader::new(f)).map_err(err)
}
pub fn atomic(path: &Path, value: &impl Serialize) -> Result<()> {
    let parent = path.parent().ok_or("Missing parent directory")?;
    let mut tmp = tempfile::NamedTempFile::new_in(parent).map_err(err)?;
    serde_json::to_writer_pretty(tmp.as_file_mut(), value).map_err(err)?;
    tmp.flush()
        .and_then(|_| tmp.as_file().sync_all())
        .map_err(err)?;
    tmp.persist(path).map_err(err)?;
    Ok(())
}
pub fn canonical(path: &Path) -> Result<PathBuf> {
    dunce::canonicalize(path).map_err(err)
}
pub fn target(path: &Path) -> Result<PathBuf> {
    if path.exists() {
        return canonical(path);
    }
    let name = path.file_name().ok_or("Invalid filename")?;
    Ok(canonical(path.parent().ok_or("Missing parent directory")?)?.join(name))
}
pub fn dir(settings: &Value, key: &str) -> Result<PathBuf> {
    Ok(PathBuf::from(
        settings
            .get(key)
            .and_then(Value::as_str)
            .ok_or("Invalid folder setting")?,
    ))
}
fn defaults(base: &Path, cache: &Path) -> Value {
    json!({"datasetRoot":base,"videoDir":base.join("raw_videos"),"soundDir":base.join("sounds"),"annotationDir":base.join("annotations"),"exportDir":base.join("exports"),"cacheDir":cache.join("cache"),"tempDir":cache.join("temp"),"projectDir":base.join("projects"),"theme":"dark","language":"en","startup":"recover","previewQuality":"full","waveformCache":true,"backgroundProcessing":true,"snapping":true,"autosaveInterval":30,"autoUpdate":true,"shortcuts":{}})
}

fn preserve_damaged(path: &Path) -> Result<()> {
    let t = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(err)?
        .as_nanos();
    let name = path
        .file_name()
        .ok_or("Invalid settings filename")?
        .to_string_lossy();
    fs::rename(path, path.with_file_name(format!("damaged-{t}-{name}"))).map_err(err)
}
fn merge_preferences(defaults: &Value, stored: Value) -> Result<Value> {
    let mut merged = defaults.clone();
    for (key, value) in stored.as_object().ok_or("Invalid settings file")? {
        if DIRS.contains(&key.as_str()) {
            if !value.as_str().is_some_and(|s| Path::new(s).is_absolute()) {
                return Err("Invalid storage directory".into());
            }
        } else if defaults.get(key).is_some() {
            let mut single = json!({});
            single[key] = value.clone();
            update_preferences(defaults, &single)?;
        }
        merged[key] = value.clone();
    }
    Ok(merged)
}
fn load_preferences(private: &Path, base: &Path) -> Result<Value> {
    let prefs = private.join("settings.json");
    let baseline = defaults(base, private);
    if prefs.is_file() {
        match read_json(&prefs).and_then(|v| merge_preferences(&baseline, v)) {
            Ok(s) => return Ok(s),
            Err(_) => preserve_damaged(&prefs)?,
        }
    }
    let backup = private.join("settings.previous.json");
    let restored = read_json(&backup)
        .and_then(|v| merge_preferences(&baseline, v))
        .ok();
    let settings = if let Some(s) = restored {
        s
    } else {
        for key in DIRS {
            fs::create_dir_all(dir(&baseline, key)?).map_err(err)?;
        }
        baseline
    };
    atomic(&prefs, &settings)?;
    Ok(settings)
}

// Picker grants live outside project JSON. Importing a project never grants arbitrary file access.
#[derive(Default, Clone, Serialize, Deserialize)]
pub struct Grants {
    pub files: BTreeSet<PathBuf>,
    pub writes: BTreeSet<PathBuf>,
}
pub struct Storage {
    pub settings: Value,
    pub grants: Grants,
    pub state_dir: PathBuf,
}
pub struct AppState(pub Mutex<Storage>);

impl Storage {
    pub fn open(app: &AppHandle) -> Result<Self> {
        let private = app.path().app_local_data_dir().map_err(err)?;
        fs::create_dir_all(&private).map_err(err)?;
        let base = app
            .path()
            .document_dir()
            .or_else(|_| app.path().home_dir())
            .map_err(err)?
            .join("FoleyMarks");
        let settings = load_preferences(&private, &base)?;
        let grants_path = private.join("grants.json");
        let grants = if grants_path.exists() {
            match read_json(&grants_path).and_then(|v| serde_json::from_value(v).map_err(err)) {
                Ok(value) => value,
                Err(_) => {
                    preserve_damaged(&grants_path)?;
                    Grants::default()
                }
            }
        } else {
            Grants::default()
        };
        Ok(Self {
            settings,
            state_dir: private,
            grants,
        })
    }
    pub fn grant(&mut self, path: PathBuf, write: bool) -> Result<()> {
        let mut grants = self.grants.clone();
        grants.files.insert(path.clone());
        if write {
            grants.writes.insert(path);
        }
        atomic(&self.state_dir.join("grants.json"), &grants)?;
        self.grants = grants;
        Ok(())
    }
    pub fn can_read(&self, path: &Path) -> bool {
        self.grants.files.contains(path)
            || [
                "datasetRoot",
                "soundDir",
                "videoDir",
                "annotationDir",
                "exportDir",
                "projectDir",
            ]
            .iter()
            .filter_map(|k| dir(&self.settings, k).ok().and_then(|p| canonical(&p).ok()))
            .any(|root| path.starts_with(root))
    }
    pub fn read_path(&self, path: &Path, types: &[&str]) -> Result<PathBuf> {
        let path = canonical(path)?;
        if !path.is_file() || !ext(&path, types) || !self.can_read(&path) {
            return Err(
                "Choose this file with the picker or configure its dataset folder in Settings."
                    .into(),
            );
        }
        Ok(path)
    }
    pub fn media(&self, path: &Path) -> Result<PathBuf> {
        let p = if path.is_relative() {
            dir(&self.settings, "soundDir")?.join(path)
        } else {
            path.into()
        };
        let p = canonical(&p)?;
        if !p.is_file()
            || !(ext(&p, VIDEOS) || ext(&p, SOUNDS) || ext(&p, VISUALS))
            || !self.can_read(&p)
        {
            return Err("Media is unavailable. Relink it with the native picker.".into());
        }
        Ok(p)
    }
    pub fn prefs(&mut self, settings: Value) -> Result<Value> {
        if settings == self.settings {
            return Ok(settings);
        }
        atomic(
            &self.state_dir.join("settings.previous.json"),
            &self.settings,
        )?;
        atomic(&self.state_dir.join("settings.json"), &settings)?;
        self.settings = settings.clone();
        Ok(settings)
    }
}

pub fn locked(app: &AppHandle) -> Result<std::sync::MutexGuard<'_, Storage>> {
    app.state::<AppState>()
        .inner()
        .0
        .lock()
        .map_err(|_| "Storage unavailable".to_string())
}
pub fn update_preferences(old: &Value, incoming: &Value) -> Result<Value> {
    let mut updated = old.clone();
    for (key, v) in incoming.as_object().ok_or("Invalid preferences")? {
        if DIRS.contains(&key.as_str()) {
            if old.get(key) != Some(v) {
                return Err("Change folders using their native picker.".into());
            }
            continue;
        }
        let valid = match key.as_str() {
            "theme" => matches!(v.as_str(), Some("dark" | "light" | "system")),
            "language" => matches!(v.as_str(), Some("en" | "id")),
            "startup" => matches!(
                v.as_str(),
                Some("recover" | "empty" | "new" | "blank" | "restore")
            ),
            "previewQuality" => matches!(v.as_str(), Some("full" | "half" | "quarter" | "auto")),
            "waveformCache" | "backgroundProcessing" | "autoUpdate" | "snapping" => v.is_boolean(),
            "autosaveInterval" => v.as_u64().is_some_and(|s| (1..=3600).contains(&s)),
            "shortcuts" => v.as_object().is_some_and(|s| {
                s.len() <= 64 && s.values().all(|v| v.as_str().is_some_and(|s| s.len() < 64))
            }),
            _ => old.get(key) == Some(v),
        };
        if !valid {
            return Err(format!("Unsupported setting: {key}"));
        }
        updated[key] = v.clone();
    }
    Ok(updated)
}

pub fn discover(base: &Path, settings: &mut Value) {
    settings["datasetRoot"] = json!(base);
    let choices = [
        (
            "videoDir",
            &["raw_videos", "videos", "dataset/raw_videos"][..],
        ),
        ("soundDir", &["sounds", "assets/sounds", "sfx"][..]),
        ("annotationDir", &["annotations", "dataset/annotations"][..]),
        ("exportDir", &["exports", "dataset/exports"][..]),
    ];
    for (key, names) in choices {
        let p = names.iter().map(|n| base.join(n)).find(|p| p.is_dir());
        let current = dir(settings, key).ok();
        // Independently selected libraries on another drive remain usable.
        if let Some(p) = p {
            settings[key] = json!(p);
        } else if key != "soundDir" || current.is_none_or(|p| !p.exists()) {
            settings[key] = json!(base.join(names[0]));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn corrupted_preferences_restore_saved_settings_and_keep_original() {
        let t = tempfile::tempdir().unwrap();
        let prefs = t.path().join("settings.json");
        let mut previous = defaults(&t.path().join("external"), t.path());
        previous["language"] = json!("id");
        atomic(&t.path().join("settings.previous.json"), &previous).unwrap();
        fs::write(&prefs, b"broken").unwrap();
        let restored = load_preferences(t.path(), &t.path().join("default")).unwrap();
        assert_eq!(restored, previous);
        assert_eq!(read_json(&prefs).unwrap(), previous);
        assert!(fs::read_dir(t.path())
            .unwrap()
            .flatten()
            .any(|f| f.file_name().to_string_lossy().starts_with("damaged-")));
    }
    #[test]
    fn preference_validation_is_atomic() {
        let old = defaults(Path::new("base"), Path::new("local"));
        assert!(update_preferences(&old, &json!({"theme":"light","exportDir":"other"})).is_err());
        assert_eq!(old["theme"], "dark");
        assert_eq!(
            update_preferences(&old, &json!({"theme":"light"})).unwrap()["theme"],
            "light"
        );
    }
    #[test]
    fn saves_replace_after_serialization() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("unicode é.json");
        atomic(&path, &json!({"n":1})).unwrap();
        atomic(&path, &json!({"n":2})).unwrap();
        assert_eq!(read_json(&path).unwrap()["n"], 2);
    }
    #[test]
    fn sibling_is_outside_dataset() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("data");
        fs::create_dir(&root).unwrap();
        let sibling = tmp.path().join("data-private.wav");
        fs::write(&sibling, []).unwrap();
        let store = Storage {
            settings: defaults(&root, &root),
            state_dir: root,
            grants: Grants::default(),
        };
        assert!(store.media(&sibling).is_err());
    }
}
