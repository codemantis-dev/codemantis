// `#[cfg(test)]` already applied by the parent `claude::mod`'s
// `#[cfg(test)] mod tests;` declaration — no inner wrapper module
// needed (avoids the `module_inception` clippy lint).
#![cfg(test)]

use crate::claude::event_types::*;
use crate::commands::files::{read_file_content, read_file_tree};
use crate::utils::claude_detection::detect_claude;
use std::fs;
use std::path::PathBuf;

    // ──────────────────────────────────────────────────────────
    // NDJSON PARSING — every event type the CLI can emit
    // ──────────────────────────────────────────────────────────

    #[test]
    fn parse_system_init_event() {
        let json = r#"{"type":"system","subtype":"init","model":"claude-sonnet-4-20250514","tools":["Read","Write"],"mcp_servers":[]}"#;
        let event: RawStreamEvent = serde_json::from_str(json).unwrap();
        match event {
            RawStreamEvent::System {
                subtype, model, ..
            } => {
                assert_eq!(subtype.as_deref(), Some("init"));
                assert_eq!(model.as_deref(), Some("claude-sonnet-4-20250514"));
            }
            other => panic!("Expected System, got {:?}", other),
        }
    }

    #[test]
    fn parse_assistant_text_event() {
        let json = r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Hello, world!"}],"model":"claude-sonnet-4-20250514"},"session_id":"abc-123"}"#;
        let event: RawStreamEvent = serde_json::from_str(json).unwrap();
        match event {
            RawStreamEvent::Assistant { message, .. } => {
                let content = message.content.unwrap();
                assert_eq!(content.len(), 1);
                match &content[0] {
                    ContentBlock::Text { text } => assert_eq!(text, "Hello, world!"),
                    other => panic!("Expected Text, got {:?}", other),
                }
            }
            other => panic!("Expected Assistant, got {:?}", other),
        }
    }

    #[test]
    fn parse_assistant_tool_use_event() {
        let json = r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"toolu_01abc","name":"Read","input":{"file_path":"src/main.rs"}}]},"session_id":"abc-123"}"#;
        let event: RawStreamEvent = serde_json::from_str(json).unwrap();
        match event {
            RawStreamEvent::Assistant { message, .. } => {
                let content = message.content.unwrap();
                assert_eq!(content.len(), 1);
                match &content[0] {
                    ContentBlock::ToolUse { id, name, input } => {
                        assert_eq!(id, "toolu_01abc");
                        assert_eq!(name, "Read");
                        assert_eq!(input["file_path"], "src/main.rs");
                    }
                    other => panic!("Expected ToolUse, got {:?}", other),
                }
            }
            other => panic!("Expected Assistant, got {:?}", other),
        }
    }

    #[test]
    fn parse_assistant_tool_result_event() {
        let json = r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_result","tool_use_id":"toolu_01abc","content":"file contents here","is_error":false}]}}"#;
        let event: RawStreamEvent = serde_json::from_str(json).unwrap();
        match event {
            RawStreamEvent::Assistant { message, .. } => {
                let content = message.content.unwrap();
                match &content[0] {
                    ContentBlock::ToolResult {
                        tool_use_id,
                        content,
                        is_error,
                    } => {
                        assert_eq!(tool_use_id, "toolu_01abc");
                        assert_eq!(
                            content.as_ref().unwrap(),
                            &serde_json::Value::String("file contents here".to_string())
                        );
                        assert_eq!(*is_error, Some(false));
                    }
                    other => panic!("Expected ToolResult, got {:?}", other),
                }
            }
            other => panic!("Expected Assistant, got {:?}", other),
        }
    }

    #[test]
    fn parse_content_block_delta_text() {
        let json =
            r#"{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}"#;
        let event: RawStreamEvent = serde_json::from_str(json).unwrap();
        match event {
            RawStreamEvent::ContentBlockDelta { delta, index, .. } => {
                assert_eq!(index, Some(0));
                match delta.unwrap() {
                    StreamDelta::TextDelta { text } => assert_eq!(text, "Hello"),
                    other => panic!("Expected TextDelta, got {:?}", other),
                }
            }
            other => panic!("Expected ContentBlockDelta, got {:?}", other),
        }
    }

    #[test]
    fn parse_content_block_delta_input_json() {
        let json = r#"{"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\"file"}}"#;
        let event: RawStreamEvent = serde_json::from_str(json).unwrap();
        match event {
            RawStreamEvent::ContentBlockDelta { delta, .. } => {
                match delta.unwrap() {
                    StreamDelta::InputJsonDelta { partial_json } => {
                        assert_eq!(partial_json.as_deref(), Some("{\"file"));
                    }
                    other => panic!("Expected InputJsonDelta, got {:?}", other),
                }
            }
            other => panic!("Expected ContentBlockDelta, got {:?}", other),
        }
    }

    #[test]
    fn parse_content_block_start_tool_use() {
        let json = r#"{"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_xyz","name":"Bash","input":{}}}"#;
        let event: RawStreamEvent = serde_json::from_str(json).unwrap();
        match event {
            RawStreamEvent::ContentBlockStart {
                content_block, ..
            } => {
                match content_block.unwrap() {
                    ContentBlock::ToolUse { id, name, .. } => {
                        assert_eq!(id, "toolu_xyz");
                        assert_eq!(name, "Bash");
                    }
                    other => panic!("Expected ToolUse, got {:?}", other),
                }
            }
            other => panic!("Expected ContentBlockStart, got {:?}", other),
        }
    }

    #[test]
    fn parse_content_block_stop() {
        let json = r#"{"type":"content_block_stop","index":0}"#;
        let event: RawStreamEvent = serde_json::from_str(json).unwrap();
        match event {
            RawStreamEvent::ContentBlockStop { index, .. } => {
                assert_eq!(index, Some(0));
            }
            other => panic!("Expected ContentBlockStop, got {:?}", other),
        }
    }

    #[test]
    fn parse_result_success() {
        let json = r#"{"type":"result","subtype":"success","duration_ms":4500,"session_id":"sess-1","cost_usd":0.003,"usage":{"input_tokens":1200,"output_tokens":800}}"#;
        let event: RawStreamEvent = serde_json::from_str(json).unwrap();
        match event {
            RawStreamEvent::Result {
                duration_ms,
                cost_usd,
                usage,
                is_error,
                ..
            } => {
                assert_eq!(duration_ms, Some(4500));
                assert!((cost_usd.unwrap() - 0.003).abs() < f64::EPSILON);
                assert_eq!(is_error, None);
                let u = usage.unwrap();
                assert_eq!(u.input_tokens, Some(1200));
                assert_eq!(u.output_tokens, Some(800));
            }
            other => panic!("Expected Result, got {:?}", other),
        }
    }

    #[test]
    fn parse_result_error() {
        let json = r#"{"type":"result","subtype":"error","is_error":true,"result":"Rate limit exceeded","duration_ms":100}"#;
        let event: RawStreamEvent = serde_json::from_str(json).unwrap();
        match event {
            RawStreamEvent::Result {
                is_error, result, ..
            } => {
                assert_eq!(is_error, Some(true));
                assert_eq!(result.as_deref(), Some("Rate limit exceeded"));
            }
            other => panic!("Expected Result, got {:?}", other),
        }
    }

    #[test]
    fn parse_unknown_event_type_does_not_panic() {
        let json = r#"{"type":"some_future_event","data":"whatever"}"#;
        let event: RawStreamEvent = serde_json::from_str(json).unwrap();
        assert!(matches!(event, RawStreamEvent::Unknown));
    }

    #[test]
    fn parse_thinking_content_block() {
        let json = r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"thinking","thinking":"hmm"}]}}"#;
        let event: RawStreamEvent = serde_json::from_str(json).unwrap();
        match event {
            RawStreamEvent::Assistant { message, .. } => {
                let content = message.content.unwrap();
                assert_eq!(content.len(), 1);
                assert!(matches!(content[0], ContentBlock::Thinking { .. }));
            }
            other => panic!("Expected Assistant, got {:?}", other),
        }
    }

    #[test]
    fn parse_unknown_content_block_type() {
        let json = r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"some_future_type","data":"test"}]}}"#;
        let event: RawStreamEvent = serde_json::from_str(json).unwrap();
        match event {
            RawStreamEvent::Assistant { message, .. } => {
                let content = message.content.unwrap();
                assert_eq!(content.len(), 1);
                assert!(matches!(content[0], ContentBlock::Unknown));
            }
            other => panic!("Expected Assistant, got {:?}", other),
        }
    }

    #[test]
    fn parse_content_block_delta_thinking() {
        let json = r#"{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"Let me analyze this..."}}"#;
        let event: RawStreamEvent = serde_json::from_str(json).unwrap();
        match event {
            RawStreamEvent::ContentBlockDelta { delta, index, .. } => {
                assert_eq!(index, Some(0));
                match delta.unwrap() {
                    StreamDelta::ThinkingDelta { thinking } => {
                        assert_eq!(thinking, "Let me analyze this...");
                    }
                    other => panic!("Expected ThinkingDelta, got {:?}", other),
                }
            }
            other => panic!("Expected ContentBlockDelta, got {:?}", other),
        }
    }

    #[test]
    fn parse_signature_delta_falls_through_to_unknown() {
        let json = r#"{"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"EqQBCgIYAh..."}}"#;
        let event: RawStreamEvent = serde_json::from_str(json).unwrap();
        match event {
            RawStreamEvent::ContentBlockDelta { delta, .. } => {
                assert!(matches!(delta, Some(StreamDelta::Unknown)));
            }
            other => panic!("Expected ContentBlockDelta, got {:?}", other),
        }
    }

    #[test]
    fn parse_content_block_start_thinking() {
        let json = r#"{"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}"#;
        let event: RawStreamEvent = serde_json::from_str(json).unwrap();
        match event {
            RawStreamEvent::ContentBlockStart { content_block, index, .. } => {
                assert_eq!(index, Some(0));
                match content_block.unwrap() {
                    ContentBlock::Thinking { thinking } => {
                        assert_eq!(thinking, "");
                    }
                    other => panic!("Expected Thinking, got {:?}", other),
                }
            }
            other => panic!("Expected ContentBlockStart, got {:?}", other),
        }
    }

    #[test]
    fn parse_assistant_with_thinking_and_text() {
        let json = r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"thinking","thinking":"Let me think about this carefully."},{"type":"text","text":"Here is my answer."}]}}"#;
        let event: RawStreamEvent = serde_json::from_str(json).unwrap();
        match event {
            RawStreamEvent::Assistant { message, .. } => {
                let content = message.content.unwrap();
                assert_eq!(content.len(), 2);
                match &content[0] {
                    ContentBlock::Thinking { thinking } => {
                        assert_eq!(thinking, "Let me think about this carefully.");
                    }
                    other => panic!("Expected Thinking, got {:?}", other),
                }
                match &content[1] {
                    ContentBlock::Text { text } => {
                        assert_eq!(text, "Here is my answer.");
                    }
                    other => panic!("Expected Text, got {:?}", other),
                }
            }
            other => panic!("Expected Assistant, got {:?}", other),
        }
    }

    #[test]
    fn parse_unknown_delta_type() {
        let json = r#"{"type":"content_block_delta","index":0,"delta":{"type":"citations_delta","data":{}}}"#;
        let event: RawStreamEvent = serde_json::from_str(json).unwrap();
        match event {
            RawStreamEvent::ContentBlockDelta { delta, .. } => {
                assert!(matches!(delta, Some(StreamDelta::Unknown)));
            }
            other => panic!("Expected ContentBlockDelta, got {:?}", other),
        }
    }

    #[test]
    fn extra_fields_are_tolerated() {
        let json = r#"{"type":"system","subtype":"init","model":"opus","future_field":"hi","tools":null,"mcp_servers":null}"#;
        let event: RawStreamEvent = serde_json::from_str(json).unwrap();
        assert!(matches!(event, RawStreamEvent::System { .. }));
    }

    #[test]
    fn empty_line_is_not_valid_json() {
        let result = serde_json::from_str::<RawStreamEvent>("");
        assert!(result.is_err());
    }

    #[test]
    fn malformed_json_returns_error() {
        let result = serde_json::from_str::<RawStreamEvent>("{broken");
        assert!(result.is_err());
    }

    #[test]
    fn parse_mixed_content_blocks() {
        let json = r#"{"type":"assistant","message":{"role":"assistant","content":[
            {"type":"text","text":"Let me read that file."},
            {"type":"tool_use","id":"toolu_01","name":"Read","input":{"file_path":"foo.ts"}},
            {"type":"text","text":"Here are the results."}
        ]}}"#;
        let event: RawStreamEvent = serde_json::from_str(json).unwrap();
        match event {
            RawStreamEvent::Assistant { message, .. } => {
                let content = message.content.unwrap();
                assert_eq!(content.len(), 3);
                assert!(matches!(&content[0], ContentBlock::Text { text } if text == "Let me read that file."));
                assert!(matches!(&content[1], ContentBlock::ToolUse { name, .. } if name == "Read"));
                assert!(matches!(&content[2], ContentBlock::Text { text } if text == "Here are the results."));
            }
            other => panic!("Expected Assistant, got {:?}", other),
        }
    }

    #[test]
    fn parse_result_with_cache_tokens() {
        let json = r#"{"type":"result","duration_ms":100,"usage":{"input_tokens":500,"output_tokens":200,"cache_creation_input_tokens":50,"cache_read_input_tokens":100}}"#;
        let event: RawStreamEvent = serde_json::from_str(json).unwrap();
        match event {
            RawStreamEvent::Result { usage, .. } => {
                let u = usage.unwrap();
                assert_eq!(u.cache_creation_input_tokens, Some(50));
                assert_eq!(u.cache_read_input_tokens, Some(100));
            }
            other => panic!("Expected Result, got {:?}", other),
        }
    }

    // ──────────────────────────────────────────────────────────
    // StdinMessage SERIALIZATION
    // ──────────────────────────────────────────────────────────

    #[test]
    fn stdin_user_message_serializes_correctly() {
        let msg = StdinMessage::new_user_message("Hello Claude");
        let json = serde_json::to_string(&msg).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["type"], "user");
        assert_eq!(parsed["message"]["role"], "user");
        assert_eq!(parsed["message"]["content"], "Hello Claude");
    }

    #[test]
    fn stdin_tool_response_serializes_correctly() {
        let msg = StdinMessage::new_tool_response("toolu_01abc", true);
        let json = serde_json::to_string(&msg).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["type"], "tool_result");
        assert_eq!(parsed["tool_use_id"], "toolu_01abc");
        assert_eq!(parsed["approved"], true);
    }

    #[test]
    fn stdin_tool_deny_serializes_correctly() {
        let msg = StdinMessage::new_tool_response("toolu_02xyz", false);
        let json = serde_json::to_string(&msg).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["approved"], false);
    }

    // ──────────────────────────────────────────────────────────
    // FrontendEvent SERIALIZATION
    // ──────────────────────────────────────────────────────────

    #[test]
    fn frontend_text_delta_serializes() {
        let fe = FrontendEvent::TextDelta {
            session_id: "s1".into(),
            text: "hello".into(),
        };
        let json = serde_json::to_string(&fe).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["type"], "text_delta");
        assert_eq!(parsed["session_id"], "s1");
        assert_eq!(parsed["text"], "hello");
    }

    #[test]
    fn frontend_tool_use_start_serializes() {
        let fe = FrontendEvent::ToolUseStart {
            session_id: "s1".into(),
            tool_use_id: "t1".into(),
            tool_name: "Write".into(),
            tool_input: serde_json::json!({"file_path": "foo.ts", "content": "bar"}),
        };
        let json = serde_json::to_string(&fe).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["type"], "tool_use_start");
        assert_eq!(parsed["tool_name"], "Write");
        assert_eq!(parsed["tool_input"]["file_path"], "foo.ts");
    }

    #[test]
    fn frontend_turn_complete_serializes() {
        let fe = FrontendEvent::TurnComplete {
            session_id: "s1".into(),
            duration_ms: Some(4500),
            usage: Some(UsageInfo {
                input_tokens: Some(1200),
                output_tokens: Some(800),
                cache_creation_input_tokens: None,
                cache_read_input_tokens: None,
                service_tier: None,
                server_tool_use: None,
                iterations: None,
            }),
            cost_usd: Some(0.003),
            duration_api_ms: None,
            num_turns: None,
            stop_reason: None,
            terminal_reason: None,
            model_name: None,
            context_window: None,
            max_output_tokens: None,
        };
        let json = serde_json::to_string(&fe).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["type"], "turn_complete");
        assert_eq!(parsed["duration_ms"], 4500);
        assert_eq!(parsed["usage"]["input_tokens"], 1200);
    }

    #[test]
    fn frontend_process_error_serializes() {
        let fe = FrontendEvent::ProcessError {
            session_id: "s1".into(),
            error: "Something broke".into(),
        };
        let json = serde_json::to_string(&fe).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["type"], "process_error");
        assert_eq!(parsed["error"], "Something broke");
    }

    #[test]
    fn frontend_thinking_delta_serializes() {
        let fe = FrontendEvent::ThinkingDelta {
            session_id: "s1".into(),
            thinking: "Let me think...".into(),
        };
        let json = serde_json::to_string(&fe).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["type"], "thinking_delta");
        assert_eq!(parsed["session_id"], "s1");
        assert_eq!(parsed["thinking"], "Let me think...");
    }

    #[test]
    fn frontend_thinking_complete_serializes() {
        let fe = FrontendEvent::ThinkingComplete {
            session_id: "s1".into(),
            full_thinking: "I analyzed the problem step by step.".into(),
        };
        let json = serde_json::to_string(&fe).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["type"], "thinking_complete");
        assert_eq!(parsed["session_id"], "s1");
        assert_eq!(parsed["full_thinking"], "I analyzed the problem step by step.");
    }

    #[test]
    fn frontend_thinking_complete_empty_text_serializes() {
        let fe = FrontendEvent::ThinkingComplete {
            session_id: "s1".into(),
            full_thinking: "".into(),
        };
        let json = serde_json::to_string(&fe).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["type"], "thinking_complete");
        assert_eq!(parsed["full_thinking"], "");
    }

    #[test]
    fn frontend_session_init_serializes() {
        let fe = FrontendEvent::SessionInit {
            session_id: "s1".into(),
            model: Some("claude-sonnet-4-20250514".into()),
            thinking_effort: None,
        };
        let json = serde_json::to_string(&fe).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["type"], "session_init");
        assert_eq!(parsed["model"], "claude-sonnet-4-20250514");
    }

    // ──────────────────────────────────────────────────────────
    // CONTROL PROTOCOL — request/response serialization
    // ──────────────────────────────────────────────────────────

    #[test]
    fn stdin_control_request_interrupt_serializes() {
        let msg = StdinMessage::ControlRequest {
            request_id: "req_abc123".into(),
            request: ControlRequestPayload::Interrupt,
        };
        let json = serde_json::to_string(&msg).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["type"], "control_request");
        assert_eq!(parsed["request_id"], "req_abc123");
        assert_eq!(parsed["request"]["subtype"], "interrupt");
    }

    #[test]
    fn stdin_control_request_set_model_serializes() {
        let msg = StdinMessage::ControlRequest {
            request_id: "req_def456".into(),
            request: ControlRequestPayload::SetModel {
                model: "sonnet".into(),
            },
        };
        let json = serde_json::to_string(&msg).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["type"], "control_request");
        assert_eq!(parsed["request_id"], "req_def456");
        assert_eq!(parsed["request"]["subtype"], "set_model");
        assert_eq!(parsed["request"]["model"], "sonnet");
    }

    #[test]
    fn stdin_control_request_initialize_serializes() {
        let msg = StdinMessage::ControlRequest {
            request_id: "req_ghi789".into(),
            request: ControlRequestPayload::Initialize,
        };
        let json = serde_json::to_string(&msg).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["type"], "control_request");
        assert_eq!(parsed["request_id"], "req_ghi789");
        assert_eq!(parsed["request"]["subtype"], "initialize");
    }

    #[test]
    fn parse_control_response_event() {
        let json = r#"{"type":"control_response","response":{"subtype":"success","request_id":"req_abc123","response":{"models":[],"commands":[]}}}"#;
        let event: RawStreamEvent = serde_json::from_str(json).unwrap();
        match event {
            RawStreamEvent::ControlResponse { response, .. } => {
                let resp = response.unwrap();
                assert_eq!(resp["subtype"], "success");
                assert_eq!(resp["request_id"], "req_abc123");
            }
            other => panic!("Expected ControlResponse, got {:?}", other),
        }
    }

    #[test]
    fn parse_control_response_error_event() {
        let json = r#"{"type":"control_response","response":{"subtype":"error","request_id":"req_xyz","error":"model not found"}}"#;
        let event: RawStreamEvent = serde_json::from_str(json).unwrap();
        match event {
            RawStreamEvent::ControlResponse { response, .. } => {
                let resp = response.unwrap();
                assert_eq!(resp["subtype"], "error");
                assert_eq!(resp["error"], "model not found");
            }
            other => panic!("Expected ControlResponse, got {:?}", other),
        }
    }

    #[test]
    fn parse_control_response_null_response_field() {
        let json = r#"{"type":"control_response","response":null}"#;
        let event: RawStreamEvent = serde_json::from_str(json).unwrap();
        match event {
            RawStreamEvent::ControlResponse { response, .. } => {
                assert!(response.is_none());
            }
            other => panic!("Expected ControlResponse, got {:?}", other),
        }
    }

    #[test]
    fn frontend_interrupt_result_serializes() {
        let fe = FrontendEvent::InterruptResult {
            session_id: "s1".into(),
            success: true,
            error: None,
        };
        let json = serde_json::to_string(&fe).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["type"], "interrupt_result");
        assert_eq!(parsed["session_id"], "s1");
        assert_eq!(parsed["success"], true);
        assert!(parsed["error"].is_null());
    }

    #[test]
    fn frontend_interrupt_result_error_serializes() {
        let fe = FrontendEvent::InterruptResult {
            session_id: "s1".into(),
            success: false,
            error: Some("not running".into()),
        };
        let json = serde_json::to_string(&fe).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["type"], "interrupt_result");
        assert_eq!(parsed["success"], false);
        assert_eq!(parsed["error"], "not running");
    }

    #[test]
    fn frontend_model_changed_serializes() {
        let fe = FrontendEvent::ModelChanged {
            session_id: "s1".into(),
            model: "sonnet".into(),
            success: true,
            error: None,
        };
        let json = serde_json::to_string(&fe).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["type"], "model_changed");
        assert_eq!(parsed["model"], "sonnet");
        assert_eq!(parsed["success"], true);
    }

    #[test]
    fn frontend_model_changed_error_serializes() {
        let fe = FrontendEvent::ModelChanged {
            session_id: "s1".into(),
            model: "nonexistent".into(),
            success: false,
            error: Some("invalid model".into()),
        };
        let json = serde_json::to_string(&fe).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["type"], "model_changed");
        assert_eq!(parsed["success"], false);
        assert_eq!(parsed["error"], "invalid model");
    }

    #[test]
    fn frontend_capabilities_discovered_serializes() {
        let fe = FrontendEvent::CapabilitiesDiscovered {
            session_id: "s1".into(),
            models: serde_json::json!([{"value": "sonnet", "displayName": "Sonnet"}]),
            commands: serde_json::json!([{"name": "compact", "description": "Compact context"}]),
            agents: serde_json::json!([]),
            account: serde_json::json!({"email": "test@example.com"}),
            output_styles: serde_json::json!(["text", "json"]),
        };
        let json = serde_json::to_string(&fe).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["type"], "capabilities_discovered");
        assert_eq!(parsed["models"][0]["value"], "sonnet");
        assert_eq!(parsed["commands"][0]["name"], "compact");
        assert_eq!(parsed["account"]["email"], "test@example.com");
        assert_eq!(parsed["output_styles"][0], "text");
    }

    #[test]
    fn frontend_capabilities_discovered_empty_serializes() {
        let fe = FrontendEvent::CapabilitiesDiscovered {
            session_id: "s1".into(),
            models: serde_json::Value::Null,
            commands: serde_json::Value::Null,
            agents: serde_json::Value::Null,
            account: serde_json::Value::Null,
            output_styles: serde_json::Value::Null,
        };
        let json = serde_json::to_string(&fe).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["type"], "capabilities_discovered");
        assert!(parsed["models"].is_null());
    }

    // ──────────────────────────────────────────────────────────
    // PROTOCOL CONFORMANCE — Phase 1-4 new event fields
    // ──────────────────────────────────────────────────────────

    #[test]
    fn parse_message_delta_with_usage() {
        let json = r#"{"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"input_tokens":7,"output_tokens":34,"cache_creation_input_tokens":7195,"cache_read_input_tokens":40037}}"#;
        let event: RawStreamEvent = serde_json::from_str(json).unwrap();
        match event {
            RawStreamEvent::MessageDelta { usage, delta, .. } => {
                let u = usage.unwrap();
                assert_eq!(u.output_tokens, Some(34));
                assert_eq!(u.input_tokens, Some(7));
                assert_eq!(u.cache_creation_input_tokens, Some(7195));
                assert_eq!(u.cache_read_input_tokens, Some(40037));
                let d = delta.unwrap();
                assert_eq!(d["stop_reason"], "end_turn");
            }
            other => panic!("Expected MessageDelta, got {:?}", other),
        }
    }

    #[test]
    fn parse_message_delta_without_usage() {
        let json = r#"{"type":"message_delta","delta":{"stop_reason":"end_turn"}}"#;
        let event: RawStreamEvent = serde_json::from_str(json).unwrap();
        match event {
            RawStreamEvent::MessageDelta { usage, .. } => {
                assert!(usage.is_none());
            }
            other => panic!("Expected MessageDelta, got {:?}", other),
        }
    }

    #[test]
    fn parse_result_with_model_usage_and_num_turns() {
        let json = r#"{"type":"result","subtype":"success","duration_ms":5000,"duration_api_ms":3200,"num_turns":3,"stop_reason":"end_turn","cost_usd":0.0685,"usage":{"input_tokens":100,"output_tokens":143},"modelUsage":{"claude-opus-4-7":{"contextWindow":200000,"maxOutputTokens":32000,"costUSD":0.0685,"inputTokens":7,"outputTokens":143,"cacheReadInputTokens":40037,"cacheCreationInputTokens":7195}}}"#;
        let event: RawStreamEvent = serde_json::from_str(json).unwrap();
        match event {
            RawStreamEvent::Result {
                num_turns,
                duration_api_ms,
                stop_reason,
                model_usage,
                ..
            } => {
                assert_eq!(num_turns, Some(3));
                assert_eq!(duration_api_ms, Some(3200));
                assert_eq!(stop_reason.as_deref(), Some("end_turn"));
                let mu = model_usage.unwrap();
                let opus = mu.get("claude-opus-4-7").unwrap();
                assert_eq!(opus["contextWindow"], 200000);
                assert_eq!(opus["maxOutputTokens"], 32000);
            }
            other => panic!("Expected Result, got {:?}", other),
        }
    }

    #[test]
    fn parse_rate_limit_info_camel_case_fields() {
        let json = r#"{"type":"rate_limit_event","rate_limit_info":{"status":"allowed_warning","resetsAt":1741800000,"rateLimitType":"five_hour","overageStatus":"rejected","overageDisabledReason":"out_of_credits","isUsingOverage":false}}"#;
        let event: RawStreamEvent = serde_json::from_str(json).unwrap();
        match event {
            RawStreamEvent::RateLimitEvent { rate_limit_info, .. } => {
                let info = rate_limit_info.unwrap();
                assert_eq!(info.status.as_deref(), Some("allowed_warning"));
                assert_eq!(info.resets_at, Some(1741800000.0));
                assert_eq!(info.rate_limit_type.as_deref(), Some("five_hour"));
                assert_eq!(info.overage_status.as_deref(), Some("rejected"));
                assert_eq!(info.overage_disabled_reason.as_deref(), Some("out_of_credits"));
                assert_eq!(info.is_using_overage, Some(false));
                assert!(info.utilization.is_none());
            }
            other => panic!("Expected RateLimitEvent, got {:?}", other),
        }
    }

    #[test]
    fn parse_usage_info_with_service_tier_and_server_tool_use() {
        let json = r#"{"input_tokens":100,"output_tokens":50,"cache_creation_input_tokens":null,"cache_read_input_tokens":null,"service_tier":"standard","server_tool_use":{"web_search_requests":2,"web_fetch_requests":1}}"#;
        let usage: UsageInfo = serde_json::from_str(json).unwrap();
        assert_eq!(usage.service_tier.as_deref(), Some("standard"));
        let stu = usage.server_tool_use.unwrap();
        assert_eq!(stu.web_search_requests, Some(2));
        assert_eq!(stu.web_fetch_requests, Some(1));
    }

    #[test]
    fn frontend_turn_complete_with_enriched_fields_serializes() {
        let fe = FrontendEvent::TurnComplete {
            session_id: "s1".into(),
            duration_ms: Some(5000),
            usage: Some(UsageInfo {
                input_tokens: Some(100),
                output_tokens: Some(143),
                cache_creation_input_tokens: Some(7195),
                cache_read_input_tokens: Some(40037),
                service_tier: Some("standard".into()),
                server_tool_use: None,
                iterations: None,
            }),
            cost_usd: Some(0.0685),
            duration_api_ms: Some(3200),
            num_turns: Some(3),
            stop_reason: Some("end_turn".into()),
            terminal_reason: None,
            model_name: Some("claude-opus-4-7".into()),
            context_window: Some(200000),
            max_output_tokens: Some(32000),
        };
        let json = serde_json::to_string(&fe).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["duration_api_ms"], 3200);
        assert_eq!(parsed["num_turns"], 3);
        assert_eq!(parsed["stop_reason"], "end_turn");
        assert_eq!(parsed["model_name"], "claude-opus-4-7");
        assert_eq!(parsed["context_window"], 200000);
        assert_eq!(parsed["max_output_tokens"], 32000);
        assert_eq!(parsed["usage"]["service_tier"], "standard");
    }

    #[test]
    fn frontend_rate_limit_warning_with_enriched_fields_serializes() {
        let fe = FrontendEvent::RateLimitWarning {
            session_id: "s1".into(),
            utilization: 0.0,
            resets_at: Some(1741800000.0),
            rate_limit_type: Some("five_hour".into()),
            overage_status: Some("rejected".into()),
            is_using_overage: Some(false),
        };
        let json = serde_json::to_string(&fe).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["rate_limit_type"], "five_hour");
        assert_eq!(parsed["overage_status"], "rejected");
        assert_eq!(parsed["is_using_overage"], false);
    }

    // ──────────────────────────────────────────────────────────
    // FILE TREE — scan directories, filter ignored, depth limit
    // ──────────────────────────────────────────────────────────

    fn create_test_dir() -> (tempfile::TempDir, PathBuf) {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().to_path_buf();

        // Create test structure
        fs::create_dir_all(root.join("src/auth")).unwrap();
        fs::create_dir_all(root.join("node_modules/pkg")).unwrap();
        fs::create_dir_all(root.join(".git/objects")).unwrap();
        fs::create_dir_all(root.join(".claude")).unwrap();
        fs::write(root.join("src/auth/index.ts"), "export {}").unwrap();
        fs::write(root.join("src/app.tsx"), "function App() {}").unwrap();
        fs::write(root.join("package.json"), "{}").unwrap();
        fs::write(root.join("CLAUDE.md"), "# CLAUDE.md").unwrap();
        fs::write(root.join("node_modules/pkg/index.js"), "module.exports = {}").unwrap();
        fs::write(root.join(".git/objects/abc"), "blob").unwrap();
        fs::write(root.join(".claude/settings.json"), "{}").unwrap();
        fs::write(root.join(".DS_Store"), "").unwrap();

        (tmp, root)
    }

    #[test]
    fn file_tree_reads_basic_structure() {
        let (_tmp, root) = create_test_dir();
        let result = read_file_tree(root.to_string_lossy().to_string()).unwrap();
        assert!(!result.is_empty());

        let names: Vec<&str> = result.iter().map(|n| n.name.as_str()).collect();
        assert!(names.contains(&"src"), "Should contain src dir: {:?}", names);
        assert!(
            names.contains(&"package.json"),
            "Should contain package.json: {:?}",
            names
        );
        assert!(
            names.contains(&"CLAUDE.md"),
            "Should contain CLAUDE.md: {:?}",
            names
        );
    }

    #[test]
    fn file_tree_ignores_node_modules() {
        let (_tmp, root) = create_test_dir();
        let result = read_file_tree(root.to_string_lossy().to_string()).unwrap();
        let names: Vec<&str> = result.iter().map(|n| n.name.as_str()).collect();
        assert!(
            !names.contains(&"node_modules"),
            "Should NOT contain node_modules: {:?}",
            names
        );
    }

    #[test]
    fn file_tree_ignores_git_dir() {
        let (_tmp, root) = create_test_dir();
        let result = read_file_tree(root.to_string_lossy().to_string()).unwrap();
        let names: Vec<&str> = result.iter().map(|n| n.name.as_str()).collect();
        assert!(
            !names.contains(&".git"),
            "Should NOT contain .git: {:?}",
            names
        );
    }

    #[test]
    fn file_tree_preserves_claude_dir() {
        let (_tmp, root) = create_test_dir();
        let result = read_file_tree(root.to_string_lossy().to_string()).unwrap();
        let names: Vec<&str> = result.iter().map(|n| n.name.as_str()).collect();
        assert!(
            names.contains(&".claude"),
            "Should preserve .claude dir: {:?}",
            names
        );
    }

    #[test]
    fn file_tree_ignores_ds_store() {
        let (_tmp, root) = create_test_dir();
        let result = read_file_tree(root.to_string_lossy().to_string()).unwrap();
        let names: Vec<&str> = result.iter().map(|n| n.name.as_str()).collect();
        assert!(
            !names.contains(&".DS_Store"),
            "Should NOT contain .DS_Store: {:?}",
            names
        );
    }

    #[test]
    fn file_tree_sorts_dirs_before_files() {
        let (_tmp, root) = create_test_dir();
        let result = read_file_tree(root.to_string_lossy().to_string()).unwrap();
        let mut found_file = false;
        for node in &result {
            if !node.is_dir {
                found_file = true;
            }
            if node.is_dir && found_file {
                panic!(
                    "Directory '{}' appears after a file — dirs should be first",
                    node.name
                );
            }
        }
    }

    #[test]
    fn file_tree_includes_extensions() {
        let (_tmp, root) = create_test_dir();
        let result = read_file_tree(root.to_string_lossy().to_string()).unwrap();
        let pkg = result.iter().find(|n| n.name == "package.json").unwrap();
        assert_eq!(pkg.extension.as_deref(), Some("json"));

        let claude = result.iter().find(|n| n.name == "CLAUDE.md").unwrap();
        assert_eq!(claude.extension.as_deref(), Some("md"));
    }

    #[test]
    fn file_tree_has_children_for_dirs() {
        let (_tmp, root) = create_test_dir();
        let result = read_file_tree(root.to_string_lossy().to_string()).unwrap();
        let src = result.iter().find(|n| n.name == "src").unwrap();
        assert!(src.is_dir);
        assert!(src.children.is_some());
        let children = src.children.as_ref().unwrap();
        let child_names: Vec<&str> = children.iter().map(|c| c.name.as_str()).collect();
        assert!(child_names.contains(&"auth"));
        assert!(child_names.contains(&"app.tsx"));
    }

    #[test]
    fn file_tree_respects_depth_limit() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        // Create 7-level deep structure
        let mut path = root.to_path_buf();
        for i in 0..7 {
            path = path.join(format!("level{}", i));
            fs::create_dir_all(&path).unwrap();
            fs::write(path.join("file.txt"), "content").unwrap();
        }

        let result = read_file_tree(root.to_string_lossy().to_string()).unwrap();

        // Walk down and verify we stop at depth 5
        fn count_depth(nodes: &[crate::commands::files::FileNode], depth: usize) -> usize {
            let mut max = depth;
            for node in nodes {
                if let Some(children) = &node.children {
                    if !children.is_empty() {
                        max = max.max(count_depth(children, depth + 1));
                    }
                }
            }
            max
        }
        let max_depth = count_depth(&result, 0);
        assert!(
            max_depth <= 5,
            "Max depth should be <=5, got {}",
            max_depth
        );
    }

    #[test]
    fn file_tree_nonexistent_path_returns_error() {
        let result = read_file_tree("/nonexistent/path/that/does/not/exist".to_string());
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("does not exist"));
    }

    // ──────────────────────────────────────────────────────────
    // FILE CONTENT — read files, reject too-large, reject dirs
    // ──────────────────────────────────────────────────────────

    #[test]
    fn read_file_content_success() {
        let tmp = tempfile::tempdir().unwrap();
        let file = tmp.path().join("test.txt");
        fs::write(&file, "Hello, world!").unwrap();

        let content = read_file_content(file.to_string_lossy().to_string()).unwrap();
        assert_eq!(content, "Hello, world!");
    }

    #[test]
    fn read_file_content_nonexistent() {
        let result = read_file_content("/no/such/file.txt".to_string());
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not found"));
    }

    #[test]
    fn read_file_content_directory_rejected() {
        let tmp = tempfile::tempdir().unwrap();
        let result = read_file_content(tmp.path().to_string_lossy().to_string());
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Not a file"));
    }

    #[test]
    fn read_file_content_too_large() {
        let tmp = tempfile::tempdir().unwrap();
        let file = tmp.path().join("big.bin");
        let data = vec![0u8; 1_048_577]; // 1 byte over limit
        fs::write(&file, &data).unwrap();

        let result = read_file_content(file.to_string_lossy().to_string());
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("too large"));
    }

    // ──────────────────────────────────────────────────────────
    // CLAUDE DETECTION — at least doesn't panic
    // ──────────────────────────────────────────────────────────

    #[test]
    fn claude_detection_returns_status() {
        let status = detect_claude();
        // We can't control what's installed, but it should not panic
        // and return a well-formed struct
        if status.installed {
            assert!(status.binary_path.is_some());
        } else {
            assert!(status.binary_path.is_none());
            assert!(status.version.is_none());
        }
    }

    // ──────────────────────────────────────────────────────────
    // SESSION STATE — in-memory state management
    // ──────────────────────────────────────────────────────────

    fn test_db() -> crate::storage::Database {
        crate::storage::Database::new(":memory:").unwrap()
    }

    #[tokio::test]
    async fn app_state_starts_empty() {
        let state = crate::claude::session::AppState::new(test_db());
        let sessions = state.sessions.lock().await;
        assert!(sessions.is_empty());
        let processes = state.processes.lock().await;
        assert!(processes.is_empty());
        let binary = state.claude_binary.lock().await;
        assert!(binary.is_none());
    }

    #[tokio::test]
    async fn app_state_store_and_retrieve_session() {
        use crate::claude::session::{AppState, SessionInfo, SessionStatus};
        use chrono::Utc;

        let state = AppState::new(test_db());
        let info = SessionInfo {
            id: "test-session-1".to_string(),
            name: "Test".to_string(),
            project_path: "/tmp/test".to_string(),
            status: SessionStatus::Connected,
            created_at: Utc::now(),
            model: Some("sonnet".to_string()),
            icon_index: 0,
        };

        {
            let mut sessions = state.sessions.lock().await;
            sessions.insert(info.id.clone(), info.clone());
        }

        let sessions = state.sessions.lock().await;
        let retrieved = sessions.get("test-session-1").unwrap();
        assert_eq!(retrieved.name, "Test");
        assert_eq!(retrieved.project_path, "/tmp/test");
        assert_eq!(retrieved.status, SessionStatus::Connected);
        assert_eq!(retrieved.model.as_deref(), Some("sonnet"));
    }

    #[tokio::test]
    async fn app_state_update_session_status() {
        use crate::claude::session::{AppState, SessionInfo, SessionStatus};
        use chrono::Utc;

        let state = AppState::new(test_db());
        let info = SessionInfo {
            id: "s1".to_string(),
            name: "Test".to_string(),
            project_path: "/tmp".to_string(),
            status: SessionStatus::Starting,
            created_at: Utc::now(),
            model: None,
            icon_index: 0,
        };

        {
            let mut sessions = state.sessions.lock().await;
            sessions.insert(info.id.clone(), info);
        }

        {
            let mut sessions = state.sessions.lock().await;
            if let Some(s) = sessions.get_mut("s1") {
                s.status = SessionStatus::Closed;
            }
        }

        let sessions = state.sessions.lock().await;
        assert_eq!(sessions.get("s1").unwrap().status, SessionStatus::Closed);
    }

    // ──────────────────────────────────────────────────────────
    // ERROR TYPES
    // ──────────────────────────────────────────────────────────

    #[test]
    fn app_error_serializes_as_string() {
        use crate::errors::AppError;

        let err = AppError::SessionNotFound("abc".to_string());
        let json = serde_json::to_string(&err).unwrap();
        assert_eq!(json, "\"Session not found: abc\"");
    }

    #[test]
    fn app_error_display_messages() {
        use crate::errors::AppError;

        assert_eq!(
            AppError::ClaudeNotFound.to_string(),
            "Claude Code CLI not found. Install with: npm install -g @anthropic-ai/claude-code"
        );
        assert_eq!(
            AppError::ProcessNotRunning("s1".into()).to_string(),
            "Process not running for session: s1"
        );
        assert_eq!(
            AppError::SendFailed("broken pipe".into()).to_string(),
            "Failed to send message: broken pipe"
        );
    }

    // ──────────────────────────────────────────────────────────
    // STREAM PARSER — integration test with fake stdout
    // ──────────────────────────────────────────────────────────

    #[tokio::test]
    async fn stream_parser_parses_multiple_lines() {
        use crate::claude::stream_parser::parse_stream;
        use tokio::sync::mpsc;

        // Create a fake "stdout" from bytes
        let ndjson = r#"{"type":"system","subtype":"init","model":"sonnet"}
{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi"}}
{"type":"result","duration_ms":100}
"#;

        let (tx, mut rx) = mpsc::channel(256);

        // Use a child process that echoes our NDJSON
        let mut child = tokio::process::Command::new("echo")
            .arg("-n")
            .arg(ndjson)
            .stdout(std::process::Stdio::piped())
            .spawn()
            .unwrap();

        let stdout = child.stdout.take().unwrap();

        tokio::spawn(async move {
            parse_stream(stdout, tx, None, None).await;
        });

        let mut events = vec![];
        while let Some(event) = rx.recv().await {
            events.push(event);
        }

        assert_eq!(events.len(), 3, "Should have parsed 3 events");
        assert!(matches!(events[0], RawStreamEvent::System { .. }));
        assert!(matches!(events[1], RawStreamEvent::ContentBlockDelta { .. }));
        assert!(matches!(events[2], RawStreamEvent::Result { .. }));
    }

    #[tokio::test]
    async fn stream_parser_skips_empty_lines() {
        use crate::claude::stream_parser::parse_stream;
        use tokio::sync::mpsc;

        let ndjson = r#"
{"type":"system","subtype":"init","model":"sonnet"}

{"type":"result","duration_ms":50}

"#;

        let (tx, mut rx) = mpsc::channel(256);

        let mut child = tokio::process::Command::new("echo")
            .arg("-n")
            .arg(ndjson)
            .stdout(std::process::Stdio::piped())
            .spawn()
            .unwrap();

        let stdout = child.stdout.take().unwrap();

        tokio::spawn(async move {
            parse_stream(stdout, tx, None, None).await;
        });

        let mut events = vec![];
        while let Some(event) = rx.recv().await {
            events.push(event);
        }

        assert_eq!(events.len(), 2, "Empty lines should be skipped");
    }

    #[tokio::test]
    async fn stream_parser_unwraps_stream_event_wrapper() {
        use crate::claude::stream_parser::parse_stream;
        use tokio::sync::mpsc;

        // CLI wraps streaming deltas in {"type":"stream_event","event":{...}}
        let ndjson = r#"{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}}
{"type":"stream_event","event":{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}}
{"type":"result","duration_ms":100}"#;

        let (tx, mut rx) = mpsc::channel(256);

        let mut child = tokio::process::Command::new("echo")
            .arg("-n")
            .arg(ndjson)
            .stdout(std::process::Stdio::piped())
            .spawn()
            .unwrap();

        let stdout = child.stdout.take().unwrap();

        tokio::spawn(async move {
            parse_stream(stdout, tx, None, None).await;
        });

        let mut events = vec![];
        while let Some(event) = rx.recv().await {
            events.push(event);
        }

        assert_eq!(events.len(), 3, "Should unwrap 2 stream_events + 1 direct result");
        assert!(matches!(events[0], RawStreamEvent::ContentBlockDelta { .. }));
        assert!(matches!(events[1], RawStreamEvent::ContentBlockStart { .. }));
        assert!(matches!(events[2], RawStreamEvent::Result { .. }));
    }

    #[tokio::test]
    async fn stream_parser_parses_thinking_deltas() {
        use crate::claude::stream_parser::parse_stream;
        use tokio::sync::mpsc;

        let ndjson = r#"{"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}
{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"Let me think..."}}
{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":" step by step."}}
{"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"abc123"}}
{"type":"content_block_stop","index":0}
{"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}}
{"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"Here is my answer."}}
{"type":"content_block_stop","index":1}
{"type":"result","duration_ms":100}"#;

        let (tx, mut rx) = mpsc::channel(256);

        let mut child = tokio::process::Command::new("echo")
            .arg("-n")
            .arg(ndjson)
            .stdout(std::process::Stdio::piped())
            .spawn()
            .unwrap();

        let stdout = child.stdout.take().unwrap();

        tokio::spawn(async move {
            parse_stream(stdout, tx, None, None).await;
        });

        let mut events = vec![];
        while let Some(event) = rx.recv().await {
            events.push(event);
        }

        assert_eq!(events.len(), 9, "Should parse all 9 events including thinking");
        assert!(matches!(events[0], RawStreamEvent::ContentBlockStart { .. }));
        // First thinking delta
        match &events[1] {
            RawStreamEvent::ContentBlockDelta { delta, .. } => {
                assert!(matches!(delta, Some(StreamDelta::ThinkingDelta { .. })));
            }
            other => panic!("Expected ContentBlockDelta with ThinkingDelta, got {:?}", other),
        }
        // Signature delta should be Unknown
        match &events[3] {
            RawStreamEvent::ContentBlockDelta { delta, .. } => {
                assert!(matches!(delta, Some(StreamDelta::Unknown)));
            }
            other => panic!("Expected ContentBlockDelta with Unknown (signature), got {:?}", other),
        }
        // Text delta
        match &events[6] {
            RawStreamEvent::ContentBlockDelta { delta, .. } => {
                assert!(matches!(delta, Some(StreamDelta::TextDelta { .. })));
            }
            other => panic!("Expected ContentBlockDelta with TextDelta, got {:?}", other),
        }
        assert!(matches!(events[8], RawStreamEvent::Result { .. }));
    }

    #[tokio::test]
    async fn stream_parser_unwraps_thinking_in_stream_event_wrapper() {
        use crate::claude::stream_parser::parse_stream;
        use tokio::sync::mpsc;

        // Thinking deltas wrapped in stream_event (from --include-partial-messages)
        let ndjson = r#"{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"hmm..."}}}
{"type":"result","duration_ms":50}"#;

        let (tx, mut rx) = mpsc::channel(256);

        let mut child = tokio::process::Command::new("echo")
            .arg("-n")
            .arg(ndjson)
            .stdout(std::process::Stdio::piped())
            .spawn()
            .unwrap();

        let stdout = child.stdout.take().unwrap();

        tokio::spawn(async move {
            parse_stream(stdout, tx, None, None).await;
        });

        let mut events = vec![];
        while let Some(event) = rx.recv().await {
            events.push(event);
        }

        assert_eq!(events.len(), 2);
        match &events[0] {
            RawStreamEvent::ContentBlockDelta { delta, .. } => {
                match delta.as_ref().unwrap() {
                    StreamDelta::ThinkingDelta { thinking } => assert_eq!(thinking, "hmm..."),
                    other => panic!("Expected ThinkingDelta, got {:?}", other),
                }
            }
            other => panic!("Expected ContentBlockDelta, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn stream_parser_survives_malformed_lines() {
        use crate::claude::stream_parser::parse_stream;
        use tokio::sync::mpsc;

        let ndjson = r#"{"type":"system","subtype":"init","model":"sonnet"}
{broken json here
{"type":"result","duration_ms":50}"#;

        let (tx, mut rx) = mpsc::channel(256);

        let mut child = tokio::process::Command::new("echo")
            .arg("-n")
            .arg(ndjson)
            .stdout(std::process::Stdio::piped())
            .spawn()
            .unwrap();

        let stdout = child.stdout.take().unwrap();

        tokio::spawn(async move {
            parse_stream(stdout, tx, None, None).await;
        });

        let mut events = vec![];
        while let Some(event) = rx.recv().await {
            events.push(event);
        }

        assert_eq!(events.len(), 2, "Malformed line should be skipped, valid ones kept");
    }
