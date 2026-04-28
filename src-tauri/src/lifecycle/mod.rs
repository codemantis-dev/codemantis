//! App lifecycle plumbing.
//!
//! Detects when the WKWebView content process becomes unresponsive — most
//! commonly after a long macOS sleep / lock — and forces a reload so the
//! window doesn't get stuck on a blank, unmovable canvas. With
//! `titleBarStyle: "Overlay"` the entire drag region is the WebView, so a
//! dead content process makes the whole window appear frozen.

pub mod wake_observer;
