import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyRemoteIdentity,
  findVerifiedXAccount,
  synchronizeRemoteIdentity
} from '../lib/identity.mjs';

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

test('sync clears a stale local verification when Xyper has no linked X account', () => {
  const result = synchronizeRemoteIdentity({
    agentSessionToken: 'secret-token',
    xVerified: true,
    xUsername: 'stale-user'
  }, { socialAccounts: [] });
  assert.equal(result.session.agentSessionToken, 'secret-token');
  assert.equal(result.session.xVerified, false);
  assert.equal(result.session.xUsername, null);
  assert.equal(result.session.xVerificationSource, 'xyper_profile_sync');
});

test('sync preserves local verification when the profile omits social account state', () => {
  const result = synchronizeRemoteIdentity({
    xVerified: true,
    xUsername: 'known-user'
  }, { id: 'profile-without-social-fields' });
  assert.equal(result.authoritative, false);
  assert.equal(result.session.xVerified, true);
  assert.equal(result.session.xUsername, 'known-user');
});
