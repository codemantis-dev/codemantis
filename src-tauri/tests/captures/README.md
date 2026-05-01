# CLI protocol capture artefacts

Captures produced by `tests/cli_protocol_capture.rs`. Per-scenario `.jsonl`
files contain the raw stdin/stdout/stderr lines exchanged with the live
`claude` binary plus every PreToolUse hook request/response observed by the
harness's embedded approval stub. Per-scenario `.md` files are short
human-readable summaries.

These files are gitignored — they reference real model output and consume
Anthropic credits to regenerate. The synthesised report lives at
`docs/internal/cli-2.1.126-protocol-report.md` (committed).

## Re-running

```
cd src-tauri
cargo test --test cli_protocol_capture -- --ignored --nocapture --test-threads=1
```

Sequential by design: concurrent runs would race on hook port allocation.

Set `CM_HARNESS_KEEP=1` to retain prior captures (otherwise the directory is
wiped at the start of each run).
