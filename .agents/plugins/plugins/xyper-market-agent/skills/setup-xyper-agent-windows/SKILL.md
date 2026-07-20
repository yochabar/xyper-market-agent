---
name: setup-xyper-agent-windows
description: "Install, set up, and operate a production Xyper Market participant agent locally on Windows in one guided prompt: install Git and Node.js when approved, create a protected Unit Zero EVM wallet, register and verify X using a local cookie export, monitor campaigns, publish and submit compliant posts, send mandatory approvals, resume interrupted operations, and claim rewards. Use when a Windows user asks to install, create, run, monitor, or operate a Xyper agent without a VPS."
---

# Run Xyper locally on Windows

Use Windows 10/11, PowerShell, production Xyper Market, and Unit Zero Mainnet only. Do not ask the user to configure APIs, RPCs, chains, wallets, Python, Docker, or a VPS.

## Safety

- Store state under `%LOCALAPPDATA%\XyperMarketAgent` with inheritance disabled and access limited to the current Windows user and SYSTEM.
- Never ask the user to paste cookies, mnemonic, or private key into chat.
- Request only the local path to an exported X cookies JSON file.
- Never edit or patch files under `node_modules`; keep compatibility fixes in this skill's bundled source.
- Show the exact tweet before publishing unless automatic posting was explicitly authorized.
- Explain that publishing is public and onchain approval/claim spends UNIT0 gas.
- Reuse state and run `resume` after interruption. Never rotate a wallet implicitly.

## One-prompt setup

### Host preflight

Before cloning the repository, changing plugin configuration, or claiming that installation succeeded:

1. Verify that the local Codex task can launch Windows executables:

   ```powershell
   powershell.exe -NoProfile -Command '$cmd = Join-Path $env:SystemRoot "System32\cmd.exe"; & $cmd /d /c "exit 0"; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }'
   ```

2. If PowerShell or `cmd.exe` cannot launch, report `executable_launch_blocked`. Do not edit `config.toml`, do not attempt marketplace registration, and do not ask the user to keep retrying commands. Tell the user to select **Full access** in the permissions control beneath the composer, restart ChatGPT Desktop, open a new local Codex task, and retry.
3. If executable launch is still blocked, tell the user to set the native Windows sandbox to `elevated` in Codex configuration and restart the app:

   ```toml
   [windows]
   sandbox = "elevated"
   ```

4. Check `winget.exe`, `git.exe`, `node.exe`, and `npm.cmd`. If Git or Node.js is missing but `winget` works, explain exactly what will be installed and request approval before running any installer. If Codex cannot launch `winget` but it works in a normal PowerShell window, the user may run these commands outside ChatGPT:

   ```powershell
   winget install --id Git.Git -e --source winget
   winget install --id OpenJS.NodeJS.LTS -e --source winget
   git --version
   node --version
   npm --version
   ```

   If `winget` is genuinely absent, ask the user to install **App Installer** from Microsoft Store or use the official Git for Windows and Node.js LTS installers. Then restart ChatGPT Desktop and retry.

Work in this skill's `scripts` directory.

1. Run PowerShell bootstrap:

   ```powershell
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\bootstrap.ps1
   ```

2. If it reports `dependencies_missing`, tell the user which dependencies are missing. Request approval to install Git for Windows and/or Node.js LTS with `winget`, then run:

   ```powershell
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\bootstrap.ps1 -InstallDependencies
   ```

3. Run `node .\xyper_agent.mjs setup`.
4. When it returns `registered_needs_cookies`, show the public address and ask one question: the absolute Windows path to an exported JSON file containing all cookies for `https://x.com`.
5. Tell the user to provide the path only, never cookie contents.
6. Validate and import the export locally without contacting X:

   ```powershell
   node .\xyper_agent.mjs cookies-check --cookies-file "C:\Users\User\Downloads\x-cookies.json"
   ```

   `status: "cookies_ready"` means the required, unexpired cookies were imported. It does not publish a post and it must not be replaced with the deprecated Twitter `verify_credentials` check.
7. State that one public verification post will be published, then run:

   ```powershell
   node .\xyper_agent.mjs setup --allow-post
   ```

8. Treat setup as complete only at `status: "verified"`. Then run `node .\xyper_agent.mjs monitor`.
9. After setup, tell the user they can return the desktop permissions control from **Full access** to **Ask for approval** for routine operation.

## Campaign operations

```powershell
node .\xyper_agent.mjs monitor
node .\xyper_agent.mjs show --campaign-id ID
node .\xyper_agent.mjs join --campaign-id ID
```

Generate a tweet from the full campaign response. Keep it within 280 characters and preserve every required hashtag, mention, phrase, URL, language, and disclosure. Do not invent claims. Show it before publishing unless pre-authorized.

Publish, submit, and approve atomically:

```powershell
node .\xyper_agent.mjs publish --campaign-id ID --text "FINAL TWEET" --allow-post --allow-onchain
```

If interrupted, run:

```powershell
node .\xyper_agent.mjs resume --allow-onchain
```

Claim rewards:

```powershell
node .\xyper_agent.mjs claim --submission-id ID --allow-onchain
node .\xyper_agent.mjs claim-all --allow-onchain
```

For recurring monitoring, use the host's scheduler/automation to invoke `monitor`. Do not keep a foreground PowerShell loop running. Require separate authorization before automatic posts or transactions.

## Recovery

- `executable_launch_blocked`: change the desktop task to **Full access**, restart ChatGPT Desktop, and retry in a new local task. If it persists, configure `[windows] sandbox = "elevated"` and restart. Do not modify plugin configuration while this condition remains.
- `dependencies_missing`: approve bootstrap with `-InstallDependencies`.
- `winget_missing`: install **App Installer** from Microsoft Store, or use the official Git for Windows and Node.js LTS installers outside ChatGPT. Verify `git --version`, `node --version`, and `npm --version`, restart ChatGPT Desktop, and retry.
- `wallet_needs_unit0`: fund the returned public address and retry.
- `cookies_missing_required_cookie:*` or `cookies_required_cookie_expired:*`: ask for one fresh local cookie export path.
- `x_cookie_session_rejected:http_401_during_post`: X rejected the actual publish request; ask for one fresh export from the currently signed-in browser session.
- `x_post_forbidden:http_403`: report that X refused the publish request; do not assume another cookie export will fix an account restriction.
- `xyper_service_unavailable:http_5xx`: report a temporary Xyper/Cloudflare outage, preserve the wallet, session, and imported cookies, and retry later. Never blame the cookie file or request repeated exports for this error.
- `operation_pending`: use `resume`.
- Pending validation: run `monitor` later.

Read `references/api.md` only for API debugging.
