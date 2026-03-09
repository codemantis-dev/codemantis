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

    if !path.exists() {
        // Ensure parent directory exists for new files
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
    }

    fs::write(path, content).map_err(|e| e.to_string())
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
