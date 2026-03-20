# CodeMantis — Release Pipeline & Auto-Update: Complete Setup Guide

**Purpose:** Step-by-step specification for setting up GitHub Actions CI/CD, signed builds, and in-app auto-updates for CodeMantis. Every step, every file, every command, in exact sequence.
**Date:** March 2026
**Target:** macOS only (universal binary: Intel + Apple Silicon)
**Prerequisites:** GitHub repository at `codemantis-dev/codemantis` (private OK), project at `/Users/hr/Dev_Projects/Claude-Forge`

---

## Table of Contents

1. How It All Fits Together (Overview)
2. Step 1: Generate Signing Keys (Your Mac, One Time)
3. Step 2: Store Secrets in GitHub (GitHub.com, One Time)
4. Step 3: Install the Updater Plugin (Project Code)
5. Step 4: Configure tauri.conf.json (Project Code)
6. Step 5: Add Capability Permissions (Project Code)
7. Step 6: Register the Plugin in Rust (Project Code)
8. Step 7: Build the Frontend Update UI (Project Code)
9. Step 8: Add Database Backup Before Migrations (Project Code)
10. Step 9: Create the GitHub Actions Workflow (Project Code)
11. Step 10: The Release Process (Every Time You Ship)
12. Step 11: Test the Full Flow
13. Troubleshooting
14. Reference: File Change Summary

---

## 1. How It All Fits Together

Here's the complete picture before we start:

```
YOU (on your Mac)
  │
  │  1. Write code, bump version
  │  2. git tag v1.0.0 && git push --tags
  │
  ▼
GITHUB ACTIONS (in the cloud)
  │
  │  3. Checks out your code
  │  4. Installs Rust + Node + pnpm
  │  5. Runs: pnpm tauri build
  │  6. Signs the .dmg with your private key
  │  7. Generates latest.json (version + download URL + signature)
  │  8. Creates a GitHub Release with .dmg + latest.json attached
  │
  ▼
GITHUB RELEASES (public download page)
  │
  │  Contains:
  │  - CodeMantis_1.0.0_universal.dmg (the installer)
  │  - CodeMantis.app.tar.gz (the update bundle)
  │  - CodeMantis.app.tar.gz.sig (the signature)
  │  - latest.json (version manifest)
  │
  ▼
USER'S INSTALLED CODEMANTIS
  │
  │  On app launch:
  │  9. Checks https://github.com/.../releases/latest/download/latest.json
  │  10. Compares version in latest.json to current app version
  │  11. If newer: shows "Update available" notification
  │  12. User clicks "Update" → downloads + verifies signature + installs
  │  13. App restarts with new version
  │  14. New version runs migrations on existing database → data preserved
```

**What stays safe during updates:**
- SQLite database at `~/Library/Application Support/dev.codemantis.app/`
- Settings JSON at the same location
- Any project-level data (docs/specs/ files, CLAUDE.md, etc.)
- Terminal history, spec conversations, everything in the database

**What gets replaced:**
- The `.app` bundle in `/Applications/` — and nothing else

---

## 2. Step 1: Generate Signing Keys

**Where:** Your Mac terminal
**When:** One time only (keep the keys forever)

The updater uses Ed25519 signatures to verify that updates come from you and haven't been tampered with. You need a key pair: a private key (secret, signs builds) and a public key (embedded in the app, verifies downloads).

### 2.1 Run the key generator

```bash
cd /Users/hr/Dev_Projects/Claude-Forge

# Generate signing key pair
pnpm tauri signer generate -w ~/.tauri/codemantis.key
```

This will prompt you:
```
Please enter a password to protect the secret key:
```

Choose a strong password and **save it in your password manager** (Bitwarden, 1Password, etc.). You will need this password every time you build a release.

### 2.2 What was created

Two files:
- `~/.tauri/codemantis.key` — **PRIVATE KEY** (never share, never commit)
- `~/.tauri/codemantis.key.pub` — **PUBLIC KEY** (safe to share, goes in tauri.conf.json)

### 2.3 Read your public key

```bash
cat ~/.tauri/codemantis.key.pub
```

Output looks like:
```
dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDEy...
```

**Copy this entire string.** You'll need it in Step 4.

### 2.4 Read your private key

```bash
cat ~/.tauri/codemantis.key
```

**Copy this entire string.** You'll need it in Step 2 (GitHub Secrets).

### 2.5 Safety checklist

- [ ] Private key saved in password manager (the content of `~/.tauri/codemantis.key`)
- [ ] Password saved in password manager
- [ ] Public key noted for Step 4
- [ ] `~/.tauri/` is NOT inside the project directory (it shouldn't be — it's in your home folder)
- [ ] `.tauri/` is NOT in any git repository

---

## 3. Step 2: Store Secrets in GitHub

**Where:** github.com → your repository → Settings → Secrets
**When:** One time only

GitHub Actions needs your private key and password to sign builds. These are stored as encrypted secrets that only the CI workflow can access.

### 3.1 Navigate to repository secrets

1. Go to `https://github.com/codemantis-dev/codemantis` (or wherever your repo is)
2. Click **Settings** tab (top nav)
3. Left sidebar: **Secrets and variables** → **Actions**
4. Click **New repository secret**

### 3.2 Add the signing key secret

- **Name:** `TAURI_SIGNING_PRIVATE_KEY`
- **Value:** Paste the ENTIRE content of `~/.tauri/codemantis.key` (the private key file)
- Click **Add secret**

### 3.3 Add the password secret

- **Name:** `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
- **Value:** The password you chose in Step 1
- Click **Add secret**

### 3.4 Verify

You should now see two secrets listed:
- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

These are encrypted — nobody can read them, not even repository admins. They're only available to GitHub Actions workflows.

---

## 4. Step 3: Install the Updater Plugin

**Where:** Your project (`/Users/hr/Dev_Projects/Claude-Forge`)
**When:** One time

### 4.1 Install Rust dependency

```bash
cd /Users/hr/Dev_Projects/Claude-Forge/src-tauri

cargo add tauri-plugin-updater --target 'cfg(any(target_os = "macos", windows, target_os = "linux"))'
cargo add tauri-plugin-process
```

This adds to your `Cargo.toml`:
```toml
[target."cfg(any(target_os = \"macos\", windows, target_os = \"linux\"))".dependencies]
tauri-plugin-updater = "2"

[dependencies]
tauri-plugin-process = "2"
```

### 4.2 Install JavaScript dependency

```bash
cd /Users/hr/Dev_Projects/Claude-Forge

pnpm add @tauri-apps/plugin-updater @tauri-apps/plugin-process
```

---

## 5. Step 4: Configure tauri.conf.json

**Where:** `src-tauri/tauri.conf.json`
**What:** Add the updater configuration with your public key and the GitHub Releases endpoint

### 5.1 Add the plugins section

Find your existing `tauri.conf.json`. Add a `"plugins"` section at the top level (if it doesn't exist), and within it add the `"updater"` configuration:

```json
{
  "plugins": {
    "updater": {
      "endpoints": [
        "https://github.com/codemantis-dev/codemantis/releases/latest/download/latest.json"
      ],
      "pubkey": "PASTE_YOUR_PUBLIC_KEY_HERE"
    }
  }
}
```

**Replace `PASTE_YOUR_PUBLIC_KEY_HERE`** with the content of `~/.tauri/codemantis.key.pub` (from Step 1.3).

**Replace the GitHub URL** if your repository has a different owner or name.

### 5.2 Also add: createUpdaterArtifacts

In the `"bundle"` section of `tauri.conf.json`, add:

```json
{
  "bundle": {
    "createUpdaterArtifacts": true
  }
}
```

This tells Tauri to generate the `.tar.gz` update bundle and `.sig` signature file alongside the normal `.dmg` during builds.

### 5.3 Full example of what to add

Your `tauri.conf.json` already has many settings. You're adding/modifying these specific keys:

```json
{
  "$schema": "...",
  "productName": "CodeMantis",
  "version": "0.5.3",
  "identifier": "dev.codemantis.app",
  "build": { ... },
  "app": { ... },
  "bundle": {
    "createUpdaterArtifacts": true,
    ...existing bundle config...
  },
  "plugins": {
    "updater": {
      "endpoints": [
        "https://github.com/codemantis-dev/codemantis/releases/latest/download/latest.json"
      ],
      "pubkey": "dW50cnVzdGVkIGNvbW1lbnQ6IG1pb..."
    }
  }
}
```

---

## 6. Step 5: Add Capability Permissions

**Where:** `src-tauri/capabilities/default.json`
**What:** Allow the app to check for updates and restart

Add these permissions to the existing `permissions` array:

```json
{
  "permissions": [
    ...existing permissions...,
    "updater:default",
    "process:allow-restart"
  ]
}
```

`updater:default` covers: checking for updates, downloading, and installing.
`process:allow-restart` allows the app to relaunch itself after installing an update.

---

## 7. Step 6: Register the Plugin in Rust

**Where:** `src-tauri/src/lib.rs`
**What:** Initialize the updater and process plugins when the app starts

Find the `tauri::Builder::default()` chain in your `lib.rs`. Add the two plugins:

```rust
// Add these imports at the top of the file (if not already present)
// The updater plugin is conditional — only on desktop platforms

tauri::Builder::default()
    .setup(|app| {
        #[cfg(desktop)]
        app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
        
        // ... your existing .setup() code ...
        
        Ok(())
    })
    .plugin(tauri_plugin_process::init())
    // ... rest of your builder chain ...
```

**IMPORTANT:** The updater plugin is registered inside `.setup()` using `app.handle().plugin()`, NOT as a top-level `.plugin()` call. This is because it needs the app handle for configuration. The process plugin is a normal `.plugin()` call.

If you already have a `.setup()` closure, add the updater registration inside it. Don't create a second `.setup()`.

---

## 8. Step 7: Build the Frontend Update UI

**Where:** New file `src/components/shared/UpdateNotification.tsx` + integration into `AppShell.tsx`
**What:** Check for updates on launch, show a notification, let the user install

### 8.1 Create the update checking component

Create `src/components/shared/UpdateNotification.tsx`:

```typescript
import { useEffect, useState } from "react";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { Download, X, Loader2 } from "lucide-react";

export default function UpdateNotification() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updateVersion, setUpdateVersion] = useState("");
  const [updateNotes, setUpdateNotes] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Store the update object so we can install it later
  const [update, setUpdate] = useState<Awaited<ReturnType<typeof check>> | null>(null);

  useEffect(() => {
    // Check for updates 5 seconds after launch (don't block startup)
    const timer = setTimeout(async () => {
      try {
        const result = await check();
        if (result) {
          setUpdate(result);
          setUpdateAvailable(true);
          setUpdateVersion(result.version);
          setUpdateNotes(result.body ?? "");
        }
      } catch (e) {
        // Silently fail — update check is not critical
        console.warn("[updater] Check failed:", e);
      }
    }, 5000);

    return () => clearTimeout(timer);
  }, []);

  const handleUpdate = async () => {
    if (!update) return;
    setDownloading(true);
    setError(null);
    try {
      await update.downloadAndInstall();
      await relaunch();
    } catch (e) {
      setError(`Update failed: ${e}`);
      setDownloading(false);
    }
  };

  if (!updateAvailable || dismissed) return null;

  return (
    <div
      className="flex items-center gap-3 px-4 py-2 text-xs"
      style={{
        background: "var(--accent-dim)",
        borderBottom: "1px solid var(--border)",
        color: "var(--text-primary)",
      }}
    >
      <Download size={14} style={{ color: "var(--accent)" }} />
      <span>
        <strong>CodeMantis {updateVersion}</strong> is available.
        {updateNotes && (
          <span style={{ color: "var(--text-secondary)" }}>
            {" "}{updateNotes.slice(0, 100)}{updateNotes.length > 100 ? "..." : ""}
          </span>
        )}
      </span>

      {error && (
        <span style={{ color: "var(--red)" }}>{error}</span>
      )}

      <div className="ml-auto flex items-center gap-2">
        <button
          onClick={handleUpdate}
          disabled={downloading}
          className="flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium"
          style={{
            background: "var(--accent)",
            color: "white",
            opacity: downloading ? 0.6 : 1,
          }}
        >
          {downloading ? (
            <>
              <Loader2 size={12} className="animate-spin" />
              Installing...
            </>
          ) : (
            "Update Now"
          )}
        </button>
        <button
          onClick={() => setDismissed(true)}
          className="p-1 rounded hover:opacity-70"
          style={{ color: "var(--text-ghost)" }}
          title="Dismiss"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
```

### 8.2 Add it to your layout

In `src/components/layout/AppShell.tsx`, import and render `UpdateNotification` at the top of the app, below the title bar:

```typescript
import UpdateNotification from "../shared/UpdateNotification";

// Inside the component's JSX, right after the TitleBar:
<TitleBar ... />
<UpdateNotification />
<div className="flex flex-1 ..."> {/* existing three-panel layout */}
```

### 8.3 Optional: Add "Check for Updates" to Settings

In your Settings modal, add a button that manually triggers an update check:

```typescript
import { check } from "@tauri-apps/plugin-updater";

const handleCheckUpdates = async () => {
  try {
    const result = await check();
    if (result) {
      showToast(`Update available: v${result.version}`, "info");
    } else {
      showToast("You're on the latest version!", "success");
    }
  } catch (e) {
    showToast(`Update check failed: ${e}`, "error");
  }
};
```

---

## 9. Step 8: Add Database Backup Before Migrations

**Where:** Your migration runner in `src-tauri/src/storage/` (wherever migrations are run)
**What:** Copy the database file before any schema changes

### 9.1 Add backup logic

Before running any migrations on app startup, add:

```rust
use std::fs;
use std::path::PathBuf;

fn backup_database(app_data_dir: &PathBuf) {
    let db_path = app_data_dir.join("sessions.db");
    let backup_path = app_data_dir.join("sessions.db.backup");
    
    if db_path.exists() {
        match fs::copy(&db_path, &backup_path) {
            Ok(_) => log::info!("[storage] Database backed up before migration"),
            Err(e) => log::warn!("[storage] Failed to backup database: {}", e),
        }
    }
}
```

Call `backup_database()` BEFORE the migration loop runs. This way, if a migration crashes, the user can recover by renaming the backup file.

### 9.2 Migration rules (existing — keep following these)

- Every schema change goes through a numbered migration
- Migrations run sequentially on startup
- Never use "drop table and recreate" — always `ALTER TABLE` or create new tables
- Test migrations with a copy of a real database from a previous version

---

## 10. Step 9: Create the GitHub Actions Workflow

**Where:** `.github/workflows/release.yml`
**What:** The complete workflow that builds, signs, and publishes releases

### 10.1 Create or replace the workflow file

Create `.github/workflows/release.yml` with this content:

```yaml
name: Release

on:
  push:
    tags:
      - 'v*'   # Trigger on version tags: v1.0.0, v1.1.0, etc.

# Ensure only one release workflow runs at a time
concurrency:
  group: release-${{ github.ref }}
  cancel-in-progress: true

jobs:
  build-and-release:
    runs-on: macos-latest    # macOS runner for universal binary
    
    permissions:
      contents: write        # Needed to create GitHub Releases
    
    steps:
      # 1. Check out the code
      - name: Checkout repository
        uses: actions/checkout@v4

      # 2. Set up Node.js
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 'lts/*'

      # 3. Set up pnpm
      - name: Setup pnpm
        uses: pnpm/action-setup@v4
        with:
          version: latest

      # 4. Install Rust (stable)
      - name: Setup Rust
        uses: dtolnay/rust-toolchain@stable
        with:
          # Both targets for universal macOS binary
          targets: aarch64-apple-darwin,x86_64-apple-darwin

      # 5. Cache Rust dependencies (speeds up builds significantly)
      - name: Cache Rust
        uses: swatinem/rust-cache@v2
        with:
          workspaces: './src-tauri -> target'

      # 6. Install frontend dependencies
      - name: Install frontend dependencies
        run: pnpm install

      # 7. Build the Tauri app and create the GitHub Release
      - name: Build and release
        uses: tauri-apps/tauri-action@v0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
        with:
          # Build universal macOS binary (Intel + Apple Silicon)
          args: '--target universal-apple-darwin'
          
          # Tag and release naming
          tagName: ${{ github.ref_name }}              # Use the tag name as-is (e.g., v1.0.0)
          releaseName: 'CodeMantis ${{ github.ref_name }}'    # e.g., "CodeMantis v1.0.0"
          releaseBody: 'See RELEASES.md for what changed in this version.'
          
          # Create as draft first so you can review before publishing
          releaseDraft: true
          prerelease: false
          
          # Generate the latest.json file for the auto-updater
          includeUpdaterJson: true
```

### 10.2 What this workflow does

When you push a tag like `v1.0.0`:

1. **Checks out** your code on a macOS runner
2. **Installs** Node.js, pnpm, Rust with both Apple Silicon and Intel targets
3. **Caches** Rust dependencies (first build: ~15 min, subsequent: ~5 min)
4. **Runs** `pnpm install` for frontend deps
5. **Builds** the app with `pnpm tauri build --target universal-apple-darwin`
6. **Signs** the update bundle with your private key (from GitHub Secrets)
7. **Generates** `latest.json` containing:
   ```json
   {
     "version": "1.0.0",
     "platforms": {
       "darwin-universal": {
         "url": "https://github.com/codemantis-dev/codemantis/releases/download/v1.0.0/CodeMantis.app.tar.gz",
         "signature": "dW50cnVzdGVkIGNvbW1lbnQ6..."
       }
     }
   }
   ```
8. **Creates** a draft GitHub Release with all artifacts attached

### 10.3 Why draft releases?

The workflow creates a **draft** release (not published). This gives you a chance to:
- Review the artifacts
- Edit the release notes
- Test the `.dmg` by downloading it manually
- Publish when you're confident everything is correct

Once you click "Publish" on the draft, the `latest.json` becomes accessible at the endpoint URL, and all users' apps will detect the update on their next check.

---

## 11. Step 10: The Release Process (Every Time You Ship)

### 11.1 Before you start

- [ ] All changes committed
- [ ] `pnpm tsc --noEmit` passes
- [ ] `pnpm test` passes
- [ ] App runs correctly in dev mode (`pnpm tauri dev`)

### 11.2 Bump the version

Update the version in ALL THREE locations (they must match):

```bash
# 1. package.json → "version": "1.0.0"
# 2. src-tauri/Cargo.toml → version = "1.0.0"
# 3. src-tauri/tauri.conf.json → "version": "1.0.0"
```

### 11.3 Update RELEASES.md

Add an entry at the top of `RELEASES.md`:

```markdown
## 1.0.0

- First public release
- SpecWriter with interactive AI conversation
- ...
```

### 11.4 Commit and tag

```bash
git add -A
git commit -m "release: v1.0.0"
git tag v1.0.0
git push origin main --tags
```

### 11.5 Wait for GitHub Actions

1. Go to your repo → **Actions** tab
2. You'll see the "Release" workflow running
3. Wait for it to complete (~10-15 min first time, ~5 min with cache)

### 11.6 Review and publish

1. Go to your repo → **Releases** tab
2. You'll see a **draft** release for v1.0.0
3. Download the `.dmg` and test it manually if this is your first release
4. Edit the release notes if needed (or leave the RELEASES.md reference)
5. Click **Publish release**

### 11.7 Done

- Users' installed CodeMantis apps will detect the update within 24 hours (on their next launch)
- New users can download the `.dmg` from the Releases page
- The `latest.json` endpoint now serves the new version

---

## 12. Step 11: Test the Full Flow

### 12.1 First time: test with two versions

1. **Build v0.9.0 locally** (set version to 0.9.0 in all three files):
   ```bash
   TAURI_SIGNING_PRIVATE_KEY=$(cat ~/.tauri/codemantis.key) \
   TAURI_SIGNING_PRIVATE_KEY_PASSWORD="your-password" \
   pnpm tauri build --target universal-apple-darwin
   ```
   Install the resulting `.dmg`.

2. **Push v1.0.0 to GitHub** (set version to 1.0.0):
   Follow Steps 11.2–11.6 above. Publish the release.

3. **Open the installed v0.9.0 app.** Within 5 seconds, you should see the update notification: "CodeMantis v1.0.0 is available."

4. **Click "Update Now."** The app should download, install, and restart. After restart, verify the version in Settings or the welcome screen shows 1.0.0.

5. **Verify data survived:** Check that sessions, specs, settings, and themes are all intact after the update.

### 12.2 What to check

- [ ] Update notification appears with correct version number
- [ ] "Update Now" shows downloading/installing progress
- [ ] App restarts automatically after install
- [ ] New version number displayed correctly after restart
- [ ] All existing sessions still present
- [ ] All saved specs still in docs/specs/
- [ ] Settings (theme, font size, API keys) preserved
- [ ] Terminal and chat history intact
- [ ] No database errors in the console

---

## 13. Troubleshooting

### "Update check failed" or no notification

- Verify the endpoint URL in `tauri.conf.json` matches your GitHub repo exactly
- Verify the release is **published** (not still a draft)
- Verify `latest.json` is attached to the release (check the release assets list)
- Test the URL manually: `curl -L https://github.com/codemantis-dev/codemantis/releases/latest/download/latest.json`

### "Signature verification failed"

- The public key in `tauri.conf.json` must match the private key used to sign the build
- If you regenerate keys, ALL existing installations become unable to auto-update (they have the old public key)
- Never regenerate keys unless absolutely necessary

### GitHub Actions build fails

- Check the Actions log for the specific error
- Most common: Rust compilation errors that don't occur locally (different OS, missing feature flags)
- Ensure your `Cargo.toml` doesn't have macOS-only dependencies without cfg guards

### Build works locally but not in CI

- CI uses `macos-latest` which may be a different macOS version than yours
- Ensure all Rust crate features are explicitly specified (don't rely on default features that might differ)
- Check that `pnpm install` doesn't have postinstall scripts that fail in CI

### The .dmg is not signed (Gatekeeper warning)

- The updater signing (Ed25519) is different from Apple code signing
- For Gatekeeper: you need an Apple Developer ID certificate ($99/year)
- For personal use, users can right-click → Open to bypass Gatekeeper
- To add Apple signing later, see: https://v2.tauri.app/distribute/sign/macos/

### Database migration fails after update

- The backup file (`sessions.db.backup`) preserves the pre-update database
- Users can recover by: quit app, rename `sessions.db.backup` to `sessions.db`, reopen
- Fix the migration bug, release a patch version

---

## 14. Reference: File Change Summary

### New files

| File | Purpose |
|------|---------|
| `~/.tauri/codemantis.key` | Private signing key (NOT in repo) |
| `~/.tauri/codemantis.key.pub` | Public signing key (value goes in tauri.conf.json) |
| `.github/workflows/release.yml` | GitHub Actions release workflow |
| `src/components/shared/UpdateNotification.tsx` | In-app update notification banner |

### Modified files

| File | Change |
|------|--------|
| `src-tauri/Cargo.toml` | Add `tauri-plugin-updater`, `tauri-plugin-process` dependencies |
| `package.json` | Add `@tauri-apps/plugin-updater`, `@tauri-apps/plugin-process` |
| `src-tauri/tauri.conf.json` | Add `plugins.updater` config with endpoint + pubkey; add `bundle.createUpdaterArtifacts: true` |
| `src-tauri/capabilities/default.json` | Add `"updater:default"`, `"process:allow-restart"` permissions |
| `src-tauri/src/lib.rs` | Register updater and process plugins |
| `src/components/layout/AppShell.tsx` | Import and render `UpdateNotification` |
| Storage migration file | Add database backup before migrations |

### GitHub Secrets to add

| Secret name | Value |
|------------|-------|
| `TAURI_SIGNING_PRIVATE_KEY` | Content of `~/.tauri/codemantis.key` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | The password you chose during key generation |

### Sequence summary

```
Step 1:  Generate keys         (your Mac, one time)
Step 2:  GitHub secrets        (github.com, one time)
Step 3:  Install plugins       (Cargo.toml + package.json)
Step 4:  Configure updater     (tauri.conf.json)
Step 5:  Add permissions       (capabilities/default.json)
Step 6:  Register in Rust      (lib.rs)
Step 7:  Update UI             (UpdateNotification.tsx + AppShell.tsx)
Step 8:  Database backup       (storage/migrations)
Step 9:  Create workflow        (.github/workflows/release.yml)
Step 10: Release!              (tag + push + publish)
Step 11: Test                  (verify update + data safety)
```
