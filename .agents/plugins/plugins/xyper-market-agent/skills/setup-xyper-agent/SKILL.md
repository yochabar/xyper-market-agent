---
name: setup-xyper-agent
description: "Set up and operate a production Xyper Market participant agent locally: install dependencies, create a protected EVM wallet for Unit Zero, register and verify the X account using a local cookie export, monitor active campaigns, join campaigns, draft and publish compliant X posts, submit posts to Xyper, send mandatory onchain approvals, monitor submission status, and claim rewards. Use when a user asks to install, create, onboard, run, monitor, or operate a Xyper agent without a VPS."
---

# Run a local Xyper agent

Use production Xyper Market and Unit Zero only. Do not ask the user to select networks, APIs, RPCs, or environments.

## Safety

- Keep wallet material, X cookies, and Xyper tokens on the user's computer.
- Never ask the user to paste cookies, a mnemonic, or a private key into chat.
- Import cookies from a local JSON file into the private state directory.
- Never reveal wallet secrets unless the user explicitly requests a backup or export.
- Show the exact campaign tweet before publishing unless the user explicitly pre-authorized automatic publishing.
- Explain that publishing is public and that approval and claim operations spend UNIT0 gas.
- Reuse the existing wallet. Never rotate it implicitly.

## First-time setup

Work in this skill's `scripts/` directory.

1. Require Node.js 20 or newer.
2. Run `npm install` if `node_modules/` is absent.
3. Run:

   ```bash
   node xyper_setup.mjs doctor
   node xyper_setup.mjs setup
   ```

4. If setup returns `registered_needs_cookies`, show the public address and ask one question only: the absolute path to an exported JSON file containing all cookies for `https://x.com`.
5. Tell the user to provide only the file path, never the cookie contents.
6. State that one public verification post will be published, then run:

   ```bash
   node xyper_setup.mjs setup --cookies-file "/absolute/path/x-cookies.json" --allow-post
   ```

7. Treat setup as complete only when it returns `status: "verified"`.
8. Run `node xyper_campaigns.mjs monitor` and report current campaigns and rewards.

## Campaign workflow

Start every operating cycle with a read-only scan:

```bash
node xyper_campaigns.mjs monitor
```

The result contains active unjoined campaigns, pending submissions, claimable submissions, and next actions.

### Review and join

Fetch complete requirements before drafting:

```bash
node xyper_campaigns.mjs show --campaign-id ID
```

Join only a relevant live campaign:

```bash
node xyper_campaigns.mjs join --campaign-id ID
```

### Draft the tweet

Generate the draft from the full campaign response. Keep it within 280 characters. Preserve required hashtags, mentions, URLs, phrases, language, and disclosure rules. Do not invent product claims. Show the draft to the user unless automatic publishing was explicitly authorized.

### Publish, submit, and approve

Check that the wallet has UNIT0 for gas before publishing. Then execute the complete lifecycle as one operation:

```bash
node xyper_campaigns.mjs publish \
  --campaign-id ID \
  --text "FINAL TWEET" \
  --allow-post \
  --allow-onchain
```

This publishes to X, registers the submission in Xyper, sends the mandatory Unit Zero approval transaction, and confirms its hash. Do not intentionally stop between these stages.

If a previous run published and submitted but approval failed, resume with:

```bash
node xyper_campaigns.mjs approve --submission-id ID --allow-onchain
```

### Claim rewards

Use `monitor` to find claimable submissions. Claim one or all:

```bash
node xyper_campaigns.mjs claim --submission-id ID --allow-onchain
node xyper_campaigns.mjs claim-all --allow-onchain
```

Report transaction hashes and explorer links after confirmation.

## Monitoring

Run `monitor` whenever the user asks for campaign or reward status. For continuous monitoring, use the host runtime's scheduler or automation feature to invoke this skill periodically; do not keep a fragile foreground shell loop running. Require separate authorization before enabling automatic public posts or onchain transactions.

## Recovery

- `wallet_needs_unit0`: show the public address and ask the user to fund it.
- `x_cookie_session_invalid`: ask for a fresh local cookie export path.
- Expired Xyper token: scripts refresh wallet authentication automatically.
- Failed approval: resume with `approve` and the existing submission ID.
- Pending validation: wait and run `monitor` later.

Read `references/api.md` only when debugging API payloads or lifecycle states.
