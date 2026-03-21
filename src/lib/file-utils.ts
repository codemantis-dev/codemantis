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

/** Read file content as text, returning undefined for binary/oversized files. */
export async function readFileContentSafe(filePath: string): Promise<string | undefined> {
  try {
    return await readFileContent(filePath);
  } catch {
    return undefined;
  }
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

/** Read file bytes and return a data: URI (base64-encoded). Used by SpecWriter
 *  so the API message builder can extract raw base64 for multimodal requests. */
async function createDataUri(filePath: string, mimeType: string): Promise<string | undefined> {
  try {
    const bytes = await readFileBytes(filePath);
    const uint8 = new Uint8Array(bytes);
    let binary = "";
    for (let i = 0; i < uint8.length; i++) {
      binary += String.fromCharCode(uint8[i]);
    }
    return `data:${mimeType};base64,${btoa(binary)}`;
  } catch {
    return undefined;
  }
}

/** Convert an array of file paths to SpecAttachment objects (images + documents). */
export async function processDroppedPathsForSpec(paths: string[]): Promise<SpecAttachment[]> {
  const results: SpecAttachment[] = [];
  for (const filePath of paths) {
    try {
      const info = await getFileInfo(filePath);
      if (info.is_image) {
        // Use data: URI (not blob: URL) so the API message builder can extract base64
        const previewUrl = await createDataUri(info.file_path, info.mime_type);
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
        // Try to read text content — fails gracefully for binary files (PDF, docx, etc.)
        let textContent: string | undefined;
        try {
          const raw = await readFileContent(info.file_path);
          textContent = raw.slice(0, 10000) + (raw.length > 10000 ? "..." : "");
        } catch {
          // Binary or oversized file — reference by name so the AI knows it was attached
          textContent = `[Attached binary file: ${info.file_name} (${info.mime_type}, ${Math.round(info.file_size / 1024)}KB)]`;
        }
        results.push({
          id: `att-${Date.now()}-${info.file_name}`,
          type: "document",
          name: info.file_name,
          size: info.file_size,
          mime_type: info.mime_type,
          text_content: textContent,
          file_path: info.file_path,
        });
      }
    } catch (err) {
      console.error("Failed to process dropped file:", filePath, err);
    }
  }
  return results;
}
