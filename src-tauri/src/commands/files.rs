use serde::Serialize;
use std::fs;
use std::path::Path;

const MAX_DEPTH: usize = 5;
const MAX_FILE_SIZE: u64 = 1_048_576; // 1MB

const IGNORE_ENTRIES: &[&str] = &[
    "node_modules",
    ".git",
    ".next",
    "__pycache__",
    ".DS_Store",
    "target",

    ".venv",
    "venv",
    ".turbo",
    ".cache",
    "coverage",
    ".angular",
    ".svelte-kit",
    ".nuxt",
    ".codemantis",
];

#[derive(Debug, Clone, Serialize)]
pub struct FileNode {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<FileNode>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extension: Option<String>,
}

#[tauri::command]
pub fn read_file_tree(root_path: String) -> Result<Vec<FileNode>, String> {
    let path = Path::new(&root_path);
    if !path.exists() {
        return Err(format!("Path does not exist: {}", root_path));
    }
    if !path.is_dir() {
        return Err(format!("Path is not a directory: {}", root_path));
    }

    scan_directory(path, 0).map_err(|e| e.to_string())
}

fn scan_directory(dir: &Path, depth: usize) -> Result<Vec<FileNode>, std::io::Error> {
    if depth >= MAX_DEPTH {
        return Ok(vec![]);
    }

    let mut entries: Vec<FileNode> = Vec::new();
    let mut dir_entries: Vec<_> = fs::read_dir(dir)?.filter_map(|e| e.ok()).collect();

    dir_entries.sort_by(|a, b| {
        let a_is_dir = a.file_type().map(|ft| ft.is_dir()).unwrap_or(false);
        let b_is_dir = b.file_type().map(|ft| ft.is_dir()).unwrap_or(false);
        match (a_is_dir, b_is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.file_name().cmp(&b.file_name()),
        }
    });

    for entry in dir_entries {
        let name = entry.file_name().to_string_lossy().to_string();

        // Skip entries in the ignore list (noisy/internal dirs)
        if IGNORE_ENTRIES.contains(&name.as_str()) {
            continue;
        }

        let path = entry.path();

        // Skip symlinks to prevent traversal outside the project root
        if path.is_symlink() {
            continue;
        }

        let is_dir = path.is_dir();

        let children = if is_dir {
            Some(scan_directory(&path, depth + 1)?)
        } else {
            None
        };

        let extension = if !is_dir {
            path.extension()
                .map(|e| e.to_string_lossy().to_string())
        } else {
            None
        };

        entries.push(FileNode {
            name,
            path: path.to_string_lossy().to_string(),
            is_dir,
            children,
            extension,
        });
    }

    Ok(entries)
}

#[tauri::command]
pub fn write_file_content(file_path: String, content: String) -> Result<(), String> {
    let path = Path::new(&file_path);

    // Reject paths with null bytes or obvious traversal attempts
    if file_path.contains('\0') {
        return Err("Invalid file path".to_string());
    }

    // Resolve to absolute path and verify no symlink escape
    let resolved = if path.exists() {
        path.canonicalize().map_err(|e| format!("Cannot resolve path: {}", e))?
    } else {
        // For new files, canonicalize the parent and append the filename
        let parent = path.parent().ok_or("Invalid file path: no parent directory")?;
        if !parent.exists() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let canonical_parent = parent.canonicalize().map_err(|e| format!("Cannot resolve parent: {}", e))?;
        let file_name = path.file_name().ok_or("Invalid file path: no filename")?;
        canonical_parent.join(file_name)
    };

    fs::write(&resolved, content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn rename_file(old_path: String, new_path: String) -> Result<(), String> {
    // Reject paths with null bytes
    if old_path.contains('\0') || new_path.contains('\0') {
        return Err("Invalid file path".to_string());
    }

    let src = Path::new(&old_path);
    let dst = Path::new(&new_path);

    if !src.exists() {
        return Err(format!("Source does not exist: {}", old_path));
    }
    if dst.exists() {
        return Err(format!("Destination already exists: {}", new_path));
    }

    // Canonicalize source to resolve symlinks
    let resolved_src = src
        .canonicalize()
        .map_err(|e| format!("Cannot resolve source path: {}", e))?;

    // Canonicalize destination parent and append filename
    let dst_parent = dst.parent().ok_or("Invalid destination path: no parent directory")?;
    if !dst_parent.exists() {
        return Err(format!("Destination directory does not exist: {}", dst_parent.display()));
    }
    let canonical_dst_parent = dst_parent
        .canonicalize()
        .map_err(|e| format!("Cannot resolve destination parent: {}", e))?;
    let dst_name = dst
        .file_name()
        .ok_or("Invalid destination path: no filename")?;
    let resolved_dst = canonical_dst_parent.join(dst_name);

    fs::rename(&resolved_src, &resolved_dst).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_file(file_path: String) -> Result<(), String> {
    // Reject paths with null bytes
    if file_path.contains('\0') {
        return Err("Invalid file path".to_string());
    }

    let path = Path::new(&file_path);

    if !path.exists() {
        return Err(format!("Path does not exist: {}", file_path));
    }

    // Canonicalize to resolve symlinks and prevent path traversal
    let resolved = path
        .canonicalize()
        .map_err(|e| format!("Cannot resolve path: {}", e))?;

    if resolved.is_dir() {
        fs::remove_dir_all(&resolved).map_err(|e| e.to_string())
    } else {
        fs::remove_file(&resolved).map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn duplicate_file(file_path: String) -> Result<String, String> {
    let src = Path::new(&file_path);

    if !src.exists() {
        return Err(format!("File does not exist: {}", file_path));
    }
    if !src.is_file() {
        return Err("Can only duplicate files, not directories".to_string());
    }

    let parent = src.parent().ok_or("Cannot determine parent directory")?;
    let stem = src.file_stem().unwrap_or_default().to_string_lossy();
    let ext = src.extension().map(|e| e.to_string_lossy().to_string());

    let mut counter = 0u32;
    let dest = loop {
        let suffix = if counter == 0 {
            " copy".to_string()
        } else {
            format!(" copy {}", counter + 1)
        };
        let name = match &ext {
            Some(e) => format!("{}{}.{}", stem, suffix, e),
            None => format!("{}{}", stem, suffix),
        };
        let candidate = parent.join(&name);
        if !candidate.exists() {
            break candidate;
        }
        counter += 1;
        if counter > 100 {
            return Err("Too many copies exist".to_string());
        }
    };

    fs::copy(src, &dest).map_err(|e| e.to_string())?;
    Ok(dest.to_string_lossy().to_string())
}

#[tauri::command]
pub fn create_directory(dir_path: String) -> Result<(), String> {
    if dir_path.contains('\0') {
        return Err("Invalid directory path".to_string());
    }

    let path = Path::new(&dir_path);

    if path.exists() {
        return Err(format!("Already exists: {}", dir_path));
    }

    fs::create_dir_all(path).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn create_file(file_path: String) -> Result<(), String> {
    if file_path.contains('\0') {
        return Err("Invalid file path".to_string());
    }

    let path = Path::new(&file_path);

    if path.exists() {
        return Err(format!("File already exists: {}", file_path));
    }

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    fs::File::create(path).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn read_file_content(file_path: String) -> Result<String, String> {
    let path = Path::new(&file_path);

    if !path.exists() {
        return Err(format!("File not found: {}", file_path));
    }

    if !path.is_file() {
        return Err(format!("Not a file: {}", file_path));
    }

    let metadata = fs::metadata(path).map_err(|e| e.to_string())?;
    if metadata.len() > MAX_FILE_SIZE {
        return Err(format!(
            "File too large: {} bytes (max {} bytes)",
            metadata.len(),
            MAX_FILE_SIZE
        ));
    }

    fs::read_to_string(path).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn temp_dir() -> TempDir {
        tempfile::tempdir().expect("Failed to create temp dir")
    }

    // ── Null byte rejection ──

    #[test]
    fn write_file_rejects_null_byte_path() {
        let result = write_file_content("foo\0bar.txt".to_string(), "content".to_string());
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "Invalid file path");
    }

    #[test]
    fn rename_file_rejects_null_byte_in_source() {
        let result = rename_file("foo\0bar.txt".to_string(), "/tmp/dest.txt".to_string());
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "Invalid file path");
    }

    #[test]
    fn rename_file_rejects_null_byte_in_dest() {
        let result = rename_file("/tmp/src.txt".to_string(), "foo\0bar.txt".to_string());
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "Invalid file path");
    }

    #[test]
    fn delete_file_rejects_null_byte_path() {
        let result = delete_file("foo\0bar.txt".to_string());
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "Invalid file path");
    }

    #[test]
    fn create_file_rejects_null_byte_path() {
        let result = create_file("foo\0bar.txt".to_string());
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "Invalid file path");
    }

    #[test]
    fn create_directory_rejects_null_byte_path() {
        let result = create_directory("foo\0bar".to_string());
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "Invalid directory path");
    }

    // ── rename_file ──

    #[test]
    fn rename_file_succeeds_for_valid_paths() {
        let dir = temp_dir();
        let src = dir.path().join("source.txt");
        let dst = dir.path().join("dest.txt");
        fs::write(&src, "hello").unwrap();

        let result = rename_file(
            src.to_string_lossy().to_string(),
            dst.to_string_lossy().to_string(),
        );
        assert!(result.is_ok());
        assert!(!src.exists());
        assert!(dst.exists());
        assert_eq!(fs::read_to_string(&dst).unwrap(), "hello");
    }

    #[test]
    fn rename_file_fails_if_source_missing() {
        let dir = temp_dir();
        let src = dir.path().join("nonexistent.txt");
        let dst = dir.path().join("dest.txt");

        let result = rename_file(
            src.to_string_lossy().to_string(),
            dst.to_string_lossy().to_string(),
        );
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Source does not exist"));
    }

    #[test]
    fn rename_file_fails_if_dest_exists() {
        let dir = temp_dir();
        let src = dir.path().join("source.txt");
        let dst = dir.path().join("dest.txt");
        fs::write(&src, "hello").unwrap();
        fs::write(&dst, "existing").unwrap();

        let result = rename_file(
            src.to_string_lossy().to_string(),
            dst.to_string_lossy().to_string(),
        );
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Destination already exists"));
    }

    // ── delete_file ──

    #[test]
    fn delete_file_removes_a_file() {
        let dir = temp_dir();
        let file = dir.path().join("to_delete.txt");
        fs::write(&file, "bye").unwrap();

        let result = delete_file(file.to_string_lossy().to_string());
        assert!(result.is_ok());
        assert!(!file.exists());
    }

    #[test]
    fn delete_file_removes_a_directory() {
        let dir = temp_dir();
        let subdir = dir.path().join("sub");
        fs::create_dir(&subdir).unwrap();
        fs::write(subdir.join("child.txt"), "data").unwrap();

        let result = delete_file(subdir.to_string_lossy().to_string());
        assert!(result.is_ok());
        assert!(!subdir.exists());
    }

    #[test]
    fn delete_file_fails_if_not_exists() {
        let result = delete_file("/nonexistent_path_12345".to_string());
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Path does not exist"));
    }

    // ── create_file / create_directory ──

    #[test]
    fn create_file_works() {
        let dir = temp_dir();
        let file = dir.path().join("new_file.txt");

        let result = create_file(file.to_string_lossy().to_string());
        assert!(result.is_ok());
        assert!(file.exists());
    }

    #[test]
    fn create_file_fails_if_exists() {
        let dir = temp_dir();
        let file = dir.path().join("existing.txt");
        fs::write(&file, "").unwrap();

        let result = create_file(file.to_string_lossy().to_string());
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("File already exists"));
    }

    #[test]
    fn create_directory_works() {
        let dir = temp_dir();
        let subdir = dir.path().join("new_dir");

        let result = create_directory(subdir.to_string_lossy().to_string());
        assert!(result.is_ok());
        assert!(subdir.is_dir());
    }

    #[test]
    fn create_directory_fails_if_exists() {
        let dir = temp_dir();
        let subdir = dir.path().join("existing_dir");
        fs::create_dir(&subdir).unwrap();

        let result = create_directory(subdir.to_string_lossy().to_string());
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Already exists"));
    }

    // ── read_file_content ──

    #[test]
    fn read_file_content_returns_content() {
        let dir = temp_dir();
        let file = dir.path().join("readable.txt");
        fs::write(&file, "hello world").unwrap();

        let result = read_file_content(file.to_string_lossy().to_string());
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "hello world");
    }

    #[test]
    fn read_file_content_fails_for_missing_file() {
        let result = read_file_content("/nonexistent_12345.txt".to_string());
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("File not found"));
    }

    #[test]
    fn read_file_content_fails_for_directory() {
        let dir = temp_dir();
        let result = read_file_content(dir.path().to_string_lossy().to_string());
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Not a file"));
    }

    // ── duplicate_file ──

    #[test]
    fn duplicate_file_creates_copy() {
        let dir = temp_dir();
        let file = dir.path().join("original.txt");
        fs::write(&file, "content").unwrap();

        let result = duplicate_file(file.to_string_lossy().to_string());
        assert!(result.is_ok());
        let copy_path = result.unwrap();
        assert!(Path::new(&copy_path).exists());
        assert_eq!(fs::read_to_string(&copy_path).unwrap(), "content");
        assert!(copy_path.contains("original copy.txt"));
    }

    #[test]
    fn duplicate_file_fails_for_missing_file() {
        let result = duplicate_file("/nonexistent_12345.txt".to_string());
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("File does not exist"));
    }

    #[test]
    fn duplicate_file_fails_for_directory() {
        let dir = temp_dir();
        let result = duplicate_file(dir.path().to_string_lossy().to_string());
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Can only duplicate files"));
    }

    // ── write_file_content ──

    #[test]
    fn write_file_content_creates_new_file() {
        let dir = temp_dir();
        let file = dir.path().join("new_write.txt");

        let result = write_file_content(
            file.to_string_lossy().to_string(),
            "new content".to_string(),
        );
        assert!(result.is_ok());
        assert_eq!(fs::read_to_string(&file).unwrap(), "new content");
    }

    #[test]
    fn write_file_content_overwrites_existing_file() {
        let dir = temp_dir();
        let file = dir.path().join("overwrite.txt");
        fs::write(&file, "old").unwrap();

        let result = write_file_content(
            file.to_string_lossy().to_string(),
            "new".to_string(),
        );
        assert!(result.is_ok());
        assert_eq!(fs::read_to_string(&file).unwrap(), "new");
    }

    // ── read_file_tree ──

    #[test]
    fn read_file_tree_skips_ignored_entries() {
        let dir = temp_dir();
        fs::create_dir(dir.path().join("node_modules")).unwrap();
        fs::create_dir(dir.path().join(".git")).unwrap();
        fs::create_dir(dir.path().join("src")).unwrap();
        fs::write(dir.path().join("file.txt"), "").unwrap();

        let result = read_file_tree(dir.path().to_string_lossy().to_string());
        assert!(result.is_ok());
        let nodes = result.unwrap();
        let names: Vec<&str> = nodes.iter().map(|n| n.name.as_str()).collect();
        assert!(names.contains(&"src"));
        assert!(names.contains(&"file.txt"));
        assert!(!names.contains(&"node_modules"));
        assert!(!names.contains(&".git"));
    }

    #[test]
    fn read_file_tree_fails_for_nonexistent_dir() {
        let result = read_file_tree("/nonexistent_path_12345".to_string());
        assert!(result.is_err());
    }
}
