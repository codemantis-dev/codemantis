use crate::claude::event_types::RawStreamEvent;
use log::{debug, trace, warn};
use tokio::fs::File;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::ChildStdout;
use tokio::sync::mpsc;

/// Try to unwrap a `stream_event` wrapper.
/// When `--include-partial-messages` is used, the CLI wraps streaming events in:
///   `{"type":"stream_event","event":{...}}`
/// We extract the inner event and parse it as a RawStreamEvent.
fn try_unwrap_stream_event(value: serde_json::Value) -> Result<RawStreamEvent, serde_json::Value> {
    let mut obj = match value {
        serde_json::Value::Object(obj) => obj,
        other => return Err(other),
    };
    if obj.get("type").and_then(|v| v.as_str()) != Some("stream_event") {
        return Err(serde_json::Value::Object(obj));
    }
    match obj.remove("event") {
        Some(inner) => serde_json::from_value::<RawStreamEvent>(inner)
            .map_err(|_| serde_json::Value::Object(obj)),
        None => Err(serde_json::Value::Object(obj)),
    }
}

/// After this many consecutive un-parseable lines without a single valid event,
/// the parser concludes the CLI is speaking a protocol it doesn't understand
/// and emits a one-shot protocol-failure notification (used to surface the
/// "outdated CLI" remediation to the user).
const PROTOCOL_FAILURE_THRESHOLD: u32 = 5;

/// Read NDJSON events from the CLI's stdout and forward parsed events.
/// When `raw_log` is `Some`, every raw line is also tee'd to that file
/// (used for protocol-level diagnostics gated by `CODEMANTIS_RAW_STREAM_LOG`).
///
/// `protocol_failure_tx`, if provided, receives a single notification (with
/// the offending raw line) when the parser detects sustained protocol-level
/// gibberish (see `PROTOCOL_FAILURE_THRESHOLD`). Once notified, the parser
/// continues running but won't fire the channel again — exactly one error
/// surfaces to the user per session.
pub async fn parse_stream(
    stdout: ChildStdout,
    sender: mpsc::Sender<RawStreamEvent>,
    mut raw_log: Option<File>,
    protocol_failure_tx: Option<mpsc::Sender<String>>,
) {
    let reader = BufReader::new(stdout);
    let mut lines = reader.lines();
    let mut consecutive_parse_failures: u32 = 0;
    let mut protocol_failure_notified = false;
    let mut any_event_seen = false;

    loop {
        match lines.next_line().await {
            Ok(Some(line)) => {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }

                if let Some(f) = raw_log.as_mut() {
                    let _ = f.write_all(trimmed.as_bytes()).await;
                    let _ = f.write_all(b"\n").await;
                    let _ = f.flush().await;
                }

                trace!("Raw NDJSON: {}", trimmed);

                // First parse as generic JSON to check for stream_event wrapper
                let parsed: Result<serde_json::Value, _> = serde_json::from_str(trimmed);
                let event = match parsed {
                    Ok(value) => {
                        // try_unwrap_stream_event takes ownership; returns Ok(inner) or Err(original)
                        match try_unwrap_stream_event(value) {
                            Ok(inner) => inner,
                            Err(original) => {
                                match serde_json::from_value::<RawStreamEvent>(original) {
                                    Ok(ev) => ev,
                                    Err(e) => {
                                        warn!("Failed to parse NDJSON event: {} — raw: {}", e, trimmed);
                                        consecutive_parse_failures += 1;
                                        maybe_notify_protocol_failure(
                                            &protocol_failure_tx,
                                            &mut protocol_failure_notified,
                                            any_event_seen,
                                            consecutive_parse_failures,
                                            trimmed,
                                        )
                                        .await;
                                        continue;
                                    }
                                }
                            }
                        }
                    }
                    Err(e) => {
                        warn!("Failed to parse NDJSON line: {} — raw: {}", e, trimmed);
                        consecutive_parse_failures += 1;
                        maybe_notify_protocol_failure(
                            &protocol_failure_tx,
                            &mut protocol_failure_notified,
                            any_event_seen,
                            consecutive_parse_failures,
                            trimmed,
                        )
                        .await;
                        continue;
                    }
                };

                consecutive_parse_failures = 0;
                any_event_seen = true;
                if sender.send(event).await.is_err() {
                    debug!("Stream parser: receiver dropped, stopping");
                    break;
                }
            }
            Ok(None) => {
                debug!("Stream parser: stdout closed");
                break;
            }
            Err(e) => {
                warn!("Stream parser: read error: {}", e);
                break;
            }
        }
    }
}

/// Fires the protocol-failure channel once when the threshold is crossed.
/// We only treat it as a real protocol failure if we've never seen a valid
/// event yet — otherwise an occasional malformed line in a long session
/// shouldn't trigger the "outdated CLI" path.
async fn maybe_notify_protocol_failure(
    tx: &Option<mpsc::Sender<String>>,
    notified: &mut bool,
    any_event_seen: bool,
    consecutive_failures: u32,
    raw_line: &str,
) {
    if *notified {
        return;
    }
    if any_event_seen {
        return;
    }
    if consecutive_failures < PROTOCOL_FAILURE_THRESHOLD {
        return;
    }
    if let Some(sender) = tx {
        let truncated = if raw_line.len() > 200 {
            format!("{}…", &raw_line[..200])
        } else {
            raw_line.to_string()
        };
        let detail = format!(
            "{consecutive_failures} consecutive un-parseable lines from the CLI before any valid event. \
             First offending line: {truncated}"
        );
        let _ = sender.send(detail).await;
        *notified = true;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::claude::event_types::RawStreamEvent;

    // ── Helper: spawn a subprocess that echoes NDJSON to stdout ──

    async fn parse_ndjson(ndjson: &str) -> Vec<RawStreamEvent> {
        let (tx, mut rx) = mpsc::channel(256);

        let mut child = tokio::process::Command::new("printf")
            .arg("%s")
            .arg(ndjson.to_string())
            .stdout(std::process::Stdio::piped())
            .spawn()
            .expect("Failed to spawn printf");

        let stdout = child.stdout.take().unwrap();

        tokio::spawn(async move {
            parse_stream(stdout, tx, None, None).await;
        });

        let mut events = vec![];
        while let Some(event) = rx.recv().await {
            events.push(event);
        }
        events
    }

    // ── try_unwrap_stream_event unit tests ──

    #[test]
    fn unwrap_stream_event_extracts_inner_event() {
        let wrapper = serde_json::json!({
            "type": "stream_event",
            "event": {
                "type": "content_block_delta",
                "index": 0,
                "delta": { "type": "text_delta", "text": "Hello" }
            }
        });
        let result = try_unwrap_stream_event(wrapper);
        assert!(result.is_ok());
        assert!(matches!(result.unwrap(), RawStreamEvent::ContentBlockDelta { .. }));
    }

    #[test]
    fn unwrap_stream_event_returns_err_for_non_stream_event() {
        let direct = serde_json::json!({
            "type": "result",
            "duration_ms": 100
        });
        let result = try_unwrap_stream_event(direct);
        assert!(result.is_err());
        // The original value should be returned as-is for fallback parsing
        let original = result.unwrap_err();
        assert_eq!(original["type"], "result");
    }

    #[test]
    fn unwrap_stream_event_returns_err_for_non_object() {
        let array = serde_json::json!([1, 2, 3]);
        let result = try_unwrap_stream_event(array);
        assert!(result.is_err());

        let string = serde_json::json!("hello");
        let result = try_unwrap_stream_event(string);
        assert!(result.is_err());

        let null = serde_json::Value::Null;
        let result = try_unwrap_stream_event(null);
        assert!(result.is_err());
    }

    #[test]
    fn unwrap_stream_event_returns_err_when_event_field_missing() {
        let wrapper_no_event = serde_json::json!({
            "type": "stream_event"
            // no "event" field
        });
        let result = try_unwrap_stream_event(wrapper_no_event);
        assert!(result.is_err());
    }

    #[test]
    fn unwrap_stream_event_returns_err_when_inner_event_is_malformed() {
        let wrapper_bad_inner = serde_json::json!({
            "type": "stream_event",
            "event": "not_an_object"
        });
        // The inner event is a string, not a valid RawStreamEvent JSON object.
        // serde_json::from_value will fail, so try_unwrap_stream_event should return Err.
        let result = try_unwrap_stream_event(wrapper_bad_inner);
        assert!(result.is_err());
    }

    // ── parse_stream integration tests ──

    #[tokio::test]
    async fn parses_single_valid_json_line() {
        let events = parse_ndjson("{\"type\":\"system\",\"subtype\":\"init\",\"model\":\"sonnet\"}\n").await;
        assert_eq!(events.len(), 1);
        assert!(matches!(events[0], RawStreamEvent::System { .. }));
    }

    #[tokio::test]
    async fn parses_multiple_json_lines() {
        let ndjson = concat!(
            "{\"type\":\"system\",\"subtype\":\"init\",\"model\":\"sonnet\"}\n",
            "{\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"Hi\"}}\n",
            "{\"type\":\"content_block_stop\",\"index\":0}\n",
            "{\"type\":\"result\",\"duration_ms\":200}\n",
        );
        let events = parse_ndjson(ndjson).await;
        assert_eq!(events.len(), 4);
        assert!(matches!(events[0], RawStreamEvent::System { .. }));
        assert!(matches!(events[1], RawStreamEvent::ContentBlockDelta { .. }));
        assert!(matches!(events[2], RawStreamEvent::ContentBlockStop { .. }));
        assert!(matches!(events[3], RawStreamEvent::Result { .. }));
    }

    #[tokio::test]
    async fn handles_empty_lines_gracefully() {
        let ndjson = concat!(
            "\n",
            "{\"type\":\"system\",\"subtype\":\"init\",\"model\":\"sonnet\"}\n",
            "\n",
            "\n",
            "{\"type\":\"result\",\"duration_ms\":50}\n",
            "\n",
        );
        let events = parse_ndjson(ndjson).await;
        assert_eq!(events.len(), 2, "Empty lines should be skipped silently");
    }

    #[tokio::test]
    async fn handles_whitespace_only_lines() {
        let ndjson = concat!(
            "   \n",
            "{\"type\":\"system\",\"subtype\":\"init\",\"model\":\"sonnet\"}\n",
            "  \t  \n",
            "{\"type\":\"result\",\"duration_ms\":50}\n",
        );
        let events = parse_ndjson(ndjson).await;
        assert_eq!(events.len(), 2, "Whitespace-only lines should be skipped");
    }

    #[tokio::test]
    async fn handles_malformed_json_without_panic() {
        let ndjson = concat!(
            "{\"type\":\"system\",\"subtype\":\"init\",\"model\":\"sonnet\"}\n",
            "{broken json line\n",
            "not json at all\n",
            "{\"type\":\"result\",\"duration_ms\":50}\n",
        );
        let events = parse_ndjson(ndjson).await;
        assert_eq!(events.len(), 2, "Malformed lines should be skipped, valid lines kept");
        assert!(matches!(events[0], RawStreamEvent::System { .. }));
        assert!(matches!(events[1], RawStreamEvent::Result { .. }));
    }

    #[tokio::test]
    async fn unwraps_stream_event_wrapper_format() {
        let ndjson = concat!(
            "{\"type\":\"stream_event\",\"event\":{\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"Hello\"}}}\n",
            "{\"type\":\"stream_event\",\"event\":{\"type\":\"content_block_stop\",\"index\":0}}\n",
            "{\"type\":\"result\",\"duration_ms\":100}\n",
        );
        let events = parse_ndjson(ndjson).await;
        assert_eq!(events.len(), 3);
        // The wrapped events should be unwrapped to their inner types
        assert!(matches!(events[0], RawStreamEvent::ContentBlockDelta { .. }));
        assert!(matches!(events[1], RawStreamEvent::ContentBlockStop { .. }));
        assert!(matches!(events[2], RawStreamEvent::Result { .. }));
    }

    #[tokio::test]
    async fn handles_large_json_payload() {
        // Create a large text payload (~100KB)
        let large_text = "x".repeat(100_000);
        let ndjson = format!(
            "{{\"type\":\"assistant\",\"message\":{{\"role\":\"assistant\",\"content\":[{{\"type\":\"text\",\"text\":\"{}\"}}]}}}}\n",
            large_text
        );
        let events = parse_ndjson(&ndjson).await;
        assert_eq!(events.len(), 1);
        match &events[0] {
            RawStreamEvent::Assistant { message, .. } => {
                let content = message.content.as_ref().unwrap();
                match &content[0] {
                    crate::claude::event_types::ContentBlock::Text { text } => {
                        assert_eq!(text.len(), 100_000);
                    }
                    other => panic!("Expected Text, got {:?}", other),
                }
            }
            other => panic!("Expected Assistant, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn handles_utf8_content_in_json_values() {
        let ndjson = "{\"type\":\"assistant\",\"message\":{\"role\":\"assistant\",\"content\":[{\"type\":\"text\",\"text\":\"Hello, \u{4e16}\u{754c}! \u{1f600} Caf\u{e9} na\u{efb}ve r\u{e9}sum\u{e9}\"}]}}\n";
        let events = parse_ndjson(ndjson).await;
        assert_eq!(events.len(), 1);
        match &events[0] {
            RawStreamEvent::Assistant { message, .. } => {
                let content = message.content.as_ref().unwrap();
                match &content[0] {
                    crate::claude::event_types::ContentBlock::Text { text } => {
                        assert!(text.contains('\u{4e16}'));
                        assert!(text.contains("Caf\u{e9}"));
                    }
                    other => panic!("Expected Text, got {:?}", other),
                }
            }
            other => panic!("Expected Assistant, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn receiver_drop_stops_parser() {
        // When the receiver is dropped, the parser should stop gracefully
        let (tx, rx) = mpsc::channel(1);

        // Drop rx immediately
        drop(rx);

        // Feed a line — the parser should detect the dropped receiver and stop
        let ndjson = "{\"type\":\"system\",\"subtype\":\"init\",\"model\":\"sonnet\"}\n";
        let mut child = tokio::process::Command::new("printf")
            .arg("%s")
            .arg(ndjson)
            .stdout(std::process::Stdio::piped())
            .spawn()
            .expect("Failed to spawn printf");

        let stdout = child.stdout.take().unwrap();

        // This should complete without hanging — the send fails and the parser breaks
        let handle = tokio::spawn(async move {
            parse_stream(stdout, tx, None, None).await;
        });

        // Should complete within a reasonable time
        tokio::time::timeout(std::time::Duration::from_secs(5), handle)
            .await
            .expect("Parser should stop when receiver is dropped")
            .expect("Task should not panic");
    }

    #[tokio::test]
    async fn handles_valid_json_but_unknown_event_type() {
        let ndjson = "{\"type\":\"some_future_event_type\",\"data\":\"whatever\"}\n";
        let events = parse_ndjson(ndjson).await;
        assert_eq!(events.len(), 1);
        assert!(matches!(events[0], RawStreamEvent::Unknown));
    }

    #[tokio::test]
    async fn handles_json_without_type_field() {
        // Valid JSON but missing the "type" field required by the tagged enum
        let ndjson = "{\"foo\":\"bar\",\"baz\":123}\n";
        let events = parse_ndjson(ndjson).await;
        // This should be skipped because it can't be parsed as RawStreamEvent
        assert_eq!(events.len(), 0, "JSON without 'type' field should be skipped");
    }

    // ── Additional unwrap edge cases ──

    #[test]
    fn unwrap_stream_event_with_extra_fields() {
        // stream_event wrapper with extra top-level fields should still work
        let wrapper = serde_json::json!({
            "type": "stream_event",
            "event": {
                "type": "content_block_stop",
                "index": 0
            },
            "timestamp": "2026-01-01"
        });
        let result = try_unwrap_stream_event(wrapper);
        assert!(result.is_ok());
    }

    #[test]
    fn unwrap_stream_event_with_null_event() {
        let wrapper = serde_json::json!({
            "type": "stream_event",
            "event": null
        });
        let result = try_unwrap_stream_event(wrapper);
        // null cannot be deserialized into RawStreamEvent
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn handles_result_event_with_duration() {
        let ndjson = "{\"type\":\"result\",\"duration_ms\":1500}\n";
        let events = parse_ndjson(ndjson).await;
        assert_eq!(events.len(), 1);
        match &events[0] {
            RawStreamEvent::Result { duration_ms, .. } => {
                assert_eq!(*duration_ms, Some(1500));
            }
            other => panic!("Expected Result, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn handles_content_block_stop_event() {
        let ndjson = "{\"type\":\"content_block_stop\",\"index\":2}\n";
        let events = parse_ndjson(ndjson).await;
        assert_eq!(events.len(), 1);
        match &events[0] {
            RawStreamEvent::ContentBlockStop { index, .. } => {
                assert_eq!(*index, Some(2));
            }
            other => panic!("Expected ContentBlockStop, got {:?}", other),
        }
    }

    // ── Tool-use flow via content_block_start + input_json_delta ──

    #[tokio::test]
    async fn parses_tool_use_flow_with_input_json_delta() {
        let ndjson = concat!(
            "{\"type\":\"content_block_start\",\"index\":1,\"content_block\":{\"type\":\"tool_use\",\"id\":\"toolu_01\",\"name\":\"Bash\",\"input\":{}}}\n",
            "{\"type\":\"content_block_delta\",\"index\":1,\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"{\\\"command\\\":\"}}\n",
            "{\"type\":\"content_block_delta\",\"index\":1,\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"\\\"ls -la\\\"}\"}}\n",
            "{\"type\":\"content_block_stop\",\"index\":1}\n",
        );
        let events = parse_ndjson(ndjson).await;
        assert_eq!(events.len(), 4);
        // content_block_start with tool_use
        match &events[0] {
            RawStreamEvent::ContentBlockStart { index, content_block, .. } => {
                assert_eq!(*index, Some(1));
                match content_block.as_ref().unwrap() {
                    crate::claude::event_types::ContentBlock::ToolUse { id, name, .. } => {
                        assert_eq!(id, "toolu_01");
                        assert_eq!(name, "Bash");
                    }
                    other => panic!("Expected ToolUse, got {:?}", other),
                }
            }
            other => panic!("Expected ContentBlockStart, got {:?}", other),
        }
        // input_json_delta events
        match &events[1] {
            RawStreamEvent::ContentBlockDelta { delta, .. } => {
                match delta.as_ref().unwrap() {
                    crate::claude::event_types::StreamDelta::InputJsonDelta { partial_json } => {
                        assert!(partial_json.is_some());
                    }
                    other => panic!("Expected InputJsonDelta, got {:?}", other),
                }
            }
            other => panic!("Expected ContentBlockDelta, got {:?}", other),
        }
        // content_block_stop
        assert!(matches!(events[3], RawStreamEvent::ContentBlockStop { .. }));
    }

    // ── Rate-limit event ──

    #[tokio::test]
    async fn parses_rate_limit_event() {
        let ndjson = "{\"type\":\"rate_limit_event\",\"rate_limit_info\":{\"status\":\"allowed_warning\",\"resetsAt\":1741800000,\"utilization\":0.92,\"rateLimitType\":\"five_hour\",\"isUsingOverage\":false}}\n";
        let events = parse_ndjson(ndjson).await;
        assert_eq!(events.len(), 1);
        match &events[0] {
            RawStreamEvent::RateLimitEvent { rate_limit_info, .. } => {
                let info = rate_limit_info.as_ref().unwrap();
                assert_eq!(info.status.as_deref(), Some("allowed_warning"));
                assert!((info.utilization.unwrap() - 0.92).abs() < f64::EPSILON);
                assert_eq!(info.rate_limit_type.as_deref(), Some("five_hour"));
            }
            other => panic!("Expected RateLimitEvent, got {:?}", other),
        }
    }

    // ── Full conversation sequence ──

    #[tokio::test]
    async fn parses_full_conversation_sequence() {
        // Simulates a realistic conversation: system init → content_block_start → text deltas → stop → result
        let ndjson = concat!(
            "{\"type\":\"system\",\"subtype\":\"init\",\"model\":\"claude-sonnet-4-20250514\"}\n",
            "{\"type\":\"assistant\",\"message\":{\"role\":\"assistant\",\"content\":[{\"type\":\"text\",\"text\":\"\"}]}}\n",
            "{\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"text\",\"text\":\"\"}}\n",
            "{\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"Hello\"}}\n",
            "{\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\" world\"}}\n",
            "{\"type\":\"content_block_stop\",\"index\":0}\n",
            "{\"type\":\"result\",\"subtype\":\"success\",\"duration_ms\":1200,\"cost_usd\":0.005,\"num_turns\":1}\n",
        );
        let events = parse_ndjson(ndjson).await;
        assert_eq!(events.len(), 7);
        assert!(matches!(events[0], RawStreamEvent::System { .. }));
        assert!(matches!(events[1], RawStreamEvent::Assistant { .. }));
        assert!(matches!(events[2], RawStreamEvent::ContentBlockStart { .. }));
        assert!(matches!(events[3], RawStreamEvent::ContentBlockDelta { .. }));
        assert!(matches!(events[4], RawStreamEvent::ContentBlockDelta { .. }));
        assert!(matches!(events[5], RawStreamEvent::ContentBlockStop { .. }));
        assert!(matches!(events[6], RawStreamEvent::Result { .. }));
    }

    // ── Mixed valid and invalid lines: valid events survive ──

    #[tokio::test]
    async fn mixed_valid_and_invalid_lines_skips_invalid() {
        let ndjson = concat!(
            "{\"type\":\"system\",\"subtype\":\"init\",\"model\":\"sonnet\"}\n",
            "this is not json\n",
            "{totally broken\n",
            "{\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"ok\"}}\n",
            "{\"type\":\"unknown_future_thing\",\"data\":123}\n",
            "\n",
            "   \n",
            "{\"type\":\"result\",\"duration_ms\":50}\n",
        );
        let events = parse_ndjson(ndjson).await;
        // system + content_block_delta + unknown + result = 4 events
        assert_eq!(events.len(), 4);
        assert!(matches!(events[0], RawStreamEvent::System { .. }));
        assert!(matches!(events[1], RawStreamEvent::ContentBlockDelta { .. }));
        assert!(matches!(events[2], RawStreamEvent::Unknown));
        assert!(matches!(events[3], RawStreamEvent::Result { .. }));
    }
}
