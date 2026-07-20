---
name: setup-xyper-agent
description: "Install, resume, and operate a production Xyper Market participant agent locally on macOS in one guided prompt: install a verified portable Node.js runtime when approved, create or reuse a protected Unit Zero EVM wallet, detect an X account already verified in Xyper, otherwise verify X using a local cookie export, monitor campaigns, publish and submit compliant posts, send mandatory approvals, and claim rewards. Use when a macOS user asks to install, create, onboard, migrate, resume, run, monitor, or operate a Xyper agent without a VPS."
---

# Run Xyper locally on macOS

Use macOS, production Xyper Market, and Unit Zero only. Do not ask the user to configure APIs, RPCs, chains, wallets, Python, Homebrew, Docker, or a VPS.

## Safety

- Keep wallet material, X cookies, and Xyper tokens on the user's computer.
- Never ask the user to paste cookies, a mnemonic, or a private key into chat.
- Import cookies from a local JSON file into the private state directory.
- Never edit or patch files under `node_modules`; keep compatibility fixes in this skill's bundled source.
- Never reveal wallet secrets unless the user explicitly requests a backup or export.
- Show the exact campaign tweet before publishing unless the user explicitly pre-authorized automatic publishing.
- Explain that publishing is public and that approval and claim operations spend UNIT0 gas.
- Reuse the existing wallet. Never rotate it implicitly.

## One-prompt setup

Work in this skill's `scripts/` directory.

1. Run:

   ```bash
   ./bootstrap.sh
   ```

2. If it returns `node_missing`, tell the user a checksum-verified portable Node.js 22 LTS runtime will be installed under the private agent directory without Homebrew or `sudo`. Request approval, then run:

   ```bash
   ./bootstrap.sh --install-node
   ```

3. Ask whether the user already has a verified X account in Xyper Market. Do not ask for an X handle, wallet secret, or cookies.
4. If yes, run the protective resume path first:

   ```bash
   ./run-node.sh xyper_setup.mjs setup --expect-existing-x
   ```

   - `status: "verified"` with `verificationReused: true` means Xyper returned the existing linked X account for this wallet. Do not request cookies and do not publish another verification post.
   - `status: "existing_wallet_state_required"` means this is a fresh local install with no managed-wallet state. No wallet or Xyper identity was created. Ask the user to restore the dedicated wallet state already associated with the verified Xyper account. Do not ask them to paste a mnemonic or private key into chat.
   - `status: "existing_x_not_found_for_wallet"` means the authenticated managed wallet belongs to a different Xyper identity. Stop before cookie import or posting. Ask the user to restore the dedicated managed-wallet state previously used with Xyper. Never overwrite the generated wallet and never claim that an X link can be transferred automatically.
5. If the user does not already have a verified Xyper X account, run `./run-node.sh xyper_setup.mjs setup`.
6. If setup returns `registered_needs_cookies`, show the public address and ask one question only: the absolute path to an exported JSON file containing all cookies for `https://x.com`.
7. Tell the user to provide only the file path, never the cookie contents.
8. Validate and import the export locally without contacting X:

   ```bash
   ./run-node.sh xyper_setup.mjs cookies-check --cookies-file "/absolute/path/x-cookies.json"
   ```

   `status: "cookies_ready"` means the required, unexpired cookies were imported. It does not publish a post and it must not be replaced with the deprecated Twitter `verify_credentials` check.
9. State that one public verification post will be published, then run:

   ```bash
   ./run-node.sh xyper_setup.mjs setup --allow-post
   ```

10. Treat setup as complete only when it returns `status: "verified"`.
11. Run `./run-node.sh xyper_campaigns.mjs monitor` and report current campaigns and rewards.

## Campaign workflow

Start every operating cycle with a read-only scan:

```bash
./run-node.sh xyper_campaigns.mjs monitor
```

The result contains active unjoined campaigns, pending submissions, claimable submissions, and next actions.

### Review and join

Fetch complete requirements before drafting:

```bash
./run-node.sh xyper_campaigns.mjs show --campaign-id ID
```

Join only a relevant live campaign:

```bash
./run-node.sh xyper_campaigns.mjs join --campaign-id ID
```

### Draft the tweet

Generate the draft from the full campaign response. Keep it within 280 characters. Preserve required hashtags, mentions, URLs, phrases, language, and disclosure rules. Do not invent product claims. Show the draft to the user unless automatic publishing was explicitly authorized.

### Publish, submit, and approve

Check that the wallet has UNIT0 for gas before publishing. Then execute the complete lifecycle as one operation:

```bash
./run-node.sh xyper_campaigns.mjs publish \
  --campaign-id ID \
  --text "FINAL TWEET" \
  --allow-post \
  --allow-onchain
```

This publishes to X, registers the submission in Xyper, sends the mandatory Unit Zero approval transaction, and confirms its hash. Do not intentionally stop between these stages.

If a previous run published and submitted but approval failed, resume with:

```bash
./run-node.sh xyper_campaigns.mjs approve --submission-id ID --allow-onchain
```

### Claim rewards

Use `monitor` to find claimable submissions. Claim one or all:

```bash
./run-node.sh xyper_campaigns.mjs claim --submission-id ID --allow-onchain
./run-node.sh xyper_campaigns.mjs claim-all --allow-onchain
```

Report transaction hashes and explorer links after confirmation.

## Monitoring

Run `monitor` whenever the user asks for campaign or reward status. For continuous monitoring, use the host runtime's scheduler or automation feature to invoke this skill periodically; do not keep a fragile foreground shell loop running. Require separate authorization before enabling automatic public posts or onchain transactions.

## Recovery

- `node_missing`: request approval and run `./bootstrap.sh --install-node`.
- `wallet_needs_unit0`: show the public address and ask the user to fund it.
- `existing_wallet_state_required`: this is a fresh machine and the existing account's managed-wallet state is absent. Do not generate or register a replacement wallet. Ask the user to restore the dedicated backup locally; never request its secret contents in chat.
- `existing_x_not_found_for_wallet`: the current managed wallet is not associated with the Xyper user that owns the verified X account. Do not request X cookies or publish a proof post. Restore the previous dedicated managed-wallet state; if none exists, explain that automatic account transfer is unsupported and stop without rotating state.
- `cookies_missing_required_cookie:*` or `cookies_required_cookie_expired:*`: ask for one fresh local cookie export path.
- `x_cookie_session_rejected:http_401:phase_session_check`: X rejected the cookie session before publishing. Ask for one fresh export from the currently signed-in `x.com` browser session.
- `x_cookie_session_rejected:http_401:phase_create_tweet`: the read-only session check passed but X rejected `CreateTweet`. Preserve the current cookie file and report this as a posting-protocol failure; do not send the user through repeated exports.
- `x_post_failed:http_404:phase_create_tweet`: the client already refreshed X's rotating query ID and tried the generic GraphQL endpoint. Preserve state and report a temporary X web API incompatibility.
- `x_post_automation_rejected:code_226`: X rejected automated posting for this account/session. Do not retry in a loop; ask the user to publish manually or resolve the X account restriction.
- `x_post_forbidden:http_403`: report that X refused the publish request; do not assume that another cookie export will fix an account restriction.
- `xyper_service_unavailable:http_5xx`: report a temporary Xyper/Cloudflare outage, preserve the wallet, session, and imported cookies, and retry later. Never blame the cookie file or request repeated exports for this error.
- Expired Xyper token: scripts refresh wallet authentication automatically.
- Failed approval: resume with `approve` and the existing submission ID.
- Pending validation: wait and run `monitor` later.

Read `references/api.md` only when debugging API payloads or lifecycle states.
