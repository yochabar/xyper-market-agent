import { registerWallet } from './api.mjs';
import { getConfig } from './config.mjs';
import { loadWallet, readJson, sessionPath, writePrivateJson } from './state.mjs';

export async function getRuntime(stateDir, { refresh = false } = {}) {
  const config = getConfig();
  const { wallet, account } = loadWallet(stateDir);
  const path = sessionPath(stateDir);
  let session = readJson(path, {});
  const expiresAt = Date.parse(session.tokenExpiresAt || '');
  const tokenUsable = session.agentSessionToken && Number.isFinite(expiresAt) && expiresAt > Date.now() + 60000;

  if (refresh || !tokenUsable) {
    const result = await registerWallet(config, account);
    session = {
      ...session,
      agentSessionToken: result.agentSessionToken,
      tokenExpiresAt: result.expiresAt,
      user: result.user,
      wallet: result.wallet,
      registeredAt: session.registeredAt || new Date().toISOString(),
      refreshedAt: new Date().toISOString()
    };
    writePrivateJson(path, session);
  }

  if (!session.xVerified) throw new Error('x_account_not_verified:run_setup_first');
  return { config, wallet, account, session, token: session.agentSessionToken };
}
