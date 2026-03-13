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
    let src = Path::new(&old_path);
    let dst = Path::new(&new_path);

    if !src.exists() {
        return Err(format!("Source does not exist: {}", old_path));
    }
    if dst.exists() {
        return Err(format!("Destination already exists: {}", new_path));
    }

    fs::rename(src, dst).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_file(file_path: String) -> Result<(), String> {
    let path = Path::new(&file_path);

    if !path.exists() {
        return Err(format!("Path does not exist: {}", file_path));
    }

    if path.is_dir() {
        fs::remove_dir_all(path).map_err(|e| e.to_string())
    } else {
        fs::remove_file(path).map_err(|e| e.to_string())
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
    let path = Path::new(&dir_path);

    if path.exists() {
        return Err(format!("Already exists: {}", dir_path));
    }

    fs::create_dir_all(path).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn create_file(file_path: String) -> Result<(), String> {
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
