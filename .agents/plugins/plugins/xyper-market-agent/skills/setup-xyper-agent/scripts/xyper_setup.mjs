#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { apiGet, apiPost, registerWallet, verifyRpc, verifyXyper } from './lib/api.mjs';
import { getConfig } from './lib/config.mjs';
import {
  cookiesPath,
  ensurePrivateDir,
  loadOrCreateWallet,
  readJson,
  resolveStateDir,
  sessionPath,
  walletPath,
  writePrivateJson
} from './lib/state.mjs';
import { createLoggedInScraper, importCookies, publishTweet } from './lib/x_session.mjs';

const [command = 'status', ...rest] = process.argv.slice(2);
const { values } = parseArgs({
  args: rest,
  options: {
    'state-dir': { type: 'string', default: '' },
    'cookies-file': { type: 'string', default: '' },
    'referral-code': { type: 'string', default: '' },
    'allow-post': { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false }
  },
  strict: true
});

const stateDir = resolveStateDir(
  values['state-dir'] || (values['dry-run'] ? join(tmpdir(), `xyper-agent-dry-run-${process.pid}`) : '')
);
const config = getConfig();
const paths = {
  wallet: walletPath(stateDir),
  session: sessionPath(stateDir),
  cookies: cookiesPath(stateDir)
};

function output(payload) {
  console.log(JSON.stringify(payload, null, 2));
}

function publicStatus(extra = {}) {
  const wallet = readJson(paths.wallet);
  const session = readJson(paths.session);
  return {
    status: session?.xVerified ? 'verified' : session?.agentSessionToken ? 'registered' : wallet ? 'wallet_ready' : 'not_started',
    evmAddress: wallet?.address || null,
    xVerified: Boolean(session?.xVerified),
    xUsername: session?.xUsername || null,
    walletRegistered: Boolean(session?.agentSessionToken),
    cookiesImported: existsSync(paths.cookies),
    stateDir,
    network: {
      name: config.network.name,
      chainId: config.network.chainId,
      rpcUrl: config.network.rpcUrl,
      explorerUrl: config.network.explorerUrl
    },
    ...extra
  };
}

async function doctor() {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 20) throw new Error(`node_20_required:current=${process.versions.node}`);
  const [chainId, xyper] = values['dry-run']
    ? [config.network.chainId, { status: 'ok', chainSupported: true }]
    : await Promise.all([verifyRpc(config), verifyXyper(config)]);
  output(publicStatus({
    status: 'ready',
    nodeVersion: process.versions.node,
    rpcChainId: chainId,
    xyperApiStatus: xyper.status,
    xyperChainSupported: xyper.chainSupported
  }));
}

async function authenticate(account, wallet, dryRun) {
  const existing = readJson(paths.session, {});
  if (dryRun) {
    const session = {
      ...existing,
      agentSessionToken: 'dry_run_token',
      tokenExpiresAt: new Date(Date.now() + 86400000).toISOString(),
      wallet: { address: wallet.address, chainId: config.network.chainId },
      dryRun: true
    };
    writePrivateJson(paths.session, session);
    return session;
  }
  const result = await registerWallet(config, account, values['referral-code']);
  const session = {
    ...existing,
    agentSessionToken: result.agentSessionToken,
    tokenExpiresAt: result.expiresAt,
    user: result.user,
    wallet: result.wallet,
    registeredAt: new Date().toISOString()
  };
  writePrivateJson(paths.session, session);
  return session;
}

async function waitForVerification(challengeId, token) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const status = await apiGet(config, `/api/agent/v1/social/x/link/status/${challengeId}/`, token);
    if (status.status === 'verified') return status;
    if (['failed', 'expired'].includes(status.status)) throw new Error(`x_verification_${status.status}`);
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  return { status: 'pending' };
}

async function setup() {
  ensurePrivateDir(stateDir);
  const { wallet, account, created } = loadOrCreateWallet(stateDir);

  if (!values['dry-run']) await Promise.all([verifyRpc(config), verifyXyper(config)]);
  const session = await authenticate(account, wallet, values['dry-run']);

  if (values['dry-run']) {
    const completed = {
      ...session,
      xVerified: true,
      xUsername: 'dry_run_user',
      verificationTweetUrl: 'https://x.com/dry_run_user/status/dry_run'
    };
    writePrivateJson(paths.session, completed);
    output(publicStatus({
      status: 'verified',
      dryRun: true,
      walletCreated: created,
      proofTweetUrl: completed.verificationTweetUrl
    }));
    return;
  }

  if (session.xVerified) {
    output(publicStatus({ status: 'verified', walletCreated: created }));
    return;
  }

  if (values['cookies-file']) importCookies(values['cookies-file'], paths.cookies);

  if (!existsSync(paths.cookies)) {
    output(publicStatus({
      status: 'registered_needs_cookies',
      walletCreated: created,
      nextAction: 'Export all x.com cookies as JSON, save locally, and provide only the absolute file path.'
    }));
    process.exitCode = 2;
    return;
  }

  const scraper = await createLoggedInScraper(paths.cookies);
  if (!values['allow-post']) {
    output(publicStatus({
      status: 'needs_post_consent',
      nextAction: 'Re-run with --allow-post to publish one public Xyper verification post.'
    }));
    process.exitCode = 3;
    return;
  }

  const challenge = await apiPost(
    config,
    '/api/agent/v1/social/x/link/start/',
    { walletAddress: wallet.address },
    session.agentSessionToken
  );
  const proofText = `Linking my wallet to Xyper. ${challenge.code}`;
  const tweet = await publishTweet(scraper, proofText, paths.cookies);
  const completion = await apiPost(
    config,
    '/api/agent/v1/social/x/link/complete/',
    { challengeId: challenge.challengeId, tweetUrl: tweet.tweetUrl },
    session.agentSessionToken
  );
  const verification = completion?.challenge?.status === 'verified'
    ? completion.challenge
    : await waitForVerification(challenge.challengeId, session.agentSessionToken);
  const verified = verification.status === 'verified';
  writePrivateJson(paths.session, {
    ...session,
    xVerified: verified,
    xUsername: tweet.username,
    verificationTweetUrl: tweet.tweetUrl,
    verificationChallengeId: challenge.challengeId,
    verificationStatus: verification.status
  });
  output(publicStatus({
    status: verified ? 'verified' : 'verification_pending',
    proofTweetUrl: tweet.tweetUrl,
    challengeId: challenge.challengeId
  }));
  if (!verified) process.exitCode = 4;
}

try {
  if (command === 'status') output(publicStatus());
  else if (command === 'doctor') await doctor();
  else if (command === 'setup') await setup();
  else throw new Error(`unknown_command:${command}`);
} catch (error) {
  console.error(JSON.stringify({
    status: 'error',
    error: error instanceof Error ? error.message : String(error),
    stateDir
  }, null, 2));
  process.exitCode = 1;
}
