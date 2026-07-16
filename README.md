# Xyper Market Agent

A local Codex plugin for setting up and operating a Xyper Market participant
agent on Windows or macOS. It creates a protected Unit Zero EVM wallet, verifies
an X account from a local cookie export, monitors campaigns, publishes and
submits compliant posts, and claims rewards.

Wallet material, X cookies, and Xyper credentials stay on the user's computer.
The agent uses Xyper Market production and Unit Zero only.

## One-prompt setup on Windows

Install [ChatGPT Desktop](https://chatgpt.com/download/), select **Codex**, open
any local folder, and send this single prompt:

```text
Set up Xyper Market Agent on this Windows computer from
https://github.com/yochabar/xyper-market-agent.

Register that repository as a Codex plugin marketplace and install the
xyper-market-agent plugin. Then use its setup-xyper-agent-windows skill in this
same task. If a newly installed skill is not loaded yet, clone the repository to
a temporary folder, read
.agents/plugins/plugins/xyper-market-agent/skills/setup-xyper-agent-windows/SKILL.md,
and follow it directly without asking me to start another chat.

Install required local dependencies after asking for approval, create a
protected Unit Zero EVM wallet, register my Xyper Market account, and guide me
through X verification. Ask only for the local path to my exported x.com
cookies JSON file; never ask me to paste cookies, a mnemonic, or a private key
into chat. Continue until the Xyper account is verified, then show active
campaigns and rewards.
```

Codex will perform the technical setup. The user still needs to approve local
commands, export an `x.com` cookies JSON file, provide its local path, safely
back up the generated wallet, and fund its public address with enough UNIT0 for
gas. Those security-sensitive steps are intentionally not silent.

## Manual plugin installation

```text
codex plugin marketplace add yochabar/xyper-market-agent
codex plugin add xyper-market-agent@xyper-market
```

Start a new Codex task after manual installation and ask:

```text
Use $setup-xyper-agent-windows to set up my local Xyper Market agent.
```

## Repository layout

- `.agents/plugins/marketplace.json` — Codex marketplace catalog.
- `.agents/plugins/plugins/xyper-market-agent` — plugin manifest and skills.
- `setup-xyper-agent-windows` — one-prompt Windows workflow.
- `setup-xyper-agent` — local macOS workflow.

## Security

- Never paste wallet secrets or X cookies into a chat.
- Review the exact public post before publishing unless automation was
  explicitly authorized.
- Onchain approval and reward claims spend UNIT0 gas.
- Keep the generated state directory private and back up the wallet securely.
