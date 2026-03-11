# CodeMantis — Multi-AI Assistant Providers

**Requirements Specification v1.0**

---

## 1. Feature Overview

Extend the Assistant panel to support multiple AI providers beyond Claude Code. Users can create assistant sessions powered by Claude Code (local CLI, existing behavior), OpenAI API, Google Gemini API, or Anthropic API (direct). Each assistant tab shows which provider/model is active, and conversations are managed per-provider with streaming support.

**Key principle:** Claude Code assistants remain the "hands" that can modify files and run commands. API-based assistants are chat-only — they can analyze code you paste to them, answer questions, review approaches, and brainstorm, but they cannot directly touch the filesystem.

---

## 2. Current State (What Already Exists)

The codebase already has most of the infrastructure needed:

**Rust backend (`src-tauri/src/changelog/summarizer.rs`):**
- Working `call_gemini()`, `call_openai()`, `call_anthropic()` functions
- Proper auth handling for all three providers
- Token usage tracking (input + output tokens)
- Error handling with status codes

**Settings (`src/types/settings.ts`):**
- `changelogApiKeys: Record<string, string>` — API keys per provider, already stored
- `changelogModelPricing: Record<string, ModelPricing>` — cost per 1M tokens (input/output), already defined
- `CHANGELOG_MODELS` — model lists with IDs, labels, and default pricing for OpenAI, Gemini, and Anthropic
- `ModelPricing` interface with `input` and `output` fields (cost per 1M tokens in USD)

**Assistant panel (`src/components/rightpanel/AssistantPanel.tsx`):**
- Multi-tab assistant UI with create/close/switch
- Message display with streaming support
- Input area with shortcuts
- Busy state tracking

**Assistant store (`src/stores/assistantStore.ts`):**
- Per-session message tracking (role, content, timestamp)
- Streaming state management (isStreaming, streamingContent, currentMessageId)
- Busy state per session

---

## 3. Settings Changes

### 3.1 Rename API Key Settings

The current settings use `changelogApiKeys` and `changelogModelPricing` — these names are too specific since the same keys and pricing will now be shared with the Assistant feature. Rename for clarity:

```typescript
// OLD (in AppSettings)
changelogApiKeys: Record<string, string>;
changelogModelPricing: Record<string, ModelPricing>;

// NEW
apiKeys: Record<string, string>;           // Shared across changelog + assistant
modelPricing: Record<string, ModelPricing>; // Shared across changelog + assistant
```

Update all references in:
- `src/types/settings.ts`
- `src/stores/settingsStore.ts` (default settings)
- `src/components/modals/SettingsModal.tsx` (settings UI)
- `src/components/rightpanel/ChangelogFeed.tsx` (if it reads keys directly)
- `src-tauri/src/commands/changelog.rs` (reads settings)
- `src-tauri/src/commands/settings.rs` (serialization)

Maintain backward compatibility: when loading settings from disk, if the old `changelogApiKeys` field exists but `apiKeys` does not, migrate automatically.

### 3.2 Rename Model Constants

```typescript
// OLD
export const CHANGELOG_MODELS: Record<ChangelogProvider, ...> = { ... };

// NEW
export const AI_MODELS: Record<AIProvider, ModelOption[]> = { ... };
```

This same model list is used for both Changelog provider selection and Assistant model selection.

### 3.3 New Settings: Assistant Defaults

Add to `AppSettings`:

```typescript
// New fields
assistantDefaultProvider: AIProvider;  // Default provider for new assistants ("claude-code" | "openai" | "gemini" | "anthropic")
assistantDefaultModel: Record<string, string>;  // Default model per provider, e.g. { "openai": "gpt-4.1", "gemini": "gemini-2.5-flash" }
```

### 3.4 Settings UI: "AI Providers" Tab

Rename the current "Changelog" tab in SettingsModal to **"AI Providers"** (since it now configures shared API keys and models used by both Changelog and Assistant).

Add a new section within this tab:

```
AI Providers
├── API Keys
│   ├── OpenAI:    [sk-...] [Test]
│   ├── Gemini:    [AI...] [Test]  
│   └── Anthropic: [sk-ant-...] [Test]
│
├── Model Pricing (per 1M tokens)
│   ├── GPT-4.1:              Input: [$2.00]  Output: [$8.00]
│   ├── GPT-5 Nano:           Input: [$0.50]  Output: [$2.00]
│   ├── GPT-5 Mini:           Input: [$1.00]  Output: [$4.00]
│   ├── Gemini 2.5 Flash Lite:Input: [$0.00]  Output: [$0.00]
│   ├── Gemini 2.5 Flash:     Input: [$0.15]  Output: [$0.60]
│   ├── Claude Sonnet 4.6:    Input: [$3.00]  Output: [$15.00]
│   └── Claude Haiku 4.5:     Input: [$0.80]  Output: [$4.00]
│
├── Assistant Defaults
│   ├── Default Provider: [Claude Code ▼]
│   └── Default Model:   (shown when API provider selected)
│
└── Changelog Settings
    ├── Enable Changelog: [toggle]
    ├── Provider: [Gemini ▼]
    ├── Model: [Gemini 2.5 Flash Lite ▼]
    └── Custom Prompt: [textarea]
```

**Important:** Model pricing fields should show default values (from `AI_MODELS` constants) but be user-editable. This lets users update pricing as providers change their rates, without requiring an app update. Pricing is stored in `modelPricing` and used for cost calculations in both Changelog and Assistant.

---

## 4. Provider Types and Model Registry

### 4.1 Type Definitions

Add to `src/types/settings.ts` or a new `src/types/assistant-provider.ts`:

```typescript
export type AIProvider = "claude-code" | "openai" | "gemini" | "anthropic";

export interface ModelOption {
  id: string;           // API model string (e.g., "gpt-4.1")
  label: string;        // Display name (e.g., "GPT-4.1")
  defaultPricing: ModelPricing;
}

export const AI_PROVIDERS: { id: AIProvider; label: string; requiresApiKey: boolean }[] = [
  { id: "claude-code", label: "Claude Code (local)", requiresApiKey: false },
  { id: "openai", label: "OpenAI", requiresApiKey: true },
  { id: "gemini", label: "Google Gemini", requiresApiKey: true },
  { id: "anthropic", label: "Anthropic API", requiresApiKey: true },
];

export const AI_MODELS: Record<Exclude<AIProvider, "claude-code">, ModelOption[]> = {
  openai: [
    { id: "gpt-4.1", label: "GPT-4.1", defaultPricing: { input: 2.0, output: 8.0 } },
    { id: "gpt-5-nano", label: "GPT-5 Nano", defaultPricing: { input: 0.5, output: 2.0 } },
    { id: "gpt-5-mini", label: "GPT-5 Mini", defaultPricing: { input: 1.0, output: 4.0 } },
  ],
  gemini: [
    { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite", defaultPricing: { input: 0.0, output: 0.0 } },
    { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", defaultPricing: { input: 0.15, output: 0.60 } },
  ],
  anthropic: [
    { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", defaultPricing: { input: 3.0, output: 15.0 } },
    { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", defaultPricing: { input: 0.80, output: 4.0 } },
  ],
};
```

Note: Claude Code (local) has no model selection — it uses whatever model the CLI session is configured with. API providers each have a selectable model list.

---

## 5. Assistant Store Changes

### 5.1 Extend AssistantInstance

```typescript
export interface AssistantInstance {
  id: string;              // For Claude Code: CLI session ID. For API: generated UUID.
  projectPath: string;
  name: string;
  sortOrder: number;
  createdAt: string;
  provider: AIProvider;    // NEW — which provider powers this assistant
  model: string | null;    // NEW — selected model (null for claude-code)
}
```

### 5.2 Add Cost Tracking

Add per-session cost tracking to the assistant store:

```typescript
// New state
sessionCost: Map<string, { inputTokens: number; outputTokens: number; totalCostUsd: number }>;

// New action
addTokenUsage: (sessionId: string, inputTokens: number, outputTokens: number, costUsd: number) => void;
```

Cost is calculated on the frontend when a response completes:

```typescript
function calculateCost(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
  modelPricing: Record<string, ModelPricing>
): number {
  const pricing = modelPricing[modelId];
  if (!pricing) return 0;
  return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
}
```

---

## 6. Rust Backend: New Chat Command

### 6.1 New Tauri Command

Create `src-tauri/src/commands/assistant_chat.rs`:

```rust
#[tauri::command]
pub async fn send_assistant_chat(
    app_handle: tauri::AppHandle,
    assistant_id: String,       // Used for emitting events
    provider: String,           // "openai" | "gemini" | "anthropic"
    api_key: String,
    model: String,
    system_prompt: String,
    messages: Vec<ChatMessage>, // Full conversation history
) -> Result<ChatResponse, String>
```

**`ChatMessage` struct:**
```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,      // "user" | "assistant" | "system"
    pub content: String,
}
```

**`ChatResponse` struct:**
```rust
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatResponse {
    pub content: String,
    pub input_tokens: u32,
    pub output_tokens: u32,
    pub model: String,
}
```

### 6.2 Streaming Implementation

The command should stream responses via Tauri events, not return the full text at once. This gives the typewriter effect matching Claude Code's behavior.

**Event name:** `assistant-stream-{assistantId}`

**Event payloads:**
```rust
// Token delta (emitted many times during generation)
{ "type": "delta", "text": "Here is" }

// Completion (emitted once at the end)
{ "type": "done", "content": "full response text", "input_tokens": 150, "output_tokens": 340 }

// Error
{ "type": "error", "message": "Rate limit exceeded" }
```

### 6.3 Streaming per Provider

**OpenAI (SSE streaming):**
```rust
let body = serde_json::json!({
    "model": model,
    "messages": convert_messages_openai(&system_prompt, &messages),
    "stream": true,            // Enable SSE streaming
    "temperature": 0.7,
});

let response = client
    .post("https://api.openai.com/v1/chat/completions")
    .bearer_auth(&api_key)
    .json(&body)
    .send().await?;

// Read SSE stream line by line
let mut stream = response.bytes_stream();
// Parse each "data: {...}" line
// Extract delta.content from each chunk
// Emit as Tauri event: assistant-stream-{id} { type: "delta", text: "..." }
```

Each SSE chunk from OpenAI looks like:
```
data: {"choices":[{"delta":{"content":"Hello"}}]}
```

Parse the `delta.content` field and emit it as a Tauri event.

**Gemini (SSE streaming):**
```rust
let url = format!(
    "https://generativelanguage.googleapis.com/v1beta/models/{}:streamGenerateContent?alt=sse&key={}",
    model, api_key
);

let body = serde_json::json!({
    "system_instruction": { "parts": [{"text": system_prompt}] },
    "contents": convert_messages_gemini(&messages),
    "generationConfig": { "temperature": 0.7 }
});
```

Each SSE chunk from Gemini looks like:
```
data: {"candidates":[{"content":{"parts":[{"text":"Hello"}]}}]}
```

Parse `candidates[0].content.parts[0].text` and emit.

**Anthropic (SSE streaming):**
```rust
let body = serde_json::json!({
    "model": model,
    "max_tokens": 4096,
    "system": system_prompt,
    "messages": convert_messages_anthropic(&messages),
    "stream": true,
});

let response = client
    .post("https://api.anthropic.com/v1/messages")
    .header("x-api-key", &api_key)
    .header("anthropic-version", "2023-06-01")
    .json(&body)
    .send().await?;
```

Anthropic SSE events use `event: content_block_delta` with:
```
data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}
```

Parse `delta.text` and emit.

### 6.4 Message Format Conversion

Each provider has slightly different message formats. Add conversion functions:

```rust
fn convert_messages_openai(system: &str, messages: &[ChatMessage]) -> Vec<serde_json::Value> {
    let mut result = vec![serde_json::json!({"role": "system", "content": system})];
    for msg in messages {
        result.push(serde_json::json!({"role": msg.role, "content": msg.content}));
    }
    result
}

fn convert_messages_gemini(messages: &[ChatMessage]) -> Vec<serde_json::Value> {
    // Gemini uses "user" and "model" roles (not "assistant")
    // Gemini uses "parts" array instead of "content" string
    messages.iter().map(|msg| {
        serde_json::json!({
            "role": if msg.role == "assistant" { "model" } else { &msg.role },
            "parts": [{"text": &msg.content}]
        })
    }).collect()
}

fn convert_messages_anthropic(messages: &[ChatMessage]) -> Vec<serde_json::Value> {
    // Anthropic format is same as internal format (role + content)
    // System prompt is a separate field, not in messages
    messages.iter().map(|msg| {
        serde_json::json!({"role": msg.role, "content": msg.content})
    }).collect()
}
```

### 6.5 Register the Command

Add to `lib.rs` invoke_handler:
```rust
commands::assistant_chat::send_assistant_chat,
```

---

## 7. Frontend: Assistant Session Hook Changes

### 7.1 Modify `useAssistantSession.ts`

The `createAssistant` function needs to accept a provider and model:

```typescript
createAssistant: (
  projectPath: string,
  provider: AIProvider,
  model: string | null,   // null for claude-code
) => Promise<string>;
```

**For Claude Code provider:** Existing behavior — call `createSession()`, spawn a CLI process, listen for events.

**For API providers:** No CLI process needed. Generate a local UUID as the assistant ID. No Tauri session creation. The conversation is managed entirely on the frontend, with API calls made per-message.

```typescript
const createAssistant = useCallback(async (
  projectPath: string,
  provider: AIProvider = "claude-code",
  model: string | null = null,
): Promise<string> => {
  const store = useAssistantStore.getState();
  const existing = store.getAssistants(projectPath);
  if (existing.length >= MAX_ASSISTANTS) {
    throw new Error(`Maximum ${MAX_ASSISTANTS} assistants allowed`);
  }

  const num = existing.length + 1;

  if (provider === "claude-code") {
    // Existing flow: create a Claude Code CLI session
    const session = await createSession(projectPath, `Assistant ${num}`);
    // ... existing event listener setup ...
    store.addAssistant(projectPath, {
      id: session.id, projectPath, name: `Assistant ${num}`,
      sortOrder: num, createdAt: new Date().toISOString(),
      provider: "claude-code", model: null,
    });
    return session.id;
  } else {
    // API provider: no CLI process, just a local ID
    const id = crypto.randomUUID();
    const modelLabel = model ? AI_MODELS[provider]?.find(m => m.id === model)?.label ?? model : provider;
    store.addAssistant(projectPath, {
      id, projectPath, name: `${modelLabel}`,
      sortOrder: num, createdAt: new Date().toISOString(),
      provider, model,
    });
    return id;
  }
}, []);
```

### 7.2 Modify `sendMessage`

The send function branches based on provider:

```typescript
const sendMessage = useCallback(async (sessionId: string, prompt: string) => {
  const store = useAssistantStore.getState();
  const projectPath = /* find project path from assistant instance */;
  const assistants = store.getAssistants(projectPath);
  const instance = assistants.find(a => a.id === sessionId);
  if (!instance) return;

  // Add user message to store
  const msgId = `asst-user-${Date.now()}`;
  store.addMessage(sessionId, {
    id: msgId, role: "user", content: prompt,
    timestamp: new Date().toISOString(), activityIds: [], isStreaming: false,
  });
  store.setBusy(sessionId, true);

  if (instance.provider === "claude-code") {
    // Existing: send via Claude Code CLI
    sendMessageCmd(sessionId, prompt).catch(/* ... */);
  } else {
    // API provider: collect conversation history and call API
    const messages = store.messages.get(sessionId) ?? [];
    const history = messages
      .filter(m => !m.isStreaming)
      .map(m => ({ role: m.role, content: m.content }));

    const settings = useSettingsStore.getState().settings;
    const apiKey = settings.apiKeys[instance.provider] ?? "";

    if (!apiKey) {
      store.addMessage(sessionId, {
        id: `asst-err-${Date.now()}`, role: "assistant",
        content: `No API key configured for ${instance.provider}. Go to Settings → AI Providers to add one.`,
        timestamp: new Date().toISOString(), activityIds: [], isStreaming: false,
      });
      store.setBusy(sessionId, false);
      return;
    }

    // Start streaming state
    const asstMsgId = `asst-resp-${Date.now()}`;
    store.startStreaming(sessionId, asstMsgId);

    // Build system prompt with project context
    const systemPrompt = buildAssistantSystemPrompt(instance.projectPath);

    try {
      // Listen for streaming events from Rust
      const unlisten = await listen<StreamEvent>(
        `assistant-stream-${sessionId}`,
        (event) => {
          const data = event.payload;
          if (data.type === "delta") {
            store.appendStreamingContent(sessionId, data.text);
          } else if (data.type === "done") {
            store.finalizeStreaming(sessionId, data.content);
            store.setBusy(sessionId, false);
            // Track cost
            const cost = calculateCost(
              instance.model!, data.input_tokens, data.output_tokens,
              settings.modelPricing
            );
            store.addTokenUsage(sessionId, data.input_tokens, data.output_tokens, cost);
            unlisten();
          } else if (data.type === "error") {
            store.finalizeStreaming(sessionId, `Error: ${data.message}`);
            store.setBusy(sessionId, false);
            unlisten();
          }
        }
      );

      // Call Rust command (streams response via events above)
      await invoke("send_assistant_chat", {
        assistantId: sessionId,
        provider: instance.provider,
        apiKey,
        model: instance.model,
        systemPrompt,
        messages: history,
      });
    } catch (e) {
      store.finalizeStreaming(sessionId, `Error: ${e}`);
      store.setBusy(sessionId, false);
    }
  }
}, []);
```

### 7.3 System Prompt Builder

Create a function that builds a context-aware system prompt for API assistants:

```typescript
function buildAssistantSystemPrompt(projectPath: string): string {
  return `You are a helpful coding assistant. The user is working on a project located at: ${projectPath}

You can help with:
- Answering questions about code and architecture
- Reviewing code snippets the user shares with you
- Suggesting improvements and best practices
- Explaining concepts and debugging strategies
- Planning features and discussing trade-offs

You do NOT have direct access to the filesystem. If the user needs file modifications, suggest they use the main Claude Code session.

Be concise and practical. When reviewing code, be specific about issues and provide concrete suggestions.`;
}
```

---

## 8. UI Changes

### 8.1 Provider Selector in New Assistant Flow

When the user clicks "+" to create a new assistant, show a provider selection dropdown instead of immediately creating a Claude Code session:

```
┌─────────────────────────────────┐
│  New Assistant                  │
│                                 │
│  Provider:                      │
│  ┌─────────────────────────┐   │
│  │ ○ Claude Code (local)   │   │
│  │ ○ OpenAI                │   │
│  │ ○ Google Gemini         │   │
│  │ ○ Anthropic API         │   │
│  └─────────────────────────┘   │
│                                 │
│  Model: [GPT-4.1 ▼]           │  ← only shown for API providers
│                                 │
│       [Cancel]  [Create]       │
└─────────────────────────────────┘
```

**Behavior:**
- Provider list shows all 4 options
- API providers that don't have an API key configured show a warning: "No API key — configure in Settings"
- Model dropdown appears only when an API provider is selected
- Model dropdown is pre-populated from `AI_MODELS[selectedProvider]`
- Default selections come from `assistantDefaultProvider` and `assistantDefaultModel` in settings
- Clicking "Create" calls `createAssistant(projectPath, provider, model)`

**Implementation:** This can be a small popover/dropdown anchored to the "+" button, or a mini-modal. Keep it lightweight — the user should be able to create an assistant in 2 clicks.

### 8.2 Provider Badge on Assistant Tabs

Each assistant tab should show which provider it uses. Modify `AssistantTabs.tsx`:

```
[• Claude 1] [◦ GPT-4.1] [◦ Gemini Flash] [+]
```

- Claude Code tabs show as they do today (green dot when busy)
- API provider tabs show a small provider label or icon instead of "Assistant N"
- The default name for API assistants is the model label (e.g., "GPT-4.1", "Gemini Flash")

### 8.3 Cost Display

Show accumulated session cost in the assistant panel. Add a small cost indicator below the messages area or in the tab bar:

```
[• GPT-4.1  $0.03] [◦ Gemini Flash  $0.00] [+]
```

Or as a subtle line above the input area:
```
─── GPT-4.1 · 1,240 tokens · $0.01 ───
```

Cost is calculated from token usage tracked in the assistant store, using the pricing from settings.

### 8.4 Capability Indicator

When an API assistant is active, show a subtle note in the empty state or above the input:

```
💬 Chat only — this assistant cannot modify files or run commands
```

This sets expectations and avoids confusion about why the API assistant isn't "doing" things like Claude Code does.

---

## 9. Conversation Management

### 9.1 Context Window

API assistants send the full conversation history with each request. This means the conversation accumulates tokens over time.

**Practical limits:**
- OpenAI GPT-4.1: 1M token context window
- Gemini 2.5 Flash: 1M token context window
- Anthropic Claude Sonnet 4.6: 200K token context window

For most assistant conversations (questions, code review, brainstorming), hitting these limits is unlikely. However, add a safety check:

- Track total tokens used in the conversation (sum of all input + output tokens)
- When approaching 80% of the model's context limit, show a warning: "Conversation is getting long. Consider starting a new assistant to keep costs down."
- When approaching 95%, suggest clearing or starting fresh

### 9.2 Conversation Persistence

API assistant conversations live only in the Zustand store (in memory). They are NOT persisted to SQLite.

**Rationale:** Claude Code sessions have their own persistence via the CLI. API conversations are lightweight side-conversations — losing them on app restart is acceptable for v1. Persistence can be added later if users request it.

### 9.3 Conversation Clearing

Add a "Clear conversation" option in the assistant tab context menu (right-click). This resets the message history for that assistant without closing/recreating it. Useful for starting fresh with the same model.

---

## 10. File Structure: New and Modified Files

### New Files
```
src-tauri/src/commands/assistant_chat.rs    — New Tauri command for API chat + streaming
src/types/assistant-provider.ts              — AIProvider, AI_MODELS, AI_PROVIDERS types
```

### Modified Files
```
src-tauri/src/lib.rs                         — Register new command
src-tauri/src/commands/mod.rs                — Add assistant_chat module
src/types/settings.ts                        — Rename changelog* → shared, add assistant defaults
src/stores/settingsStore.ts                  — Update defaults for renamed fields
src/stores/assistantStore.ts                 — Add provider/model to AssistantInstance, add cost tracking
src/hooks/useAssistantSession.ts             — Branch logic per provider, streaming for API
src/components/rightpanel/AssistantPanel.tsx  — Provider selector on create, capability indicator
src/components/rightpanel/AssistantTabs.tsx   — Show provider badge and cost
src/components/modals/SettingsModal.tsx       — Rename tab, add assistant defaults section
src/lib/tauri-commands.ts                    — Add typed wrapper for send_assistant_chat
```

---

## 11. Implementation Order

```
Step 1: Types and settings refactor
  - Create src/types/assistant-provider.ts with AIProvider, AI_MODELS, AI_PROVIDERS
  - Rename changelogApiKeys → apiKeys, changelogModelPricing → modelPricing in settings
  - Update all references (settings store, settings modal, changelog commands)
  - Add assistantDefaultProvider and assistantDefaultModel to AppSettings
  - Verify changelog still works after rename

Step 2: Extend assistant store
  - Add provider and model to AssistantInstance
  - Add sessionCost state and addTokenUsage action
  - Update all places that create AssistantInstance to include new fields

Step 3: Rust streaming chat command
  - Create src-tauri/src/commands/assistant_chat.rs
  - Implement send_assistant_chat with SSE streaming for all 3 providers
  - Add message format converters (OpenAI, Gemini, Anthropic)
  - Register in lib.rs
  - Add typed wrapper in tauri-commands.ts

Step 4: Frontend provider branching
  - Modify useAssistantSession.ts to branch on provider
  - For claude-code: keep existing flow unchanged
  - For API providers: call send_assistant_chat, listen for stream events
  - Handle streaming state (delta → append, done → finalize)
  - Handle errors gracefully

Step 5: UI updates
  - Add provider selection popover on "+" button in AssistantTabs
  - Show model dropdown for API providers
  - Show provider badge on tabs
  - Show cost indicator
  - Show "chat only" capability note for API assistants
  - Update SettingsModal with renamed tab and assistant defaults

Step 6: Testing
  - Test Claude Code assistant still works exactly as before
  - Test each API provider: create, send message, receive streamed response
  - Test with missing API key (should show friendly error)
  - Test cost tracking accuracy
  - Test conversation context (multi-turn with history)
  - Test creating mixed assistants (one Claude Code + one API in same project)
```

---

## 12. Edge Cases and Error Handling

| Scenario | Behavior |
|----------|----------|
| No API key configured | Show inline error message in chat: "No API key for [provider]. Configure in Settings → AI Providers." |
| API key invalid/expired | Show error from API response in chat. Don't crash. |
| Rate limit hit | Show "Rate limit reached. Wait a moment and try again." in chat. |
| Network error | Show "Network error. Check your connection." in chat. |
| Model not available | Show the API error message. Provider may have deprecated a model. |
| Very long conversation | Warn at 80% context usage. Suggest clearing. |
| Streaming interrupted | Finalize with whatever content was received. Show partial response. |
| User sends while streaming | Disable send button while busy (already implemented). |
| Close assistant while streaming | Cancel the in-flight request. Clean up listeners. |
| Switch tabs while streaming | Streaming continues in background. Messages update when user switches back. |
