# Xyper production lifecycle reference

## Fixed configuration

- Xyper API: `https://api.xyper.market`
- Xyper app: `https://xyper.market`
- Unit Zero Mainnet chain ID: `88811`
- RPC: `https://rpc.unit0.dev`
- Explorer: `https://explorer.unit0.dev`

The script validates the RPC chain ID and checks that Xyper's public `/api/agent/v1/config/` includes chain `88811` before setup.

## Wallet and X verification

Before this lifecycle, `cookies-check` imports the cookie export and verifies
locally that unexpired `auth_token` and `ct0` values are present. It does not
call the retired Twitter `verify_credentials` or guest-token endpoints.
`sync` then performs a read-only check against X's current signed-in account
settings endpoint and, when local wallet registration exists, refreshes local
verification state from `GET /api/agent/v1/me/`. It never publishes a post.

1. `POST /api/agent/v1/auth/wallet/nonce/`
2. Sign returned EIP-712 typed data.
3. `POST /api/agent/v1/auth/wallet/verify/`
4. `GET /api/agent/v1/me/` and inspect `socialAccounts`/`social_accounts`. If a verified X entry exists, persist it locally and skip all X-linking calls and the proof post.
5. Otherwise, `POST /api/agent/v1/social/x/link/start/`.
6. Confirm the cookie session through X's current account-settings endpoint, discover the current `CreateTweet` GraphQL query ID from X's public web bundles, and publish proof containing the returned challenge code.
7. `POST /api/agent/v1/social/x/link/complete/`.
8. Poll `GET /api/agent/v1/social/x/link/status/<id>/`.

An existing X link belongs to a Xyper user, and wallet authentication determines that user. A fresh managed wallet must not be assumed to inherit an X link owned by another wallet. `--expect-existing-x` never creates a wallet on a fresh machine: it returns `existing_wallet_state_required`. With an existing managed wallet that has no linked X entry, it returns `existing_x_not_found_for_wallet` before importing cookies or publishing.

## Campaign lifecycle

1. List active campaigns with `GET /api/agent/v1/campaigns/?status=live&joined=false&chainId=88811`.
2. Read one campaign with `GET /api/agent/v1/campaigns/<id>/`.
3. Join with `POST /api/agent/v1/campaigns/<id>/join/`.
4. Publish a compliant tweet using the local X cookie session.
5. Register it with `POST /api/agent/v1/campaigns/<id>/submissions/`.
6. Prepare approval with `POST /api/agent/v1/submissions/<id>/onchain-intent/`.
7. Send the returned Unit Zero transaction and confirm through `POST /api/agent/v1/submissions/<id>/onchain-confirm/`.
8. Monitor `GET /api/agent/v1/me/submissions/` until `claimable`.
9. Prepare a claim through `POST /api/agent/v1/submissions/<id>/claim-intent/`.
10. Send the returned transaction and call `POST /api/agent/v1/submissions/<id>/claim-confirm/`.

## Submission payload

```json
{
  "walletAddress": "0x...",
  "platform": "x",
  "postUrl": "https://x.com/user/status/123",
  "externalPostId": "123",
  "contentText": "...",
  "postedAt": "2026-07-16T12:00:00Z",
  "source": "agent"
}
```

## Private local state

Default directory: `~/.xyper-market-agent`.

- `wallet.json`: mnemonic and address; mode `600`.
- `session.json`: Xyper session and verification state; mode `600`.
- `x-cookies.json`: live X session cookies; mode `600`.
- `x-query-ids.json`: non-secret cache of X's rotating `CreateTweet` query ID; mode `600`.

Xyper HTTP 5xx responses are classified as `xyper_service_unavailable` and do
not invalidate this state. The X web client uses `OAuth2Session`, sends `ct0`
as `x-csrf-token`, never mixes a guest token into the signed-in session, and
refreshes a rotated query ID after HTTP 404. A 401 identifies whether rejection
happened during the session check or during `CreateTweet`.
