export interface Attachment {
  id: string;
  fileName: string;
  filePath: string;
  fileSize: number;
  mimeType: string;
  isImage: boolean;
  thumbnailUrl?: string;
}
