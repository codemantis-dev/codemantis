export interface SpecConversation {
  id: string;
  project_path: string;
  messages: SpecMessage[];
  ai_provider: string;
  ai_model: string;
  status: 'gathering' | 'ready_to_write' | 'writing' | 'done';
  mode: 'new_application' | 'feature';
  context_loaded: boolean;
  templateCatalog?: string;
}

export interface SpecMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  attachments?: SpecAttachment[];
  message_type: 'conversation' | 'spec_document' | 'context_summary';
  timestamp: string;
  parsedOptions?: string[];
}

export interface SpecAttachment {
  id: string;
  type: 'image' | 'document';
  name: string;
  size: number;
  mime_type: string;
  preview_url?: string;
  text_content?: string;
  file_path: string;
}

export interface SpecDocumentInfo {
  filename: string;
  title: string;
  modified_at: string;
  size_bytes: number;
  path: string;
}

export interface SpecWriterUIState {
  is_open: boolean;
  chat_width: number;
  current_spec_content: string | null;
  selected_saved_spec: string | null;
}
