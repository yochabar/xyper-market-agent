# Xyper Windows lifecycle reference

Fixed production configuration: Xyper API `https://api.xyper.market`, Unit Zero Mainnet chain `88811`, RPC `https://rpc.unit0.dev`, explorer `https://explorer.unit0.dev`.

Lifecycle:

`cookies-check` first imports the cookie export and verifies locally that
unexpired `auth_token` and `ct0` values are present. It does not call the
retired Twitter `verify_credentials` or guest-token endpoints.

1. `/api/agent/v1/auth/wallet/nonce/` → EIP-712 signature → `/auth/wallet/verify/`.
2. `GET /api/agent/v1/me/` → reuse an existing verified X entry from `socialAccounts`/`social_accounts` without cookies or a proof post.
3. Only when no X entry exists: `/social/x/link/start/` → cookie-session check → current `CreateTweet` query-ID discovery → proof tweet → `/social/x/link/complete/` → status polling.

`--expect-existing-x` returns `existing_wallet_state_required` instead of creating a wallet on a fresh machine. With a restored managed wallet, it stops before cookie import or posting when that wallet is not associated with the Xyper user that owns the expected X link.
3. `/campaigns/?status=live&joined=false&chainId=88811` → campaign review → `/campaigns/<id>/join/`.
4. Publish tweet → `/campaigns/<id>/submissions/`.
5. `/submissions/<id>/onchain-intent/` → send Unit Zero transaction → `/onchain-confirm/`.
6. Monitor `/me/submissions/` until claimable.
7. `/claim-intent/` → send transaction → `/claim-confirm/`.

Private state:

- `%LOCALAPPDATA%\XyperMarketAgent\wallet.json`
- `%LOCALAPPDATA%\XyperMarketAgent\session.json`
- `%LOCALAPPDATA%\XyperMarketAgent\x-cookies.json`
- `%LOCALAPPDATA%\XyperMarketAgent\operation.json`
- `%LOCALAPPDATA%\XyperMarketAgent\x-query-ids.json` (non-secret rotating X query-ID cache)

The directory ACL permits the current user and SYSTEM only.

Windows host preflight statuses:

- `executable_launch_blocked`: the Codex sandbox cannot start local Windows executables. Select Full access, restart ChatGPT Desktop, and retry in a new local task; use `[windows] sandbox = "elevated"` if the block persists.
- `dependencies_missing`: Git for Windows or Node.js 20+ is missing and requires approval before `winget` installation.
- `winget_missing`: install Git for Windows and Node.js LTS outside ChatGPT, then restart the app.

Xyper HTTP 5xx responses are classified as `xyper_service_unavailable` and do
not invalidate private state. The X web client uses `OAuth2Session`, sends
`ct0` as `x-csrf-token`, never mixes a guest token into the signed-in session,
and refreshes a rotated query ID after HTTP 404. A 401 identifies whether
rejection happened during the session check or during `CreateTweet`.
