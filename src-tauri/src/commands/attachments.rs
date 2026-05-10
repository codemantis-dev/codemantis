use log::warn;
use serde::Serialize;
use std::fs;
use std::path::Path;

const MAX_IMAGE_SIZE: usize = 20 * 1024 * 1024; // 20MB

#[derive(Debug, Serialize)]
pub struct AttachmentInfo {
    pub file_path: String,
    pub file_name: String,
    pub file_size: u64,
    pub mime_type: String,
    pub is_image: bool,
}

/// Read a file and return its bytes for creating object URLs on the frontend.
#[tauri::command]
pub fn read_file_bytes(file_path: String) -> Result<Vec<u8>, String> {
    let path = Path::new(&file_path);
    if !path.exists() {
        return Err(format!("File not found: {}", file_path));
    }
    let metadata = fs::metadata(path).map_err(|e| e.to_string())?;
    if metadata.len() > MAX_IMAGE_SIZE as u64 {
        return Err("File too large for preview".to_string());
    }
    fs::read(path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_clipboard_image(
    project_path: String,
    image_data: Vec<u8>,
    filename: String,
) -> Result<AttachmentInfo, String> {
    if image_data.len() > MAX_IMAGE_SIZE {
        return Err(format!(
            "Image too large: {} bytes (max {} bytes)",
            image_data.len(),
            MAX_IMAGE_SIZE
        ));
    }

    let attachments_dir = Path::new(&project_path)
        .join(".codemantis")
        .join("attachments");

    fs::create_dir_all(&attachments_dir).map_err(|e| e.to_string())?;

    // Validate filename to prevent path traversal
    let safe_name = Path::new(&filename)
        .file_name()
        .ok_or_else(|| "Invalid filename".to_string())?;
    let name_str = safe_name.to_str().ok_or_else(|| "Non-UTF8 filename".to_string())?;
    if name_str.contains("..") || name_str.contains('/') || name_str.contains('\\') || name_str.contains('\0') {
        return Err("Filename contains invalid characters".to_string());
    }

    let file_path = attachments_dir.join(safe_name);
    fs::write(&file_path, &image_data).map_err(|e| e.to_string())?;

    // Ensure .codemantis is in .gitignore
    ensure_gitignore(&project_path);

    let path_str = file_path.to_string_lossy().to_string();
    Ok(AttachmentInfo {
        file_path: path_str,
        file_name: filename,
        file_size: image_data.len() as u64,
        mime_type: "image/png".to_string(),
        is_image: true,
    })
}

#[tauri::command]
pub fn get_file_info(file_path: String) -> Result<AttachmentInfo, String> {
    let path = Path::new(&file_path);
    if !path.exists() {
        return Err(format!("File not found: {}", file_path));
    }

    let metadata = fs::metadata(path).map_err(|e| e.to_string())?;
    let file_name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();

    let ext = path
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();

    let (mime_type, is_image) = match ext.as_str() {
        // Images
        "png" => ("image/png".to_string(), true),
        "jpg" | "jpeg" => ("image/jpeg".to_string(), true),
        "gif" => ("image/gif".to_string(), true),
        "webp" => ("image/webp".to_string(), true),
        "svg" => ("image/svg+xml".to_string(), true),
        // Documents
        "pdf" => ("application/pdf".to_string(), false),
        // Text / code
        "txt" | "md" | "markdown" => ("text/plain".to_string(), false),
        "json" => ("application/json".to_string(), false),
        "csv" => ("text/csv".to_string(), false),
        "xml" => ("text/xml".to_string(), false),
        "html" | "htm" => ("text/html".to_string(), false),
        "css" => ("text/css".to_string(), false),
        "js" | "mjs" | "cjs" => ("text/javascript".to_string(), false),
        "ts" | "tsx" | "jsx" => ("text/typescript".to_string(), false),
        "py" => ("text/x-python".to_string(), false),
        "rs" => ("text/x-rust".to_string(), false),
        "go" => ("text/x-go".to_string(), false),
        "java" => ("text/x-java".to_string(), false),
        "rb" => ("text/x-ruby".to_string(), false),
        "sh" | "bash" | "zsh" => ("text/x-shellscript".to_string(), false),
        "yaml" | "yml" => ("text/yaml".to_string(), false),
        "toml" => ("text/toml".to_string(), false),
        "sql" => ("text/sql".to_string(), false),
        "log" => ("text/plain".to_string(), false),
        _ => ("application/octet-stream".to_string(), false),
    };

    Ok(AttachmentInfo {
        file_path: file_path.clone(),
        file_name,
        file_size: metadata.len(),
        mime_type,
        is_image,
    })
}

#[tauri::command]
pub fn cleanup_old_attachments(project_path: String, max_age_days: u64) -> Result<u32, String> {
    let attachments_dir = Path::new(&project_path)
        .join(".codemantis")
        .join("attachments");

    if !attachments_dir.exists() {
        return Ok(0);
    }

    let now = std::time::SystemTime::now();
    let max_age = std::time::Duration::from_secs(max_age_days * 24 * 3600);
    let mut removed = 0u32;

    let entries = fs::read_dir(&attachments_dir).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        if let Ok(metadata) = entry.metadata() {
            if let Ok(modified) = metadata.modified() {
                if let Ok(age) = now.duration_since(modified) {
                    if age > max_age {
                        let _ = fs::remove_file(entry.path());
                        removed += 1;
                    }
                }
            }
        }
    }

    Ok(removed)
}

fn ensure_gitignore(project_path: &str) {
    let gitignore_path = Path::new(project_path).join(".gitignore");
    let entry = ".codemantis/";

    if gitignore_path.exists() {
        if let Ok(content) = fs::read_to_string(&gitignore_path) {
            if content.lines().any(|l| l.trim() == entry) {
                return; // Already present
            }
            // Append to existing .gitignore
            let separator = if content.ends_with('\n') { "" } else { "\n" };
            let new_content = format!("{}{}{}\n", content, separator, entry);
            if let Err(e) = fs::write(&gitignore_path, new_content) {
                warn!("Failed to update .gitignore: {}", e);
            }
        }
    } else if let Err(e) = fs::write(&gitignore_path, format!("{}\n", entry)) {
        warn!("Failed to create .gitignore: {}", e);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn test_save_clipboard_image_creates_file() {
        let tmp = tempfile::tempdir().unwrap();
        let project_path = tmp.path().to_str().unwrap().to_string();
        let data = vec![0x89, 0x50, 0x4E, 0x47]; // PNG magic bytes (partial)

        let result = save_clipboard_image(project_path.clone(), data.clone(), "test.png".into());
        assert!(result.is_ok());
        let info = result.unwrap();
        assert_eq!(info.file_name, "test.png");
        assert_eq!(info.file_size, 4);
        assert!(info.is_image);
        assert_eq!(info.mime_type, "image/png");

        let saved = fs::read(info.file_path).unwrap();
        assert_eq!(saved, data);
    }

    #[test]
    fn test_save_clipboard_image_rejects_oversized() {
        let tmp = tempfile::tempdir().unwrap();
        let project_path = tmp.path().to_str().unwrap().to_string();
        let data = vec![0u8; 21 * 1024 * 1024]; // 21MB

        let result = save_clipboard_image(project_path, data, "big.png".into());
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("too large"));
    }

    #[test]
    fn test_save_clipboard_image_creates_gitignore() {
        let tmp = tempfile::tempdir().unwrap();
        let project_path = tmp.path().to_str().unwrap().to_string();
        let data = vec![1, 2, 3];

        let _ = save_clipboard_image(project_path.clone(), data, "x.png".into());
        let gitignore = fs::read_to_string(tmp.path().join(".gitignore")).unwrap();
        assert!(gitignore.contains(".codemantis/"));
    }

    #[test]
    fn test_save_clipboard_image_appends_to_existing_gitignore() {
        let tmp = tempfile::tempdir().unwrap();
        let project_path = tmp.path().to_str().unwrap().to_string();
        fs::write(tmp.path().join(".gitignore"), "node_modules/\n").unwrap();

        let data = vec![1, 2, 3];
        let _ = save_clipboard_image(project_path.clone(), data, "x.png".into());
        let gitignore = fs::read_to_string(tmp.path().join(".gitignore")).unwrap();
        assert!(gitignore.contains("node_modules/"));
        assert!(gitignore.contains(".codemantis/"));
    }

    #[test]
    fn test_save_clipboard_image_does_not_duplicate_gitignore_entry() {
        let tmp = tempfile::tempdir().unwrap();
        let project_path = tmp.path().to_str().unwrap().to_string();
        fs::write(tmp.path().join(".gitignore"), ".codemantis/\n").unwrap();

        let data = vec![1, 2, 3];
        let _ = save_clipboard_image(project_path.clone(), data.clone(), "a.png".into());
        let _ = save_clipboard_image(project_path, data, "b.png".into());
        let gitignore = fs::read_to_string(tmp.path().join(".gitignore")).unwrap();
        assert_eq!(gitignore.matches(".codemantis/").count(), 1);
    }

    #[test]
    fn test_get_file_info_image() {
        let tmp = tempfile::tempdir().unwrap();
        let img_path = tmp.path().join("photo.png");
        fs::write(&img_path, b"fake png data").unwrap();

        let result = get_file_info(img_path.to_str().unwrap().to_string());
        assert!(result.is_ok());
        let info = result.unwrap();
        assert_eq!(info.file_name, "photo.png");
        assert!(info.is_image);
        assert_eq!(info.mime_type, "image/png");
    }

    #[test]
    fn test_get_file_info_non_image() {
        let tmp = tempfile::tempdir().unwrap();
        let txt_path = tmp.path().join("notes.txt");
        fs::write(&txt_path, b"hello world").unwrap();

        let result = get_file_info(txt_path.to_str().unwrap().to_string());
        assert!(result.is_ok());
        let info = result.unwrap();
        assert_eq!(info.file_name, "notes.txt");
        assert!(!info.is_image);
        assert_eq!(info.mime_type, "text/plain");
        assert_eq!(info.file_size, 11);
    }

    #[test]
    fn test_get_file_info_jpeg() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("photo.jpg");
        fs::write(&path, b"jpeg data").unwrap();
        let info = get_file_info(path.to_str().unwrap().to_string()).unwrap();
        assert!(info.is_image);
        assert_eq!(info.mime_type, "image/jpeg");
    }

    #[test]
    fn test_get_file_info_unknown_ext() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("data.xyz");
        fs::write(&path, b"binary").unwrap();
        let info = get_file_info(path.to_str().unwrap().to_string()).unwrap();
        assert!(!info.is_image);
        assert_eq!(info.mime_type, "application/octet-stream");
    }

    #[test]
    fn test_get_file_info_nonexistent() {
        let result = get_file_info("/nonexistent/file.txt".to_string());
        assert!(result.is_err());
    }

    #[test]
    fn test_cleanup_old_attachments_empty_dir() {
        let tmp = tempfile::tempdir().unwrap();
        let project_path = tmp.path().to_str().unwrap().to_string();
        let result = cleanup_old_attachments(project_path, 7);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), 0);
    }

    #[test]
    fn test_cleanup_old_attachments_keeps_recent() {
        let tmp = tempfile::tempdir().unwrap();
        let project_path = tmp.path().to_str().unwrap().to_string();
        let att_dir = tmp.path().join(".codemantis").join("attachments");
        fs::create_dir_all(&att_dir).unwrap();
        fs::write(att_dir.join("recent.png"), b"recent").unwrap();

        let result = cleanup_old_attachments(project_path, 7);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), 0);
        assert!(att_dir.join("recent.png").exists());
    }

    // --- Additional edge-case tests ---

    #[test]
    fn test_save_clipboard_image_exact_max_size() {
        let tmp = tempfile::tempdir().unwrap();
        let project_path = tmp.path().to_str().unwrap().to_string();
        let data = vec![0u8; MAX_IMAGE_SIZE]; // exactly 20MB

        let result = save_clipboard_image(project_path, data, "exact.png".into());
        assert!(result.is_ok());
        assert_eq!(result.unwrap().file_size, MAX_IMAGE_SIZE as u64);
    }

    #[test]
    fn test_save_clipboard_image_one_byte_over_max() {
        let tmp = tempfile::tempdir().unwrap();
        let project_path = tmp.path().to_str().unwrap().to_string();
        let data = vec![0u8; MAX_IMAGE_SIZE + 1];

        let result = save_clipboard_image(project_path, data, "over.png".into());
        assert!(result.is_err());
    }

    #[test]
    fn test_save_clipboard_image_prevents_path_traversal() {
        let tmp = tempfile::tempdir().unwrap();
        let project_path = tmp.path().to_str().unwrap().to_string();
        let data = vec![1, 2, 3];

        // Path::file_name() strips directory components, so "../escape.png" → "escape.png"
        // This is safe: the file is written inside attachments_dir regardless
        let result = save_clipboard_image(project_path.clone(), data.clone(), "../escape.png".into());
        assert!(result.is_ok(), "Traversal path safely reduced to basename");
        let info = result.unwrap();
        assert!(info.file_path.contains("attachments"), "File must be in attachments dir");
        assert!(info.file_path.ends_with("escape.png"));
        // Verify it did NOT escape
        let att_dir = tmp.path().join(".codemantis").join("attachments");
        assert!(att_dir.join("escape.png").exists(), "File in correct location");
        assert!(!tmp.path().join("escape.png").exists(), "File did NOT escape");

        // Pure ".." has no file_name() component — returns error
        let result2 = save_clipboard_image(project_path.clone(), data.clone(), "..".into());
        assert!(result2.is_err(), "Pure '..' should be rejected (no filename)");

        // "sub/dir/file.png" → file_name is "file.png" which is safe
        let result3 = save_clipboard_image(project_path.clone(), data.clone(), "sub/dir/file.png".into());
        assert!(result3.is_ok(), "Directory paths are safely reduced to basename");
        assert!(result3.unwrap().file_path.ends_with("file.png"));
    }

    #[test]
    fn test_save_clipboard_image_empty_data() {
        let tmp = tempfile::tempdir().unwrap();
        let project_path = tmp.path().to_str().unwrap().to_string();
        let data = vec![];

        let result = save_clipboard_image(project_path, data, "empty.png".into());
        assert!(result.is_ok());
        let info = result.unwrap();
        assert_eq!(info.file_size, 0);
    }

    #[test]
    fn test_save_clipboard_image_creates_attachments_dir() {
        let tmp = tempfile::tempdir().unwrap();
        let project_path = tmp.path().to_str().unwrap().to_string();
        let att_dir = tmp.path().join(".codemantis").join("attachments");

        assert!(!att_dir.exists());
        let _ = save_clipboard_image(project_path, vec![1], "a.png".into());
        assert!(att_dir.exists());
    }

    #[test]
    fn test_save_clipboard_image_overwrites_existing() {
        let tmp = tempfile::tempdir().unwrap();
        let project_path = tmp.path().to_str().unwrap().to_string();

        let _ = save_clipboard_image(project_path.clone(), vec![1, 2, 3], "dup.png".into());
        let result = save_clipboard_image(project_path, vec![4, 5], "dup.png".into());
        assert!(result.is_ok());
        let info = result.unwrap();
        assert_eq!(info.file_size, 2);

        let saved = fs::read(&info.file_path).unwrap();
        assert_eq!(saved, vec![4, 5]);
    }

    #[test]
    fn test_get_file_info_gif() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("anim.gif");
        fs::write(&path, b"GIF89a").unwrap();
        let info = get_file_info(path.to_str().unwrap().to_string()).unwrap();
        assert!(info.is_image);
        assert_eq!(info.mime_type, "image/gif");
    }

    #[test]
    fn test_get_file_info_webp() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("photo.webp");
        fs::write(&path, b"RIFF").unwrap();
        let info = get_file_info(path.to_str().unwrap().to_string()).unwrap();
        assert!(info.is_image);
        assert_eq!(info.mime_type, "image/webp");
    }

    #[test]
    fn test_get_file_info_pdf() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("doc.pdf");
        fs::write(&path, b"%PDF-1.4").unwrap();
        let info = get_file_info(path.to_str().unwrap().to_string()).unwrap();
        assert!(!info.is_image);
        assert_eq!(info.mime_type, "application/pdf");
    }

    #[test]
    fn test_get_file_info_markdown() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("README.md");
        fs::write(&path, b"# Title\n\nContent").unwrap();
        let info = get_file_info(path.to_str().unwrap().to_string()).unwrap();
        assert!(!info.is_image);
        assert_eq!(info.mime_type, "text/plain");
    }

    #[test]
    fn test_get_file_info_jpeg_extension() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("photo.jpeg");
        fs::write(&path, b"jpeg content").unwrap();
        let info = get_file_info(path.to_str().unwrap().to_string()).unwrap();
        assert!(info.is_image);
        assert_eq!(info.mime_type, "image/jpeg");
    }

    #[test]
    fn test_get_file_info_file_size_accuracy() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("exact.txt");
        let content = "Hello, World!"; // 13 bytes
        fs::write(&path, content).unwrap();
        let info = get_file_info(path.to_str().unwrap().to_string()).unwrap();
        assert_eq!(info.file_size, 13);
    }

    #[test]
    fn test_get_file_info_no_extension() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("Makefile");
        fs::write(&path, b"all: build").unwrap();
        let info = get_file_info(path.to_str().unwrap().to_string()).unwrap();
        assert!(!info.is_image);
        assert_eq!(info.mime_type, "application/octet-stream");
        assert_eq!(info.file_name, "Makefile");
    }

    #[test]
    fn test_ensure_gitignore_appends_without_trailing_newline() {
        let tmp = tempfile::tempdir().unwrap();
        let project_path = tmp.path().to_str().unwrap().to_string();
        // Write gitignore WITHOUT trailing newline
        fs::write(tmp.path().join(".gitignore"), "node_modules/").unwrap();

        ensure_gitignore(&project_path);
        let gitignore = fs::read_to_string(tmp.path().join(".gitignore")).unwrap();
        assert!(gitignore.contains("node_modules/\n.codemantis/\n"));
    }

    #[test]
    fn test_ensure_gitignore_with_whitespace_entry() {
        let tmp = tempfile::tempdir().unwrap();
        let project_path = tmp.path().to_str().unwrap().to_string();
        // Entry with trailing whitespace should still match after trim
        fs::write(tmp.path().join(".gitignore"), ".codemantis/  \n").unwrap();

        ensure_gitignore(&project_path);
        let gitignore = fs::read_to_string(tmp.path().join(".gitignore")).unwrap();
        // Should NOT add a duplicate entry
        assert_eq!(gitignore.matches(".codemantis/").count(), 1);
    }

    #[test]
    fn test_cleanup_old_attachments_no_attachments_dir() {
        let tmp = tempfile::tempdir().unwrap();
        let project_path = tmp.path().to_str().unwrap().to_string();
        // No .codemantis/attachments dir exists
        let result = cleanup_old_attachments(project_path, 7);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), 0);
    }

    #[test]
    fn test_cleanup_old_attachments_with_subdirs() {
        let tmp = tempfile::tempdir().unwrap();
        let project_path = tmp.path().to_str().unwrap().to_string();
        let att_dir = tmp.path().join(".codemantis").join("attachments");
        fs::create_dir_all(&att_dir).unwrap();
        // Create a recent file
        fs::write(att_dir.join("a.png"), b"data").unwrap();
        // Create a subdir (should be skipped, not crash)
        fs::create_dir_all(att_dir.join("subdir")).unwrap();

        let result = cleanup_old_attachments(project_path, 7);
        assert!(result.is_ok());
        // Only files should be counted, not dirs
    }

    #[test]
    fn test_save_multiple_images_creates_multiple_files() {
        let tmp = tempfile::tempdir().unwrap();
        let project_path = tmp.path().to_str().unwrap().to_string();

        let r1 = save_clipboard_image(project_path.clone(), vec![1], "a.png".into());
        let r2 = save_clipboard_image(project_path.clone(), vec![2], "b.png".into());
        let r3 = save_clipboard_image(project_path, vec![3], "c.png".into());

        assert!(r1.is_ok());
        assert!(r2.is_ok());
        assert!(r3.is_ok());

        let att_dir = tmp.path().join(".codemantis").join("attachments");
        assert!(att_dir.join("a.png").exists());
        assert!(att_dir.join("b.png").exists());
        assert!(att_dir.join("c.png").exists());
    }

    #[test]
    fn test_get_file_info_empty_file() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("empty.txt");
        fs::write(&path, b"").unwrap();
        let info = get_file_info(path.to_str().unwrap().to_string()).unwrap();
        assert_eq!(info.file_size, 0);
        assert_eq!(info.file_name, "empty.txt");
    }
}

