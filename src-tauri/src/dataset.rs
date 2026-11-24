use crate::storage::*;
use serde::Serialize;
use serde_json::Value;
use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
};
use walkdir::WalkDir;

#[derive(Serialize)]
pub struct Entry {
    path: PathBuf,
    name: String,
    category: String,
    size: u64,
}
#[derive(Default, Serialize)]
pub struct Dataset {
    videos: Vec<Entry>,
    sounds: Vec<Entry>,
    annotations: Vec<Entry>,
    bytes: u64,
    missing: Vec<String>,
}
pub fn scan(settings: &Value) -> Result<Dataset> {
    let mut scan = Dataset::default();
    let mut seen = HashSet::new();
    for key in [
        "datasetRoot",
        "videoDir",
        "soundDir",
        "annotationDir",
        "exportDir",
        "projectDir",
        "cacheDir",
        "tempDir",
    ] {
        let path = dir(settings, key)?;
        if !path.is_dir() {
            scan.missing.push(key.into());
            continue;
        }
        if !matches!(
            key,
            "videoDir" | "soundDir" | "annotationDir" | "exportDir" | "projectDir"
        ) {
            continue;
        }
        let root = canonical(&path)?;
        for item in WalkDir::new(&root)
            .follow_links(false)
            .into_iter()
            .filter_entry(|f| f.depth() == 0 || !f.file_name().to_string_lossy().starts_with('.'))
        {
            let f = match item {
                Ok(f) => f,
                Err(_) => {
                    if !scan.missing.iter().any(|k| k == key) {
                        scan.missing.push(key.into());
                    }
                    continue;
                }
            };
            if !f.file_type().is_file() {
                continue;
            }
            let p = f.path();
            let target = match key {
                "videoDir" if ext(p, VIDEOS) => &mut scan.videos,
                "soundDir" if ext(p, SOUNDS) => &mut scan.sounds,
                "annotationDir" | "projectDir" if ext(p, PROJECTS) => &mut scan.annotations,
                "exportDir" if p.file_name().and_then(|n| n.to_str()) == Some("metadata.json") => {
                    &mut scan.annotations
                }
                _ => continue,
            };
            let path = canonical(p)?;
            if !path.starts_with(&root) || !seen.insert(path.clone()) {
                continue;
            }
            let size = f.metadata().map_err(err)?.len();
            scan.bytes += size;
            let parent = path
                .parent()
                .and_then(|p| p.strip_prefix(&root).ok())
                .unwrap_or(Path::new(""));
            let category = if parent.as_os_str().is_empty() {
                "General".into()
            } else {
                parent.to_string_lossy().into_owned()
            };
            target.push(Entry {
                path,
                name: f.file_name().to_string_lossy().into_owned(),
                category,
                size,
            });
        }
    }
    for list in [&mut scan.videos, &mut scan.sounds, &mut scan.annotations] {
        list.sort_by(|a, b| a.path.cmp(&b.path));
    }
    Ok(scan)
}

pub fn wave_cache_dir(settings: &Value) -> Result<PathBuf> {
    let cache = canonical(&dir(settings, "cacheDir")?)?;
    let path = cache.join("foleymarks-waveforms-v1");
    if !path.exists() {
        match fs::create_dir(&path) {
            Ok(()) => (),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => (),
            Err(e) => return Err(err(e)),
        }
    }
    let path = canonical(&path)?;
    if path.parent() != Some(cache.as_path()) {
        return Err("Invalid waveform cache directory".into());
    }
    Ok(path)
}
pub fn clear_cache(settings: &Value) -> Result<usize> {
    let cache = wave_cache_dir(settings)?;
    let mut n = 0;
    for item in fs::read_dir(&cache).map_err(err)? {
        let item = item.map_err(err)?;
        let p = item.path();
        let valid = p
            .file_stem()
            .and_then(|f| f.to_str())
            .is_some_and(|s| s.len() == 64 && s.bytes().all(|c| c.is_ascii_hexdigit()));
        if valid && ext(&p, &["json"]) && item.file_type().map_err(err)?.is_file() {
            fs::remove_file(p).map_err(err)?;
            n += 1;
        }
    }
    Ok(n)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn scan_unicode_and_missing() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path();
        let files = root.join("é choir");
        fs::create_dir(&files).unwrap();
        fs::write(files.join("tone.WAV"), b"audio").unwrap();
        let mut cfg = json!({});
        for k in DIRS {
            cfg[k] = json!(root);
        }
        cfg["videoDir"] = json!(root.join("absent"));
        let index = scan(&cfg).unwrap();
        assert_eq!(index.bytes, 5);
        assert_eq!(index.sounds.len(), 1);
        assert_eq!(index.missing, vec!["videoDir"]);
    }
    #[test]
    fn clearing_only_removes_generated_entries() {
        let temp = tempfile::tempdir().unwrap();
        let settings = json!({"cacheDir":temp.path()});
        let dest = wave_cache_dir(&settings).unwrap();
        fs::write(dest.join("notes.json"), b"notes").unwrap();
        fs::write(dest.join(format!("{}.json", "a".repeat(64))), []).unwrap();
        assert_eq!(clear_cache(&settings).unwrap(), 1);
        assert!(dest.join("notes.json").exists());
    }
}
