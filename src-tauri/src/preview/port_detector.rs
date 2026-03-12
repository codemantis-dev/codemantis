use log::{debug, warn};
use std::sync::LazyLock;
use regex::Regex;

static PORT_PATTERNS: LazyLock<Vec<Regex>> = LazyLock::new(|| {
    vec![
        // Framework-specific patterns (most reliable)
        // Vite: "Local: http://localhost:5173/"
        Regex::new(r"Local:\s+https?://(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d+)").unwrap(),
        // Next.js: "ready started server on 0.0.0.0:3000, url: http://localhost:3000"
        Regex::new(r"ready started server on .+?:(\d+)").unwrap(),
        // Next.js (newer): "▲ Next.js 15 ... Local: http://localhost:3000"
        Regex::new(r"Local:\s+https?://localhost:(\d+)").unwrap(),
        // Generic URL patterns
        Regex::new(r"https?://(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d+)").unwrap(),
        // "listening on port 3000"
        Regex::new(r"(?i)listening on (?:port )?(\d+)").unwrap(),
        // "server running at http://...:3000"
        Regex::new(r"(?i)server (?:running|started|listening) (?:at|on) .+?:(\d+)").unwrap(),
        // "port 3000"
        Regex::new(r"(?i)port[:\s]+(\d+)").unwrap(),
    ]
});

/// Scan a line of terminal output for a dev server URL/port.
/// Returns (port, url) if found.
pub fn scan_for_dev_server_url(line: &str) -> Option<(u16, String)> {
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
pub async fn probe_port(port: u16) -> bool {
    let url = format!("http://localhost:{}", port);
    match reqwest::Client::new()
        .head(&url)
        .timeout(std::time::Duration::from_secs(2))
        .send()
        .await
    {
        Ok(_) => {
            debug!("Port {} is responding to HTTP", port);
            true
        }
        Err(_) => false,
    }
}

/// Use lsof to find ports opened by a specific PID (macOS fallback).
#[allow(dead_code)]
pub fn scan_pid_ports(pid: u32) -> Vec<u16> {
    let output = std::process::Command::new("lsof")
        .args(["-i", "-P", "-n", "-a", "-p", &pid.to_string()])
        .output();

    match output {
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout);
            let port_re = Regex::new(r":(\d+)\s+\(LISTEN\)").unwrap();
            let mut ports: Vec<u16> = port_re
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
        let line = "Application port: 5000";
        let result = scan_for_dev_server_url(line);
        assert_eq!(result, Some((5000, "http://localhost:5000".to_string())));
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
}
