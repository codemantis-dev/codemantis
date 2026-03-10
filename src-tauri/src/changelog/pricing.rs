/// Per-million-token pricing (input, output) in USD
pub fn get_pricing(model: &str) -> (f64, f64) {
    match model {
        "gpt-4.1" => (2.0, 8.0),
        "gpt-5-nano" => (0.5, 2.0),
        "gpt-5-mini" => (1.0, 4.0),
        "gemini-2.5-flash-lite" => (0.0, 0.0),
        "gemini-2.5-flash" => (0.15, 0.60),
        "claude-sonnet-4-6" => (3.0, 15.0),
        "claude-haiku-4-5" | "claude-haiku-4-5-20251001" => (0.80, 4.0),
        _ => (0.0, 0.0),
    }
}

pub fn calculate_cost(model: &str, input_tokens: u32, output_tokens: u32) -> f64 {
    let (input_price, output_price) = get_pricing(model);
    (input_tokens as f64 / 1_000_000.0 * input_price)
        + (output_tokens as f64 / 1_000_000.0 * output_price)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_free_tier() {
        assert_eq!(calculate_cost("gemini-2.5-flash-lite", 1000, 1000), 0.0);
    }

    #[test]
    fn test_known_model() {
        let cost = calculate_cost("gpt-4.1", 1_000_000, 1_000_000);
        assert!((cost - 10.0).abs() < 0.001); // 2.0 + 8.0
    }

    #[test]
    fn test_unknown_model() {
        assert_eq!(calculate_cost("unknown-model", 1000, 1000), 0.0);
    }
}
