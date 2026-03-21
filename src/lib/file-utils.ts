import { readFileBytes, getFileInfo, readFileContent } from "./tauri-commands";
import type { Attachment } from "../types/attachment";
import type { SpecAttachment } from "../types/spec-writer";

export async function fileToBase64(filePath: string): Promise<{ data: string; mimeType: string }> {
  const [bytes, info] = await Promise.all([readFileBytes(filePath), getFileInfo(filePath)]);
  const uint8 = new Uint8Array(bytes);
  let binary = "";
  for (let i = 0; i < uint8.length; i++) {
    binary += String.fromCharCode(uint8[i]);
  }
  return { data: btoa(binary), mimeType: info.mime_type };
}

/** Read a file via Rust and create a blob: URL for previewing in the webview. */
export async function createPreviewUrl(
  filePath: string,
  mimeType: string
): Promise<string | undefined> {
  try {
    const bytes = await readFileBytes(filePath);
    const blob = new Blob([new Uint8Array(bytes)], { type: mimeType });
    return URL.createObjectURL(blob);
  } catch {
    return undefined;
  }
}

/** Convert an array of file paths (from Tauri drag-drop) to Attachment objects. */
export async function processDroppedPaths(paths: string[]): Promise<Attachment[]> {
  const results: Attachment[] = [];
  for (const filePath of paths) {
    try {
      const info = await getFileInfo(filePath);
      const previewUrl = info.is_image
        ? await createPreviewUrl(info.file_path, info.mime_type)
        : undefined;
      results.push({
        id: `att-${Date.now()}-${info.file_name}`,
        fileName: info.file_name,
        filePath: info.file_path,
        fileSize: info.file_size,
        mimeType: info.mime_type,
        isImage: info.is_image,
        thumbnailUrl: previewUrl,
      });
    } catch (err) {
      console.error("Failed to process dropped file:", filePath, err);
    }
  }
  return results;
}

/** Convert an array of file paths to SpecAttachment objects (images + documents). */
export async function processDroppedPathsForSpec(paths: string[]): Promise<SpecAttachment[]> {
  const results: SpecAttachment[] = [];
  for (const filePath of paths) {
    try {
      const info = await getFileInfo(filePath);
      if (info.is_image) {
        const previewUrl = await createPreviewUrl(info.file_path, info.mime_type);
        results.push({
          id: `att-${Date.now()}-${info.file_name}`,
          type: "image",
          name: info.file_name,
          size: info.file_size,
          mime_type: info.mime_type,
          preview_url: previewUrl,
          file_path: info.file_path,
        });
      } else {
        const textContent = await readFileContent(info.file_path);
        results.push({
          id: `att-${Date.now()}-${info.file_name}`,
          type: "document",
          name: info.file_name,
          size: info.file_size,
          mime_type: info.mime_type,
          text_content:
            textContent.slice(0, 10000) +
            (textContent.length > 10000 ? "..." : ""),
          file_path: info.file_path,
        });
      }
    } catch (err) {
      console.error("Failed to process dropped file:", filePath, err);
    }
  }
  return results;
}
