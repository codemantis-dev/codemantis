#!/usr/bin/env bash
# verify-templates.sh — Verify that all CodeMantis templates scaffold successfully
#
# Usage:
#   ./scripts/verify-templates.sh              # Verify all templates
#   ./scripts/verify-templates.sh <id> [<id>]  # Verify specific templates
#   SKIP_DEV_CHECK=1 ./scripts/verify-templates.sh  # Skip dev server check
#
# Exit codes:
#   0 — all templates passed
#   1 — one or more templates failed

set -euo pipefail

TEMPLATES_JSON="src-tauri/resources/templates.json"
WORK_DIR=$(mktemp -d)
SKIP_DEV_CHECK="${SKIP_DEV_CHECK:-0}"
DEV_CHECK_TIMEOUT="${DEV_CHECK_TIMEOUT:-30}"
INSTALL_TIMEOUT="${INSTALL_TIMEOUT:-300}"

passed=0
failed=0
skipped=0
results=()

cleanup() {
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

log() {
  echo "[$(date +%H:%M:%S)] $*"
}

log_pass() {
  log "✅ PASS: $1"
  results+=("PASS  $1")
  ((passed++))
}

log_fail() {
  log "❌ FAIL: $1 — $2"
  results+=("FAIL  $1 — $2")
  ((failed++))
}

log_skip() {
  log "⏭️  SKIP: $1 — $2"
  results+=("SKIP  $1 — $2")
  ((skipped++))
}

# Parse templates.json using python3 (available on macOS and most CI)
get_template_ids() {
  python3 -c "
import json, sys
with open('$TEMPLATES_JSON') as f:
    data = json.load(f)
for t in data['templates']:
    print(t['id'])
"
}

get_template_field() {
  local id="$1" field="$2"
  python3 -c "
import json, sys
with open('$TEMPLATES_JSON') as f:
    data = json.load(f)
for t in data['templates']:
    if t['id'] == '$id':
        val = t.get('$field', '')
        if isinstance(val, list):
            print('\n'.join(val))
        else:
            print(val or '')
        sys.exit(0)
print('')
"
}

check_dev_server() {
  local dir="$1" dev_cmd="$2" dev_port="$3"

  if [ "$SKIP_DEV_CHECK" = "1" ] || [ -z "$dev_port" ] || [ "$dev_port" = "0" ]; then
    return 0
  fi

  # Skip Docker-based dev commands
  if echo "$dev_cmd" | grep -q "docker"; then
    log "  Skipping dev server check (Docker-based)"
    return 0
  fi

  log "  Starting dev server on port $dev_port..."

  # Start dev server in background
  cd "$dir"
  eval "$dev_cmd" > /dev/null 2>&1 &
  local dev_pid=$!

  # Wait for the port to become available
  local waited=0
  while [ $waited -lt "$DEV_CHECK_TIMEOUT" ]; do
    if curl -sf "http://localhost:$dev_port" > /dev/null 2>&1; then
      log "  Dev server responded on port $dev_port"
      kill "$dev_pid" 2>/dev/null || true
      wait "$dev_pid" 2>/dev/null || true
      return 0
    fi
    sleep 2
    ((waited += 2))
  done

  kill "$dev_pid" 2>/dev/null || true
  wait "$dev_pid" 2>/dev/null || true
  log "  Dev server did not respond within ${DEV_CHECK_TIMEOUT}s"
  return 1
}

verify_template() {
  local id="$1"
  local scaffold_type install_cmd dev_cmd dev_port repo_url branch cli_command
  scaffold_type=$(get_template_field "$id" "scaffold_type")
  install_cmd=$(get_template_field "$id" "install_command")
  dev_cmd=$(get_template_field "$id" "dev_command")
  dev_port=$(get_template_field "$id" "dev_port")
  repo_url=$(get_template_field "$id" "repo_url")
  branch=$(get_template_field "$id" "branch")
  cli_command=$(get_template_field "$id" "cli_command")

  local project_dir="$WORK_DIR/$id"

  log "━━━ Verifying: $id ($scaffold_type) ━━━"

  # Step 1: Clone or generate
  if [ "$scaffold_type" = "git-clone" ]; then
    if [ -z "$repo_url" ]; then
      log_fail "$id" "No repo_url defined"
      return
    fi

    log "  Cloning $repo_url (branch: $branch)..."
    if ! git clone --depth 1 --branch "$branch" "$repo_url" "$project_dir" 2>&1 | tail -3; then
      log_fail "$id" "git clone failed"
      return
    fi
    # Remove .git to match scaffold behavior
    rm -rf "$project_dir/.git"

  elif [ "$scaffold_type" = "cli" ]; then
    if [ -z "$cli_command" ]; then
      log_fail "$id" "No cli_command defined"
      return
    fi

    local resolved_cmd="${cli_command//\{\{PROJECT_NAME\}\}/$id}"
    log "  Running CLI: $resolved_cmd"
    cd "$WORK_DIR"
    if ! eval "$resolved_cmd" 2>&1 | tail -5; then
      log_fail "$id" "CLI scaffold command failed"
      return
    fi
    project_dir="$WORK_DIR/$id"

    if [ ! -d "$project_dir" ]; then
      log_fail "$id" "CLI command did not create project directory"
      return
    fi
  else
    log_skip "$id" "Unknown scaffold_type: $scaffold_type"
    return
  fi

  # Step 2: Install dependencies
  if [ -n "$install_cmd" ]; then
    log "  Installing: $install_cmd"
    cd "$project_dir"
    if ! timeout "$INSTALL_TIMEOUT" bash -c "$install_cmd" 2>&1 | tail -5; then
      log_fail "$id" "Install command failed: $install_cmd"
      return
    fi
  fi

  # Step 3: Basic verification
  if [ -f "$project_dir/package.json" ]; then
    if [ ! -d "$project_dir/node_modules" ]; then
      log_fail "$id" "node_modules missing after install"
      return
    fi
    local mod_count
    mod_count=$(ls "$project_dir/node_modules" 2>/dev/null | wc -l | tr -d ' ')
    if [ "$mod_count" -lt 3 ]; then
      log_fail "$id" "node_modules appears empty ($mod_count entries)"
      return
    fi
  fi

  # Step 4: Dev server check (optional)
  if [ "$SKIP_DEV_CHECK" != "1" ] && [ -n "$dev_port" ] && [ "$dev_port" != "0" ]; then
    if ! check_dev_server "$project_dir" "$dev_cmd" "$dev_port"; then
      log_fail "$id" "Dev server did not respond on port $dev_port"
      return
    fi
  fi

  log_pass "$id"
}

# ── Main ──

if [ ! -f "$TEMPLATES_JSON" ]; then
  echo "Error: $TEMPLATES_JSON not found. Run from project root." >&2
  exit 1
fi

# Determine which templates to verify
if [ $# -gt 0 ]; then
  template_ids=("$@")
else
  mapfile -t template_ids < <(get_template_ids)
fi

log "Verifying ${#template_ids[@]} template(s) in $WORK_DIR"
log "Dev server check: $([ "$SKIP_DEV_CHECK" = "1" ] && echo "disabled" || echo "enabled")"
echo ""

for id in "${template_ids[@]}"; do
  verify_template "$id"
  echo ""
done

# ── Summary ──
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "RESULTS:"
for r in "${results[@]}"; do
  echo "  $r"
done
echo ""
echo "Total: $((passed + failed + skipped)) | Passed: $passed | Failed: $failed | Skipped: $skipped"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ "$failed" -gt 0 ]; then
  exit 1
fi
