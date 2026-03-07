export interface FileNode {
  name: string;
  path: string;
  is_dir: boolean;
  children?: FileNode[];
  extension?: string;
}
