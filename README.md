# Xyper Market Agent

A local Codex plugin for setting up and operating a Xyper Market participant
agent on Windows or macOS. It creates or reuses a protected Unit Zero EVM
wallet, detects an X account already verified in Xyper, otherwise verifies X
from a local cookie export, monitors campaigns, publishes and submits compliant
posts, and claims rewards.

Wallet material, X cookies, and Xyper credentials stay on the user's computer.
The agent uses Xyper Market production and Unit Zero only.

## One-prompt setup on Windows

Install [ChatGPT Desktop](https://chatgpt.com/download/), select **Codex**, open
any local folder, select **Full access** in the permissions control for the
initial installation, and send this single prompt:

```text
Set up Xyper Market Agent on this Windows computer from
https://github.com/yochabar/xyper-market-agent.

Before changing plugin configuration or cloning anything, verify that this
local Codex task can launch powershell.exe and cmd.exe. If executable launch is
blocked, do not edit config.toml or claim that the plugin is installed. Tell me
to select Full access, restart ChatGPT Desktop, and retry in a new local task.
If it remains blocked, guide me to configure [windows] sandbox = "elevated"
and restart the app.

Check winget.exe, git.exe, node.exe, and npm.cmd. If Git for Windows or Node.js
LTS is missing and winget works, tell me exactly what will be installed and ask
for approval before installing it. If winget is unavailable, give me the
manual installation steps and wait for me to restart ChatGPT Desktop.

Register that repository as a Codex plugin marketplace and install the
xyper-market-agent plugin. Then use its setup-xyper-agent-windows skill in this
same task. If a newly installed skill is not loaded yet, clone the repository to
a temporary folder, read
.agents/plugins/plugins/xyper-market-agent/skills/setup-xyper-agent-windows/SKILL.md,
and follow it directly without asking me to start another chat.

Install required local dependencies after asking for approval, create a
protected Unit Zero EVM wallet, register my Xyper Market account, and guide me
through X verification. First ask whether I already have a verified X account
in Xyper; if I do, use the protective existing-account flow and do not publish
another verification post. Ask only for the local path to my exported x.com
cookies JSON file; never ask me to paste cookies, a mnemonic, or a private key
into chat. Continue until the Xyper account is verified, then show active
campaigns and rewards.
```

Codex will perform the technical setup. The user still needs to approve local
commands, export an `x.com` cookies JSON file, provide its local path, safely
back up the generated wallet, and fund its public address with enough UNIT0 for
gas. Those security-sensitive steps are intentionally not silent.

If the executable preflight remains blocked, install the dependencies from a
normal PowerShell window outside ChatGPT:

```powershell
winget install --id Git.Git -e --source winget
winget install --id OpenJS.NodeJS.LTS -e --source winget
```

Then verify `git --version`, `node --version`, and `npm --version`, restart
ChatGPT Desktop, select Full access, and run the setup prompt again. Native
Windows Codex should use the recommended elevated sandbox when available:

```toml
[windows]
sandbox = "elevated"
```

After the initial setup succeeds, the user can switch the desktop permissions
control back to **Ask for approval** for routine operation.

## One-prompt setup on macOS

Install [ChatGPT Desktop](https://chatgpt.com/download/), select **Codex**, open
any local folder, and send this prompt:

```text
Set up Xyper Market Agent on this macOS computer from
https://github.com/yochabar/xyper-market-agent.

Register that repository as a Codex plugin marketplace and install the
xyper-market-agent plugin. Then use its setup-xyper-agent skill in this same
task. If a newly installed skill is not loaded yet, clone the repository to a
temporary folder, read
.agents/plugins/plugins/xyper-market-agent/skills/setup-xyper-agent/SKILL.md,
and follow it directly without asking me to start another chat.

Install required local dependencies after asking for approval, including a
local portable Node.js runtime when needed. Do not require Homebrew, sudo,
Python, Docker, or a VPS. Create a protected Unit Zero EVM wallet, register my
Xyper Market account, and guide me through X verification. First ask whether I
already have a verified X account in Xyper; if I do, use the protective
existing-account flow and do not publish another verification post. Ask only
for the local path to my exported x.com cookies JSON file; never ask me to paste
cookies, a mnemonic, or a private key into chat. Continue until the account is
verified, then show active campaigns and rewards.
```

The portable Node.js runtime is downloaded from `nodejs.org`, verified against
the published SHA-256 checksum, and stored inside the private local agent
directory. An existing compatible Node.js installation is reused.

## Manual plugin installation

```text
codex plugin marketplace add yochabar/xyper-market-agent
codex plugin add xyper-market-agent@xyper-market
```

### Update an existing installation

```text
codex plugin marketplace upgrade xyper-market
codex plugin add xyper-market-agent@xyper-market
```

The update reuses the existing local wallet, Xyper registration, and private
state. Setup now checks Xyper's authenticated profile first: an X account already
linked to that Xyper user is reused without requesting cookies or publishing a
new proof post. If the expected X link belongs to another wallet, setup stops
before generating or registering a replacement wallet, importing cookies, or
posting. The user must restore the dedicated managed-wallet state associated
with that Xyper identity; the plugin cannot silently transfer an X link between
wallets. Cookie exports are now checked locally for the required unexpired
`auth_token` and `ct0` cookies. A temporary Xyper or Cloudflare 5xx response is
reported as a service outage and no longer causes repeated cookie-export
requests. X publishing no longer uses the deprecated
`agent-twitter-client@0.0.18`: the bundled client uses the current signed-in
`OAuth2Session` cookie flow and refreshes X's rotating `CreateTweet` query ID.
The plugin never modifies installed files under `node_modules`.

Start a new Codex task after manual installation and ask on Windows:

```text
Use $setup-xyper-agent-windows to set up my local Xyper Market agent.
```

Or on macOS:

```text
Use $setup-xyper-agent to set up my local Xyper Market agent on macOS.
```

## Repository layout

- `.agents/plugins/marketplace.json` — Codex marketplace catalog.
- `.agents/plugins/plugins/xyper-market-agent` — plugin manifest and skills.
- `setup-xyper-agent-windows` — one-prompt Windows workflow.
- `setup-xyper-agent` — one-prompt macOS workflow with portable Node.js.

## Security

- Never paste wallet secrets or X cookies into a chat.
- Review the exact public post before publishing unless automation was
  explicitly authorized.
- Onchain approval and reward claims spend UNIT0 gas.
- Keep the generated state directory private and back up the wallet securely.
