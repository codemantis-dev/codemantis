use crate::claude::event_types::RawStreamEvent;
use log::{debug, trace, warn};
use tokio::io::{AsyncBufReadExt, BufReader};
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

pub async fn parse_stream(
    stdout: ChildStdout,
    sender: mpsc::Sender<RawStreamEvent>,
) {
    let reader = BufReader::new(stdout);
    let mut lines = reader.lines();

    loop {
        match lines.next_line().await {
            Ok(Some(line)) => {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
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
                                        continue;
                                    }
                                }
                            }
                        }
                    }
                    Err(e) => {
                        warn!("Failed to parse NDJSON line: {} — raw: {}", e, trimmed);
                        continue;
                    }
                };

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
            parse_stream(stdout, tx).await;
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
            parse_stream(stdout, tx).await;
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
}
