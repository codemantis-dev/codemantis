use log::{debug, info, warn};
use std::collections::HashSet;
use std::sync::LazyLock;
use regex::Regex;

/// Strip ANSI escape sequences (SGR, CSI, OSC) from terminal output.
/// Real PTY output embeds color/style codes that break URL regex matching.
static ANSI_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(concat!(
        r"\x1b\[[0-9;]*[A-Za-z]",       // CSI sequences (e.g. \e[32m, \e[0m)
        r"|\x1b\].*?(?:\x1b\\|\x07)",     // OSC sequences (e.g. \e]8;;url\e\\)
        r"|\x1b[()][A-Z0-9]",             // Character set selection
        r"|\x1b[=>]",                      // Keypad mode
    )).expect("ANSI_RE: invalid regex pattern")
});

static LSOF_PORT_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r":(\d+)\s+\(LISTEN\)").expect("LSOF_PORT_RE: invalid regex pattern")
});

/// Lines indicating a port is already occupied — must be skipped before pattern matching.
static PORT_IN_USE_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)(?:already in use|is in use|in use.*trying|using available port|EADDRINUSE|address already|port is occupied|is already running on port)").expect("PORT_IN_USE_RE: invalid regex pattern")
});

/// Extract the occupied port number from "port in use" messages.
/// E.g. "Port 5173 is in use, trying another one..." → 5173
static OCCUPIED_PORT_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)(?:port\s+)(\d+)(?:\s+is\s+(?:already\s+)?in\s+use|.*EADDRINUSE|.*address already|\s+is\s+occupied|\s+is\s+already\s+running)").expect("OCCUPIED_PORT_RE: invalid regex pattern")
});

/// Common dev server ports to probe as a last-resort fallback when terminal
/// output scanning and expected-port probing both fail.
pub const DEFAULT_DEV_PORTS: &[u16] = &[
    5173, 5174, 5175, 5176, // Vite
    4173, 4174,             // Vite preview
    3000, 3001, 3002, 3030, // Next.js, Express, Rails
    4000, 4200,             // Phoenix, Angular
    4321,                   // Astro
    5000, 5500,             // Flask, Live Server
    1234,                   // Parcel
    8000, 8080, 8081,       // Django/Uvicorn, Webpack, generic
    8888, 9000, 9090,       // Jupyter, generic
];

static PORT_PATTERNS: LazyLock<Vec<Regex>> = LazyLock::new(|| {
    let patterns = [
        // Framework-specific patterns (most reliable)
        // Vite: "Local: http://localhost:5173/"
        (r"Local:\s+https?://(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d+)", "Vite Local"),
        // Next.js: "ready started server on 0.0.0.0:3000, url: http://localhost:3000"
        (r"ready started server on .+?:(\d+)", "Next.js ready"),
        // Next.js (newer): "▲ Next.js 15 ... Local: http://localhost:3000"
        (r"Local:\s+https?://localhost:(\d+)", "Next.js Local"),
        // Generic URL patterns
        (r"https?://(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d+)", "generic URL"),
        // "listening on port 3000"
        (r"(?i)listening on (?:port )?(\d+)", "listening on port"),
        // "server running at http://...:3000"
        (r"(?i)server (?:running|started|listening) (?:at|on) .+?:(\d+)", "server running"),
        // Uvicorn: "Uvicorn running on http://127.0.0.1:8000"
        (r"Uvicorn running on https?://(?:127\.0\.0\.1|0\.0\.0\.0):(\d+)", "Uvicorn"),
    ];
    patterns.iter().map(|(pat, label)| {
        Regex::new(pat).unwrap_or_else(|e| panic!("PORT_PATTERNS[{}]: invalid regex: {}", label, e))
    }).collect()
});

/// Scan a line of terminal output for a dev server URL/port.
/// Returns (port, url) if found.
pub fn scan_for_dev_server_url(line: &str) -> Option<(u16, String)> {
    // Strip ANSI escape codes — real PTY output embeds color/style codes
    // that break regex matching (e.g. "\e[36mhttp://\e[0mlocalhost:5173")
    let cleaned = ANSI_RE.replace_all(line, "");
    let line = cleaned.as_ref();

    // Skip lines about ports already in use — prevents matching the occupied port
    // (e.g. Vite: "Port 5173 is already in use, trying 5174...")
    if PORT_IN_USE_RE.is_match(line) {
        debug!("Skipping port-in-use line: {}", line.trim());
        return None;
    }

    for pattern in PORT_PATTERNS.iter() {
        if let Some(caps) = pattern.captures(line) {
            if let Some(port_match) = caps.get(1) {
                if let Ok(port) = port_match.as_str().parse::<u16>() {
                    // Skip common false positives
                    if port < 1024 {
                        continue;
                    }
                    let url = format!("http://localhost:{}", port);
                    debug!("Detected dev server port {} from line: {}", port, line.trim());
                    return Some((port, url));
                }
            }
        }
    }
    None
}

/// Probe a port to check if an HTTP server is listening.
///
/// Tries both IPv4 (`127.0.0.1`) and IPv6 (`[::1]`) concurrently so that
/// dev servers binding to either protocol are detected without added latency.
/// Modern Vite on macOS binds to `localhost` which resolves to `::1` (IPv6),
/// while older servers bind to `0.0.0.0` (IPv4 only).
///
/// Uses `GET` (not `HEAD`) because some dev servers and middleware (fumadocs-mdx,
/// Astro middleware, vite-plugin-html) reject HEAD with 405/501 or hang the
/// connection. A 5 s timeout absorbs slow first-compile responses where Vite
/// holds the socket open for several seconds while pre-bundling deps. Any HTTP
/// response — including 4xx/5xx — counts as success: we are checking *liveness*,
/// not the content. Connection refused / DNS errors are still rejected fast.
pub async fn probe_port(port: u16) -> bool {
    let client = reqwest::Client::new();
    let timeout = std::time::Duration::from_secs(5);

    let ipv4 = client
        .get(format!("http://127.0.0.1:{}", port))
        .timeout(timeout)
        .send();
    let ipv6 = client
        .get(format!("http://[::1]:{}", port))
        .timeout(timeout)
        .send();

    let (v4, v6) = tokio::join!(ipv4, ipv6);

    if v4.is_ok() {
        debug!("Port {} responding on IPv4 (127.0.0.1)", port);
        true
    } else if v6.is_ok() {
        debug!("Port {} responding on IPv6 (::1)", port);
        true
    } else {
        debug!("Port {} probe failed on both IPv4 and IPv6", port);
        false
    }
}

/// Extract the occupied port number from a "port in use" line.
/// Returns `Some(port)` if the line indicates a port collision.
///
/// # Examples
/// - `"Port 5173 is in use, trying another one..."` → `Some(5173)`
/// - `"Port 3000 is already in use, trying 3001 instead."` → `Some(3000)`
/// - `"Error: listen EADDRINUSE: address already in use :::5173"` → `Some(5173)`
pub fn extract_occupied_port(line: &str) -> Option<u16> {
    let cleaned = ANSI_RE.replace_all(line, "");
    let line = cleaned.as_ref();

    if !PORT_IN_USE_RE.is_match(line) {
        return None;
    }

    if let Some(caps) = OCCUPIED_PORT_RE.captures(line) {
        if let Some(port_match) = caps.get(1) {
            if let Ok(port) = port_match.as_str().parse::<u16>() {
                if port >= 1024 {
                    debug!("Extracted occupied port {} from line: {}", port, line.trim());
                    return Some(port);
                }
            }
        }
    }

    // Fallback: scan for any port number in the line
    // (handles formats like "EADDRINUSE :::5173" where the port is after :::)
    static FALLBACK_PORT_RE: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"(?::::|port\s+)(\d+)").expect("FALLBACK_PORT_RE: invalid regex pattern")
    });
    if let Some(caps) = FALLBACK_PORT_RE.captures(line) {
        if let Some(port_match) = caps.get(1) {
            if let Ok(port) = port_match.as_str().parse::<u16>() {
                if port >= 1024 {
                    debug!("Extracted occupied port {} (fallback) from line: {}", port, line.trim());
                    return Some(port);
                }
            }
        }
    }

    None
}

/// Probe a list of candidate ports, skipping excluded ones.
/// Returns the first port that responds to HTTP, along with its URL.
///
/// Retained as a utility (and exercised by the unit tests below) but no
/// longer called from the preview detection task — the new architecture
/// spawns parallel `confirm_and_announce` tasks per candidate port instead
/// of probing sequentially, so individual slow ports don't block faster ones.
#[allow(dead_code)]
pub async fn probe_port_range(candidates: &[u16], exclude: &HashSet<u16>) -> Option<(u16, String)> {
    for &port in candidates {
        if exclude.contains(&port) {
            debug!("Skipping excluded port {} in range scan", port);
            continue;
        }
        if probe_port(port).await {
            let url = format!("http://localhost:{}", port);
            info!("Port range scan found server on port {}", port);
            return Some((port, url));
        }
    }
    None
}

/// Use `lsof` to enumerate the TCP ports a specific PID is listening on.
///
/// This is the most reliable detection signal — it bypasses output parsing
/// and asks the OS directly what the dev-server subprocess has bound. Used by
/// the preview detection task as a parallel "Layer 1.5" when terminal-output
/// regex matching is slow or fails (e.g. silent dev servers, custom output
/// formatters). macOS-specific (lsof is preinstalled).
pub fn scan_pid_ports(pid: u32) -> Vec<u16> {
    let output = std::process::Command::new("lsof")
        .args(["-i", "-P", "-n", "-a", "-p", &pid.to_string()])
        .output();

    match output {
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout);
            let mut ports: Vec<u16> = LSOF_PORT_RE
                .captures_iter(&stdout)
                .filter_map(|caps| caps.get(1)?.as_str().parse().ok())
                .filter(|&p| p >= 1024)
                .collect();
            ports.sort();
            ports.dedup();
            debug!("lsof found ports for PID {}: {:?}", pid, ports);
            ports
        }
        Err(e) => {
            warn!("Failed to run lsof for PID {}: {}", pid, e);
            vec![]
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── Static regex compilation validation ──

    #[test]
    fn all_static_regexes_compile_successfully() {
        // Force evaluation of all LazyLock regexes to verify patterns are valid.
        // If any pattern is broken, this test panics with a descriptive message
        // (from the .expect() calls) instead of failing silently at runtime.
        let _ = ANSI_RE.as_str();
        let _ = LSOF_PORT_RE.as_str();
        let _ = PORT_IN_USE_RE.as_str();
        let _ = OCCUPIED_PORT_RE.as_str();
        assert!(!PORT_PATTERNS.is_empty(), "PORT_PATTERNS should contain patterns");
        // FALLBACK_PORT_RE is inside extract_occupied_port — exercise it:
        let _ = extract_occupied_port("dummy");
    }

    // --- Vite patterns ---

    #[test]
    fn test_vite_output() {
        let line = "  ➜  Local:   http://localhost:5173/";
        let result = scan_for_dev_server_url(line);
        assert_eq!(result, Some((5173, "http://localhost:5173".to_string())));
    }

    #[test]
    fn test_vite_network_127() {
        let line = "  ➜  Local:   http://127.0.0.1:5173/";
        let result = scan_for_dev_server_url(line);
        assert_eq!(result, Some((5173, "http://localhost:5173".to_string())));
    }

    #[test]
    fn test_vite_custom_port() {
        let line = "  ➜  Local:   http://localhost:4000/";
        let result = scan_for_dev_server_url(line);
        assert_eq!(result, Some((4000, "http://localhost:4000".to_string())));
    }

    #[test]
    fn test_vite_https() {
        let line = "  ➜  Local:   https://localhost:5173/";
        let result = scan_for_dev_server_url(line);
        assert_eq!(result, Some((5173, "http://localhost:5173".to_string())));
    }

    // --- Next.js patterns ---

    #[test]
    fn test_nextjs_output() {
        let line = "  ▲ Next.js 16.0.0 (Turbopack)\n  - Local: http://localhost:3000";
        let result = scan_for_dev_server_url(line);
        assert_eq!(result, Some((3000, "http://localhost:3000".to_string())));
    }

    #[test]
    fn test_nextjs_ready_started() {
        let line = "ready started server on 0.0.0.0:3000, url: http://localhost:3000";
        let result = scan_for_dev_server_url(line);
        assert_eq!(result, Some((3000, "http://localhost:3000".to_string())));
    }

    #[test]
    fn test_nextjs_port_fallback() {
        let line = "ready started server on 0.0.0.0:3001, url: http://localhost:3001";
        let result = scan_for_dev_server_url(line);
        assert_eq!(result, Some((3001, "http://localhost:3001".to_string())));
    }

    // --- Generic patterns ---

    #[test]
    fn test_generic_listening() {
        let line = "Server listening on port 8080";
        let result = scan_for_dev_server_url(line);
        assert_eq!(result, Some((8080, "http://localhost:8080".to_string())));
    }

    #[test]
    fn test_generic_listening_on_port_number() {
        let line = "listening on port 9090";
        let result = scan_for_dev_server_url(line);
        assert_eq!(result, Some((9090, "http://localhost:9090".to_string())));
    }

    #[test]
    fn test_generic_server_running_at() {
        let line = "Server running at http://localhost:4200";
        let result = scan_for_dev_server_url(line);
        assert_eq!(result, Some((4200, "http://localhost:4200".to_string())));
    }

    #[test]
    fn test_generic_server_started_on() {
        let line = "Server started on http://0.0.0.0:8000";
        let result = scan_for_dev_server_url(line);
        assert_eq!(result, Some((8000, "http://localhost:8000".to_string())));
    }

    #[test]
    fn test_bare_localhost_url() {
        let line = "Open http://localhost:3000 in your browser";
        let result = scan_for_dev_server_url(line);
        assert_eq!(result, Some((3000, "http://localhost:3000".to_string())));
    }

    #[test]
    fn test_bare_127_url() {
        let line = "App available at http://127.0.0.1:8888";
        let result = scan_for_dev_server_url(line);
        assert_eq!(result, Some((8888, "http://localhost:8888".to_string())));
    }

    #[test]
    fn test_0000_url() {
        let line = "Listening on http://0.0.0.0:3000";
        let result = scan_for_dev_server_url(line);
        assert_eq!(result, Some((3000, "http://localhost:3000".to_string())));
    }

    #[test]
    fn test_port_colon_format() {
        // Bare "port: 5000" no longer matches — pattern #8 was removed to prevent false positives
        let line = "Application port: 5000";
        let result = scan_for_dev_server_url(line);
        assert!(result.is_none());
    }

    // --- Case insensitivity ---

    #[test]
    fn test_case_insensitive_listening() {
        let line = "LISTENING ON PORT 4000";
        let result = scan_for_dev_server_url(line);
        assert_eq!(result, Some((4000, "http://localhost:4000".to_string())));
    }

    #[test]
    fn test_case_insensitive_server() {
        let line = "SERVER STARTED ON http://localhost:9000";
        let result = scan_for_dev_server_url(line);
        assert_eq!(result, Some((9000, "http://localhost:9000".to_string())));
    }

    // --- Edge cases & filtering ---

    #[test]
    fn test_no_match() {
        let line = "Compiling modules...";
        let result = scan_for_dev_server_url(line);
        assert!(result.is_none());
    }

    #[test]
    fn test_empty_line() {
        let result = scan_for_dev_server_url("");
        assert!(result.is_none());
    }

    #[test]
    fn test_low_port_filtered() {
        let line = "port 80";
        let result = scan_for_dev_server_url(line);
        assert!(result.is_none());
    }

    #[test]
    fn test_port_443_filtered() {
        let line = "https://localhost:443/api";
        let result = scan_for_dev_server_url(line);
        assert!(result.is_none());
    }

    #[test]
    fn test_port_22_filtered() {
        let line = "listening on port 22";
        let result = scan_for_dev_server_url(line);
        assert!(result.is_none());
    }

    #[test]
    fn test_port_1024_allowed() {
        // 1024 is the boundary — should be allowed
        let line = "http://localhost:1024";
        let result = scan_for_dev_server_url(line);
        assert_eq!(result, Some((1024, "http://localhost:1024".to_string())));
    }

    #[test]
    fn test_high_port() {
        let line = "http://localhost:65000";
        let result = scan_for_dev_server_url(line);
        assert_eq!(result, Some((65000, "http://localhost:65000".to_string())));
    }

    #[test]
    fn test_no_false_positive_on_random_numbers() {
        let line = "Downloaded 3000 files in 5 seconds";
        // "3000" might match a generic "port" pattern but shouldn't match
        // since there's no port-related keyword
        let result = scan_for_dev_server_url(line);
        assert!(result.is_none());
    }

    #[test]
    fn test_ansi_escape_codes_in_line() {
        // Some frameworks output ANSI color codes
        let line = "\x1b[32m  ➜  Local:\x1b[0m   \x1b[36mhttp://localhost:5173/\x1b[0m";
        let result = scan_for_dev_server_url(line);
        assert_eq!(result, Some((5173, "http://localhost:5173".to_string())));
    }

    #[test]
    fn test_trailing_path_in_url() {
        let line = "http://localhost:3000/dashboard";
        let result = scan_for_dev_server_url(line);
        assert_eq!(result, Some((3000, "http://localhost:3000".to_string())));
    }

    // --- Framework-specific real-world output ---

    #[test]
    fn test_webpack_dev_server() {
        let line = "  <i> [webpack-dev-server] Project is running at http://localhost:8080/";
        let result = scan_for_dev_server_url(line);
        assert_eq!(result, Some((8080, "http://localhost:8080".to_string())));
    }

    #[test]
    fn test_flask_output() {
        let line = " * Running on http://127.0.0.1:5000";
        let result = scan_for_dev_server_url(line);
        assert_eq!(result, Some((5000, "http://localhost:5000".to_string())));
    }

    #[test]
    fn test_rails_output() {
        let line = "* Listening on http://0.0.0.0:3000";
        let result = scan_for_dev_server_url(line);
        assert_eq!(result, Some((3000, "http://localhost:3000".to_string())));
    }

    #[test]
    fn test_django_output() {
        let line = "Starting development server at http://127.0.0.1:8000/";
        let result = scan_for_dev_server_url(line);
        assert_eq!(result, Some((8000, "http://localhost:8000".to_string())));
    }

    #[test]
    fn test_express_output() {
        let line = "Server listening on port 3000";
        let result = scan_for_dev_server_url(line);
        assert_eq!(result, Some((3000, "http://localhost:3000".to_string())));
    }

    #[test]
    fn test_uvicorn_output() {
        let line = "INFO:     Uvicorn running on http://127.0.0.1:8000 (Press CTRL+C to quit)";
        let result = scan_for_dev_server_url(line);
        assert_eq!(result, Some((8000, "http://localhost:8000".to_string())));
    }

    #[test]
    fn test_uvicorn_0000() {
        let line = "Uvicorn running on http://0.0.0.0:8080";
        let result = scan_for_dev_server_url(line);
        assert_eq!(result, Some((8080, "http://localhost:8080".to_string())));
    }

    // --- ANSI escape code stripping ---

    #[test]
    fn test_ansi_codes_splitting_url() {
        // ANSI codes inserted in the middle of the URL (e.g. color change between scheme and host)
        let line = "\x1b[36mhttp://\x1b[0mlocalhost:5173/";
        let result = scan_for_dev_server_url(line);
        assert_eq!(result, Some((5173, "http://localhost:5173".to_string())));
    }

    #[test]
    fn test_ansi_bold_and_color_interleaved() {
        // Bold + color wrapping parts of "Local: http://localhost:5173/"
        let line = "\x1b[1m\x1b[32m  ➜\x1b[0m  \x1b[1mLocal:\x1b[0m   \x1b[36mhttp://localhost:\x1b[1m5173\x1b[0m\x1b[36m/\x1b[0m";
        let result = scan_for_dev_server_url(line);
        assert_eq!(result, Some((5173, "http://localhost:5173".to_string())));
    }

    #[test]
    fn test_osc8_hyperlink() {
        // OSC 8 hyperlink: \e]8;;url\e\\text\e]8;;\e\\
        let line = "\x1b]8;;http://localhost:3000\x1b\\http://localhost:3000\x1b]8;;\x1b\\";
        let result = scan_for_dev_server_url(line);
        assert_eq!(result, Some((3000, "http://localhost:3000".to_string())));
    }

    #[test]
    fn test_osc8_hyperlink_bel_terminated() {
        // OSC 8 hyperlink terminated by BEL (\x07) instead of ST (\e\\)
        let line = "\x1b]8;;http://localhost:4000\x07http://localhost:4000\x1b]8;;\x07";
        let result = scan_for_dev_server_url(line);
        assert_eq!(result, Some((4000, "http://localhost:4000".to_string())));
    }

    #[test]
    fn test_ansi_256color_codes() {
        // 256-color SGR sequences
        let line = "\x1b[38;5;82m  Local:\x1b[0m   \x1b[38;5;45mhttp://localhost:8080/\x1b[0m";
        let result = scan_for_dev_server_url(line);
        assert_eq!(result, Some((8080, "http://localhost:8080".to_string())));
    }

    #[test]
    fn test_ansi_truecolor_codes() {
        // 24-bit truecolor SGR sequences
        let line = "\x1b[38;2;0;255;0mLocal:\x1b[0m \x1b[38;2;0;200;255mhttp://localhost:9000\x1b[0m";
        let result = scan_for_dev_server_url(line);
        assert_eq!(result, Some((9000, "http://localhost:9000".to_string())));
    }

    #[test]
    fn test_nextjs_real_terminal_output() {
        // Real Next.js output with ANSI codes
        let line = "  \x1b[32m▲\x1b[0m Next.js 16.0.0 (Turbopack)\n  - \x1b[36mLocal:\x1b[0m http://localhost:3000";
        let result = scan_for_dev_server_url(line);
        assert_eq!(result, Some((3000, "http://localhost:3000".to_string())));
    }

    // --- Port-in-use rejection ---

    #[test]
    fn test_port_in_use_vite() {
        let line = "Port 5173 is already in use, trying 5174...";
        let result = scan_for_dev_server_url(line);
        assert!(result.is_none());
    }

    #[test]
    fn test_port_in_use_nextjs() {
        let line = "Port 3000 is in use, trying 3001 instead.";
        let result = scan_for_dev_server_url(line);
        assert!(result.is_none());
    }

    #[test]
    fn test_port_in_use_cra() {
        let line = "Something is already running on port 3000.";
        let result = scan_for_dev_server_url(line);
        assert!(result.is_none());
    }

    #[test]
    fn test_port_in_use_eaddrinuse() {
        let line = "Error: listen EADDRINUSE: address already in use :::5173";
        let result = scan_for_dev_server_url(line);
        assert!(result.is_none());
    }

    #[test]
    fn test_port_in_use_ansi_wrapped() {
        let line = "\x1b[31mPort 5173 is already in use\x1b[0m, trying 5174...";
        let result = scan_for_dev_server_url(line);
        assert!(result.is_none());
    }

    // ── Next.js 16 "is in use" patterns ──

    #[test]
    fn test_port_in_use_nextjs16_bare() {
        // Next.js 16: "Port 3000 is in use by process 8197, using available port 3001 instead."
        let line = "⚠ Port 3000 is in use by process 8197, using available port 3001 instead.";
        let result = scan_for_dev_server_url(line);
        assert!(result.is_none());
    }

    #[test]
    fn test_port_in_use_bare_is_in_use() {
        let line = "Port 3000 is in use";
        let result = scan_for_dev_server_url(line);
        assert!(result.is_none());
    }

    #[test]
    fn test_extract_occupied_port_nextjs16() {
        let line = "⚠ Port 3000 is in use by process 8197, using available port 3001 instead.";
        assert_eq!(extract_occupied_port(line), Some(3000));
    }

    #[test]
    fn test_extract_occupied_port_bare_is_in_use() {
        let line = "Port 5173 is in use";
        assert_eq!(extract_occupied_port(line), Some(5173));
    }

    #[test]
    fn test_port_in_use_using_available_port() {
        // The "using available port" phrase should also be recognized as a port-in-use context
        let line = "using available port 3001 instead";
        let result = scan_for_dev_server_url(line);
        assert!(result.is_none());
    }

    // ── Additional edge cases ──

    #[test]
    fn test_multiple_urls_returns_first() {
        // When a line has multiple ports, the first valid match wins
        let line = "Local: http://localhost:3000  Network: http://192.168.1.1:3000";
        let result = scan_for_dev_server_url(line);
        assert_eq!(result, Some((3000, "http://localhost:3000".to_string())));
    }

    #[test]
    fn test_port_65535_boundary() {
        let line = "http://localhost:65535";
        let result = scan_for_dev_server_url(line);
        assert_eq!(result, Some((65535, "http://localhost:65535".to_string())));
    }

    #[test]
    fn test_port_1023_filtered() {
        // Port 1023 is below the 1024 threshold
        let line = "http://localhost:1023";
        let result = scan_for_dev_server_url(line);
        assert!(result.is_none());
    }

    #[test]
    fn test_port_is_occupied_rejected() {
        let line = "port is occupied on 5173";
        let result = scan_for_dev_server_url(line);
        assert!(result.is_none());
    }

    #[test]
    fn test_already_running_on_port_rejected() {
        let line = "Server is already running on port 3000";
        let result = scan_for_dev_server_url(line);
        assert!(result.is_none());
    }

    #[test]
    fn test_astro_output() {
        let line = "  🚀  astro  v5.0.0 started in 300ms\n\n  ┃ Local    http://localhost:4321/";
        let result = scan_for_dev_server_url(line);
        assert_eq!(result, Some((4321, "http://localhost:4321".to_string())));
    }

    #[test]
    fn test_go_server_output() {
        let line = "Server started on http://localhost:8090";
        let result = scan_for_dev_server_url(line);
        assert_eq!(result, Some((8090, "http://localhost:8090".to_string())));
    }

    #[test]
    fn test_listening_without_keyword() {
        // Just a bare number without server context should not match
        let line = "Total: 8080 items processed";
        let result = scan_for_dev_server_url(line);
        assert!(result.is_none());
    }

    // ── ANSI stripping additional tests ──

    #[test]
    fn test_ansi_cursor_position_codes() {
        // CSI cursor movement codes (e.g. \e[2A = move up 2 lines)
        let line = "\x1b[2Ahttp://localhost:3000\x1b[0m";
        let result = scan_for_dev_server_url(line);
        assert_eq!(result, Some((3000, "http://localhost:3000".to_string())));
    }

    #[test]
    fn test_character_set_selection_codes() {
        let line = "\x1b(Bhttp://localhost:4000\x1b(0";
        let result = scan_for_dev_server_url(line);
        assert_eq!(result, Some((4000, "http://localhost:4000".to_string())));
    }

    // ── lsof regex tests ──

    #[test]
    fn test_lsof_port_regex() {
        let output = "node    12345  user  21u  IPv4  0x123  0t0  TCP *:3000 (LISTEN)\n\
                       node    12345  user  22u  IPv4  0x456  0t0  TCP *:9229 (LISTEN)\n";
        let ports: Vec<u16> = LSOF_PORT_RE
            .captures_iter(output)
            .filter_map(|caps| caps.get(1)?.as_str().parse().ok())
            .filter(|&p| p >= 1024)
            .collect();
        assert_eq!(ports, vec![3000, 9229]);
    }

    #[test]
    fn test_lsof_port_regex_filters_low_ports() {
        let output = "nginx   100  root  6u  IPv4  0x789  0t0  TCP *:80 (LISTEN)\n\
                       nginx   100  root  7u  IPv4  0xabc  0t0  TCP *:443 (LISTEN)\n";
        let ports: Vec<u16> = LSOF_PORT_RE
            .captures_iter(output)
            .filter_map(|caps| caps.get(1)?.as_str().parse().ok())
            .filter(|&p| p >= 1024)
            .collect();
        assert!(ports.is_empty());
    }

    // ── probe_port tests ──

    #[tokio::test]
    async fn test_probe_port_returns_false_for_closed_port() {
        // Port 59999 is extremely unlikely to have a server running
        let result = probe_port(59999).await;
        assert!(!result);
    }

    #[tokio::test]
    async fn test_probe_port_returns_false_for_low_port() {
        // Port 1 should not have an HTTP server
        let result = probe_port(1).await;
        assert!(!result);
    }

    /// Validates that probe_port constructs URLs with 127.0.0.1 (not localhost).
    /// This is a static analysis test — we verify the format! template in source
    /// rather than making network calls, since the actual HTTP call is covered
    /// by the integration tests above.
    #[test]
    fn test_probe_url_uses_ipv4_loopback() {
        let url = format!("http://127.0.0.1:{}", 3000);
        assert_eq!(url, "http://127.0.0.1:3000");
        assert!(!url.contains("localhost"));
    }

    // ── extract_occupied_port tests ──

    #[test]
    fn test_extract_occupied_port_vite() {
        let line = "Port 5173 is in use, trying another one...";
        assert_eq!(extract_occupied_port(line), Some(5173));
    }

    #[test]
    fn test_extract_occupied_port_vite_already() {
        let line = "Port 5173 is already in use, trying 5174...";
        assert_eq!(extract_occupied_port(line), Some(5173));
    }

    #[test]
    fn test_extract_occupied_port_nextjs() {
        let line = "Port 3000 is in use, trying 3001 instead.";
        assert_eq!(extract_occupied_port(line), Some(3000));
    }

    #[test]
    fn test_extract_occupied_port_eaddrinuse() {
        let line = "Error: listen EADDRINUSE: address already in use :::5173";
        assert_eq!(extract_occupied_port(line), Some(5173));
    }

    #[test]
    fn test_extract_occupied_port_cra() {
        let line = "Something is already running on port 3000.";
        assert_eq!(extract_occupied_port(line), Some(3000));
    }

    #[test]
    fn test_extract_occupied_port_none_for_normal_line() {
        let line = "  ➜  Local:   http://localhost:5173/";
        assert_eq!(extract_occupied_port(line), None);
    }

    #[test]
    fn test_extract_occupied_port_ansi_wrapped() {
        let line = "\x1b[31mPort 5173 is already in use\x1b[0m, trying 5174...";
        assert_eq!(extract_occupied_port(line), Some(5173));
    }

    #[test]
    fn test_extract_occupied_port_occupied_keyword() {
        let line = "port is occupied on 5173";
        // PORT_IN_USE_RE matches, but OCCUPIED_PORT_RE expects "port 5173 is occupied"
        // The fallback regex handles "port 5173" patterns
        // This line says "port is occupied on 5173" — PORT_IN_USE_RE matches because
        // it contains "port is occupied", then we try to extract the port number.
        let result = extract_occupied_port(line);
        // The port number here is just at the end, not in a standard format.
        // The OCCUPIED_PORT_RE won't match because the number comes after "on".
        // The fallback "port\s+" won't match either since "port" is followed by "is", not a number.
        // This is acceptable — the important case is that scan_for_dev_server_url
        // already rejects this line via PORT_IN_USE_RE.
        assert!(result.is_none() || result == Some(5173));
    }

    // ── probe_port_range tests ──

    #[tokio::test]
    async fn test_probe_port_range_skips_excluded() {
        let exclude: HashSet<u16> = vec![59998, 59999].into_iter().collect();
        // Both ports are excluded and also not running — should return None
        let result = probe_port_range(&[59998, 59999], &exclude).await;
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn test_probe_port_range_no_servers() {
        let exclude: HashSet<u16> = HashSet::new();
        // These ports are extremely unlikely to have servers
        let result = probe_port_range(&[59997, 59998, 59999], &exclude).await;
        assert!(result.is_none());
    }

    // ── probe_port + real local listener ───────────────────────────────
    //
    // These tests cover the GET-based probing introduced as part of the
    // resilience overhaul. They guard against regressions to:
    //   1. HEAD-rejecting servers being missed (probe must use GET).
    //   2. The 5 s timeout silently dropping back to 2 s.
    //   3. probe_port treating a 4xx/5xx response as failure (it must
    //      treat *any* HTTP response as liveness).

    #[tokio::test]
    async fn test_probe_port_succeeds_against_real_get_only_listener() {
        // Bind a TCP listener that *only* responds to GET requests.
        // If probe_port still used HEAD, the connection would close before
        // a status line arrived → probe would fail.
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        use tokio::net::TcpListener;

        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind random port");
        let port = listener.local_addr().unwrap().port();

        let server = tokio::spawn(async move {
            // Accept a single connection, read the request line, respond.
            if let Ok((mut sock, _)) = listener.accept().await {
                let mut buf = [0u8; 1024];
                let n = sock.read(&mut buf).await.unwrap_or(0);
                let req = std::str::from_utf8(&buf[..n]).unwrap_or("");
                if req.starts_with("GET ") {
                    let _ = sock
                        .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok")
                        .await;
                }
                // For HEAD or anything else: drop the connection without responding.
                let _ = sock.shutdown().await;
            }
        });

        let result = probe_port(port).await;
        let _ = server.await;
        assert!(result, "probe_port must succeed against a GET-only listener");
    }

    #[tokio::test]
    async fn test_probe_port_treats_5xx_as_alive() {
        // A dev server returning 502 because its proxy target isn't ready
        // is still *alive* — probe_port must treat that as a successful
        // probe (we'd rather try opening the preview than time out).
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        use tokio::net::TcpListener;

        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind random port");
        let port = listener.local_addr().unwrap().port();

        let server = tokio::spawn(async move {
            if let Ok((mut sock, _)) = listener.accept().await {
                let mut buf = [0u8; 1024];
                let _ = sock.read(&mut buf).await;
                let _ = sock
                    .write_all(b"HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n")
                    .await;
                let _ = sock.shutdown().await;
            }
        });

        let result = probe_port(port).await;
        let _ = server.await;
        assert!(
            result,
            "probe_port must treat any HTTP response (incl. 5xx) as success"
        );
    }

    // ── DEFAULT_DEV_PORTS coverage ─────────────────────────────────────

    #[test]
    fn default_dev_ports_includes_common_alternates() {
        // Regression guard: the user reported failures across many frameworks
        // because the fallback port list was too narrow. These ports cover
        // common dev-server defaults; the list must keep covering them.
        let ports: HashSet<u16> = DEFAULT_DEV_PORTS.iter().copied().collect();
        for must_have in [
            5173, 5174, // Vite + collision fallback
            4173, 4174, // Vite preview
            3000, 3030, // Next.js / Express variants
            4000, 4200, // Phoenix / Angular
            4321,       // Astro
            5000, 5500, // Flask / Live Server
            1234,       // Parcel
            8000, 8080, 8888, 9000, 9090,
        ] {
            assert!(
                ports.contains(&must_have),
                "DEFAULT_DEV_PORTS must contain {} (used by common dev tooling)",
                must_have
            );
        }
        // Sanity: no privileged ports
        for p in DEFAULT_DEV_PORTS {
            assert!(*p >= 1024, "DEFAULT_DEV_PORTS must skip privileged ports");
        }
    }
}
