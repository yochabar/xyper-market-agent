function socialAccounts(profile) {
  if (Array.isArray(profile?.socialAccounts)) return profile.socialAccounts;
  if (Array.isArray(profile?.social_accounts)) return profile.social_accounts;
  return [];
}

function accountPlatform(account) {
  return String(account?.platform || account?.provider || '').toLowerCase();
}

function accountHandle(account) {
  return account?.handle
    || account?.username
    || account?.screenName
    || account?.screen_name
    || null;
}

function explicitlyUnverified(account) {
  if (account?.isVerified === false || account?.is_verified === false) return true;
  return ['created', 'submitted', 'pending', 'failed', 'expired', 'unverified']
    .includes(String(account?.status || '').toLowerCase());
}

export function findVerifiedXAccount(profile) {
  const account = socialAccounts(profile).find(
    (candidate) => ['x', 'twitter'].includes(accountPlatform(candidate)) && !explicitlyUnverified(candidate)
  );
  if (!account) return null;
  return {
    username: accountHandle(account),
    verifiedAt: account.verifiedAt || account.verified_at || null
  };
}

export function applyRemoteIdentity(session, profile) {
  const xAccount = findVerifiedXAccount(profile);
  if (!xAccount) return { session, xAccount: null };
  return {
    session: {
      ...session,
      xVerified: true,
      xUsername: xAccount.username || session?.xUsername || null,
      xVerifiedAt: xAccount.verifiedAt || session?.xVerifiedAt || null,
      xVerificationSource: 'existing_xyper_account'
    },
    xAccount
  };
}

export function synchronizeRemoteIdentity(session, profile) {
  const applied = applyRemoteIdentity(session, profile);
  if (applied.xAccount) {
    return {
      ...applied,
      authoritative: true,
      session: { ...applied.session, xProfileSyncedAt: new Date().toISOString() }
    };
  }
  const hasAuthoritativeSocialList = Array.isArray(profile?.socialAccounts)
    || Array.isArray(profile?.social_accounts);
  if (!hasAuthoritativeSocialList) {
    return {
      xAccount: null,
      authoritative: false,
      session: { ...session, xProfileSyncedAt: new Date().toISOString() }
    };
  }
  return {
    xAccount: null,
    authoritative: true,
    session: {
      ...session,
      xVerified: false,
      xUsername: null,
      xVerifiedAt: null,
      xVerificationSource: 'xyper_profile_sync',
      xProfileSyncedAt: new Date().toISOString()
    }
  };
}
