//! Duo-Coding analyst — the API-LLM observability layer.
//!
//! The analyst is NOT a coding agent. It reads the run's event log + deterministic
//! aggregates and produces a STRICTLY STRUCTURED qualitative report that the
//! dashboard renders. Hard numbers (counts, diff series, cost) are computed in
//! code (see `commands::duo`); the LLM supplies judgment an algorithm can't:
//! momentum, collaboration health, quality trajectory, root-cause patterns,
//! mentor effectiveness, recommendations, and watch items.
//!
//! Stability guarantee: whatever the LLM returns, [`parse_and_sanitize`] coerces
//! it to a fully-populated, bounded, controlled-vocabulary [`DuoAnalystReport`].
//! The dashboard therefore never sees missing fields, unknown enum values,
//! out-of-range scores, or unbounded lists — even on a malformed model reply.

use crate::changelog::summarizer;
use serde::{Deserialize, Serialize};

pub const SCHEMA_VERSION: u32 = 1;

// List/string caps so a runaway model reply can't bloat the dashboard payload.
const MAX_LIST: usize = 6;
const MAX_STR: usize = 600;
const MAX_HEADLINE: usize = 100;

// ── Report schema (the dashboard contract) ───────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct DuoAnalystReport {
    pub schema_version: u32,
    pub headline: String,
    pub narrative: String,
    pub phase_assessment: PhaseAssessment,
    pub collaboration_health: CollaborationHealth,
    pub quality_assessment: QualityAssessment,
    pub repair_analysis: RepairAnalysis,
    pub improvement_analysis: ImprovementAnalysis,
    pub decisions: Vec<DecisionItem>,
    pub recommendations: Vec<Recommendation>,
    pub watch_items: Vec<String>,
    pub confidence: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct PhaseAssessment {
    pub current_focus: String,
    /// accelerating | steady | stalling | blocked | unknown
    pub momentum: String,
    pub momentum_rationale: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct CollaborationHealth {
    pub score: u32, // 0-100
    /// improving | stable | declining | unknown
    pub trend: String,
    pub summary: String,
    pub friction_points: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct QualityAssessment {
    pub score: u32, // 0-100
    /// improving | flat | regressing | unknown
    pub trajectory: String,
    pub strengths: Vec<String>,
    pub risks: Vec<Risk>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Risk {
    /// high | medium | low
    pub severity: String,
    pub description: String,
    pub evidence: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct RepairAnalysis {
    pub summary: String,
    pub root_cause_patterns: Vec<String>,
    /// high | moderate | low | unknown
    pub mentor_effectiveness: String,
    pub mentor_effectiveness_rationale: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ImprovementAnalysis {
    pub summary: String,
    pub delivered: Vec<String>,
    pub prevented_issues: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct DecisionItem {
    pub title: String,
    /// primary | mentor | converged | pending | unknown
    pub outcome: String,
    pub summary: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Recommendation {
    /// high | medium | low
    pub priority: String,
    pub action: String,
    /// primary | mentor | user
    pub audience: String,
}

// ── Controlled vocabularies ───────────────────────────────────────────────────

const MOMENTUM: &[&str] = &["accelerating", "steady", "stalling", "blocked"];
const TREND: &[&str] = &["improving", "stable", "declining"];
const TRAJECTORY: &[&str] = &["improving", "flat", "regressing"];
const SEVERITY: &[&str] = &["high", "medium", "low"];
const EFFECTIVENESS: &[&str] = &["high", "moderate", "low"];
const OUTCOME: &[&str] = &["primary", "mentor", "converged", "pending"];
const PRIORITY: &[&str] = &["high", "medium", "low"];
const AUDIENCE: &[&str] = &["primary", "mentor", "user"];

fn coerce_enum(value: &str, allowed: &[&str], fallback: &str) -> String {
    let v = value.trim().to_lowercase();
    if allowed.contains(&v.as_str()) {
        v
    } else {
        fallback.to_string()
    }
}

fn clamp_str(s: &str, max: usize) -> String {
    let t = s.trim();
    if t.chars().count() <= max {
        t.to_string()
    } else {
        t.chars().take(max).collect::<String>() + "…"
    }
}

fn clamp_list(list: Vec<String>) -> Vec<String> {
    list.into_iter()
        .map(|s| clamp_str(&s, MAX_STR))
        .filter(|s| !s.is_empty())
        .take(MAX_LIST)
        .collect()
}

/// Coerce a (possibly malformed) LLM JSON reply into a fully-valid report.
/// Strips any markdown fences first, then clamps every field. On parse failure,
/// returns a default report carrying the raw text as the narrative so the
/// dashboard still renders *something* truthful.
pub fn parse_and_sanitize(raw: &str) -> DuoAnalystReport {
    let json = extract_json(raw);
    let mut report: DuoAnalystReport = serde_json::from_str(&json).unwrap_or_else(|_| {
        let mut r = DuoAnalystReport {
            confidence: 0,
            ..Default::default()
        };
        r.headline = "Analyst output could not be parsed".to_string();
        r.narrative = clamp_str(raw, MAX_STR);
        r.phase_assessment.momentum = "unknown".to_string();
        r
    });

    report.schema_version = SCHEMA_VERSION;
    report.headline = clamp_str(&report.headline, MAX_HEADLINE);
    report.narrative = clamp_str(&report.narrative, MAX_STR);
    report.confidence = report.confidence.min(100);

    report.phase_assessment.current_focus = clamp_str(&report.phase_assessment.current_focus, MAX_STR);
    report.phase_assessment.momentum = coerce_enum(&report.phase_assessment.momentum, MOMENTUM, "unknown");
    report.phase_assessment.momentum_rationale = clamp_str(&report.phase_assessment.momentum_rationale, MAX_STR);

    report.collaboration_health.score = report.collaboration_health.score.min(100);
    report.collaboration_health.trend = coerce_enum(&report.collaboration_health.trend, TREND, "unknown");
    report.collaboration_health.summary = clamp_str(&report.collaboration_health.summary, MAX_STR);
    report.collaboration_health.friction_points = clamp_list(report.collaboration_health.friction_points);

    report.quality_assessment.score = report.quality_assessment.score.min(100);
    report.quality_assessment.trajectory = coerce_enum(&report.quality_assessment.trajectory, TRAJECTORY, "unknown");
    report.quality_assessment.strengths = clamp_list(report.quality_assessment.strengths);
    report.quality_assessment.risks = report
        .quality_assessment
        .risks
        .into_iter()
        .map(|r| Risk {
            severity: coerce_enum(&r.severity, SEVERITY, "low"),
            description: clamp_str(&r.description, MAX_STR),
            evidence: clamp_str(&r.evidence, MAX_STR),
        })
        .filter(|r| !r.description.is_empty())
        .take(MAX_LIST)
        .collect();

    report.repair_analysis.summary = clamp_str(&report.repair_analysis.summary, MAX_STR);
    report.repair_analysis.root_cause_patterns = clamp_list(report.repair_analysis.root_cause_patterns);
    report.repair_analysis.mentor_effectiveness =
        coerce_enum(&report.repair_analysis.mentor_effectiveness, EFFECTIVENESS, "unknown");
    report.repair_analysis.mentor_effectiveness_rationale =
        clamp_str(&report.repair_analysis.mentor_effectiveness_rationale, MAX_STR);

    report.improvement_analysis.summary = clamp_str(&report.improvement_analysis.summary, MAX_STR);
    report.improvement_analysis.delivered = clamp_list(report.improvement_analysis.delivered);
    report.improvement_analysis.prevented_issues = clamp_list(report.improvement_analysis.prevented_issues);

    report.decisions = report
        .decisions
        .into_iter()
        .map(|d| DecisionItem {
            title: clamp_str(&d.title, MAX_STR),
            outcome: coerce_enum(&d.outcome, OUTCOME, "unknown"),
            summary: clamp_str(&d.summary, MAX_STR),
        })
        .filter(|d| !d.title.is_empty())
        .take(MAX_LIST)
        .collect();

    report.recommendations = report
        .recommendations
        .into_iter()
        .map(|r| Recommendation {
            priority: coerce_enum(&r.priority, PRIORITY, "medium"),
            action: clamp_str(&r.action, MAX_STR),
            audience: coerce_enum(&r.audience, AUDIENCE, "user"),
        })
        .filter(|r| !r.action.is_empty())
        .take(MAX_LIST)
        .collect();

    report.watch_items = clamp_list(report.watch_items);

    report
}

/// Strip markdown fences / surrounding prose and return the outermost JSON object.
fn extract_json(raw: &str) -> String {
    let trimmed = raw.trim();
    let body = if let Some(stripped) = trimmed.strip_prefix("```") {
        // ```json\n...\n``` — drop the opening fence line and trailing fence.
        let after = stripped.split_once('\n').map(|x| x.1).unwrap_or("");
        after.trim_end().trim_end_matches("```").trim()
    } else {
        trimmed
    };
    match (body.find('{'), body.rfind('}')) {
        (Some(start), Some(end)) if end > start => body[start..=end].to_string(),
        _ => body.to_string(),
    }
}

// ── The system prompt — the dashboard's stability contract ───────────────────

pub const ANALYST_SYSTEM_PROMPT: &str = r#"# Role

You are the ANALYST for a "Duo-Coding" session inside an AI coding IDE. You are an independent, read-only observability analyst — NOT a coding agent. You never write, run, or review code. Your sole job is to turn a structured event log of a two-agent collaboration into a precise, evidence-based assessment that powers a live monitoring dashboard.

# The collaboration you are analyzing

Two AI coding agents work one task together:
- PRIMARY: the sole writer. It edits files and runs the build/tests. It does the actual implementation.
- MENTOR (the "Duo"): a read-only reviewer. After each primary turn it independently inspects the changes, runs the build/tests itself, and issues a verdict. On a blocking problem it does NOT edit code — it directs the primary to fix it, and a bounded back-and-forth dialogue may follow. Unresolved disagreements hit a tie-break (pause for human / mentor wins / primary wins).

The goal of the pairing: get more done, with fewer errors, faster — code that actually works and does what the user asked.

# Event vocabulary (what the log entries mean)

- turn: the primary completed a turn (may carry diff stats: lines added/removed, files).
- verdict: the mentor's structured judgment of a turn.
- agreement: the mentor accepted the primary's work (convergence).
- disagreement: the mentor raised a BLOCKING objection.
- concern: a non-blocking (advisory/nit) observation, logged but not acted on.
- dialogue: a back-and-forth exchange turn between the two agents.
- repair: the mentor directed the primary to fix something.
- drift: the mentor's mid-turn watcher flagged the primary going off-track (e.g. destructive command, deleting tests).
- escalation: non-convergence reached the tie-break.
- decision: a control event (run start, tie-break outcome, etc.).

# How to think

- Be EVIDENCE-BASED. Ground every claim in the events you were given. Distinguish what is OBSERVED from what is INFERRED, and prefer observed.
- Do NOT compute or restate raw counts/totals — the dashboard already has the exact numbers. Your value is JUDGMENT: momentum, health, quality trajectory, recurring root causes, mentor effectiveness, what to do next, and what to watch.
- CALIBRATE confidence to the evidence volume. Early in a run with few events, scores should be tentative and `confidence` low. Never fabricate a trend from a single data point.
- Be neutral and specific. No praise, no blame, no filler. Information-dense.
- When evidence is insufficient for a categorical field, use the literal value "unknown" (for enums that allow it) and say so plainly.
- Scores are 0–100. Anchors: 0–39 = poor/at-risk, 40–69 = mixed/acceptable, 70–100 = strong. A brand-new run with no reviews yet is "unknown"/low-confidence, not a high score.

# Output format — STRICT

Return ONE JSON object and NOTHING else. No markdown, no code fences, no commentary before or after. It MUST match this exact shape and use ONLY the allowed enum values. Always include EVERY field; for unknowns use an empty array, an empty string, "unknown" (where allowed), or a conservative score with low confidence — never omit a field. Keep every string under ~80 words. Lists hold at most 6 items.

{
  "schemaVersion": 1,
  "headline": "string — one line, <=100 chars, the single most important status",
  "narrative": "string — 2-4 plain-prose sentences telling the progress story",
  "phaseAssessment": {
    "currentFocus": "string — what the pair is working on right now",
    "momentum": "accelerating | steady | stalling | blocked",
    "momentumRationale": "string"
  },
  "collaborationHealth": {
    "score": 0,
    "trend": "improving | stable | declining",
    "summary": "string",
    "frictionPoints": ["string"]
  },
  "qualityAssessment": {
    "score": 0,
    "trajectory": "improving | flat | regressing",
    "strengths": ["string"],
    "risks": [ { "severity": "high | medium | low", "description": "string", "evidence": "string" } ]
  },
  "repairAnalysis": {
    "summary": "string",
    "rootCausePatterns": ["string — recurring causes behind the disagreements"],
    "mentorEffectiveness": "high | moderate | low",
    "mentorEffectivenessRationale": "string"
  },
  "improvementAnalysis": {
    "summary": "string",
    "delivered": ["string — concrete improvements the mentor caused"],
    "preventedIssues": ["string — problems the mentor stopped before they shipped"]
  },
  "decisions": [ { "title": "string", "outcome": "primary | mentor | converged | pending", "summary": "string" } ],
  "recommendations": [ { "priority": "high | medium | low", "action": "string", "audience": "primary | mentor | user" } ],
  "watchItems": ["string — early-warning signs to monitor next"],
  "confidence": 0
}

Enum values must be EXACTLY as listed (lowercase). `momentum` may also be "unknown"; `trend` may be "unknown"; `trajectory` may be "unknown"; `mentorEffectiveness` may be "unknown"; decision `outcome` may be "unknown". `confidence` and all `score` fields are integers 0–100. Output the JSON object only."#;

// ── Context the command assembles, and the user prompt ────────────────────────

#[derive(Debug, Clone, Default)]
pub struct AnalystContext {
    pub task: String,
    pub primary_label: String,
    pub duo_label: String,
    pub tie_break_policy: String,
    /// Deterministic counts the dashboard already shows — given so the analyst
    /// reasons about them but never recomputes them.
    pub aggregates_json: String,
    /// Compact, chronological "<kind>/<actor>: <summary>" lines (already capped).
    pub event_timeline: String,
}

pub fn build_user_prompt(ctx: &AnalystContext) -> String {
    format!(
        r#"Analyze this Duo-Coding run and return the JSON report.

TASK THE PAIR IS WORKING ON:
{task}

PRIMARY agent: {primary}
MENTOR agent: {duo}
Tie-break policy: {tie}

DETERMINISTIC AGGREGATES (already correct — do not recompute, reason about them):
{aggregates}

EVENT TIMELINE (chronological):
{timeline}

Produce the structured JSON report now."#,
        task = ctx.task,
        primary = ctx.primary_label,
        duo = ctx.duo_label,
        tie = ctx.tie_break_policy,
        aggregates = ctx.aggregates_json,
        timeline = ctx.event_timeline,
    )
}

/// Call the analyst LLM and return the sanitized report plus token counts (for
/// `insert_api_log`). Reuses the shared provider dispatch in `summarizer`.
pub async fn analyze(
    provider: &str,
    api_key: &str,
    model: &str,
    ctx: &AnalystContext,
) -> Result<(DuoAnalystReport, u32, u32), String> {
    let user_prompt = build_user_prompt(ctx);
    let (text, input_tokens, output_tokens) = summarizer::call_provider(
        provider,
        api_key,
        model,
        ANALYST_SYSTEM_PROMPT,
        &user_prompt,
        "off", // fast structured output; no extended thinking needed
    )
    .await?;
    Ok((parse_and_sanitize(&text), input_tokens, output_tokens))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn full_json() -> &'static str {
        r#"{
          "schemaVersion": 1,
          "headline": "Pair is making steady progress with minor rework",
          "narrative": "The primary implemented the feature; the mentor caught a missing test and it was added within one round.",
          "phaseAssessment": { "currentFocus": "logout flow", "momentum": "steady", "momentumRationale": "one clean round" },
          "collaborationHealth": { "score": 78, "trend": "improving", "summary": "low friction", "frictionPoints": [] },
          "qualityAssessment": { "score": 72, "trajectory": "improving", "strengths": ["tests added"], "risks": [ { "severity": "medium", "description": "no e2e", "evidence": "no e2e events" } ] },
          "repairAnalysis": { "summary": "one repair", "rootCausePatterns": ["missing tests"], "mentorEffectiveness": "high", "mentorEffectivenessRationale": "fix landed fast" },
          "improvementAnalysis": { "summary": "coverage up", "delivered": ["unit test"], "preventedIssues": ["shipping untested code"] },
          "decisions": [ { "title": "Add test", "outcome": "converged", "summary": "agreed to add a unit test" } ],
          "recommendations": [ { "priority": "medium", "action": "add an e2e test", "audience": "primary" } ],
          "watchItems": ["repeated test gaps"],
          "confidence": 65
        }"#
    }

    #[test]
    fn parses_a_well_formed_report() {
        let r = parse_and_sanitize(full_json());
        assert_eq!(r.schema_version, 1);
        assert_eq!(r.collaboration_health.score, 78);
        assert_eq!(r.phase_assessment.momentum, "steady");
        assert_eq!(r.recommendations.len(), 1);
        assert_eq!(r.quality_assessment.risks[0].severity, "medium");
    }

    #[test]
    fn strips_markdown_fences() {
        let fenced = format!("```json\n{}\n```", full_json());
        let r = parse_and_sanitize(&fenced);
        assert_eq!(r.headline, "Pair is making steady progress with minor rework");
    }

    #[test]
    fn coerces_unknown_enums_to_safe_fallbacks() {
        let json = r#"{ "phaseAssessment": { "momentum": "VIBING" }, "collaborationHealth": { "trend": "sideways" }, "recommendations": [ { "priority": "urgent", "action": "do x", "audience": "everyone" } ] }"#;
        let r = parse_and_sanitize(json);
        assert_eq!(r.phase_assessment.momentum, "unknown");
        assert_eq!(r.collaboration_health.trend, "unknown");
        assert_eq!(r.recommendations[0].priority, "medium");
        assert_eq!(r.recommendations[0].audience, "user");
    }

    #[test]
    fn clamps_scores_and_list_lengths() {
        let big_list: Vec<String> = (0..20).map(|i| format!("item {i}")).collect();
        let json = serde_json::json!({
            "collaborationHealth": { "score": 250 },
            "confidence": 999,
            "watchItems": big_list,
        })
        .to_string();
        let r = parse_and_sanitize(&json);
        assert_eq!(r.collaboration_health.score, 100);
        assert_eq!(r.confidence, 100);
        assert_eq!(r.watch_items.len(), MAX_LIST);
    }

    #[test]
    fn malformed_json_degrades_to_a_valid_default_report() {
        let r = parse_and_sanitize("the model rambled and produced no json");
        assert_eq!(r.schema_version, 1);
        assert_eq!(r.confidence, 0);
        assert!(r.headline.contains("could not be parsed"));
        // Still schema-valid: enums are safe defaults.
        assert_eq!(r.phase_assessment.momentum, "unknown");
    }

    #[test]
    fn always_emits_every_top_level_field_as_valid_json() {
        let r = parse_and_sanitize("{}");
        let serialized = serde_json::to_value(&r).unwrap();
        for key in [
            "schemaVersion", "headline", "narrative", "phaseAssessment",
            "collaborationHealth", "qualityAssessment", "repairAnalysis",
            "improvementAnalysis", "decisions", "recommendations", "watchItems", "confidence",
        ] {
            assert!(serialized.get(key).is_some(), "missing field {key}");
        }
    }

    #[test]
    fn build_user_prompt_includes_context() {
        let ctx = AnalystContext {
            task: "Add logout".into(),
            primary_label: "codex/gpt-5.5".into(),
            duo_label: "claude/opus".into(),
            tie_break_policy: "pause".into(),
            aggregates_json: "{\"reviews\":3}".into(),
            event_timeline: "turn/primary: did work".into(),
        };
        let p = build_user_prompt(&ctx);
        assert!(p.contains("Add logout"));
        assert!(p.contains("codex/gpt-5.5"));
        assert!(p.contains("\"reviews\":3"));
        assert!(p.contains("turn/primary"));
    }
}
