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
