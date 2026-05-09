// `api_probe` verification — fires a single HTTP request and checks the
// response. Auth is injected via the recipe's `auth` field:
//   - "bearer"            → Authorization: Bearer <secret>
//   - "x_api_key"         → x-api-key: <secret>
//   - "query_param:<name>" → ?<name>=<secret>
//   - missing / unknown   → no auth applied
// Extra static headers (e.g. anthropic-version) are added verbatim from
// the recipe's `extra_headers` map.

use super::VerifyOutcome;
use std::collections::HashMap;
use std::time::Duration;

pub struct Probe<'a> {
    pub method: &'a str,
    pub url: &'a str,
    pub auth: Option<&'a str>,
    pub extra_headers: &'a HashMap<String, String>,
    pub success_when: Option<&'a str>,
    pub timeout_ms: u64,
    pub secret: Option<&'a str>,
}

pub async fn check(probe: Probe<'_>) -> VerifyOutcome {
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_millis(probe.timeout_ms))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            return VerifyOutcome::Error {
                error: format!("HTTP client build failed: {}", e),
            }
        }
    };

    let url = match build_url_with_query_auth(probe.url, probe.auth, probe.secret) {
        Ok(u) => u,
        Err(e) => return VerifyOutcome::Error { error: e },
    };

    let mut req = match probe.method.to_uppercase().as_str() {
        "GET" => client.get(url),
        "POST" => client.post(url),
        "PUT" => client.put(url),
        "DELETE" => client.delete(url),
        "HEAD" => client.head(url),
        other => {
            return VerifyOutcome::Error {
                error: format!("unsupported HTTP method: {}", other),
            }
        }
    };

    // Inject header-style auth.
    if let Some(scheme) = probe.auth {
        if let Some(secret) = probe.secret {
            match scheme {
                "bearer" => {
                    req = req.header("Authorization", format!("Bearer {}", secret));
                }
                "x_api_key" => {
                    req = req.header("x-api-key", secret);
                }
                _ if scheme.starts_with("query_param:") => { /* handled in URL */ }
                _ => { /* unknown scheme — no auth injected */ }
            }
        }
    }

    for (k, v) in probe.extra_headers {
        req = req.header(k.as_str(), v.as_str());
    }

    let response = match req.send().await {
        Ok(r) => r,
        Err(e) if e.is_timeout() => {
            return VerifyOutcome::Error {
                error: format!("Request timed out after {} ms", probe.timeout_ms),
            }
        }
        Err(e) => {
            return VerifyOutcome::Error {
                error: format!("Network error: {}", e),
            }
        }
    };

    evaluate_response(response.status().as_u16(), probe.success_when)
}

fn evaluate_response(status: u16, success_when: Option<&str>) -> VerifyOutcome {
    let expected_status = success_when
        .and_then(parse_status_predicate)
        .unwrap_or(200);

    if status == expected_status {
        VerifyOutcome::Satisfied {
            message: Some(format!("HTTP {}", status)),
        }
    } else if status == 401 || status == 403 {
        VerifyOutcome::Missing {
            reason: format!("Auth rejected (HTTP {}). Re-check the value.", status),
        }
    } else {
        VerifyOutcome::Missing {
            reason: format!(
                "Expected HTTP {} but server replied {}",
                expected_status, status
            ),
        }
    }
}

/// Parse `status == <code>` (DSL used in catalog YAML) and return the code.
fn parse_status_predicate(expr: &str) -> Option<u16> {
    let expr = expr.trim();
    let prefix = "status == ";
    if !expr.starts_with(prefix) {
        return None;
    }
    expr[prefix.len()..].trim().parse().ok()
}

/// Apply `query_param:<name>` auth by appending `?<name>=<secret>` to the URL.
fn build_url_with_query_auth(
    base: &str,
    auth: Option<&str>,
    secret: Option<&str>,
) -> Result<String, String> {
    let Some(scheme) = auth else { return Ok(base.into()) };
    let Some(name) = scheme.strip_prefix("query_param:") else {
        return Ok(base.into());
    };
    let Some(value) = secret else {
        // No secret to inject — leave the URL alone; the request will fail
        // and produce the right Missing outcome via the response evaluator.
        return Ok(base.into());
    };
    let separator = if base.contains('?') { '&' } else { '?' };
    Ok(format!(
        "{}{}{}={}",
        base,
        separator,
        urlencoding(name),
        urlencoding(value)
    ))
}

/// Minimal URL encoding for query parameters. Avoids pulling in a new crate
/// just for this — we only need to escape a small set of characters.
fn urlencoding(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char);
            }
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_status_predicate_extracts_code() {
        assert_eq!(parse_status_predicate("status == 200"), Some(200));
        assert_eq!(parse_status_predicate("status == 204"), Some(204));
        assert_eq!(parse_status_predicate(""), None);
        assert_eq!(parse_status_predicate("garbage"), None);
    }

    #[test]
    fn evaluate_response_passes_on_match() {
        assert!(evaluate_response(200, Some("status == 200")).is_satisfied());
        assert!(evaluate_response(200, None).is_satisfied()); // default = 200
    }

    #[test]
    fn evaluate_response_reports_auth_failure_specially() {
        match evaluate_response(401, None) {
            VerifyOutcome::Missing { reason } => assert!(reason.contains("Auth rejected")),
            other => panic!("expected Missing, got {:?}", other),
        }
        match evaluate_response(403, None) {
            VerifyOutcome::Missing { reason } => assert!(reason.contains("Auth rejected")),
            other => panic!("expected Missing, got {:?}", other),
        }
    }

    #[test]
    fn evaluate_response_reports_unexpected_status() {
        match evaluate_response(500, Some("status == 200")) {
            VerifyOutcome::Missing { reason } => {
                assert!(reason.contains("500"));
                assert!(reason.contains("200"));
            }
            other => panic!("expected Missing, got {:?}", other),
        }
    }

    #[test]
    fn build_url_with_query_param_appends_secret() {
        let url = build_url_with_query_auth(
            "https://api.example.com/v1",
            Some("query_param:key"),
            Some("abc123"),
        )
        .unwrap();
        assert_eq!(url, "https://api.example.com/v1?key=abc123");
    }

    #[test]
    fn build_url_with_query_param_uses_amp_when_existing_query() {
        let url = build_url_with_query_auth(
            "https://api.example.com/v1?x=1",
            Some("query_param:key"),
            Some("v"),
        )
        .unwrap();
        assert_eq!(url, "https://api.example.com/v1?x=1&key=v");
    }

    #[test]
    fn build_url_without_auth_returns_base() {
        let url =
            build_url_with_query_auth("https://api.example.com", None, Some("ignored")).unwrap();
        assert_eq!(url, "https://api.example.com");
    }

    #[test]
    fn build_url_with_bearer_auth_does_not_modify_url() {
        let url =
            build_url_with_query_auth("https://api.example.com", Some("bearer"), Some("v"))
                .unwrap();
        assert_eq!(url, "https://api.example.com");
    }

    #[test]
    fn urlencoding_escapes_special_chars() {
        assert_eq!(urlencoding("hello world"), "hello%20world");
        assert_eq!(urlencoding("a&b=c"), "a%26b%3Dc");
        assert_eq!(urlencoding("safe-_.~"), "safe-_.~");
    }
}
