#!/usr/bin/env bash
# verify-mcp-templates.sh — Verify that all MCP server templates are real and correctly configured
#
# Usage:
#   ./scripts/verify-mcp-templates.sh              # Verify all templates
#   ./scripts/verify-mcp-templates.sh <id> [<id>]  # Verify specific templates
#   SKIP_README_CHECK=1 ./scripts/verify-mcp-templates.sh  # Skip README checks
#
# Exit codes:
#   0 — all templates passed
#   1 — one or more templates failed

set -euo pipefail

REGISTRY_JSON="scripts/mcp-templates-registry.json"
TEMPLATES_TS="src/types/mcp-templates.ts"
SKIP_README_CHECK="${SKIP_README_CHECK:-0}"
REPORT_FILE="/tmp/mcp-verification-$(date +%Y%m%d-%H%M%S).json"

passed=0
failed=0
warnings=0
results=()
report_entries=()

# ── Helpers ──

log() {
  echo "[$(date +%H:%M:%S)] $*"
}

log_pass() {
  log "✅ PASS: $1"
  results+=("PASS  $1")
  passed=$((passed + 1))
}

log_fail() {
  log "❌ FAIL: $1 — $2"
  results+=("FAIL  $1 — $2")
  failed=$((failed + 1))
}

log_warn() {
  log "⚠️  WARN: $1 — $2"
  warnings=$((warnings + 1))
}

# Portable timeout: macOS may lack GNU timeout
run_with_timeout() {
  local secs="$1"
  shift
  if command -v timeout &>/dev/null; then
    timeout "$secs" "$@"
  else
    perl -e "alarm $secs; exec @ARGV" "$@"
  fi
}

# Retry with backoff for npm rate limiting
npm_view_with_retry() {
  local pkg="$1"
  local retries=3
  local delay=10
  for ((i = 1; i <= retries; i++)); do
    local output
    if output=$(run_with_timeout 30 npm view "$pkg" name version homepage repository.url 2>&1); then
      echo "$output"
      return 0
    fi
    if echo "$output" | grep -q "429"; then
      log "  npm rate limited, retrying in ${delay}s (attempt $i/$retries)..."
      sleep "$delay"
      delay=$((delay * 2))
    else
      echo "$output"
      return 1
    fi
  done
  return 1
}

# ── Registry accessors (python3) ──

get_registry_ids() {
  python3 -c "
import json, sys
with open('$REGISTRY_JSON') as f:
    data = json.load(f)
for t in data['templates']:
    print(t['id'])
"
}

get_registry_field() {
  local id="$1" field="$2"
  python3 -c "
import json, sys
with open('$REGISTRY_JSON') as f:
    data = json.load(f)
for t in data['templates']:
    if t['id'] == '$id':
        val = t.get('$field')
        if val is None:
            print('')
        elif isinstance(val, list):
            print('\n'.join(str(v) for v in val))
        else:
            print(str(val))
        sys.exit(0)
print('')
"
}

# ── Verification Checks ──

verify_template() {
  local id="$1"
  local server_type npm_pkg pypi_pkg http_url github_repo docs_url
  server_type=$(get_registry_field "$id" "serverType")
  npm_pkg=$(get_registry_field "$id" "npmPackage")
  pypi_pkg=$(get_registry_field "$id" "pypiPackage")
  http_url=$(get_registry_field "$id" "httpUrl")
  github_repo=$(get_registry_field "$id" "githubRepo")
  docs_url=$(get_registry_field "$id" "docsUrl")

  local check1_status="SKIP" check2_status="SKIP" check3_status="SKIP"
  local check4_status="SKIP" check5_status="SKIP"
  local npm_version="" http_status_code=""

  log "━━━ Verifying: $id ($server_type) ━━━"

  # ── Check 1: Existence Proof ──
  if [ "$server_type" = "stdio" ] && [ -n "$npm_pkg" ]; then
    log "  Check 1: npm existence — $npm_pkg"
    local npm_output
    if npm_output=$(npm_view_with_retry "$npm_pkg" 2>&1); then
      npm_version=$(echo "$npm_output" | sed -n "s/^version = '\\(.*\\)'/\\1/p" | head -1)
      [ -z "$npm_version" ] && npm_version="unknown"
      log "  npm package exists (version: $npm_version)"
      check1_status="PASS"
    else
      log "  ❌ npm view failed for $npm_pkg"
      log_fail "$id" "npm package not found: $npm_pkg"
      report_entries+=("{\"id\":\"$id\",\"status\":\"FAIL\",\"reason\":\"npm package not found\"}")
      return
    fi
  elif [ "$server_type" = "stdio" ] && [ -n "$pypi_pkg" ]; then
    log "  Check 1: PyPI existence — $pypi_pkg"
    local pypi_status
    pypi_status=$(run_with_timeout 15 curl -sI -o /dev/null -w "%{http_code}" "https://pypi.org/pypi/$pypi_pkg/json" 2>/dev/null || echo "000")
    if [ "$pypi_status" = "200" ]; then
      local pypi_version
      pypi_version=$(run_with_timeout 15 curl -s "https://pypi.org/pypi/$pypi_pkg/json" 2>/dev/null | python3 -c "import json,sys; print(json.load(sys.stdin)['info']['version'])" 2>/dev/null || echo "unknown")
      npm_version="$pypi_version"  # reuse field for report
      log "  PyPI package exists (version: $pypi_version)"
      check1_status="PASS"
    else
      log "  ❌ PyPI package not found ($pypi_status)"
      log_fail "$id" "PyPI package not found: $pypi_pkg"
      report_entries+=("{\"id\":\"$id\",\"status\":\"FAIL\",\"reason\":\"PyPI package not found\"}")
      return
    fi
  elif [ "$server_type" = "http" ] && [ -n "$http_url" ]; then
    log "  Check 1: HTTP endpoint — $http_url"
    http_status_code=$(run_with_timeout 15 curl -sI -o /dev/null -w "%{http_code}" "$http_url" 2>/dev/null || echo "000")
    case "$http_status_code" in
      200|401|403|405|301|302|307|308)
        log "  HTTP endpoint responded ($http_status_code)"
        check1_status="PASS"
        ;;
      000)
        log "  ❌ HTTP endpoint unreachable (DNS/timeout)"
        log_fail "$id" "HTTP endpoint unreachable: $http_url"
        report_entries+=("{\"id\":\"$id\",\"status\":\"FAIL\",\"reason\":\"HTTP endpoint unreachable\"}")
        return
        ;;
      404)
        log "  ❌ HTTP endpoint returned 404"
        log_fail "$id" "HTTP endpoint not found (404): $http_url"
        report_entries+=("{\"id\":\"$id\",\"status\":\"FAIL\",\"reason\":\"HTTP 404\"}")
        return
        ;;
      *)
        log "  HTTP endpoint responded with unexpected code: $http_status_code"
        check1_status="PASS"
        ;;
    esac
  fi

  # ── Check 2: Template-Registry Consistency ──
  log "  Check 2: Template-registry consistency"
  local pkg_to_check=""
  if [ -n "$npm_pkg" ]; then
    pkg_to_check="$npm_pkg"
  elif [ -n "$pypi_pkg" ]; then
    pkg_to_check="$pypi_pkg"
  fi
  if [ "$server_type" = "stdio" ] && [ -n "$pkg_to_check" ]; then
    if grep -Fq "$pkg_to_check" "$TEMPLATES_TS"; then
      log "  Package name found in templates TS"
      check2_status="PASS"
    else
      log "  ❌ Package $pkg_to_check not found in $TEMPLATES_TS"
      log_fail "$id" "package not in template args: $pkg_to_check"
      report_entries+=("{\"id\":\"$id\",\"status\":\"FAIL\",\"reason\":\"registry/template mismatch\"}")
      return
    fi
  elif [ "$server_type" = "http" ] && [ -n "$http_url" ]; then
    if grep -Fq "$http_url" "$TEMPLATES_TS"; then
      log "  HTTP URL found in templates TS"
      check2_status="PASS"
    else
      log "  ❌ URL $http_url not found in $TEMPLATES_TS"
      log_fail "$id" "HTTP URL not in template: $http_url"
      report_entries+=("{\"id\":\"$id\",\"status\":\"FAIL\",\"reason\":\"registry/template mismatch\"}")
      return
    fi
  fi

  # ── Check 3: Env Var Consistency ──
  log "  Check 3: Env var consistency"
  local expected_vars
  expected_vars=$(get_registry_field "$id" "expectedEnvVars")
  if [ -n "$expected_vars" ]; then
    local env_ok=true
    while IFS= read -r var; do
      [ -z "$var" ] && continue
      if grep -Fq "$var" "$TEMPLATES_TS"; then
        log "  Env var $var found in template"
      else
        log "  ❌ Env var $var missing from template"
        env_ok=false
      fi
    done <<< "$expected_vars"
    if $env_ok; then
      check3_status="PASS"
    else
      log_fail "$id" "Missing env vars in template"
      report_entries+=("{\"id\":\"$id\",\"status\":\"FAIL\",\"reason\":\"missing env vars\"}")
      return
    fi
  else
    log "  No expected env vars — skipped"
    check3_status="PASS"
  fi

  # ── Check 4: Expected Args Consistency ──
  log "  Check 4: Expected args consistency"
  local expected_args
  expected_args=$(get_registry_field "$id" "expectedArgs")
  if [ -n "$expected_args" ]; then
    local args_ok=true
    while IFS= read -r arg; do
      [ -z "$arg" ] && continue
      if grep -Fq -- "$arg" "$TEMPLATES_TS"; then
        log "  Expected arg '$arg' found in template"
      else
        log "  ❌ Expected arg '$arg' missing from template"
        args_ok=false
      fi
    done <<< "$expected_args"
    if $args_ok; then
      check4_status="PASS"
    else
      log_fail "$id" "Missing expected args in template"
      report_entries+=("{\"id\":\"$id\",\"status\":\"FAIL\",\"reason\":\"missing expected args\"}")
      return
    fi
  else
    log "  No expected args — skipped"
    check4_status="PASS"
  fi

  # ── Check 5: README Cross-Reference (optional) ──
  if [ "$SKIP_README_CHECK" = "1" ]; then
    log "  Check 5: README check — skipped (SKIP_README_CHECK=1)"
    check5_status="SKIP"
  elif [ -n "$docs_url" ] && [ -n "$expected_vars" ]; then
    log "  Check 5: README cross-reference"
    # Convert GitHub URL to raw content URL
    local raw_url="$docs_url"
    raw_url=$(echo "$raw_url" | sed 's|github.com/\([^/]*/[^/]*\)/tree/main/\(.*\)|raw.githubusercontent.com/\1/main/\2/README.md|')
    raw_url=$(echo "$raw_url" | sed 's|github.com/\([^/]*/[^/]*\)#readme|raw.githubusercontent.com/\1/main/README.md|')
    raw_url=$(echo "$raw_url" | sed 's|github.com/\([^/]*/[^/]*\)$|raw.githubusercontent.com/\1/main/README.md|')

    local readme_content
    if readme_content=$(run_with_timeout 15 curl -sL "$raw_url" 2>/dev/null) && [ -n "$readme_content" ]; then
      local readme_ok=true
      while IFS= read -r var; do
        [ -z "$var" ] && continue
        if echo "$readme_content" | grep -qi "$var"; then
          log "  Env var $var found in README"
        else
          log "  ⚠️  Env var $var not found in README"
          log_warn "$id" "Env var $var not in README"
          readme_ok=false
        fi
      done <<< "$expected_vars"
      if $readme_ok; then
        check5_status="PASS"
      else
        check5_status="WARN"
      fi
    else
      log "  ⚠️  Could not fetch README from $raw_url"
      log_warn "$id" "README fetch failed"
      check5_status="WARN"
    fi
  else
    log "  Check 5: README check — no env vars to cross-reference"
    check5_status="PASS"
  fi

  # ── Version Tag Audit ──
  if [ "$server_type" = "stdio" ] && [ -n "$npm_pkg" ]; then
    if grep -Fq "${npm_pkg}@latest" "$TEMPLATES_TS"; then
      log "  Note: Template uses @latest tag (resolved to: ${npm_version:-unknown})"
    fi
  fi
  if [ "$server_type" = "stdio" ] && [ -n "$pypi_pkg" ]; then
    log "  Note: PyPI package (resolved version: ${npm_version:-unknown})"
  fi

  # ── Result ──
  log_pass "$id"
  local report_npm="" report_http=""
  [ -n "$npm_version" ] && report_npm="\"npmVersion\":\"$npm_version\","
  [ -n "$http_status_code" ] && report_http="\"httpStatusCode\":\"$http_status_code\","
  report_entries+=("{\"id\":\"$id\",\"status\":\"PASS\",${report_npm}${report_http}\"check1\":\"$check1_status\",\"check2\":\"$check2_status\",\"check3\":\"$check3_status\",\"check4\":\"$check4_status\",\"check5\":\"$check5_status\"}")
}

# ── Main ──

if [ ! -f "$REGISTRY_JSON" ]; then
  echo "Error: $REGISTRY_JSON not found. Run from project root." >&2
  exit 1
fi

if [ ! -f "$TEMPLATES_TS" ]; then
  echo "Error: $TEMPLATES_TS not found. Run from project root." >&2
  exit 1
fi

# Determine which templates to verify
if [ $# -gt 0 ]; then
  template_ids=("$@")
else
  template_ids=()
  while IFS= read -r line; do
    template_ids+=("$line")
  done < <(get_registry_ids)
fi

log "Verifying ${#template_ids[@]} MCP template(s)"
log "README check: $([ "$SKIP_README_CHECK" = "1" ] && echo "disabled" || echo "enabled")"
echo ""

for id in "${template_ids[@]}"; do
  verify_template "$id"
  echo ""
done

# ── JSON Report ──
{
  echo "{"
  echo "  \"generated_at\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\","
  echo "  \"total\": ${#template_ids[@]},"
  echo "  \"passed\": $passed,"
  echo "  \"failed\": $failed,"
  echo "  \"warnings\": $warnings,"
  echo "  \"templates\": ["
  first_entry=true
  for entry in "${report_entries[@]}"; do
    if $first_entry; then
      echo "    $entry"
      first_entry=false
    else
      echo "    ,$entry"
    fi
  done
  echo "  ]"
  echo "}"
} > "$REPORT_FILE"

log "Report saved to $REPORT_FILE"

# ── Summary ──
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "RESULTS:"
for r in "${results[@]}"; do
  echo "  $r"
done
echo ""
echo "Total: $((passed + failed)) | Passed: $passed | Failed: $failed | Warnings: $warnings"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ "$failed" -gt 0 ]; then
  exit 1
fi
