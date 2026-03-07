use crate::claude::event_types::RawStreamEvent;
use log::{debug, warn};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::ChildStdout;
use tokio::sync::mpsc;

pub async fn parse_stream(
    stdout: ChildStdout,
    sender: mpsc::UnboundedSender<RawStreamEvent>,
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

                debug!("Raw NDJSON: {}", trimmed);

                match serde_json::from_str::<RawStreamEvent>(trimmed) {
                    Ok(event) => {
                        if sender.send(event).is_err() {
                            debug!("Stream parser: receiver dropped, stopping");
                            break;
                        }
                    }
                    Err(e) => {
                        warn!("Failed to parse NDJSON line: {} — raw: {}", e, trimmed);
                    }
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
