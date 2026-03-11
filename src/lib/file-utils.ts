import { readFileBytes, getFileInfo } from "./tauri-commands";

export async function fileToBase64(filePath: string): Promise<{ data: string; mimeType: string }> {
  const [bytes, info] = await Promise.all([readFileBytes(filePath), getFileInfo(filePath)]);
  const uint8 = new Uint8Array(bytes);
  let binary = "";
  for (let i = 0; i < uint8.length; i++) {
    binary += String.fromCharCode(uint8[i]);
  }
  return { data: btoa(binary), mimeType: info.mime_type };
}
