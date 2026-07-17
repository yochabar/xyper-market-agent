# Xyper Windows lifecycle reference

Fixed production configuration: Xyper API `https://api.xyper.market`, Unit Zero Mainnet chain `88811`, RPC `https://rpc.unit0.dev`, explorer `https://explorer.unit0.dev`.

Lifecycle:

`cookies-check` first imports the cookie export and verifies locally that
unexpired `auth_token` and `ct0` values are present. It does not call the
retired Twitter `verify_credentials` or guest-token endpoints.

1. `/api/agent/v1/auth/wallet/nonce/` → EIP-712 signature → `/auth/wallet/verify/`.
2. `/social/x/link/start/` → proof tweet → `/social/x/link/complete/` → status polling.
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

The directory ACL permits the current user and SYSTEM only.

Xyper HTTP 5xx responses are classified as `xyper_service_unavailable` and do
not invalidate private state. An X session is classified as rejected only when
the actual publish request returns HTTP 401.
