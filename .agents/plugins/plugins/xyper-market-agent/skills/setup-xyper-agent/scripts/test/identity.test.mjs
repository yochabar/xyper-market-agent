import assert from 'node:assert/strict';
import test from 'node:test';

import { applyRemoteIdentity, findVerifiedXAccount } from '../lib/identity.mjs';

test('detects an existing verified X account in the Xyper profile', () => {
  const account = findVerifiedXAccount({
    socialAccounts: [
      { platform: 'instagram', handle: 'elsewhere' },
      { platform: 'x', handle: 'alice', verifiedAt: '2026-07-20T00:00:00Z' }
    ]
  });
  assert.deepEqual(account, {
    username: 'alice',
    verifiedAt: '2026-07-20T00:00:00Z'
  });
});

test('supports snake_case profile fields', () => {
  const account = findVerifiedXAccount({
    social_accounts: [{ provider: 'twitter', screen_name: 'legacy', verified_at: '2026-01-01' }]
  });
  assert.equal(account.username, 'legacy');
});

test('does not treat pending or explicitly unverified accounts as linked', () => {
  assert.equal(findVerifiedXAccount({
    socialAccounts: [{ platform: 'x', handle: 'alice', status: 'pending' }]
  }), null);
  assert.equal(findVerifiedXAccount({
    socialAccounts: [{ platform: 'x', handle: 'alice', isVerified: false }]
  }), null);
});

test('marks the local session as remotely verified without changing its token', () => {
  const existing = { agentSessionToken: 'secret-token', xVerified: false };
  const result = applyRemoteIdentity(existing, {
    socialAccounts: [{ platform: 'x', handle: 'alice' }]
  });
  assert.equal(result.session.agentSessionToken, 'secret-token');
  assert.equal(result.session.xVerified, true);
  assert.equal(result.session.xUsername, 'alice');
  assert.equal(result.session.xVerificationSource, 'existing_xyper_account');
});
