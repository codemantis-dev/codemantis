use log::info;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

// ── Types ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectAnalysis {
    pub name: String,
    pub description: Option<String>,
    pub framework: Option<String>,
    pub framework_version: Option<String>,
    pub language: String,
    pub router_type: Option<String>,
    pub css_framework: Option<String>,
    pub database: Option<String>,
    pub orm: Option<String>,
    pub auth: Option<String>,
    pub test_framework: Option<String>,
    pub state_management: Option<String>,
    pub deployment: Option<String>,
    pub scripts: Vec<(String, String)>,
    pub env_vars: Vec<String>,
    pub directory_tree: String,
    pub key_directories: Vec<(String, String)>,
    pub conventions: Vec<String>,
    pub architecture_notes: Vec<String>,
    pub has_monorepo: bool,
    pub package_manager: Option<String>,
    pub ui_library: Option<String>,
    pub key_files: Vec<(String, String)>,
}

// ── Helpers ──

/// Read a JSON file and return parsed value
fn read_json(path: &Path) -> Option<serde_json::Value> {
    let content = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&content).ok()
}

/// Extract first paragraph from README.md (skip badges, blank lines, headers)
fn extract_readme_description(project_path: &Path) -> Option<String> {
    let readme_path = project_path.join("README.md");
    let content = std::fs::read_to_string(&readme_path).ok()?;

    let mut paragraph_lines: Vec<&str> = vec![];
    let mut found_content = false;

    for line in content.lines().take(50) {
        let trimmed = line.trim();

        // Skip badges, images, blank lines before content
        if !found_content {
            if trimmed.is_empty()
                || trimmed.starts_with("![")
                || trimmed.starts_with("[![")
                || trimmed.starts_with('<')
            {
                continue;
            }
            // Skip the main heading
            if trimmed.starts_with("# ") {
                continue;
            }
            found_content = true;
        }

        if found_content {
            if trimmed.is_empty() && !paragraph_lines.is_empty() {
                break; // End of first paragraph
            }
            if trimmed.starts_with('#') && !paragraph_lines.is_empty() {
                break; // Next heading
            }
            if !trimmed.is_empty()
                && !trimmed.starts_with("![")
                && !trimmed.starts_with("[![")
            {
                paragraph_lines.push(trimmed);
            }
        }
    }

    if paragraph_lines.is_empty() {
        None
    } else {
        Some(paragraph_lines.join(" "))
    }
}

/// Detect package manager from lock files
pub fn detect_package_manager(project_path: &Path) -> Option<String> {
    let checks: &[(&str, &str)] = &[
        ("pnpm-lock.yaml", "pnpm"),
        ("yarn.lock", "yarn"),
        ("bun.lockb", "bun"),
        ("bun.lock", "bun"),
        ("package-lock.json", "npm"),
    ];
    for (file, pm) in checks {
        if project_path.join(file).exists() {
            return Some(pm.to_string());
        }
    }
    // Check for JS project without lock file
    if project_path.join("package.json").exists() {
        return Some("npm".to_string());
    }
    None
}

/// Detect install command from lock files
pub fn detect_install_command(project_path: &Path) -> Option<String> {
    let checks: &[(&str, &str)] = &[
        ("pnpm-lock.yaml", "pnpm install"),
        ("yarn.lock", "yarn install"),
        ("bun.lockb", "bun install"),
        ("bun.lock", "bun install"),
        ("package-lock.json", "npm install"),
        ("Pipfile.lock", "pipenv install"),
        ("Gemfile.lock", "bundle install"),
        ("go.sum", "go mod download"),
        ("Cargo.lock", "cargo build"),
    ];
    for (file, cmd) in checks {
        if project_path.join(file).exists() {
            return Some(cmd.to_string());
        }
    }

    // pyproject.toml + uv.lock → uv sync
    if project_path.join("pyproject.toml").exists() {
        if project_path.join("uv.lock").exists() {
            return Some("uv sync".to_string());
        }
        return Some("pip install -e .".to_string());
    }

    // package.json without lock file
    if project_path.join("package.json").exists() {
        return Some("npm install".to_string());
    }

    None
}

/// Get a dependency version from package.json
fn pkg_dep_version(pkg: &serde_json::Value, dep_name: &str) -> Option<String> {
    for section in &["dependencies", "devDependencies"] {
        if let Some(ver) = pkg.get(section).and_then(|d| d.get(dep_name)).and_then(|v| v.as_str())
        {
            // Strip leading ^, ~, >=, etc. to get clean version
            let clean = ver.trim_start_matches(|c: char| !c.is_ascii_digit());
            if !clean.is_empty() {
                return Some(clean.to_string());
            }
        }
    }
    None
}

/// Check if a dependency exists in package.json
fn has_dep(pkg: &serde_json::Value, dep_name: &str) -> bool {
    pkg.get("dependencies")
        .and_then(|d| d.get(dep_name))
        .is_some()
        || pkg
            .get("devDependencies")
            .and_then(|d| d.get(dep_name))
            .is_some()
}

/// Infer a description for a script command
fn infer_script_description(name: &str, cmd: &str) -> String {
    let lower_name = name.to_lowercase();
    let lower_cmd = cmd.to_lowercase();

    // ── Compound names with colons (most specific — check first) ──

    if lower_name.starts_with("build:") {
        let variant = name.split(':').nth(1).unwrap_or("");
        return match variant.to_lowercase().as_str() {
            "dev" => "Development build (unminified, source maps)".to_string(),
            "prod" | "production" => "Production build (optimized)".to_string(),
            "watch" => "Build in watch mode".to_string(),
            "analyze" => "Build with bundle analysis".to_string(),
            "css" => "Build CSS".to_string(),
            _ => format!("Build ({})", variant),
        };
    }

    if lower_name.starts_with("test:") {
        let variant = name.split(':').nth(1).unwrap_or("");
        return match variant.to_lowercase().as_str() {
            "unit" => "Run unit tests".to_string(),
            "e2e" | "integration" => "Run end-to-end tests".to_string(),
            "watch" => "Run tests in watch mode".to_string(),
            "coverage" | "cov" => "Run tests with coverage".to_string(),
            "ci" => "Run tests in CI mode".to_string(),
            _ => format!("Run tests ({})", variant),
        };
    }

    if lower_name.starts_with("lint:") {
        let variant = name.split(':').nth(1).unwrap_or("");
        return match variant.to_lowercase().as_str() {
            "fix" => "Run linter with auto-fix".to_string(),
            "css" | "styles" => "Lint stylesheets".to_string(),
            _ => format!("Lint ({})", variant),
        };
    }

    if lower_name.starts_with("dev:") {
        let variant = name.split(':').nth(1).unwrap_or("");
        return format!("Start dev server ({})", variant);
    }

    if lower_name.starts_with("generate:") || lower_name.starts_with("gen:") {
        let variant = name.split(':').next_back().unwrap_or("");
        return format!("Generate {}", variant);
    }

    if lower_name.starts_with("docker:") {
        let variant = name.split(':').nth(1).unwrap_or("");
        return format!("Docker: {}", variant);
    }

    // ── Simple names ──

    if lower_name == "dev" || lower_name == "start:dev" {
        return "Start development server".to_string();
    }
    if lower_name == "build" {
        return "Build for production".to_string();
    }
    if lower_name == "start" || lower_name == "serve" {
        return "Start the application".to_string();
    }
    if lower_name == "test" {
        return "Run tests".to_string();
    }
    if lower_name == "lint" {
        return "Run linter".to_string();
    }
    if lower_name == "format" || lower_name == "prettier" {
        return "Format code".to_string();
    }
    if lower_name == "typecheck" || lower_name == "type-check" || lower_name == "tsc" {
        return "Type check".to_string();
    }
    if lower_name.contains("migrate") {
        return "Run database migrations".to_string();
    }
    if lower_name.contains("seed") {
        return "Seed the database".to_string();
    }
    if lower_name.contains("storybook") {
        return "Start Storybook".to_string();
    }
    if lower_name == "clean" {
        return "Clean build artifacts".to_string();
    }
    if lower_name == "preview" {
        return "Preview production build".to_string();
    }
    if lower_name.starts_with("db:") {
        return format!("Database: {}", lower_name.trim_start_matches("db:"));
    }
    if lower_name == "generate" || lower_name == "codegen" {
        return "Run code generation".to_string();
    }
    if lower_name == "deploy" {
        return "Deploy the application".to_string();
    }

    // ── Infer from command content ──

    // Multi-command runners checked first (contain other tool names as args)
    if lower_cmd.contains("concurrently") || lower_cmd.contains("&&") {
        return "Run multiple tasks".to_string();
    }
    if lower_cmd.contains("vitest") || lower_cmd.contains("jest") {
        return "Run tests".to_string();
    }
    if lower_cmd.contains("eslint") {
        return "Run ESLint".to_string();
    }
    if lower_cmd.contains("prettier") {
        return "Format with Prettier".to_string();
    }
    if lower_cmd.contains("tsc") {
        return "TypeScript type check".to_string();
    }
    if lower_cmd.starts_with("vite build") {
        return "Vite build".to_string();
    }
    if lower_cmd.starts_with("vite") {
        return "Start Vite dev server".to_string();
    }
    if lower_cmd.starts_with("next ") {
        let next_cmd = cmd.split_whitespace().nth(1).unwrap_or("");
        return format!("Next.js: {}", next_cmd);
    }
    if lower_cmd.starts_with("node ") || lower_cmd.starts_with("tsx ") {
        return "Run script".to_string();
    }

    // Truncate long commands
    let display_cmd = if cmd.len() > 60 {
        format!("{}...", &cmd[..57])
    } else {
        cmd.to_string()
    };
    format!("`{}`", display_cmd)
}

/// Count entries in a directory (non-recursive)
fn count_dir_entries(path: &Path) -> usize {
    std::fs::read_dir(path)
        .map(|entries| entries.filter_map(|e| e.ok()).count())
        .unwrap_or(0)
}

/// List top-level items in a directory (files without extension, dirs with count)
/// Returns "ComponentA, ComponentB, ui/ (14 items)" style description
fn describe_directory_contents(path: &Path, max_items: usize) -> String {
    let mut items: Vec<String> = vec![];
    let entries = match std::fs::read_dir(path) {
        Ok(e) => e,
        Err(_) => return String::new(),
    };

    let mut sorted: Vec<_> = entries.filter_map(|e| e.ok()).collect();
    sorted.sort_by_key(|e| e.file_name());

    for entry in &sorted {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        if is_dir {
            let count = count_dir_entries(&entry.path());
            items.push(format!("{} ({} items)", name, count));
        } else {
            // Strip common extensions for display
            let display = name
                .strip_suffix(".tsx")
                .or_else(|| name.strip_suffix(".ts"))
                .or_else(|| name.strip_suffix(".jsx"))
                .or_else(|| name.strip_suffix(".js"))
                .or_else(|| name.strip_suffix(".vue"))
                .or_else(|| name.strip_suffix(".svelte"))
                .unwrap_or(&name);
            items.push(display.to_string());
        }
    }

    let total = items.len();
    if total == 0 {
        String::new()
    } else if total <= max_items {
        items.join(", ")
    } else {
        let shown: Vec<_> = items[..max_items].to_vec();
        format!("{}, and {} more", shown.join(", "), total - max_items)
    }
}

/// Detect important individual files and infer their purpose
fn detect_key_files(project_path: &Path) -> Vec<(String, String)> {
    let mut files: Vec<(String, String)> = vec![];

    let candidates: &[(&str, &str)] = &[
        ("src/lib/ai-providers.ts", "AI provider configuration"),
        ("src/lib/ai-provider.ts", "AI provider configuration"),
        ("src/config/ai.ts", "AI configuration"),
        ("src/lib/api.ts", "API client"),
        ("src/lib/api-client.ts", "API client"),
        ("src/lib/auth.ts", "Authentication utilities"),
        ("src/lib/db.ts", "Database client"),
        ("src/lib/prisma.ts", "Prisma client instance"),
        ("src/lib/drizzle.ts", "Drizzle client instance"),
        ("src/lib/supabase.ts", "Supabase client"),
        ("src/lib/firebase.ts", "Firebase configuration"),
        ("src/lib/stripe.ts", "Stripe integration"),
        ("src/lib/utils.ts", "Shared utility functions"),
        ("src/lib/constants.ts", "Application constants"),
        ("src/lib/schema.ts", "Validation schemas"),
        ("src/lib/validators.ts", "Input validators"),
        ("src/lib/i18n.ts", "Internationalization setup"),
        ("src/middleware.ts", "Next.js middleware"),
        ("src/instrumentation.ts", "Instrumentation/monitoring setup"),
        ("src/env.ts", "Environment variable validation"),
        ("src/env.mjs", "Environment variable validation"),
    ];

    for (path_str, desc) in candidates {
        if project_path.join(path_str).exists() {
            files.push((path_str.to_string(), desc.to_string()));
        }
    }

    // Also scan src/lib/ for files with distinctive names
    let lib_dir = project_path.join("src/lib");
    if lib_dir.is_dir() {
        if let Ok(entries) = std::fs::read_dir(&lib_dir) {
            for entry in entries.filter_map(|e| e.ok()) {
                let name = entry.file_name().to_string_lossy().to_string();
                let path_str = format!("src/lib/{}", name);

                // Skip if already detected above
                if files.iter().any(|(p, _)| p == &path_str) {
                    continue;
                }

                // Infer purpose from filename patterns
                let lower = name.to_lowercase();
                let desc = if lower.contains("schema") || lower.contains("detect") {
                    Some("Schema/format detection")
                } else if lower.contains("provider") {
                    Some("Service provider configuration")
                } else if lower.contains("client") {
                    Some("API/service client")
                } else if lower.contains("config") {
                    Some("Configuration")
                } else if lower.contains("hook") {
                    Some("Custom hook utilities")
                } else if lower.contains("store") {
                    Some("State management")
                } else if lower.contains("middleware") {
                    Some("Middleware")
                } else if lower.contains("context") {
                    Some("React context provider")
                } else {
                    None
                };

                if let Some(d) = desc {
                    files.push((path_str, d.to_string()));
                }
            }
        }
    }

    files
}

/// Directories to skip when scanning
const SKIP_DIRS: &[&str] = &[
    "node_modules",
    ".git",
    "dist",
    "build",
    ".next",
    ".nuxt",
    ".svelte-kit",
    "target",
    ".venv",
    "venv",
    "__pycache__",
    ".cache",
    ".turbo",
    ".vercel",
    ".output",
    "coverage",
    ".parcel-cache",
    ".expo",
    "vendor",
];

/// Build a directory tree string (max depth levels)
fn build_directory_tree(project_path: &Path, max_depth: usize) -> String {
    let mut lines: Vec<String> = vec![];
    build_tree_recursive(project_path, "", max_depth, 0, &mut lines);
    lines.join("\n")
}

fn build_tree_recursive(
    dir: &Path,
    prefix: &str,
    max_depth: usize,
    current_depth: usize,
    lines: &mut Vec<String>,
) {
    if current_depth >= max_depth {
        return;
    }

    let mut entries: Vec<_> = match std::fs::read_dir(dir) {
        Ok(rd) => rd.filter_map(|e| e.ok()).collect(),
        Err(_) => return,
    };

    // Sort: directories first, then alphabetically
    entries.sort_by(|a, b| {
        let a_is_dir = a.file_type().map(|t| t.is_dir()).unwrap_or(false);
        let b_is_dir = b.file_type().map(|t| t.is_dir()).unwrap_or(false);
        match (a_is_dir, b_is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.file_name().cmp(&b.file_name()),
        }
    });

    // Filter out hidden and skip dirs
    let entries: Vec<_> = entries
        .into_iter()
        .filter(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            !name.starts_with('.')
                && !SKIP_DIRS.contains(&name.as_str())
        })
        .collect();

    let total = entries.len();
    for (i, entry) in entries.iter().enumerate() {
        let is_last = i == total - 1;
        let connector = if is_last { "└── " } else { "├── " };
        let name = entry.file_name().to_string_lossy().to_string();
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);

        if is_dir {
            let count = count_dir_entries(&entry.path());
            if count > 10 && current_depth >= 1 {
                lines.push(format!("{}{}{}/ ({} items)", prefix, connector, name, count));
            } else {
                lines.push(format!("{}{}{}/", prefix, connector, name));
                let next_prefix = if is_last {
                    format!("{}    ", prefix)
                } else {
                    format!("{}│   ", prefix)
                };
                build_tree_recursive(
                    &entry.path(),
                    &next_prefix,
                    max_depth,
                    current_depth + 1,
                    lines,
                );
            }
        } else {
            lines.push(format!("{}{}{}", prefix, connector, name));
        }
    }
}

/// Detect key directories and their purposes
fn detect_key_directories(project_path: &Path) -> Vec<(String, String)> {
    let mut dirs: Vec<(String, String)> = vec![];

    let candidates: &[(&str, &str)] = &[
        ("src/app", "Next.js App Router pages and layouts"),
        ("src/pages", "Page components (file-based routing)"),
        ("src/routes", "Route definitions (file-based routing)"),
        ("app", "Application routes or entry point"),
        ("pages", "Page components"),
        ("src/components", "React components"),
        ("src/hooks", "Custom React hooks"),
        ("src/stores", "State management stores"),
        ("src/store", "State management store"),
        ("src/lib", "Shared utilities and helpers"),
        ("src/utils", "Utility functions"),
        ("src/types", "TypeScript type definitions"),
        ("src/services", "Service layer / API clients"),
        ("src/api", "API route handlers"),
        ("prisma", "Prisma ORM schema and migrations"),
        ("drizzle", "Drizzle ORM configuration"),
        ("migrations", "Database migrations"),
        ("supabase", "Supabase configuration and functions"),
        ("tests", "Test files"),
        ("__tests__", "Test files"),
        ("test", "Test files"),
        ("e2e", "End-to-end tests"),
        (".github/workflows", "CI/CD workflows"),
        ("docker", "Docker configuration"),
        ("scripts", "Build and utility scripts"),
        ("public", "Static assets"),
        ("assets", "Project assets"),
        ("src/styles", "Stylesheets"),
        ("src/config", "Configuration files"),
        ("src/middleware", "Middleware handlers"),
        ("src/models", "Data models"),
        ("src/controllers", "Request controllers"),
    ];

    // Directories that get detailed content listing instead of just counts
    let detail_dirs: &[&str] = &[
        "src/components", "src/hooks", "src/stores", "src/store",
        "src/lib", "src/utils", "src/services", "src/pages", "src/routes",
        "src/types", "src/api", "src/middleware", "src/models",
    ];

    for (path_str, desc) in candidates {
        let full_path = project_path.join(path_str);
        if full_path.is_dir() {
            let description = if detail_dirs.contains(path_str) {
                let contents = describe_directory_contents(&full_path, 8);
                if contents.is_empty() {
                    desc.to_string()
                } else {
                    format!("{}: {}", desc, contents)
                }
            } else {
                let count = count_dir_entries(&full_path);
                if count > 0 {
                    format!("{} ({} items)", desc, count)
                } else {
                    desc.to_string()
                }
            };
            dirs.push((path_str.to_string(), description));
        }
    }

    dirs
}

/// Parse tsconfig.json for conventions
fn detect_tsconfig_conventions(project_path: &Path) -> Vec<String> {
    let mut conventions = vec![];
    let tsconfig_path = project_path.join("tsconfig.json");
    let content = match std::fs::read_to_string(&tsconfig_path) {
        Ok(c) => c,
        Err(_) => return conventions,
    };

    // tsconfig often has comments — strip them before parsing
    let stripped = strip_json_comments(&content);
    let tsconfig: serde_json::Value = match serde_json::from_str(&stripped) {
        Ok(v) => v,
        Err(_) => return conventions,
    };

    if let Some(compiler) = tsconfig.get("compilerOptions") {
        let strict = compiler
            .get("strict")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        conventions.push(format!(
            "TypeScript: strict mode {}",
            if strict { "enabled" } else { "disabled" }
        ));

        if let Some(paths) = compiler.get("paths").and_then(|v| v.as_object()) {
            let aliases: Vec<String> = paths
                .iter()
                .map(|(k, v)| {
                    let target = v
                        .as_array()
                        .and_then(|a| a.first())
                        .and_then(|s| s.as_str())
                        .unwrap_or("?");
                    format!("`{}` → `{}`", k, target)
                })
                .collect();
            if !aliases.is_empty() {
                conventions.push(format!("Import aliases: {}", aliases.join(", ")));
            }
        }

        if let Some(target) = compiler.get("target").and_then(|v| v.as_str()) {
            conventions.push(format!("TypeScript target: {}", target));
        }
    }

    conventions
}

/// Strip // and /* */ comments from JSON (for tsconfig, etc.)
fn strip_json_comments(input: &str) -> String {
    let mut result = String::with_capacity(input.len());
    let chars: Vec<char> = input.chars().collect();
    let len = chars.len();
    let mut i = 0;
    let mut in_string = false;

    while i < len {
        if in_string {
            result.push(chars[i]);
            if chars[i] == '\\' && i + 1 < len {
                i += 1;
                result.push(chars[i]);
            } else if chars[i] == '"' {
                in_string = false;
            }
            i += 1;
            continue;
        }

        if chars[i] == '"' {
            in_string = true;
            result.push(chars[i]);
            i += 1;
            continue;
        }

        if chars[i] == '/' && i + 1 < len {
            if chars[i + 1] == '/' {
                // Line comment — skip to end of line
                while i < len && chars[i] != '\n' {
                    i += 1;
                }
                continue;
            } else if chars[i + 1] == '*' {
                // Block comment — skip to */
                i += 2;
                while i + 1 < len && !(chars[i] == '*' && chars[i + 1] == '/') {
                    i += 1;
                }
                i += 2; // skip */
                continue;
            }
        }

        result.push(chars[i]);
        i += 1;
    }

    result
}

/// Detect ESLint conventions
fn detect_eslint_conventions(project_path: &Path) -> Vec<String> {
    let candidates = [
        "eslint.config.js",
        "eslint.config.mjs",
        "eslint.config.cjs",
        ".eslintrc.json",
        ".eslintrc.js",
        ".eslintrc.cjs",
        ".eslintrc.yml",
        ".eslintrc.yaml",
        ".eslintrc",
    ];

    for candidate in &candidates {
        if project_path.join(candidate).exists() {
            return vec![format!("Linting: ESLint (config: {})", candidate)];
        }
    }
    vec![]
}

/// Detect Prettier conventions
fn detect_prettier_conventions(project_path: &Path) -> Vec<String> {
    let candidates = [
        ".prettierrc",
        ".prettierrc.json",
        ".prettierrc.js",
        ".prettierrc.cjs",
        ".prettierrc.mjs",
        ".prettierrc.yml",
        ".prettierrc.yaml",
        "prettier.config.js",
        "prettier.config.cjs",
        "prettier.config.mjs",
    ];

    for candidate in &candidates {
        if project_path.join(candidate).exists() {
            return vec!["Formatting: Prettier".to_string()];
        }
    }
    vec![]
}

/// Detect commit conventions
fn detect_commit_conventions(project_path: &Path) -> Vec<String> {
    let mut conventions = vec![];

    if project_path.join(".husky").is_dir() {
        conventions.push("Git hooks: Husky".to_string());
    }
    if project_path.join(".commitlintrc.json").exists()
        || project_path.join("commitlint.config.js").exists()
        || project_path.join("commitlint.config.cjs").exists()
        || project_path.join("commitlint.config.mjs").exists()
    {
        conventions.push("Commits: Conventional Commits (Commitlint)".to_string());
    }

    conventions
}

/// Read .env.example for variable names
fn read_env_example(project_path: &Path) -> Vec<String> {
    let candidates = [".env.example", ".env.sample", ".env.template"];
    for candidate in &candidates {
        let path = project_path.join(candidate);
        if let Ok(content) = std::fs::read_to_string(&path) {
            return content
                .lines()
                .filter_map(|line| {
                    let trimmed = line.trim();
                    if trimmed.is_empty() || trimmed.starts_with('#') {
                        return None;
                    }
                    // Extract variable name (before =)
                    trimmed.split('=').next().map(|name| name.trim().to_string())
                })
                .filter(|name| !name.is_empty())
                .collect();
        }
    }
    vec![]
}

/// Read all REAL `.env*` files (excluding `.env.example`/`.sample`/`.template`)
/// and collect variable NAMES only — never values. Used by SpecWriter's
/// Phase 0 probe to detect which credentials are actually present in the
/// project (not just declared as placeholders in `.env.example`).
///
/// Returns a map keyed by env-var name → list of relative filenames where
/// the name was seen, so the probe can distinguish "placeholder in
/// .env.example" from "real value in .env.local".
pub fn read_env_keys_real_sources(
    project_path: &Path,
) -> std::collections::BTreeMap<String, Vec<String>> {
    let candidates = [
        ".env",
        ".env.local",
        ".env.development",
        ".env.development.local",
        ".env.production",
        ".env.production.local",
        ".env.test",
        ".env.test.local",
    ];
    let mut out: std::collections::BTreeMap<String, Vec<String>> =
        std::collections::BTreeMap::new();
    for candidate in &candidates {
        let path = project_path.join(candidate);
        let Ok(content) = std::fs::read_to_string(&path) else {
            continue;
        };
        for line in content.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with('#') {
                continue;
            }
            let Some(name) = trimmed.split('=').next() else {
                continue;
            };
            let name = name.trim().to_string();
            if name.is_empty() {
                continue;
            }
            out.entry(name).or_default().push((*candidate).to_string());
        }
    }
    out
}

/// Infer purpose from environment variable name
fn infer_env_var_purpose(name: &str) -> String {
    let upper = name.to_uppercase();
    if upper.contains("DATABASE_URL") || upper.contains("DB_URL") {
        return "Database connection string".to_string();
    }
    if upper.contains("DATABASE") || upper.contains("DB_") {
        return "Database configuration".to_string();
    }
    if upper.contains("SECRET") || upper.contains("JWT") {
        return "Secret key".to_string();
    }
    if upper.contains("API_KEY") || upper.contains("APIKEY") {
        return "API key".to_string();
    }
    if upper.contains("AUTH") || upper.contains("OAUTH") {
        return "Authentication configuration".to_string();
    }
    if upper.contains("REDIS") {
        return "Redis connection".to_string();
    }
    if upper.contains("SMTP") || upper.contains("MAIL") || upper.contains("EMAIL") {
        return "Email/SMTP configuration".to_string();
    }
    if upper.contains("AWS") || upper.contains("S3") {
        return "AWS configuration".to_string();
    }
    if upper.contains("STRIPE") {
        return "Stripe payment configuration".to_string();
    }
    if upper.contains("PORT") {
        return "Server port".to_string();
    }
    if upper.contains("HOST") || upper.contains("HOSTNAME") {
        return "Server hostname".to_string();
    }
    if upper.starts_with("NEXT_PUBLIC") {
        return "Next.js public environment variable".to_string();
    }
    if upper.starts_with("VITE_") {
        return "Vite public environment variable".to_string();
    }
    if upper.contains("URL") || upper.contains("ENDPOINT") {
        return "Service URL".to_string();
    }
    if upper.contains("NODE_ENV") || upper.contains("APP_ENV") {
        return "Environment mode".to_string();
    }
    String::new()
}

// ── Analysis Helper Functions ──

/// Detect JavaScript/TypeScript framework from package.json dependencies.
fn detect_js_framework(
    pkg: &serde_json::Value,
    project_path: &Path,
    analysis: &mut ProjectAnalysis,
) {
    if has_dep(pkg, "next") {
        let ver = pkg_dep_version(pkg, "next").unwrap_or_default();
        analysis.framework = Some("Next.js".to_string());
        if !ver.is_empty() {
            analysis.framework_version = Some(ver);
        }
        if project_path.join("src/app").is_dir() || project_path.join("app").is_dir() {
            analysis.router_type = Some("App Router".to_string());
            analysis
                .architecture_notes
                .push("Next.js App Router with server components".to_string());
        } else if project_path.join("src/pages").is_dir()
            || project_path.join("pages").is_dir()
        {
            analysis.router_type = Some("Pages Router".to_string());
        }
    } else if has_dep(pkg, "astro") {
        let ver = pkg_dep_version(pkg, "astro").unwrap_or_default();
        analysis.framework = Some("Astro".to_string());
        if !ver.is_empty() {
            analysis.framework_version = Some(ver);
        }
    } else if has_dep(pkg, "@sveltejs/kit") || has_dep(pkg, "svelte") {
        let ver = pkg_dep_version(pkg, "@sveltejs/kit")
            .or_else(|| pkg_dep_version(pkg, "svelte"))
            .unwrap_or_default();
        let name = if has_dep(pkg, "@sveltejs/kit") {
            "SvelteKit"
        } else {
            "Svelte"
        };
        analysis.framework = Some(name.to_string());
        if !ver.is_empty() {
            analysis.framework_version = Some(ver);
        }
        if project_path.join("src/routes").is_dir() {
            analysis.router_type = Some("File-based routing".to_string());
        }
    } else if has_dep(pkg, "nuxt") || has_dep(pkg, "nuxt3") {
        let ver = pkg_dep_version(pkg, "nuxt")
            .or_else(|| pkg_dep_version(pkg, "nuxt3"))
            .unwrap_or_default();
        analysis.framework = Some("Nuxt".to_string());
        if !ver.is_empty() {
            analysis.framework_version = Some(ver);
        }
        analysis.language = "Vue/TypeScript".to_string();
    } else if has_dep(pkg, "vue") {
        let ver = pkg_dep_version(pkg, "vue").unwrap_or_default();
        analysis.framework = Some("Vue".to_string());
        if !ver.is_empty() {
            analysis.framework_version = Some(ver);
        }
        analysis.language = "Vue/TypeScript".to_string();
    } else if has_dep(pkg, "react") {
        detect_react_framework(pkg, project_path, analysis);
    } else if has_dep(pkg, "express") {
        let ver = pkg_dep_version(pkg, "express").unwrap_or_default();
        analysis.framework = Some("Express.js".to_string());
        if !ver.is_empty() {
            analysis.framework_version = Some(ver);
        }
    } else if has_dep(pkg, "fastify") {
        let ver = pkg_dep_version(pkg, "fastify").unwrap_or_default();
        analysis.framework = Some("Fastify".to_string());
        if !ver.is_empty() {
            analysis.framework_version = Some(ver);
        }
    } else if has_dep(pkg, "hono") {
        let ver = pkg_dep_version(pkg, "hono").unwrap_or_default();
        analysis.framework = Some("Hono".to_string());
        if !ver.is_empty() {
            analysis.framework_version = Some(ver);
        }
    }
}

/// Detect React meta-framework (Remix, Gatsby, Expo, etc.) or plain React + build tool.
fn detect_react_framework(
    pkg: &serde_json::Value,
    project_path: &Path,
    analysis: &mut ProjectAnalysis,
) {
    let ver = pkg_dep_version(pkg, "react").unwrap_or_default();
    if has_dep(pkg, "@remix-run/react") || has_dep(pkg, "remix") {
        analysis.framework = Some("Remix".to_string());
        analysis.framework_version =
            pkg_dep_version(pkg, "@remix-run/react").or(Some(ver));
    } else if has_dep(pkg, "gatsby") {
        analysis.framework = Some("Gatsby".to_string());
        analysis.framework_version = pkg_dep_version(pkg, "gatsby").or(Some(ver));
    } else if has_dep(pkg, "expo") || has_dep(pkg, "expo-router") {
        analysis.framework = Some("Expo (React Native)".to_string());
        analysis.framework_version = pkg_dep_version(pkg, "expo").or(Some(ver));
    } else if has_dep(pkg, "react-native") {
        analysis.framework = Some("React Native".to_string());
        analysis.framework_version = pkg_dep_version(pkg, "react-native").or(Some(ver));
    } else {
        // Plain React — check build tool
        if project_path.join("vite.config.ts").exists()
            || project_path.join("vite.config.js").exists()
            || project_path.join("vite.config.mjs").exists()
        {
            let vite_ver = pkg_dep_version(pkg, "vite").unwrap_or_default();
            analysis.framework = Some("React + Vite".to_string());
            if !vite_ver.is_empty() {
                analysis.framework_version = Some(format!("React {}, Vite {}", ver, vite_ver));
            } else if !ver.is_empty() {
                analysis.framework_version = Some(ver);
            }
        } else {
            analysis.framework = Some("React".to_string());
            if !ver.is_empty() {
                analysis.framework_version = Some(ver);
            }
        }
    }
}

/// Detect JS ecosystem tooling: CSS, ORM, auth, testing, state, router, UI lib, deployment.
fn detect_js_ecosystem(
    pkg: &serde_json::Value,
    project_path: &Path,
    analysis: &mut ProjectAnalysis,
) {
    // CSS framework
    if has_dep(pkg, "tailwindcss") {
        let ver = pkg_dep_version(pkg, "tailwindcss").unwrap_or_default();
        analysis.css_framework = Some(if ver.is_empty() {
            "Tailwind CSS".to_string()
        } else {
            format!("Tailwind CSS {}", ver)
        });
    } else if has_dep(pkg, "@chakra-ui/react") {
        analysis.css_framework = Some("Chakra UI".to_string());
    } else if has_dep(pkg, "@mui/material") {
        analysis.css_framework = Some("Material UI".to_string());
    } else if has_dep(pkg, "styled-components") {
        analysis.css_framework = Some("styled-components".to_string());
    }

    // ORM / Database
    if has_dep(pkg, "@prisma/client") || has_dep(pkg, "prisma") {
        analysis.orm = Some("Prisma".to_string());
        if project_path.join("prisma/schema.prisma").exists() {
            analysis.database = Some("Prisma ORM".to_string());
        }
    }
    if has_dep(pkg, "drizzle-orm") {
        analysis.orm = Some("Drizzle".to_string());
        analysis.database = Some("Drizzle ORM".to_string());
    }
    if has_dep(pkg, "@supabase/supabase-js") {
        analysis.database =
            Some(analysis.database.take().map_or("Supabase".to_string(), |d| {
                format!("{} + Supabase", d)
            }));
    }
    if has_dep(pkg, "firebase") || has_dep(pkg, "firebase-admin") {
        analysis.database =
            Some(analysis.database.take().map_or("Firebase".to_string(), |d| {
                format!("{} + Firebase", d)
            }));
    }
    if has_dep(pkg, "mongoose") {
        analysis.orm = Some("Mongoose".to_string());
        analysis.database = Some("MongoDB (Mongoose)".to_string());
    }

    // Auth
    if has_dep(pkg, "next-auth") || has_dep(pkg, "@auth/core") {
        analysis.auth = Some("NextAuth.js / Auth.js".to_string());
    } else if has_dep(pkg, "@clerk/nextjs") || has_dep(pkg, "@clerk/clerk-react") {
        analysis.auth = Some("Clerk".to_string());
    } else if has_dep(pkg, "lucia") || has_dep(pkg, "lucia-auth") {
        analysis.auth = Some("Lucia Auth".to_string());
    } else if has_dep(pkg, "@supabase/auth-helpers-nextjs")
        || has_dep(pkg, "@supabase/ssr")
    {
        analysis.auth = Some("Supabase Auth".to_string());
    } else if has_dep(pkg, "passport") {
        analysis.auth = Some("Passport.js".to_string());
    }

    // Testing
    if has_dep(pkg, "vitest") {
        analysis.test_framework = Some("Vitest".to_string());
    } else if has_dep(pkg, "jest") {
        analysis.test_framework = Some("Jest".to_string());
    }
    if has_dep(pkg, "@playwright/test") || has_dep(pkg, "playwright") {
        let base = analysis.test_framework.clone().unwrap_or_default();
        analysis.test_framework = Some(if base.is_empty() {
            "Playwright".to_string()
        } else {
            format!("{} + Playwright (E2E)", base)
        });
    } else if has_dep(pkg, "cypress") {
        let base = analysis.test_framework.clone().unwrap_or_default();
        analysis.test_framework = Some(if base.is_empty() {
            "Cypress".to_string()
        } else {
            format!("{} + Cypress (E2E)", base)
        });
    }

    // State management
    if has_dep(pkg, "zustand") {
        analysis.state_management = Some("Zustand".to_string());
    } else if has_dep(pkg, "@reduxjs/toolkit") || has_dep(pkg, "redux") {
        analysis.state_management = Some("Redux Toolkit".to_string());
    } else if has_dep(pkg, "jotai") {
        analysis.state_management = Some("Jotai".to_string());
    } else if has_dep(pkg, "recoil") {
        analysis.state_management = Some("Recoil".to_string());
    } else if has_dep(pkg, "pinia") {
        analysis.state_management = Some("Pinia".to_string());
    } else if has_dep(pkg, "mobx") {
        analysis.state_management = Some("MobX".to_string());
    }

    // Router (for non-Next.js/SvelteKit projects)
    if analysis.router_type.is_none() {
        if has_dep(pkg, "@tanstack/react-router") {
            analysis.router_type = Some("TanStack Router (file-based)".to_string());
        } else if has_dep(pkg, "react-router-dom") || has_dep(pkg, "react-router") {
            let ver = pkg_dep_version(pkg, "react-router-dom")
                .or_else(|| pkg_dep_version(pkg, "react-router"))
                .unwrap_or_default();
            analysis.router_type = if ver.starts_with('7') || ver.starts_with('6') {
                Some(format!("React Router {}", ver))
            } else {
                Some("React Router".to_string())
            };
        } else if has_dep(pkg, "wouter") {
            analysis.router_type = Some("Wouter".to_string());
        }
    }

    // TanStack Query
    if has_dep(pkg, "@tanstack/react-query") {
        analysis.architecture_notes.push("Data fetching: TanStack Query".to_string());
    }

    // UI Component Library
    if project_path.join("components.json").exists() {
        analysis.ui_library = Some("shadcn/ui".to_string());
        analysis.architecture_notes.push(
            "UI: shadcn/ui — add components with `npx shadcn@latest add {name}`".to_string(),
        );
    }
    if analysis.ui_library.is_none() {
        if has_dep(pkg, "@radix-ui/react-dialog") || has_dep(pkg, "@radix-ui/themes") {
            analysis.ui_library = Some("Radix UI".to_string());
        } else if has_dep(pkg, "antd") {
            analysis.ui_library = Some("Ant Design".to_string());
        } else if has_dep(pkg, "@headlessui/react") {
            analysis.ui_library = Some("Headless UI".to_string());
        } else if has_dep(pkg, "@mantine/core") {
            analysis.ui_library = Some("Mantine".to_string());
        } else if has_dep(pkg, "daisyui") {
            analysis.ui_library = Some("daisyUI".to_string());
        } else if has_dep(pkg, "@nextui-org/react") {
            analysis.ui_library = Some("NextUI".to_string());
        } else if has_dep(pkg, "flowbite-react") || has_dep(pkg, "flowbite") {
            analysis.ui_library = Some("Flowbite".to_string());
        }
    }

    // Monorepo
    if pkg.get("workspaces").is_some() {
        analysis.has_monorepo = true;
        analysis
            .architecture_notes
            .push("Monorepo with npm/yarn/pnpm workspaces".to_string());
    }

    // Deployment
    if project_path.join("vercel.json").exists() || has_dep(pkg, "vercel") {
        analysis.deployment = Some("Vercel".to_string());
    } else if project_path.join("netlify.toml").exists() {
        analysis.deployment = Some("Netlify".to_string());
    } else if project_path.join("fly.toml").exists() {
        analysis.deployment = Some("Fly.io".to_string());
    } else if project_path.join("render.yaml").exists() {
        analysis.deployment = Some("Render".to_string());
    } else if project_path.join("railway.json").exists()
        || project_path.join("railway.toml").exists()
    {
        analysis.deployment = Some("Railway".to_string());
    } else if project_path.join("Dockerfile").exists() {
        analysis.deployment = Some("Docker".to_string());
    }
}

/// Detect non-JS project types: Rust (Cargo.toml), Python (pyproject.toml), Go (go.mod), Ruby (Gemfile).
fn detect_non_js_projects(project_path: &Path, analysis: &mut ProjectAnalysis) {
    // Cargo.toml (Rust)
    let cargo_path = project_path.join("Cargo.toml");
    if cargo_path.exists() {
        if analysis.language == "Unknown" {
            analysis.language = "Rust".to_string();
        }
        if let Ok(content) = std::fs::read_to_string(&cargo_path) {
            if let Ok(cargo) = content.parse::<toml::Value>() {
                if let Some(package) = cargo.get("package") {
                    if analysis.description.is_none() {
                        if let Some(desc) = package.get("description").and_then(|v| v.as_str()) {
                            analysis.description = Some(desc.to_string());
                        }
                    }
                    if let Some(edition) = package.get("edition").and_then(|v| v.as_str()) {
                        analysis
                            .conventions
                            .push(format!("Rust edition: {}", edition));
                    }
                }
                if cargo.get("workspace").is_some() {
                    analysis.has_monorepo = true;
                    analysis
                        .architecture_notes
                        .push("Cargo workspace (monorepo)".to_string());
                }
            }
        }
        let tauri_conf = project_path.join("src-tauri/tauri.conf.json");
        if tauri_conf.exists() {
            analysis.framework = Some("Tauri".to_string());
            analysis
                .architecture_notes
                .push("Tauri desktop application (Rust + Web frontend)".to_string());
        }
    }

    // pyproject.toml (Python)
    let pyproject_path = project_path.join("pyproject.toml");
    if pyproject_path.exists() && analysis.language == "Unknown" {
        analysis.language = "Python".to_string();
        if let Ok(content) = std::fs::read_to_string(&pyproject_path) {
            let lower = content.to_lowercase();
            if lower.contains("fastapi") {
                analysis.framework = Some("FastAPI".to_string());
            } else if lower.contains("django") {
                analysis.framework = Some("Django".to_string());
            } else if lower.contains("flask") {
                analysis.framework = Some("Flask".to_string());
            }
            if lower.contains("pytest") {
                analysis.test_framework = Some("pytest".to_string());
            }
            if lower.contains("sqlalchemy") {
                analysis.orm = Some("SQLAlchemy".to_string());
                analysis.database = Some("SQLAlchemy".to_string());
            }
        }
    }

    // go.mod (Go)
    let gomod_path = project_path.join("go.mod");
    if gomod_path.exists() && analysis.language == "Unknown" {
        analysis.language = "Go".to_string();
        if let Ok(content) = std::fs::read_to_string(&gomod_path) {
            if content.contains("gin-gonic") {
                analysis.framework = Some("Gin".to_string());
            } else if content.contains("echo") {
                analysis.framework = Some("Echo".to_string());
            } else if content.contains("fiber") {
                analysis.framework = Some("Fiber".to_string());
            }
        }
    }

    // Gemfile (Ruby)
    if project_path.join("Gemfile").exists() && analysis.language == "Unknown" {
        analysis.language = "Ruby".to_string();
        if project_path.join("config/routes.rb").exists() {
            analysis.framework = Some("Ruby on Rails".to_string());
        }
    }
}

/// Detect project infrastructure: Makefile, dir tree, conventions, env vars, Docker, CI/CD, monorepo tools.
fn detect_project_infrastructure(project_path: &Path, analysis: &mut ProjectAnalysis) {
    // Description fallback
    if analysis.description.is_none() {
        analysis.description = extract_readme_description(project_path);
    }

    // Makefile targets
    let makefile_path = project_path.join("Makefile");
    if makefile_path.exists() {
        if let Ok(content) = std::fs::read_to_string(&makefile_path) {
            let targets: Vec<(String, String)> = content
                .lines()
                .filter_map(|line| {
                    if line.ends_with(':') || line.contains(": ") || line.contains(":\t") {
                        let target = line.split(':').next()?.trim();
                        if !target.is_empty()
                            && !target.starts_with('.')
                            && !target.starts_with('\t')
                            && !target.starts_with(' ')
                            && !target.contains('$')
                            && !target.contains('/')
                        {
                            return Some((
                                format!("make {}", target),
                                infer_script_description(target, ""),
                            ));
                        }
                    }
                    None
                })
                .collect();
            analysis.scripts.extend(targets);
        }
    }

    // Directory tree
    analysis.directory_tree = build_directory_tree(project_path, 3);

    // Key directories & files
    analysis.key_directories = detect_key_directories(project_path);
    analysis.key_files = detect_key_files(project_path);

    // Conventions
    analysis
        .conventions
        .extend(detect_tsconfig_conventions(project_path));
    analysis
        .conventions
        .extend(detect_eslint_conventions(project_path));
    analysis
        .conventions
        .extend(detect_prettier_conventions(project_path));
    analysis
        .conventions
        .extend(detect_commit_conventions(project_path));

    // Environment variables
    analysis.env_vars = read_env_example(project_path);

    // Docker
    if project_path.join("Dockerfile").exists() || project_path.join("docker-compose.yml").exists()
    {
        analysis
            .architecture_notes
            .push("Docker containerization configured".to_string());
    }

    // CI/CD
    if project_path.join(".github/workflows").is_dir() {
        analysis
            .architecture_notes
            .push("GitHub Actions CI/CD".to_string());
    }

    // Turborepo
    if project_path.join("turbo.json").exists() {
        analysis.has_monorepo = true;
        analysis
            .architecture_notes
            .push("Turborepo build system".to_string());
    }

    // Nx
    if project_path.join("nx.json").exists() {
        analysis.has_monorepo = true;
        analysis
            .architecture_notes
            .push("Nx workspace".to_string());
    }
}

// ── Main Analysis Function ──

pub fn analyze_project(project_path: &Path) -> ProjectAnalysis {
    let project_name = project_path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();

    let mut analysis = ProjectAnalysis {
        name: project_name.clone(),
        description: None,
        framework: None,
        framework_version: None,
        language: "Unknown".to_string(),
        router_type: None,
        css_framework: None,
        database: None,
        orm: None,
        auth: None,
        test_framework: None,
        state_management: None,
        deployment: None,
        scripts: vec![],
        env_vars: vec![],
        directory_tree: String::new(),
        key_directories: vec![],
        conventions: vec![],
        architecture_notes: vec![],
        has_monorepo: false,
        package_manager: None,
        ui_library: None,
        key_files: vec![],
    };

    // package.json analysis (JavaScript/TypeScript projects)
    let pkg_path = project_path.join("package.json");
    let pkg = read_json(&pkg_path);

    if let Some(ref pkg) = pkg {
        analysis.language = "TypeScript/JavaScript".to_string();

        if let Some(desc) = pkg.get("description").and_then(|v| v.as_str()) {
            if !desc.is_empty() {
                analysis.description = Some(desc.to_string());
            }
        }

        analysis.package_manager = detect_package_manager(project_path);

        if let Some(scripts) = pkg.get("scripts").and_then(|v| v.as_object()) {
            analysis.scripts = scripts
                .iter()
                .map(|(name, cmd)| {
                    let cmd_str = cmd.as_str().unwrap_or("");
                    (name.clone(), cmd_str.to_string())
                })
                .collect();
        }

        detect_js_framework(pkg, project_path, &mut analysis);
        detect_js_ecosystem(pkg, project_path, &mut analysis);
    }

    detect_non_js_projects(project_path, &mut analysis);
    detect_project_infrastructure(project_path, &mut analysis);

    analysis
}

// ── CLAUDE.md Generator ──

pub fn generate_claude_md(analysis: &ProjectAnalysis) -> String {
    let mut md = String::with_capacity(4096);

    // Header
    md.push_str(&format!("# CLAUDE.md — {}\n\n", analysis.name));

    // What This Is — enriched with framework context
    md.push_str("## What This Is\n");
    let base_desc = analysis.description.as_deref().unwrap_or("");
    let framework_label = analysis.framework.as_deref().unwrap_or(&analysis.language);

    if base_desc.is_empty() {
        md.push_str(&format!("A {} project.", framework_label));
    } else if base_desc.len() < 80 && analysis.framework.is_some() {
        md.push_str(&format!("{} Built with {}.", base_desc, framework_label));
    } else {
        md.push_str(base_desc);
    }
    md.push_str("\n\n");

    // Stack
    md.push_str("## Stack\n");
    if let Some(ref fw) = analysis.framework {
        let fw_display = if let Some(ref ver) = analysis.framework_version {
            format!("{} {}", fw, ver)
        } else {
            fw.clone()
        };
        let fw_display = if let Some(ref router) = analysis.router_type {
            format!("{} ({})", fw_display, router)
        } else {
            fw_display
        };
        md.push_str(&format!("- **Framework:** {}\n", fw_display));
    }
    md.push_str(&format!("- **Language:** {}\n", analysis.language));
    if let Some(ref css) = analysis.css_framework {
        md.push_str(&format!("- **Styling:** {}\n", css));
    }
    if let Some(ref db) = analysis.database {
        md.push_str(&format!("- **Database:** {}\n", db));
    }
    if let Some(ref auth) = analysis.auth {
        md.push_str(&format!("- **Auth:** {}\n", auth));
    }
    if let Some(ref test) = analysis.test_framework {
        md.push_str(&format!("- **Testing:** {}\n", test));
    }
    if let Some(ref state) = analysis.state_management {
        md.push_str(&format!("- **State Management:** {}\n", state));
    }
    if let Some(ref ui_lib) = analysis.ui_library {
        md.push_str(&format!("- **UI Components:** {}\n", ui_lib));
    }
    if let Some(ref deploy) = analysis.deployment {
        md.push_str(&format!("- **Deployment:** {}\n", deploy));
    }
    if let Some(ref pm) = analysis.package_manager {
        md.push_str(&format!("- **Package Manager:** {}\n", pm));
    }
    md.push('\n');

    // Project Structure
    if !analysis.directory_tree.is_empty() {
        md.push_str("## Project Structure\n```\n");
        md.push_str(&analysis.directory_tree);
        md.push_str("\n```\n\n");

        if !analysis.key_directories.is_empty() {
            md.push_str("Key directories:\n");
            for (path, desc) in &analysis.key_directories {
                md.push_str(&format!("- `{}/` — {}\n", path, desc));
            }
            md.push('\n');
        }

        if !analysis.key_files.is_empty() {
            md.push_str("Key files:\n");
            for (path, desc) in &analysis.key_files {
                md.push_str(&format!("- `{}` — {}\n", path, desc));
            }
            md.push('\n');
        }
    }

    // Commands
    let npm_scripts: Vec<_> = analysis
        .scripts
        .iter()
        .filter(|(name, _)| !name.starts_with("make "))
        .collect();
    let make_targets: Vec<_> = analysis
        .scripts
        .iter()
        .filter(|(name, _)| name.starts_with("make "))
        .collect();

    if !npm_scripts.is_empty() || !make_targets.is_empty() {
        md.push_str("## Commands\n```bash\n");
        let pm = analysis
            .package_manager
            .as_deref()
            .unwrap_or("npm");
        let run_prefix = if pm == "npm" {
            "npm run ".to_string()
        } else {
            format!("{} ", pm)
        };
        // Calculate max name length for alignment
        let max_name_len = npm_scripts
            .iter()
            .map(|(name, _)| name.len() + run_prefix.len())
            .max()
            .unwrap_or(20)
            .min(30); // cap alignment at 30 chars

        for (name, cmd) in &npm_scripts {
            let desc = infer_script_description(name, cmd);
            let full_name = format!("{}{}", run_prefix, name);
            let padding = " ".repeat((max_name_len + 2).saturating_sub(full_name.len()));
            md.push_str(&format!("{}{}# {}\n", full_name, padding, desc));
        }
        md.push_str("```\n");

        if !make_targets.is_empty() {
            md.push_str("\nMake targets:\n```bash\n");
            for (name, _) in &make_targets {
                md.push_str(&format!("{}\n", name));
            }
            md.push_str("```\n");
        }
        md.push('\n');
    }

    // Database
    if analysis.orm.is_some() {
        md.push_str("## Database\n");
        if let Some(ref orm) = analysis.orm {
            md.push_str(&format!("- **ORM:** {}\n", orm));
        }
        // Detect schema file
        let schema_files = [
            "prisma/schema.prisma",
            "drizzle/schema.ts",
            "src/db/schema.ts",
            "src/schema.ts",
        ];
        for schema in &schema_files {
            if analysis
                .key_directories
                .iter()
                .any(|(d, _)| schema.starts_with(d.as_str()))
            {
                md.push_str(&format!("- **Schema:** `{}`\n", schema));
                break;
            }
        }
        md.push('\n');
    }

    // Environment Variables
    if !analysis.env_vars.is_empty() {
        md.push_str("## Environment Variables\nRequired environment variables (from `.env.example`):\n");
        for var in &analysis.env_vars {
            let purpose = infer_env_var_purpose(var);
            if purpose.is_empty() {
                md.push_str(&format!("- `{}`\n", var));
            } else {
                md.push_str(&format!("- `{}` — {}\n", var, purpose));
            }
        }
        md.push('\n');
    }

    // Conventions
    if !analysis.conventions.is_empty() {
        md.push_str("## Conventions\n");
        for conv in &analysis.conventions {
            md.push_str(&format!("- {}\n", conv));
        }
        md.push('\n');
    }

    // Architecture Notes
    if !analysis.architecture_notes.is_empty() {
        md.push_str("## Architecture Notes\n");
        for note in &analysis.architecture_notes {
            md.push_str(&format!("- {}\n", note));
        }
        md.push('\n');
    }

    md
}

// ── Tauri Commands ──

#[tauri::command]
pub async fn analyze_project_cmd(project_path: String) -> Result<ProjectAnalysis, String> {
    let path = PathBuf::from(&project_path);
    if !path.exists() || !path.is_dir() {
        return Err(format!("Project path does not exist: {}", project_path));
    }
    info!("Analyzing project at: {}", project_path);
    Ok(analyze_project(&path))
}

#[tauri::command]
pub async fn generate_claude_md_cmd(
    project_path: String,
) -> Result<String, String> {
    let path = PathBuf::from(&project_path);
    if !path.exists() || !path.is_dir() {
        return Err(format!("Project path does not exist: {}", project_path));
    }

    let claude_md_path = path.join("CLAUDE.md");
    if claude_md_path.exists() {
        return Err("CLAUDE.md already exists — refusing to overwrite".to_string());
    }

    info!("Generating CLAUDE.md for: {}", project_path);
    let analysis = analyze_project(&path);
    let content = generate_claude_md(&analysis);

    std::fs::write(&claude_md_path, &content)
        .map_err(|e| format!("Failed to write CLAUDE.md: {}", e))?;

    Ok(content)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn temp_dir() -> TempDir {
        tempfile::tempdir().expect("Failed to create temp dir")
    }

    // ── strip_json_comments ──

    #[test]
    fn strip_json_comments_line_comments() {
        let input = r#"{
  // This is a comment
  "key": "value"
}"#;
        let result = strip_json_comments(input);
        assert!(result.contains("\"key\""));
        assert!(!result.contains("// This is a comment"));
    }

    #[test]
    fn strip_json_comments_block_comments() {
        let input = r#"{
  /* block comment */
  "key": "value"
}"#;
        let result = strip_json_comments(input);
        assert!(result.contains("\"key\""));
        assert!(!result.contains("block comment"));
    }

    #[test]
    fn strip_json_comments_preserves_strings_with_slashes() {
        let input = r#"{ "url": "https://example.com" }"#;
        let result = strip_json_comments(input);
        assert!(result.contains("https://example.com"));
    }

    // ── detect_package_manager ──

    #[test]
    fn detect_pnpm() {
        let dir = temp_dir();
        std::fs::write(dir.path().join("pnpm-lock.yaml"), "").unwrap();
        assert_eq!(detect_package_manager(dir.path()), Some("pnpm".to_string()));
    }

    #[test]
    fn detect_yarn() {
        let dir = temp_dir();
        std::fs::write(dir.path().join("yarn.lock"), "").unwrap();
        assert_eq!(detect_package_manager(dir.path()), Some("yarn".to_string()));
    }

    #[test]
    fn detect_bun() {
        let dir = temp_dir();
        std::fs::write(dir.path().join("bun.lockb"), "").unwrap();
        assert_eq!(detect_package_manager(dir.path()), Some("bun".to_string()));
    }

    #[test]
    fn detect_npm() {
        let dir = temp_dir();
        std::fs::write(dir.path().join("package-lock.json"), "").unwrap();
        assert_eq!(detect_package_manager(dir.path()), Some("npm".to_string()));
    }

    #[test]
    fn detect_npm_fallback_from_package_json() {
        let dir = temp_dir();
        std::fs::write(dir.path().join("package.json"), "{}").unwrap();
        assert_eq!(detect_package_manager(dir.path()), Some("npm".to_string()));
    }

    #[test]
    fn detect_no_package_manager() {
        let dir = temp_dir();
        assert_eq!(detect_package_manager(dir.path()), None);
    }

    #[test]
    fn detect_pnpm_takes_priority() {
        let dir = temp_dir();
        std::fs::write(dir.path().join("pnpm-lock.yaml"), "").unwrap();
        std::fs::write(dir.path().join("package-lock.json"), "").unwrap();
        assert_eq!(detect_package_manager(dir.path()), Some("pnpm".to_string()));
    }

    // ── detect_install_command ──

    #[test]
    fn install_command_pnpm() {
        let dir = temp_dir();
        std::fs::write(dir.path().join("pnpm-lock.yaml"), "").unwrap();
        assert_eq!(
            detect_install_command(dir.path()),
            Some("pnpm install".to_string())
        );
    }

    #[test]
    fn install_command_uv_sync() {
        let dir = temp_dir();
        std::fs::write(dir.path().join("pyproject.toml"), "").unwrap();
        std::fs::write(dir.path().join("uv.lock"), "").unwrap();
        assert_eq!(
            detect_install_command(dir.path()),
            Some("uv sync".to_string())
        );
    }

    #[test]
    fn install_command_pip() {
        let dir = temp_dir();
        std::fs::write(dir.path().join("pyproject.toml"), "").unwrap();
        assert_eq!(
            detect_install_command(dir.path()),
            Some("pip install -e .".to_string())
        );
    }

    #[test]
    fn install_command_cargo() {
        let dir = temp_dir();
        std::fs::write(dir.path().join("Cargo.lock"), "").unwrap();
        assert_eq!(
            detect_install_command(dir.path()),
            Some("cargo build".to_string())
        );
    }

    #[test]
    fn install_command_go() {
        let dir = temp_dir();
        std::fs::write(dir.path().join("go.sum"), "").unwrap();
        assert_eq!(
            detect_install_command(dir.path()),
            Some("go mod download".to_string())
        );
    }

    #[test]
    fn install_command_bundle() {
        let dir = temp_dir();
        std::fs::write(dir.path().join("Gemfile.lock"), "").unwrap();
        assert_eq!(
            detect_install_command(dir.path()),
            Some("bundle install".to_string())
        );
    }

    // ── infer_script_description ──

    #[test]
    fn infer_dev_script() {
        assert_eq!(
            infer_script_description("dev", "next dev"),
            "Start development server"
        );
    }

    #[test]
    fn infer_build_script() {
        assert_eq!(
            infer_script_description("build", "next build"),
            "Build for production"
        );
    }

    #[test]
    fn infer_test_script() {
        assert_eq!(infer_script_description("test", "vitest"), "Run tests");
    }

    #[test]
    fn infer_lint_script() {
        assert_eq!(infer_script_description("lint", "eslint ."), "Run linter");
    }

    #[test]
    fn infer_format_script() {
        assert_eq!(
            infer_script_description("format", "prettier --write ."),
            "Format code"
        );
    }

    #[test]
    fn infer_typecheck_script() {
        assert_eq!(
            infer_script_description("typecheck", "tsc --noEmit"),
            "Type check"
        );
    }

    #[test]
    fn infer_db_migrate_script() {
        assert_eq!(
            infer_script_description("db:migrate", "prisma migrate dev"),
            "Run database migrations"
        );
    }

    #[test]
    fn infer_unknown_script_shows_command() {
        let result = infer_script_description("custom", "some-obscure-tool --flag");
        assert!(result.contains("some-obscure-tool"));
    }

    #[test]
    fn infer_long_command_truncates() {
        let long_cmd = "a".repeat(100);
        let result = infer_script_description("x", &long_cmd);
        assert!(result.len() < 100);
        assert!(result.contains("..."));
    }

    // ── infer_env_var_purpose ──

    #[test]
    fn env_var_database_url() {
        assert!(infer_env_var_purpose("DATABASE_URL").contains("Database"));
    }

    #[test]
    fn env_var_api_key() {
        assert!(infer_env_var_purpose("STRIPE_API_KEY").contains("API key"));
    }

    #[test]
    fn env_var_secret() {
        assert!(infer_env_var_purpose("JWT_SECRET").contains("Secret"));
    }

    #[test]
    fn env_var_port() {
        assert!(infer_env_var_purpose("PORT").contains("port"));
    }

    #[test]
    fn env_var_next_public() {
        assert!(infer_env_var_purpose("NEXT_PUBLIC_FOO").contains("Next.js"));
    }

    #[test]
    fn env_var_vite() {
        assert!(infer_env_var_purpose("VITE_API_URL").contains("Vite"));
    }

    #[test]
    fn env_var_unknown() {
        assert_eq!(infer_env_var_purpose("FOOBAR"), "");
    }

    // ── read_env_example ──

    #[test]
    fn read_env_example_parses_variables() {
        let dir = temp_dir();
        std::fs::write(
            dir.path().join(".env.example"),
            "# Database\nDATABASE_URL=\nREDIS_URL=redis://localhost\n\n# Auth\nJWT_SECRET=\n",
        )
        .unwrap();
        let vars = read_env_example(dir.path());
        assert_eq!(vars, vec!["DATABASE_URL", "REDIS_URL", "JWT_SECRET"]);
    }

    #[test]
    fn read_env_example_skips_comments_and_blanks() {
        let dir = temp_dir();
        std::fs::write(
            dir.path().join(".env.example"),
            "# This is a comment\n\n  \nFOO=bar\n",
        )
        .unwrap();
        let vars = read_env_example(dir.path());
        assert_eq!(vars, vec!["FOO"]);
    }

    #[test]
    fn read_env_example_no_file() {
        let dir = temp_dir();
        let vars = read_env_example(dir.path());
        assert!(vars.is_empty());
    }

    #[test]
    fn read_env_sample_fallback() {
        let dir = temp_dir();
        std::fs::write(dir.path().join(".env.sample"), "API_KEY=\n").unwrap();
        let vars = read_env_example(dir.path());
        assert_eq!(vars, vec!["API_KEY"]);
    }

    // ── read_env_keys_real_sources ──

    #[test]
    fn read_env_keys_real_sources_finds_keys_in_env_local() {
        let dir = temp_dir();
        std::fs::write(
            dir.path().join(".env.local"),
            "# Supabase\nVITE_SUPABASE_URL=https://example.supabase.co\nVITE_SUPABASE_ANON_KEY=ey...\n",
        )
        .unwrap();
        let keys = read_env_keys_real_sources(dir.path());
        assert_eq!(keys.len(), 2);
        assert_eq!(
            keys.get("VITE_SUPABASE_URL").map(|v| v.as_slice()),
            Some(&[".env.local".to_string()][..])
        );
        assert_eq!(
            keys.get("VITE_SUPABASE_ANON_KEY").map(|v| v.as_slice()),
            Some(&[".env.local".to_string()][..])
        );
    }

    #[test]
    fn read_env_keys_real_sources_ignores_env_example() {
        // Placeholder files MUST be ignored — `.env.example` is for declaration,
        // not actual credentials. The probe needs to know what's REALLY there.
        let dir = temp_dir();
        std::fs::write(dir.path().join(".env.example"), "OPENAI_API_KEY=\n").unwrap();
        let keys = read_env_keys_real_sources(dir.path());
        assert!(keys.is_empty());
    }

    #[test]
    fn read_env_keys_real_sources_tracks_multiple_sources() {
        let dir = temp_dir();
        std::fs::write(dir.path().join(".env"), "SHARED_KEY=base\n").unwrap();
        std::fs::write(dir.path().join(".env.local"), "SHARED_KEY=override\nLOCAL_ONLY=x\n")
            .unwrap();
        let keys = read_env_keys_real_sources(dir.path());
        assert_eq!(
            keys.get("SHARED_KEY").map(|v| v.as_slice()),
            Some(&[".env".to_string(), ".env.local".to_string()][..])
        );
        assert_eq!(
            keys.get("LOCAL_ONLY").map(|v| v.as_slice()),
            Some(&[".env.local".to_string()][..])
        );
    }

    #[test]
    fn read_env_keys_real_sources_skips_comments_and_blanks() {
        let dir = temp_dir();
        std::fs::write(
            dir.path().join(".env.local"),
            "# Comment\n\n  \nDATABASE_URL=postgres://x\n",
        )
        .unwrap();
        let keys = read_env_keys_real_sources(dir.path());
        assert_eq!(keys.len(), 1);
        assert!(keys.contains_key("DATABASE_URL"));
    }

    #[test]
    fn read_env_keys_real_sources_no_files() {
        let dir = temp_dir();
        let keys = read_env_keys_real_sources(dir.path());
        assert!(keys.is_empty());
    }

    // ── extract_readme_description ──

    #[test]
    fn readme_extracts_first_paragraph() {
        let dir = temp_dir();
        std::fs::write(
            dir.path().join("README.md"),
            "# My Project\n\nThis is a description of the project.\n\n## Installation\n",
        )
        .unwrap();
        let desc = extract_readme_description(dir.path());
        assert_eq!(desc, Some("This is a description of the project.".to_string()));
    }

    #[test]
    fn readme_skips_badges() {
        let dir = temp_dir();
        std::fs::write(
            dir.path().join("README.md"),
            "# Project\n\n![badge](url)\n[![ci](url)](link)\n\nActual description here.\n",
        )
        .unwrap();
        let desc = extract_readme_description(dir.path());
        assert_eq!(desc, Some("Actual description here.".to_string()));
    }

    #[test]
    fn readme_no_file() {
        let dir = temp_dir();
        let desc = extract_readme_description(dir.path());
        assert_eq!(desc, None);
    }

    // ── build_directory_tree ──

    #[test]
    fn directory_tree_basic() {
        let dir = temp_dir();
        std::fs::create_dir_all(dir.path().join("src")).unwrap();
        std::fs::write(dir.path().join("src/main.ts"), "").unwrap();
        std::fs::write(dir.path().join("package.json"), "{}").unwrap();

        let tree = build_directory_tree(dir.path(), 2);
        assert!(tree.contains("src/"));
        assert!(tree.contains("package.json"));
    }

    #[test]
    fn directory_tree_skips_node_modules() {
        let dir = temp_dir();
        std::fs::create_dir_all(dir.path().join("node_modules/foo")).unwrap();
        std::fs::create_dir_all(dir.path().join("src")).unwrap();

        let tree = build_directory_tree(dir.path(), 2);
        assert!(!tree.contains("node_modules"));
        assert!(tree.contains("src/"));
    }

    #[test]
    fn directory_tree_skips_git() {
        let dir = temp_dir();
        std::fs::create_dir_all(dir.path().join(".git/objects")).unwrap();
        std::fs::create_dir_all(dir.path().join("src")).unwrap();

        let tree = build_directory_tree(dir.path(), 2);
        assert!(!tree.contains(".git"));
    }

    #[test]
    fn directory_tree_respects_max_depth() {
        let dir = temp_dir();
        std::fs::create_dir_all(dir.path().join("a/b/c/d")).unwrap();

        let tree = build_directory_tree(dir.path(), 2);
        // Depth 2: should show a/ and a/b/ but not deeper contents
        assert!(tree.contains("a/"));
        assert!(tree.contains("b/"));
    }

    // ── detect_key_directories ──

    #[test]
    fn detects_src_components() {
        let dir = temp_dir();
        std::fs::create_dir_all(dir.path().join("src/components")).unwrap();
        std::fs::write(dir.path().join("src/components/Foo.tsx"), "").unwrap();
        std::fs::write(dir.path().join("src/components/Bar.tsx"), "").unwrap();

        let dirs = detect_key_directories(dir.path());
        let found = dirs.iter().find(|(p, _)| p == "src/components");
        assert!(found.is_some());
        let desc = &found.unwrap().1;
        // Now shows component names instead of just counts
        assert!(desc.contains("Bar"), "Should list Bar by name");
        assert!(desc.contains("Foo"), "Should list Foo by name");
    }

    #[test]
    fn detects_prisma() {
        let dir = temp_dir();
        std::fs::create_dir_all(dir.path().join("prisma")).unwrap();
        std::fs::write(dir.path().join("prisma/schema.prisma"), "").unwrap();

        let dirs = detect_key_directories(dir.path());
        assert!(dirs.iter().any(|(p, _)| p == "prisma"));
    }

    // ── Convention detection ──

    #[test]
    fn detects_eslint() {
        let dir = temp_dir();
        std::fs::write(dir.path().join("eslint.config.js"), "").unwrap();

        let convs = detect_eslint_conventions(dir.path());
        assert!(!convs.is_empty());
        assert!(convs[0].contains("ESLint"));
    }

    #[test]
    fn detects_prettier() {
        let dir = temp_dir();
        std::fs::write(dir.path().join(".prettierrc"), "{}").unwrap();

        let convs = detect_prettier_conventions(dir.path());
        assert!(!convs.is_empty());
        assert!(convs[0].contains("Prettier"));
    }

    #[test]
    fn detects_husky() {
        let dir = temp_dir();
        std::fs::create_dir_all(dir.path().join(".husky")).unwrap();

        let convs = detect_commit_conventions(dir.path());
        assert!(convs.iter().any(|c| c.contains("Husky")));
    }

    #[test]
    fn detects_commitlint() {
        let dir = temp_dir();
        std::fs::write(dir.path().join("commitlint.config.js"), "").unwrap();

        let convs = detect_commit_conventions(dir.path());
        assert!(convs.iter().any(|c| c.contains("Commitlint")));
    }

    #[test]
    fn detects_tsconfig_strict() {
        let dir = temp_dir();
        std::fs::write(
            dir.path().join("tsconfig.json"),
            r#"{ "compilerOptions": { "strict": true, "target": "ES2022" } }"#,
        )
        .unwrap();

        let convs = detect_tsconfig_conventions(dir.path());
        assert!(convs.iter().any(|c| c.contains("strict mode enabled")));
        assert!(convs.iter().any(|c| c.contains("ES2022")));
    }

    #[test]
    fn detects_tsconfig_path_aliases() {
        let dir = temp_dir();
        std::fs::write(
            dir.path().join("tsconfig.json"),
            r#"{ "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }"#,
        )
        .unwrap();

        let convs = detect_tsconfig_conventions(dir.path());
        assert!(convs.iter().any(|c| c.contains("@/*")));
    }

    #[test]
    fn tsconfig_with_comments() {
        let dir = temp_dir();
        std::fs::write(
            dir.path().join("tsconfig.json"),
            r#"{
  // strict mode
  "compilerOptions": {
    "strict": true /* enforce */
  }
}"#,
        )
        .unwrap();

        let convs = detect_tsconfig_conventions(dir.path());
        assert!(convs.iter().any(|c| c.contains("strict mode enabled")));
    }

    // ── Full analyze_project ──

    #[test]
    fn analyze_nextjs_project() {
        let dir = temp_dir();
        let pkg = serde_json::json!({
            "name": "my-app",
            "description": "A Next.js application",
            "scripts": {
                "dev": "next dev",
                "build": "next build",
                "start": "next start",
                "lint": "next lint"
            },
            "dependencies": {
                "next": "^15.1.0",
                "react": "^19.0.0",
                "react-dom": "^19.0.0"
            },
            "devDependencies": {
                "tailwindcss": "^4.0.0",
                "vitest": "^3.0.0",
                "@prisma/client": "^6.0.0"
            }
        });
        std::fs::write(
            dir.path().join("package.json"),
            serde_json::to_string_pretty(&pkg).unwrap(),
        )
        .unwrap();
        std::fs::write(dir.path().join("pnpm-lock.yaml"), "").unwrap();
        std::fs::create_dir_all(dir.path().join("src/app")).unwrap();
        std::fs::create_dir_all(dir.path().join("prisma")).unwrap();
        std::fs::write(dir.path().join("prisma/schema.prisma"), "").unwrap();

        let analysis = analyze_project(dir.path());

        assert_eq!(analysis.framework, Some("Next.js".to_string()));
        assert_eq!(analysis.framework_version, Some("15.1.0".to_string()));
        assert_eq!(analysis.router_type, Some("App Router".to_string()));
        assert_eq!(analysis.css_framework, Some("Tailwind CSS 4.0.0".to_string()));
        assert_eq!(analysis.orm, Some("Prisma".to_string()));
        assert_eq!(analysis.test_framework, Some("Vitest".to_string()));
        assert_eq!(analysis.package_manager, Some("pnpm".to_string()));
        assert_eq!(analysis.description, Some("A Next.js application".to_string()));
        assert_eq!(analysis.scripts.len(), 4);
        assert!(analysis.language.contains("TypeScript"));
    }

    #[test]
    fn analyze_react_vite_project() {
        let dir = temp_dir();
        let pkg = serde_json::json!({
            "name": "react-app",
            "dependencies": {
                "react": "^19.0.0",
                "zustand": "^5.0.0"
            },
            "devDependencies": {
                "vite": "^6.0.0"
            }
        });
        std::fs::write(
            dir.path().join("package.json"),
            serde_json::to_string_pretty(&pkg).unwrap(),
        )
        .unwrap();
        std::fs::write(dir.path().join("vite.config.ts"), "").unwrap();

        let analysis = analyze_project(dir.path());

        assert_eq!(analysis.framework, Some("React + Vite".to_string()));
        assert!(analysis.framework_version.as_ref().unwrap().contains("React 19"));
        assert_eq!(analysis.state_management, Some("Zustand".to_string()));
    }

    #[test]
    fn analyze_rust_project() {
        let dir = temp_dir();
        std::fs::write(
            dir.path().join("Cargo.toml"),
            r#"[package]
name = "my-tool"
version = "0.1.0"
edition = "2021"
description = "A CLI tool"

[dependencies]
tokio = "1"
"#,
        )
        .unwrap();

        let analysis = analyze_project(dir.path());

        assert_eq!(analysis.language, "Rust");
        assert_eq!(analysis.description, Some("A CLI tool".to_string()));
        assert!(analysis.conventions.iter().any(|c| c.contains("2021")));
    }

    #[test]
    fn analyze_python_fastapi_project() {
        let dir = temp_dir();
        std::fs::write(
            dir.path().join("pyproject.toml"),
            r#"[project]
name = "my-api"
dependencies = ["fastapi", "sqlalchemy", "pytest"]
"#,
        )
        .unwrap();

        let analysis = analyze_project(dir.path());

        assert_eq!(analysis.language, "Python");
        assert_eq!(analysis.framework, Some("FastAPI".to_string()));
        assert_eq!(analysis.orm, Some("SQLAlchemy".to_string()));
        assert_eq!(analysis.test_framework, Some("pytest".to_string()));
    }

    #[test]
    fn analyze_go_project() {
        let dir = temp_dir();
        std::fs::write(
            dir.path().join("go.mod"),
            "module github.com/user/myapp\n\ngo 1.22\n\nrequire github.com/gin-gonic/gin v1.9.1\n",
        )
        .unwrap();

        let analysis = analyze_project(dir.path());

        assert_eq!(analysis.language, "Go");
        assert_eq!(analysis.framework, Some("Gin".to_string()));
    }

    #[test]
    fn analyze_empty_project() {
        let dir = temp_dir();

        let analysis = analyze_project(dir.path());

        assert_eq!(analysis.language, "Unknown");
        assert!(analysis.framework.is_none());
        assert!(analysis.scripts.is_empty());
    }

    #[test]
    fn analyze_detects_monorepo_workspaces() {
        let dir = temp_dir();
        let pkg = serde_json::json!({
            "name": "monorepo",
            "workspaces": ["packages/*"]
        });
        std::fs::write(
            dir.path().join("package.json"),
            serde_json::to_string_pretty(&pkg).unwrap(),
        )
        .unwrap();

        let analysis = analyze_project(dir.path());
        assert!(analysis.has_monorepo);
    }

    #[test]
    fn analyze_detects_turborepo() {
        let dir = temp_dir();
        std::fs::write(dir.path().join("package.json"), "{}").unwrap();
        std::fs::write(dir.path().join("turbo.json"), "{}").unwrap();

        let analysis = analyze_project(dir.path());
        assert!(analysis.has_monorepo);
        assert!(analysis.architecture_notes.iter().any(|n| n.contains("Turborepo")));
    }

    #[test]
    fn analyze_detects_deployment_vercel() {
        let dir = temp_dir();
        std::fs::write(dir.path().join("package.json"), "{}").unwrap();
        std::fs::write(dir.path().join("vercel.json"), "{}").unwrap();

        let analysis = analyze_project(dir.path());
        assert_eq!(analysis.deployment, Some("Vercel".to_string()));
    }

    #[test]
    fn analyze_detects_deployment_docker() {
        let dir = temp_dir();
        std::fs::write(dir.path().join("package.json"), "{}").unwrap();
        std::fs::write(dir.path().join("Dockerfile"), "FROM node:20").unwrap();

        let analysis = analyze_project(dir.path());
        assert_eq!(analysis.deployment, Some("Docker".to_string()));
    }

    #[test]
    fn analyze_env_vars() {
        let dir = temp_dir();
        std::fs::write(dir.path().join("package.json"), "{}").unwrap();
        std::fs::write(
            dir.path().join(".env.example"),
            "DATABASE_URL=\nAPI_KEY=\nPORT=3000\n",
        )
        .unwrap();

        let analysis = analyze_project(dir.path());
        assert_eq!(analysis.env_vars.len(), 3);
        assert!(analysis.env_vars.contains(&"DATABASE_URL".to_string()));
    }

    #[test]
    fn analyze_detects_auth_clerk() {
        let dir = temp_dir();
        let pkg = serde_json::json!({
            "dependencies": {
                "next": "15.0.0",
                "@clerk/nextjs": "^5.0.0"
            }
        });
        std::fs::write(
            dir.path().join("package.json"),
            serde_json::to_string_pretty(&pkg).unwrap(),
        )
        .unwrap();

        let analysis = analyze_project(dir.path());
        assert_eq!(analysis.auth, Some("Clerk".to_string()));
    }

    #[test]
    fn analyze_detects_github_actions() {
        let dir = temp_dir();
        std::fs::create_dir_all(dir.path().join(".github/workflows")).unwrap();
        std::fs::write(dir.path().join(".github/workflows/ci.yml"), "").unwrap();

        let analysis = analyze_project(dir.path());
        assert!(analysis.architecture_notes.iter().any(|n| n.contains("GitHub Actions")));
    }

    #[test]
    fn analyze_vue_nuxt_project() {
        let dir = temp_dir();
        let pkg = serde_json::json!({
            "dependencies": {
                "nuxt": "^3.14.0",
                "vue": "^3.5.0",
                "pinia": "^2.3.0"
            }
        });
        std::fs::write(
            dir.path().join("package.json"),
            serde_json::to_string_pretty(&pkg).unwrap(),
        )
        .unwrap();

        let analysis = analyze_project(dir.path());
        assert_eq!(analysis.framework, Some("Nuxt".to_string()));
        assert_eq!(analysis.state_management, Some("Pinia".to_string()));
        assert!(analysis.language.contains("Vue"));
    }

    #[test]
    fn analyze_express_project() {
        let dir = temp_dir();
        let pkg = serde_json::json!({
            "dependencies": {
                "express": "^4.19.0",
                "mongoose": "^8.0.0",
                "passport": "^0.7.0"
            },
            "devDependencies": {
                "jest": "^29.0.0"
            }
        });
        std::fs::write(
            dir.path().join("package.json"),
            serde_json::to_string_pretty(&pkg).unwrap(),
        )
        .unwrap();

        let analysis = analyze_project(dir.path());
        assert_eq!(analysis.framework, Some("Express.js".to_string()));
        assert_eq!(analysis.orm, Some("Mongoose".to_string()));
        assert_eq!(analysis.database, Some("MongoDB (Mongoose)".to_string()));
        assert_eq!(analysis.auth, Some("Passport.js".to_string()));
        assert_eq!(analysis.test_framework, Some("Jest".to_string()));
    }

    #[test]
    fn analyze_svelte_project() {
        let dir = temp_dir();
        let pkg = serde_json::json!({
            "devDependencies": {
                "@sveltejs/kit": "^2.0.0",
                "svelte": "^5.0.0",
                "@playwright/test": "^1.40.0"
            }
        });
        std::fs::write(
            dir.path().join("package.json"),
            serde_json::to_string_pretty(&pkg).unwrap(),
        )
        .unwrap();
        std::fs::create_dir_all(dir.path().join("src/routes")).unwrap();

        let analysis = analyze_project(dir.path());
        assert_eq!(analysis.framework, Some("SvelteKit".to_string()));
        assert_eq!(analysis.router_type, Some("File-based routing".to_string()));
        assert!(analysis.test_framework.as_ref().unwrap().contains("Playwright"));
    }

    // ── generate_claude_md ──

    #[test]
    fn generate_includes_header() {
        let analysis = ProjectAnalysis {
            name: "test-project".to_string(),
            description: None,
            framework: None,
            framework_version: None,
            language: "TypeScript/JavaScript".to_string(),
            router_type: None,
            css_framework: None,
            database: None,
            orm: None,
            auth: None,
            test_framework: None,
            state_management: None,
            deployment: None,
            scripts: vec![],
            env_vars: vec![],
            directory_tree: String::new(),
            key_directories: vec![],
            conventions: vec![],
            architecture_notes: vec![],
            has_monorepo: false,
            package_manager: None,
            ui_library: None,
            key_files: vec![],
        };

        let md = generate_claude_md(&analysis);
        assert!(md.starts_with("# CLAUDE.md — test-project"));
        assert!(md.contains("## What This Is"));
        assert!(md.contains("## Stack"));
    }

    #[test]
    fn generate_includes_framework_with_version() {
        let analysis = ProjectAnalysis {
            name: "app".to_string(),
            description: Some("My app".to_string()),
            framework: Some("Next.js".to_string()),
            framework_version: Some("15.1.0".to_string()),
            language: "TypeScript/JavaScript".to_string(),
            router_type: Some("App Router".to_string()),
            css_framework: Some("Tailwind CSS 4.0".to_string()),
            database: None,
            orm: None,
            auth: None,
            test_framework: Some("Vitest".to_string()),
            state_management: None,
            deployment: Some("Vercel".to_string()),
            scripts: vec![
                ("dev".to_string(), "next dev".to_string()),
                ("build".to_string(), "next build".to_string()),
            ],
            env_vars: vec!["DATABASE_URL".to_string()],
            directory_tree: "src/\n  app/".to_string(),
            key_directories: vec![("src/app".to_string(), "Next.js App Router".to_string())],
            conventions: vec!["TypeScript: strict mode enabled".to_string()],
            architecture_notes: vec!["Next.js App Router with server components".to_string()],
            has_monorepo: false,
            package_manager: Some("pnpm".to_string()),
            ui_library: None,
            key_files: vec![],
        };

        let md = generate_claude_md(&analysis);
        assert!(md.contains("Next.js 15.1.0 (App Router)"));
        assert!(md.contains("Tailwind CSS 4.0"));
        assert!(md.contains("Vitest"));
        assert!(md.contains("Vercel"));
        assert!(md.contains("pnpm"));
        assert!(md.contains("## Commands"));
        assert!(md.contains("## Environment Variables"));
        assert!(md.contains("DATABASE_URL"));
        assert!(md.contains("## Conventions"));
        assert!(md.contains("strict mode"));
        assert!(md.contains("## Architecture Notes"));
    }

    #[test]
    fn generate_omits_empty_sections() {
        let analysis = ProjectAnalysis {
            name: "minimal".to_string(),
            description: None,
            framework: None,
            framework_version: None,
            language: "Rust".to_string(),
            router_type: None,
            css_framework: None,
            database: None,
            orm: None,
            auth: None,
            test_framework: None,
            state_management: None,
            deployment: None,
            scripts: vec![],
            env_vars: vec![],
            directory_tree: String::new(),
            key_directories: vec![],
            conventions: vec![],
            architecture_notes: vec![],
            has_monorepo: false,
            package_manager: None,
            ui_library: None,
            key_files: vec![],
        };

        let md = generate_claude_md(&analysis);
        assert!(!md.contains("## Commands"));
        assert!(!md.contains("## Environment Variables"));
        assert!(!md.contains("## Database"));
        assert!(!md.contains("## Conventions"));
        assert!(!md.contains("## Architecture Notes"));
    }

    #[test]
    fn generate_never_includes_env_values() {
        let analysis = ProjectAnalysis {
            name: "app".to_string(),
            description: None,
            framework: None,
            framework_version: None,
            language: "TypeScript/JavaScript".to_string(),
            router_type: None,
            css_framework: None,
            database: None,
            orm: None,
            auth: None,
            test_framework: None,
            state_management: None,
            deployment: None,
            scripts: vec![],
            env_vars: vec!["SECRET_KEY".to_string(), "DATABASE_URL".to_string()],
            directory_tree: String::new(),
            key_directories: vec![],
            conventions: vec![],
            architecture_notes: vec![],
            has_monorepo: false,
            package_manager: None,
            ui_library: None,
            key_files: vec![],
        };

        let md = generate_claude_md(&analysis);
        assert!(md.contains("`SECRET_KEY`"));
        assert!(md.contains("`DATABASE_URL`"));
        // Should NOT contain any = signs for env values
        assert!(!md.contains("SECRET_KEY="));
        assert!(!md.contains("DATABASE_URL="));
    }

    // ── generate_claude_md_cmd — never overwrite ──

    #[test]
    fn cmd_refuses_overwrite() {
        let dir = temp_dir();
        std::fs::write(dir.path().join("CLAUDE.md"), "# Existing").unwrap();

        let rt = tokio::runtime::Runtime::new().unwrap();
        let result = rt.block_on(generate_claude_md_cmd(
            dir.path().to_string_lossy().to_string(),
        ));

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("already exists"));
        // Verify content wasn't changed
        let content = std::fs::read_to_string(dir.path().join("CLAUDE.md")).unwrap();
        assert_eq!(content, "# Existing");
    }

    #[test]
    fn cmd_creates_new_claude_md() {
        let dir = temp_dir();
        std::fs::write(dir.path().join("package.json"), r#"{"name":"test"}"#).unwrap();

        let rt = tokio::runtime::Runtime::new().unwrap();
        let result = rt.block_on(generate_claude_md_cmd(
            dir.path().to_string_lossy().to_string(),
        ));

        assert!(result.is_ok());
        assert!(dir.path().join("CLAUDE.md").exists());
        let content = std::fs::read_to_string(dir.path().join("CLAUDE.md")).unwrap();
        assert!(content.contains("# CLAUDE.md"));
    }

    #[test]
    fn cmd_rejects_nonexistent_path() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        let result = rt.block_on(generate_claude_md_cmd(
            "/nonexistent/path/that/does/not/exist".to_string(),
        ));
        assert!(result.is_err());
    }

    // ── Makefile targets ──

    #[test]
    fn analyze_makefile_targets() {
        let dir = temp_dir();
        std::fs::write(
            dir.path().join("Makefile"),
            "build:\n\tgo build\n\ntest:\n\tgo test ./...\n\nclean:\n\trm -rf bin/\n",
        )
        .unwrap();

        let analysis = analyze_project(dir.path());
        let make_scripts: Vec<_> = analysis
            .scripts
            .iter()
            .filter(|(n, _)| n.starts_with("make "))
            .collect();
        assert!(make_scripts.len() >= 3);
    }

    // ── CSS framework detection ──

    #[test]
    fn detects_chakra_ui() {
        let dir = temp_dir();
        let pkg = serde_json::json!({
            "dependencies": {
                "react": "19.0.0",
                "@chakra-ui/react": "^3.0.0"
            }
        });
        std::fs::write(
            dir.path().join("package.json"),
            serde_json::to_string_pretty(&pkg).unwrap(),
        )
        .unwrap();

        let analysis = analyze_project(dir.path());
        assert_eq!(analysis.css_framework, Some("Chakra UI".to_string()));
    }

    #[test]
    fn detects_material_ui() {
        let dir = temp_dir();
        let pkg = serde_json::json!({
            "dependencies": {
                "react": "19.0.0",
                "@mui/material": "^6.0.0"
            }
        });
        std::fs::write(
            dir.path().join("package.json"),
            serde_json::to_string_pretty(&pkg).unwrap(),
        )
        .unwrap();

        let analysis = analyze_project(dir.path());
        assert_eq!(analysis.css_framework, Some("Material UI".to_string()));
    }

    // ── shadcn/ui detection ──

    #[test]
    fn detect_shadcn_ui() {
        let dir = temp_dir();
        let pkg = serde_json::json!({
            "dependencies": { "react": "19.0.0" },
            "devDependencies": { "tailwindcss": "4.0.0" }
        });
        std::fs::write(
            dir.path().join("package.json"),
            serde_json::to_string_pretty(&pkg).unwrap(),
        )
        .unwrap();
        std::fs::write(dir.path().join("components.json"), "{}").unwrap();

        let analysis = analyze_project(dir.path());
        assert_eq!(analysis.ui_library, Some("shadcn/ui".to_string()));
        assert!(analysis.architecture_notes.iter().any(|n| n.contains("shadcn/ui")));
    }

    // ── Component name listing ──

    #[test]
    fn describe_directory_lists_names() {
        let dir = temp_dir();
        let comps = dir.path().join("src/components");
        std::fs::create_dir_all(&comps).unwrap();
        std::fs::write(comps.join("Button.tsx"), "").unwrap();
        std::fs::write(comps.join("Modal.tsx"), "").unwrap();
        std::fs::create_dir(comps.join("ui")).unwrap();
        std::fs::write(comps.join("ui/dialog.tsx"), "").unwrap();

        let desc = describe_directory_contents(&comps, 10);
        assert!(desc.contains("Button"), "Should list Button component");
        assert!(desc.contains("Modal"), "Should list Modal component");
        assert!(desc.contains("ui"), "Should list ui subdirectory");
    }

    #[test]
    fn describe_directory_truncates_long_lists() {
        let dir = temp_dir();
        let comps = dir.path().join("src/components");
        std::fs::create_dir_all(&comps).unwrap();
        for i in 0..15 {
            std::fs::write(comps.join(format!("Component{}.tsx", i)), "").unwrap();
        }

        let desc = describe_directory_contents(&comps, 5);
        assert!(desc.contains("and 10 more"), "Should truncate and show 'and N more'");
    }

    #[test]
    fn describe_directory_empty() {
        let dir = temp_dir();
        std::fs::create_dir_all(dir.path().join("empty")).unwrap();

        let desc = describe_directory_contents(&dir.path().join("empty"), 10);
        assert!(desc.is_empty());
    }

    #[test]
    fn describe_directory_strips_extensions() {
        let dir = temp_dir();
        let d = dir.path().join("hooks");
        std::fs::create_dir_all(&d).unwrap();
        std::fs::write(d.join("use-mobile.tsx"), "").unwrap();
        std::fs::write(d.join("use-toast.ts"), "").unwrap();

        let desc = describe_directory_contents(&d, 10);
        assert!(desc.contains("use-mobile"));
        assert!(desc.contains("use-toast"));
        assert!(!desc.contains(".tsx"), "Should strip .tsx extension");
        assert!(!desc.contains(".ts"), "Should strip .ts extension");
    }

    // ── Compound script names ──

    #[test]
    fn infer_build_dev_script() {
        let desc = infer_script_description("build:dev", "vite build --mode development");
        assert!(desc.contains("Development build"));
    }

    #[test]
    fn infer_build_prod_script() {
        assert!(infer_script_description("build:prod", "vite build").contains("Production build"));
    }

    #[test]
    fn infer_build_watch_script() {
        assert!(infer_script_description("build:watch", "tsc -w").contains("watch mode"));
    }

    #[test]
    fn infer_build_analyze_script() {
        assert!(
            infer_script_description("build:analyze", "webpack --analyze")
                .contains("bundle analysis")
        );
    }

    #[test]
    fn infer_test_coverage_script() {
        let desc = infer_script_description("test:coverage", "vitest --coverage");
        assert!(desc.contains("coverage"));
    }

    #[test]
    fn infer_test_watch_script() {
        assert!(
            infer_script_description("test:watch", "vitest --watch").contains("watch mode")
        );
    }

    #[test]
    fn infer_test_ci_script() {
        assert!(infer_script_description("test:ci", "vitest run").contains("CI mode"));
    }

    #[test]
    fn infer_lint_fix_script() {
        let desc = infer_script_description("lint:fix", "eslint --fix .");
        assert!(desc.contains("auto-fix"));
    }

    #[test]
    fn infer_lint_css_script() {
        assert!(
            infer_script_description("lint:css", "stylelint **/*.css").contains("stylesheets")
        );
    }

    #[test]
    fn infer_dev_variant_script() {
        let desc = infer_script_description("dev:debug", "node --inspect");
        assert!(desc.contains("dev server"));
        assert!(desc.contains("debug"));
    }

    #[test]
    fn infer_generate_variant_script() {
        let desc = infer_script_description("generate:types", "openapi-typescript");
        assert!(desc.contains("Generate"));
        assert!(desc.contains("types"));
    }

    #[test]
    fn infer_docker_variant_script() {
        let desc = infer_script_description("docker:build", "docker build .");
        assert!(desc.contains("Docker"));
        assert!(desc.contains("build"));
    }

    #[test]
    fn infer_vite_command() {
        assert!(infer_script_description("x", "vite").contains("Vite dev server"));
    }

    #[test]
    fn infer_vite_build_command() {
        assert!(infer_script_description("x", "vite build").contains("Vite build"));
    }

    #[test]
    fn infer_next_command() {
        assert!(infer_script_description("x", "next dev").contains("Next.js"));
    }

    #[test]
    fn infer_node_command() {
        assert_eq!(infer_script_description("x", "node server.js"), "Run script");
    }

    #[test]
    fn infer_concurrently_command() {
        assert!(
            infer_script_description("x", "concurrently 'vite' 'tsc -w'")
                .contains("multiple tasks")
        );
    }

    // ── Key file detection ──

    #[test]
    fn detect_key_files_ai_provider() {
        let dir = temp_dir();
        std::fs::create_dir_all(dir.path().join("src/lib")).unwrap();
        std::fs::write(dir.path().join("src/lib/ai-providers.ts"), "").unwrap();
        std::fs::write(dir.path().join("src/lib/utils.ts"), "").unwrap();

        let files = detect_key_files(dir.path());
        assert!(files.iter().any(|(p, d)| p.contains("ai-providers") && d.contains("AI")));
        assert!(files.iter().any(|(p, _)| p.contains("utils")));
    }

    #[test]
    fn detect_key_files_schema_detector() {
        let dir = temp_dir();
        std::fs::create_dir_all(dir.path().join("src/lib")).unwrap();
        std::fs::write(dir.path().join("src/lib/schema-detector.ts"), "").unwrap();

        let files = detect_key_files(dir.path());
        assert!(files.iter().any(|(p, d)| p.contains("schema-detector") && d.contains("Schema")));
    }

    #[test]
    fn detect_key_files_known_candidates() {
        let dir = temp_dir();
        std::fs::create_dir_all(dir.path().join("src/lib")).unwrap();
        std::fs::write(dir.path().join("src/lib/prisma.ts"), "").unwrap();
        std::fs::write(dir.path().join("src/lib/auth.ts"), "").unwrap();
        std::fs::write(dir.path().join("src/lib/stripe.ts"), "").unwrap();

        let files = detect_key_files(dir.path());
        assert!(files.iter().any(|(p, _)| p.contains("prisma")));
        assert!(files.iter().any(|(p, _)| p.contains("auth")));
        assert!(files.iter().any(|(p, _)| p.contains("stripe")));
    }

    #[test]
    fn detect_key_files_no_duplicates() {
        let dir = temp_dir();
        std::fs::create_dir_all(dir.path().join("src/lib")).unwrap();
        std::fs::write(dir.path().join("src/lib/utils.ts"), "").unwrap();

        let files = detect_key_files(dir.path());
        let utils_count = files.iter().filter(|(p, _)| p.contains("utils")).count();
        assert_eq!(utils_count, 1, "utils.ts should appear exactly once");
    }

    // ── Router detection ──

    #[test]
    fn detect_tanstack_router() {
        let dir = temp_dir();
        let pkg = serde_json::json!({
            "dependencies": {
                "react": "19.0.0",
                "@tanstack/react-router": "^1.0.0"
            }
        });
        std::fs::write(
            dir.path().join("package.json"),
            serde_json::to_string_pretty(&pkg).unwrap(),
        )
        .unwrap();

        let analysis = analyze_project(dir.path());
        assert!(analysis.router_type.as_ref().unwrap().contains("TanStack"));
    }

    #[test]
    fn detect_react_router_v7() {
        let dir = temp_dir();
        let pkg = serde_json::json!({
            "dependencies": {
                "react": "19.0.0",
                "react-router-dom": "^7.0.0"
            }
        });
        std::fs::write(
            dir.path().join("package.json"),
            serde_json::to_string_pretty(&pkg).unwrap(),
        )
        .unwrap();

        let analysis = analyze_project(dir.path());
        let router = analysis.router_type.as_ref().unwrap();
        assert!(router.contains("React Router"));
        assert!(router.contains("7"));
    }

    #[test]
    fn detect_react_router_plain() {
        let dir = temp_dir();
        let pkg = serde_json::json!({
            "dependencies": {
                "react": "19.0.0",
                "react-router-dom": "^5.0.0"
            }
        });
        std::fs::write(
            dir.path().join("package.json"),
            serde_json::to_string_pretty(&pkg).unwrap(),
        )
        .unwrap();

        let analysis = analyze_project(dir.path());
        assert_eq!(analysis.router_type, Some("React Router".to_string()));
    }

    #[test]
    fn detect_wouter() {
        let dir = temp_dir();
        let pkg = serde_json::json!({
            "dependencies": {
                "react": "19.0.0",
                "wouter": "^3.0.0"
            }
        });
        std::fs::write(
            dir.path().join("package.json"),
            serde_json::to_string_pretty(&pkg).unwrap(),
        )
        .unwrap();

        let analysis = analyze_project(dir.path());
        assert_eq!(analysis.router_type, Some("Wouter".to_string()));
    }

    #[test]
    fn nextjs_router_takes_priority() {
        let dir = temp_dir();
        let pkg = serde_json::json!({
            "dependencies": {
                "next": "15.0.0",
                "react-router-dom": "7.0.0"
            }
        });
        std::fs::write(
            dir.path().join("package.json"),
            serde_json::to_string_pretty(&pkg).unwrap(),
        )
        .unwrap();
        std::fs::create_dir_all(dir.path().join("src/app")).unwrap();

        let analysis = analyze_project(dir.path());
        // Next.js App Router should take priority, not React Router
        assert_eq!(analysis.router_type, Some("App Router".to_string()));
    }

    // ── UI library detection ──

    #[test]
    fn detect_radix_ui() {
        let dir = temp_dir();
        let pkg = serde_json::json!({
            "dependencies": {
                "react": "19.0.0",
                "@radix-ui/react-dialog": "^1.0.0"
            }
        });
        std::fs::write(
            dir.path().join("package.json"),
            serde_json::to_string_pretty(&pkg).unwrap(),
        )
        .unwrap();

        let analysis = analyze_project(dir.path());
        assert_eq!(analysis.ui_library, Some("Radix UI".to_string()));
    }

    #[test]
    fn detect_mantine() {
        let dir = temp_dir();
        let pkg = serde_json::json!({
            "dependencies": {
                "react": "19.0.0",
                "@mantine/core": "^7.0.0"
            }
        });
        std::fs::write(
            dir.path().join("package.json"),
            serde_json::to_string_pretty(&pkg).unwrap(),
        )
        .unwrap();

        let analysis = analyze_project(dir.path());
        assert_eq!(analysis.ui_library, Some("Mantine".to_string()));
    }

    #[test]
    fn detect_ant_design() {
        let dir = temp_dir();
        let pkg = serde_json::json!({
            "dependencies": { "react": "19.0.0", "antd": "^5.0.0" }
        });
        std::fs::write(
            dir.path().join("package.json"),
            serde_json::to_string_pretty(&pkg).unwrap(),
        )
        .unwrap();

        let analysis = analyze_project(dir.path());
        assert_eq!(analysis.ui_library, Some("Ant Design".to_string()));
    }

    #[test]
    fn detect_headless_ui() {
        let dir = temp_dir();
        let pkg = serde_json::json!({
            "dependencies": { "react": "19.0.0", "@headlessui/react": "^2.0.0" }
        });
        std::fs::write(
            dir.path().join("package.json"),
            serde_json::to_string_pretty(&pkg).unwrap(),
        )
        .unwrap();

        let analysis = analyze_project(dir.path());
        assert_eq!(analysis.ui_library, Some("Headless UI".to_string()));
    }

    #[test]
    fn detect_daisyui() {
        let dir = temp_dir();
        let pkg = serde_json::json!({
            "devDependencies": { "daisyui": "^4.0.0", "tailwindcss": "^3.0.0" }
        });
        std::fs::write(
            dir.path().join("package.json"),
            serde_json::to_string_pretty(&pkg).unwrap(),
        )
        .unwrap();

        let analysis = analyze_project(dir.path());
        assert_eq!(analysis.ui_library, Some("daisyUI".to_string()));
    }

    #[test]
    fn shadcn_takes_priority_over_radix() {
        let dir = temp_dir();
        let pkg = serde_json::json!({
            "dependencies": {
                "react": "19.0.0",
                "@radix-ui/react-dialog": "^1.0.0"
            }
        });
        std::fs::write(
            dir.path().join("package.json"),
            serde_json::to_string_pretty(&pkg).unwrap(),
        )
        .unwrap();
        // shadcn/ui projects have components.json AND radix primitives
        std::fs::write(dir.path().join("components.json"), "{}").unwrap();

        let analysis = analyze_project(dir.path());
        assert_eq!(analysis.ui_library, Some("shadcn/ui".to_string()));
    }

    // ── TanStack Query detection ──

    #[test]
    fn detect_tanstack_query() {
        let dir = temp_dir();
        let pkg = serde_json::json!({
            "dependencies": {
                "react": "19.0.0",
                "@tanstack/react-query": "^5.0.0"
            }
        });
        std::fs::write(
            dir.path().join("package.json"),
            serde_json::to_string_pretty(&pkg).unwrap(),
        )
        .unwrap();

        let analysis = analyze_project(dir.path());
        assert!(analysis.architecture_notes.iter().any(|n| n.contains("TanStack Query")));
    }

    // ── Enriched description ──

    #[test]
    fn generate_enriches_short_description() {
        let analysis = ProjectAnalysis {
            name: "app".to_string(),
            description: Some("A translation tool".to_string()),
            framework: Some("React + Vite".to_string()),
            framework_version: None,
            language: "TypeScript/JavaScript".to_string(),
            router_type: None,
            css_framework: None,
            database: None,
            orm: None,
            auth: None,
            test_framework: None,
            state_management: None,
            deployment: None,
            scripts: vec![],
            env_vars: vec![],
            directory_tree: String::new(),
            key_directories: vec![],
            conventions: vec![],
            architecture_notes: vec![],
            has_monorepo: false,
            package_manager: None,
            ui_library: None,
            key_files: vec![],
        };

        let md = generate_claude_md(&analysis);
        assert!(md.contains("A translation tool"));
        assert!(md.contains("Built with React + Vite"));
    }

    #[test]
    fn generate_does_not_enrich_long_description() {
        let long_desc = "This is a very detailed description of the project that is longer than 80 characters and provides enough context already.";
        let analysis = ProjectAnalysis {
            name: "app".to_string(),
            description: Some(long_desc.to_string()),
            framework: Some("Next.js".to_string()),
            framework_version: None,
            language: "TypeScript/JavaScript".to_string(),
            router_type: None,
            css_framework: None,
            database: None,
            orm: None,
            auth: None,
            test_framework: None,
            state_management: None,
            deployment: None,
            scripts: vec![],
            env_vars: vec![],
            directory_tree: String::new(),
            key_directories: vec![],
            conventions: vec![],
            architecture_notes: vec![],
            has_monorepo: false,
            package_manager: None,
            ui_library: None,
            key_files: vec![],
        };

        let md = generate_claude_md(&analysis);
        assert!(md.contains(long_desc));
        assert!(!md.contains("Built with"));
    }

    // ── UI library in output ──

    #[test]
    fn generate_includes_ui_library() {
        let analysis = ProjectAnalysis {
            name: "app".to_string(),
            description: None,
            framework: None,
            framework_version: None,
            language: "TypeScript/JavaScript".to_string(),
            router_type: None,
            css_framework: None,
            database: None,
            orm: None,
            auth: None,
            test_framework: None,
            state_management: None,
            deployment: None,
            scripts: vec![],
            env_vars: vec![],
            directory_tree: String::new(),
            key_directories: vec![],
            conventions: vec![],
            architecture_notes: vec![],
            has_monorepo: false,
            package_manager: None,
            ui_library: Some("shadcn/ui".to_string()),
            key_files: vec![],
        };

        let md = generate_claude_md(&analysis);
        assert!(md.contains("**UI Components:** shadcn/ui"));
    }

    // ── Key files in output ──

    #[test]
    fn generate_includes_key_files() {
        let analysis = ProjectAnalysis {
            name: "app".to_string(),
            description: None,
            framework: None,
            framework_version: None,
            language: "TypeScript/JavaScript".to_string(),
            router_type: None,
            css_framework: None,
            database: None,
            orm: None,
            auth: None,
            test_framework: None,
            state_management: None,
            deployment: None,
            scripts: vec![],
            env_vars: vec![],
            directory_tree: "src/".to_string(),
            key_directories: vec![],
            conventions: vec![],
            architecture_notes: vec![],
            has_monorepo: false,
            package_manager: None,
            ui_library: None,
            key_files: vec![
                ("src/lib/utils.ts".to_string(), "Shared utility functions".to_string()),
                ("src/lib/api.ts".to_string(), "API client".to_string()),
            ],
        };

        let md = generate_claude_md(&analysis);
        assert!(md.contains("Key files:"));
        assert!(md.contains("`src/lib/utils.ts` — Shared utility functions"));
        assert!(md.contains("`src/lib/api.ts` — API client"));
    }

    // ── Full A+ quality test ──

    #[test]
    fn generate_a_plus_quality_vite_react() {
        let dir = temp_dir();
        let pkg = serde_json::json!({
            "name": "lang-flux-translate",
            "description": "Batch translate language files using AI",
            "scripts": {
                "dev": "vite",
                "build": "vite build",
                "build:dev": "vite build --mode development",
                "lint": "eslint .",
                "preview": "vite preview"
            },
            "dependencies": {
                "react": "^18.3.1",
                "react-dom": "^18.3.1"
            },
            "devDependencies": {
                "vite": "^5.4.19",
                "tailwindcss": "^3.4.17"
            }
        });
        std::fs::write(
            dir.path().join("package.json"),
            serde_json::to_string_pretty(&pkg).unwrap(),
        )
        .unwrap();
        std::fs::write(dir.path().join("bun.lockb"), "").unwrap();
        std::fs::write(dir.path().join("components.json"), "{}").unwrap();
        std::fs::write(dir.path().join("eslint.config.js"), "").unwrap();
        std::fs::write(
            dir.path().join("tsconfig.json"),
            r#"{ "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }"#,
        )
        .unwrap();
        std::fs::write(dir.path().join("vite.config.ts"), "").unwrap();

        // Create realistic directory structure
        std::fs::create_dir_all(dir.path().join("src/components")).unwrap();
        std::fs::create_dir_all(dir.path().join("src/hooks")).unwrap();
        std::fs::create_dir_all(dir.path().join("src/lib")).unwrap();
        std::fs::create_dir_all(dir.path().join("src/pages")).unwrap();
        std::fs::write(dir.path().join("src/lib/ai-providers.ts"), "").unwrap();
        std::fs::write(dir.path().join("src/lib/schema-detector.ts"), "").unwrap();
        std::fs::write(dir.path().join("src/lib/utils.ts"), "").unwrap();
        std::fs::write(dir.path().join("src/hooks/use-mobile.tsx"), "").unwrap();
        std::fs::write(dir.path().join("src/hooks/use-toast.ts"), "").unwrap();
        std::fs::write(dir.path().join("src/pages/Index.tsx"), "").unwrap();

        let analysis = analyze_project(dir.path());
        let md = generate_claude_md(&analysis);

        // A+ quality checks
        assert!(md.contains("shadcn/ui"), "Must detect shadcn/ui from components.json");
        assert!(md.contains("bun"), "Must detect bun as package manager");
        assert!(md.contains("React 18.3.1"), "Must include React version");
        assert!(md.contains("Vite 5.4.19"), "Must include Vite version");
        assert!(md.contains("Tailwind CSS 3.4.17"), "Must include Tailwind version");
        assert!(md.contains("ai-providers"), "Must list key lib files by name");
        assert!(md.contains("schema-detector"), "Must list key lib files by name");
        assert!(md.contains("use-mobile"), "Must list hooks by name");
        assert!(md.contains("use-toast"), "Must list hooks by name");
        assert!(md.contains("Development build"), "build:dev must have good description");
        assert!(md.contains("@/*"), "Must detect import aliases");
        // Check for empty inline backtick pairs (`` ` `` ` ``) but not triple backtick fences
        let has_empty_backtick = md
            .lines()
            .any(|line| line.contains("``") && !line.trim().starts_with("```"));
        assert!(!has_empty_backtick, "Must not have empty backtick pairs");
    }

    // ── Key directories show detailed contents ──

    #[test]
    fn key_directories_show_component_names() {
        let dir = temp_dir();
        std::fs::write(dir.path().join("package.json"), "{}").unwrap();
        let comps = dir.path().join("src/components");
        std::fs::create_dir_all(&comps).unwrap();
        std::fs::write(comps.join("Header.tsx"), "").unwrap();
        std::fs::write(comps.join("Footer.tsx"), "").unwrap();
        std::fs::create_dir(comps.join("ui")).unwrap();
        std::fs::write(comps.join("ui/button.tsx"), "").unwrap();

        let analysis = analyze_project(dir.path());
        let comp_dir = analysis
            .key_directories
            .iter()
            .find(|(p, _)| p == "src/components");
        assert!(comp_dir.is_some());
        let desc = &comp_dir.unwrap().1;
        assert!(desc.contains("Header"), "Should list Header by name");
        assert!(desc.contains("Footer"), "Should list Footer by name");
        assert!(desc.contains("ui"), "Should list ui subdirectory");
    }
}
