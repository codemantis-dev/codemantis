---
name: flyio-containers
description: >
  Complete operational reference for building, deploying, integrating, and managing Fly.io
  containers in ContentScaler. Covers the full lifecycle: creating new containers, writing
  Dockerfiles, edge function dispatch patterns, Machines API integration, heartbeat monitoring,
  database tracking (fly_container_executions, fly_container_logs), deployment via deploy-all.sh,
  shared utilities, error recovery, reconciler awareness, and cost/credit tracking.
  Use when: creating a new Fly.io container, dispatching work to containers from edge functions,
  modifying container source code, debugging container failures, deploying containers, adding
  heartbeat/monitoring, checking container status, understanding the Fly.io integration architecture,
  or moving processing from edge functions to containers.
  Auto-triggers on: fly.io, flyio, fly container, fly machine, deploy container, container dispatch,
  fly deploy, deploy-all, build.sh, fly_container_executions, fly_container_logs, heartbeat,
  container processor, machines api, auto_destroy, content-generation-processor, research-processor,
  multi-page-processor, search-job-processor, cognitor-publisher, adhoc-collector, cs-video-processor,
  long-running, 150s timeout, edge function timeout, move to container, dispatch to fly.
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash
  - Write
  - Edit
  - Agent
---

# Fly.io Container Operations — Complete Reference

> **Last verified:** 2026-03-12 (7 production containers, all deployed and operational)

## Architecture Overview

Fly.io containers handle long-running jobs that exceed Supabase Edge Function limits (150s wall clock). Edge functions act as dispatchers: they validate the request, create a Fly.io machine via the Machines API, and return immediately. The container processes the work asynchronously with no timeout constraint.

**Flow:** User Request -> Edge Function (validate, credit check, dispatch) -> Fly.io Machine (process) -> Database (results)

### Active Containers (7)

| Container | Purpose | Memory | Dispatcher Edge Function |
|-----------|---------|--------|--------------------------|
| `research-processor-v2` | Deep research (5-stage pipeline) | 2048 MB | `research-coordinator`, `research-plan-processor` |
| `search-job-processor` | Search API + scraping | 2048 MB | `research-orchestrator`, `research-plan-processor` |
| `multi-page-processor` | Batch content creation | 1024 MB | `generate-multi-pages` |
| `cognitor-publisher` | WordPress batch publishing | 512 MB | `trigger-cognitor-batch-publish` |
| `adhoc-collector` | Ad-hoc research collection | 1024 MB | `adhoc-information-orchestrator` |
| `cs-video-processor` | Video generation | 1024 MB | `social-media-generate-video` |
| `content-generation-processor` | Complex content generation | 2048 MB | `generate-content` |

---

## Creating a New Container

### Step 1: Directory Structure

```
fly/{container-name}/
├── index.ts          # Entry point (required)
├── heartbeat.ts      # DB heartbeat (required)
├── monitoring.ts     # Progress tracking (required)
├── Dockerfile        # Deno 2.1.3 image (required)
└── fly.toml          # Fly.io app config (required)
```

### Step 2: Dockerfile Template

```dockerfile
FROM denoland/deno:2.1.3

WORKDIR /app

# Copy shared utilities (from fly/shared/)
COPY shared /app/shared

# Copy processor files
COPY {container-name}/index.ts /app/index.ts
COPY {container-name}/heartbeat.ts /app/heartbeat.ts
COPY {container-name}/monitoring.ts /app/monitoring.ts

RUN chmod +x /app/index.ts

CMD ["deno", "run", "--allow-net", "--allow-env", "--allow-read", "--allow-write", "/app/index.ts"]
```

**Notes:**
- Always use `denoland/deno:2.1.3` (pinned version that works with all shared utilities)
- The `COPY shared` and `COPY {container-name}/` paths are rewritten by `build.sh` during build
- Deno permissions: `--allow-net` (API calls), `--allow-env` (config), `--allow-read`/`--allow-write` (file ops)

### Step 3: fly.toml Template

```toml
# WARNING: DO NOT run 'flyctl deploy' directly from this directory!
# ALWAYS use: cd fly && ./deploy-all.sh {container-name}

app = "{container-name}"
primary_region = "iad"

[build]
  dockerfile = "Dockerfile"

[[vm]]
  cpu_kind = "shared"
  cpus = 1
  memory_mb = 1024  # Adjust: 512 (I/O only), 1024 (standard), 2048 (LLM/heavy)
```

**Memory sizing guide:**
- 512 MB: I/O-bound only (publishing, simple API calls)
- 1024 MB: Standard processing (batch operations, moderate API use)
- 2048 MB: Heavy workloads (LLM prompt construction, image processing, research)

### Step 4: index.ts Template

```typescript
import { createSupabaseClient } from "./shared/supabase-client.ts";
import { startHeartbeat } from "./heartbeat.ts";

async function main() {
  const jobId = Deno.env.get("JOB_ID");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const executionId = Deno.env.get("EXECUTION_ID");

  if (!jobId || !supabaseUrl || !supabaseServiceKey) {
    console.error("[FATAL] Missing required env vars");
    Deno.exit(1);
  }

  const supabase = createSupabaseClient();
  const stopHeartbeat = startHeartbeat(jobId, executionId || null, supabase);

  try {
    // === YOUR PROCESSING LOGIC HERE ===

    // Update execution record on success
    if (executionId) {
      await supabase
        .from("fly_container_executions")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
        })
        .eq("id", executionId);
    }
  } catch (error: any) {
    console.error(`[FATAL] ${error.message}`);
    if (executionId) {
      await supabase
        .from("fly_container_executions")
        .update({
          status: "failed",
          completed_at: new Date().toISOString(),
          error_message: error.message?.substring(0, 1000),
        })
        .eq("id", executionId);
    }
  } finally {
    stopHeartbeat();
    await new Promise(r => setTimeout(r, 1000)); // Allow final DB writes
    Deno.exit(0);
  }
}

main();
```

### Step 5: heartbeat.ts Template

Updates the database every 30 seconds so reconcilers know the container is alive.

```typescript
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

let heartbeatInterval: number | null = null;

export function startHeartbeat(
  jobId: string,
  executionId: string | null,
  supabase: SupabaseClient
): () => void {
  if (heartbeatInterval) clearInterval(heartbeatInterval);

  const update = async () => {
    try {
      const now = new Date().toISOString();
      // Update your job's primary table (e.g., content_pages.updated_at, research_jobs.last_heartbeat)
      await supabase.from("{primary_table}").update({ updated_at: now }).eq("id", jobId);
      // Update execution heartbeat
      if (executionId) {
        await supabase.from("fly_container_executions").update({ last_heartbeat: now }).eq("id", executionId);
      }
    } catch (error) {
      console.error(`[HEARTBEAT] Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  update(); // Initial heartbeat
  heartbeatInterval = setInterval(update, 30_000);

  return () => {
    if (heartbeatInterval) { clearInterval(heartbeatInterval); heartbeatInterval = null; }
  };
}
```

### Step 6: Register in Deployment Scripts

**`fly/deploy-all.sh`** — Add to `CONTAINERS` array:
```bash
CONTAINERS=(
  ...
  "{container-name}"
)
```

**`fly/build.sh`** — Add usage string and sed rule:
```bash
# Usage line:
echo "Usage: ./build.sh [...|{container-name}]"

# Sed rule (inside the else branch for simple containers):
sed -i.bak 's|COPY {container-name}/|COPY |g' "$BUILD_DIR/Dockerfile"
```

**Complex containers** (with subdirectories like `ai/`, `config/`, `stages/`): Add to the `if` condition that copies directory structure instead of flat files.

### Step 7: Create the Fly.io App

```bash
cd fly/{container-name}
flyctl apps create {container-name} --org personal
```

### Step 8: Deploy

```bash
cd fly
./deploy-all.sh {container-name}
```

---

## Edge Function Dispatch Pattern

Every edge function that dispatches to a Fly.io container follows this pattern:

### 1. Get Fly.io Token

```typescript
let flyApiToken = Deno.env.get('FLY_ACCESS_TOKEN');
if (flyApiToken) flyApiToken = flyApiToken.replace(/^["']|["']$/g, ''); // Strip quotes
if (!flyApiToken) throw new Error('FLY_ACCESS_TOKEN not set');
```

### 2. Hardcode Image Tag

```typescript
// ALWAYS use :latest — deploy-all.sh manages the actual image
const flyAppName = '{container-name}';
const flyImage = 'registry.fly.io/{container-name}:latest';
```

**FORBIDDEN:**
- `Deno.env.get('FLY_{NAME}_IMAGE')` — env var overrides cause version mismatch
- Hardcoded deployment tags like `deployment-01KAF8NG...`

### 3. Build Machine Config

```typescript
const machineId = `{prefix}-${jobId.substring(0, 8)}-${Date.now()}`;

const env: Record<string, string> = {
  JOB_ID: jobId,
  SUPABASE_URL: supabaseUrl,
  SUPABASE_SERVICE_ROLE_KEY: supabaseServiceKey,
  FLY_MACHINE_ID: machineId,
  // Add job-specific env vars...
};

const machineConfig = {
  name: machineId,
  config: {
    image: flyImage,
    env,
    init: {
      exec: ["deno", "run", "--allow-net", "--allow-env", "--allow-read", "--allow-write", "/app/index.ts"],
    },
    auto_destroy: true,
    restart: { policy: "no" },
    guest: {               // Optional: override fly.toml VM settings
      cpu_kind: "shared",
      cpus: 1,
      memory_mb: 2048,
    },
  },
};
```

**Key settings:**
- `auto_destroy: true` — machine self-destructs after `init.exec` exits
- `restart: { policy: "no" }` — prevents automatic restart that could re-process a job
- `init.exec` — the command to run (not CMD from Dockerfile; overrides it)

### 4. Record Execution

```typescript
const { data: execution } = await supabase
  .from('fly_container_executions')
  .insert({
    fly_machine_id: machineId,
    container_type: '{container-name}',
    status: 'starting',
    metadata: { job_id: jobId, fly_app_name: flyAppName, fly_image: flyImage },
    // Link to parent entity via the appropriate FK:
    // batch_id, job_id, cognitor_batch_id, or adhoc_job_id
  })
  .select('id')
  .single();

const executionId = execution.id;
env.EXECUTION_ID = executionId;  // Pass to container
```

### 5. Create Machine + Poll for Startup

```typescript
const apiUrl = `https://api.machines.dev/v1/apps/${flyAppName}/machines`;
const response = await fetch(apiUrl, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${flyApiToken}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(machineConfig),
});

if (!response.ok) {
  const errorText = await response.text().catch(() => 'Unknown');
  throw new Error(`Fly.io API error: ${response.status} - ${errorText}`);
}

const result = await response.json();
const actualMachineId = result.id || machineId;

// Poll for machine to auto-start (init.exec triggers auto-start)
// DO NOT call /start manually — causes 412 race condition
const MAX_WAIT = 30000;
const POLL_MS = 2000;
const pollStart = Date.now();
let started = false;

while (Date.now() - pollStart < MAX_WAIT) {
  await new Promise(r => setTimeout(r, POLL_MS));
  const state = await fetch(
    `https://api.machines.dev/v1/apps/${flyAppName}/machines/${actualMachineId}`,
    { headers: { 'Authorization': `Bearer ${flyApiToken}`, 'Content-Type': 'application/json' } }
  );
  if (state.ok) {
    const { state: s } = await state.json();
    if (s === 'started' || s === 'stopping' || s === 'stopped') { started = true; break; }
    if (s === 'destroyed' || s === 'failed') throw new Error(`Machine terminal state: ${s}`);
  }
}
```

### 6. Update Execution Record

```typescript
await supabase
  .from('fly_container_executions')
  .update({
    fly_machine_id: actualMachineId,
    status: started ? 'running' : 'starting',
    metadata: { ...metadata, final_state, wait_time_ms },
  })
  .eq('id', executionId);
```

### 7. Implement Fallback (optional but recommended)

If Fly.io dispatch fails, fall back to edge function self-call:

```typescript
try {
  await dispatchToFlyContainer(...);
} catch (flyError) {
  console.error(`Fly.io dispatch failed, falling back: ${flyError}`);
  fetch(backgroundUrl, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...requestBody, async_mode: false, _internal_sync_job_id: jobId }),
  }).catch(() => {});
}
```

---

## Database Tables

### fly_container_executions (16 columns, RLS enabled)

Tracks every machine dispatch event.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | Auto-generated |
| `batch_id` | uuid FK | -> multi_page_creation_batches |
| `job_id` | uuid FK | -> research_jobs |
| `cognitor_batch_id` | uuid FK | -> cognitor_publish_batches |
| `adhoc_job_id` | uuid FK | -> adhoc_collection_jobs |
| `fly_machine_id` | text NOT NULL | Unique machine identifier |
| `container_type` | text NOT NULL | Container name (e.g., "research-processor-v2") |
| `status` | text NOT NULL | "starting", "running", "completed", "failed" |
| `started_at` | timestamptz | When dispatch occurred |
| `completed_at` | timestamptz | When machine exited |
| `duration_ms` | integer | Total execution time |
| `error_message` | text | Failure details |
| `metadata` | jsonb | Machine config, context, custom data |
| `last_heartbeat` | timestamptz | Last heartbeat from container |
| `created_at` | timestamptz | Record creation |

**No `content_page_id` FK exists.** Store page references in `metadata` JSONB.

### fly_container_logs (14 columns, RLS enabled)

Detailed structured event logging.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | Auto-generated |
| `execution_id` | uuid FK | -> fly_container_executions |
| `batch_id` | uuid FK | Optional batch link |
| `job_id` | uuid FK | Optional job link |
| `timestamp` | timestamptz NOT NULL | When event occurred |
| `level` | text NOT NULL | "info", "warn", "error", "debug" |
| `event` | text NOT NULL | Event name |
| `stage` | text | Processing stage |
| `message` | text NOT NULL | Human-readable description |
| `metadata` | jsonb | Event-specific data |
| `duration_ms` | integer | For timing events |

**No `container_type` or `content_page_id` columns.** Store these in `metadata` JSONB.

### fly_performance_metrics (14 columns, RLS enabled)

Resource utilization and stage-level performance data.

---

## Shared Utilities (`fly/shared/`)

| File | Key Exports | Used By |
|------|-------------|---------|
| `supabase-client.ts` | `createSupabaseClient()`, `supabase` | All containers |
| `types.ts` | `ProgressUpdate`, `PerformanceMetrics` | multi-page, search-job |
| `credit-manager.ts` | `calculateAndDebitCredits()`, `debitCredits()` | Containers that debit credits directly |
| `logging.ts` | `logEvent()`, `createLogger()` | Dual-output logging (stdout + DB) |
| `usage-logger.ts` | `logApiCall()`, `logApiUsage()` | API cost tracking |
| `json-response-extractor.ts` | JSON parsing from LLM responses | Containers calling LLMs |
| `prompt-enhancer.ts` | `enhanceElementPrompt()` | Content generation |
| `prompt-resolver.ts` | `resolvePromptForElement()` | Prompt template resolution |
| `db-sanitizer.ts` | Input validation helpers | Data sanitization |

**Import pattern in containers:** `import { createSupabaseClient } from "./shared/supabase-client.ts";`

**Supabase client uses:** `@supabase/supabase-js@2.45.0` (pinned; v2.92.0 has `createRequire` bug with Deno)

---

## Deployment

### CRITICAL RULES

- **ALWAYS** deploy via `cd fly && ./deploy-all.sh {container-name}`
- **NEVER** run `flyctl deploy` directly (bypasses build, breaks shared file copying)
- **NEVER** use env var image overrides in edge functions (hardcode `:latest`)
- **NEVER** destroy running machines (may be processing jobs)

### Deployment Workflow

```bash
cd fly

# Deploy specific container
./deploy-all.sh {container-name}

# Deploy all containers
./deploy-all.sh

# Check status
./deploy-all.sh --list
```

**What deploy-all.sh does:**
1. Calls `build.sh` -> creates `.build/{container}/`, copies files, builds Docker image (`--platform linux/amd64`)
2. Tags `{container}:latest` -> `registry.fly.io/{container}:latest`
3. Also tags with timestamp (`registry.fly.io/{container}:YYYYMMDD-HHMMSS`) for rollback
4. Authenticates and pushes both tags to Fly.io registry
5. Cleans up stopped machines (skips running ones)

### Rollback

```bash
# List available images
flyctl image list --app {container-name}

# Rollback to timestamped version
flyctl deploy --image registry.fly.io/{container-name}:20260312-192421 --app {container-name}
```

### Viewing Logs

```bash
flyctl logs --app {container-name}
flyctl machines list --app {container-name}
```

---

## Error Handling and Recovery

### Container-Side Recovery

- Retry failed operations with exponential backoff
- Update `fly_container_executions.status` to "failed" with `error_message` on unrecoverable errors
- Always stop heartbeat and allow final DB writes before `Deno.exit(0)`

### Reconciler-Side Recovery

Reconcilers detect stalled containers by checking:
1. `last_heartbeat` age on `fly_container_executions`
2. `updated_at` age on the primary job table
3. Progress timestamps in JSONB progress fields

**Thresholds:**
- Edge function jobs: 5-minute stall threshold
- Fly.io container jobs: 15-minute stall threshold (containers run longer legitimately)

**Recovery actions:** Re-dispatch to new container or edge function, up to MAX_RETRY_ATTEMPTS with cooldown.

### Container Callback Pattern

When containers call edge functions for per-element processing, pass `_flyio_container: true` so the edge function:
- Processes the element synchronously
- Skips page-level finalization (container handles it)
- Skips fire-and-forget post-processing triggers

---

## Environment Variables

### Passed by Edge Function -> Container

| Variable | Required | Description |
|----------|----------|-------------|
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Service role key (bypasses RLS) |
| `JOB_ID` or `BATCH_ID` | Yes | Primary job identifier |
| `FLY_MACHINE_ID` | Yes | Unique machine identifier |
| `EXECUTION_ID` | No | `fly_container_executions.id` for heartbeat |
| `REQUEST_PAYLOAD` | No | JSON-encoded job configuration |

### Edge Function Secrets

| Secret | Where Set | Purpose |
|--------|-----------|---------|
| `FLY_ACCESS_TOKEN` | Supabase secrets | Fly.io Machines API authentication |

**Security boundary:** `FLY_ACCESS_TOKEN` is NEVER passed to containers. Containers use `SUPABASE_SERVICE_ROLE_KEY` only.

---

## Checklist: Adding a New Container

- [ ] Create `fly/{name}/` with index.ts, heartbeat.ts, monitoring.ts, Dockerfile, fly.toml
- [ ] Add to `CONTAINERS` array in `fly/deploy-all.sh`
- [ ] Add usage text and sed rule in `fly/build.sh`
- [ ] Create Fly.io app: `flyctl apps create {name} --org personal`
- [ ] Write dispatcher in edge function (or add dispatch branch to existing one)
- [ ] Add `_flyio_container` flag handling if edge function is called back by container
- [ ] Update reconciler if one exists for this job type (extended threshold, heartbeat check)
- [ ] Deploy: `cd fly && ./deploy-all.sh {name}`
- [ ] Deploy dispatcher edge function: `npx supabase functions deploy {fn-name} --no-verify-jwt`
- [ ] Add to `deploy-edge-function` skill's no-verify-jwt table if container calls the edge function
- [ ] Test: dispatch a job, verify container starts, heartbeat updates, job completes
- [ ] Run regression tests for affected area
