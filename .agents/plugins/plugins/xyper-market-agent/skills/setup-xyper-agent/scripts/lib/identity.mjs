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
