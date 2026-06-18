//! Duo-Coding backend module — the API-LLM analyst and its real-time events.
//! The orchestration state machine lives in the frontend `duoStore`; this
//! module supplies the observability analyst and the snapshot event channel.

pub mod analyst;
pub mod events;
