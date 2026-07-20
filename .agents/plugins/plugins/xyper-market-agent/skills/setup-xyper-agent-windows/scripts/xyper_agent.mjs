#!/usr/bin/env node
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { generateMnemonic } from '@scure/bip39';
import { wordlist as english } from '@scure/bip39/wordlists/english';
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  parseAbi
} from 'viem';
import { mnemonicToAccount } from 'viem/accounts';
import {
  createLoggedInScraper,
  normalizeCookieExport,
  publishTweet
} from '../../setup-xyper-agent/scripts/lib/x_session.mjs';

const [command = 'status', ...rest] = process.argv.slice(2);
const { values } = parseArgs({
  args: rest,
  options: {
    'state-dir': { type: 'string', default: '' },
    'cookies-file': { type: 'string', default: '' },
    'referral-code': { type: 'string', default: '' },
    'campaign-id': { type: 'string', default: '' },
    'submission-id': { type: 'string', default: '' },
    text: { type: 'string', default: '' },
    'allow-post': { type: 'boolean', default: false },
    'allow-onchain': { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false }
  },
  strict: true
});

const simulatedWindows = process.env.XYPER_WINDOWS_TEST_MODE === '1' || values['dry-run'];
if (process.platform !== 'win32' && !simulatedWindows) {
  throw new Error('windows_required');
}

const here = dirname(fileURLToPath(import.meta.url));
const defaults = JSON.parse(readFileSync(resolve(here, '../references/defaults.json'), 'utf8'));
const config = {
  apiBase: (process.env.XYPER_API_BASE || defaults.xyperApiBase).replace(/\/$/, ''),
  appBaseUrl: (process.env.XYPER_APP_BASE_URL || defaults.xyperAppBaseUrl).replace(/\/$/, ''),
  network: {
    ...defaults.network,
    rpcUrl: process.env.UNIT_ZERO_RPC_URL || defaults.network.rpcUrl
  }
};

function defaultStateDir() {
  if (values['state-dir']) return resolve(values['state-dir']);
  if (process.env.XYPER_AGENT_HOME) return resolve(process.env.XYPER_AGENT_HOME);
  if (simulatedWindows && process.platform !== 'win32') {
    return join(tmpdir(), `xyper-windows-agent-${process.pid}`);
  }
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) throw new Error('localappdata_not_available');
  return join(localAppData, 'XyperMarketAgent');
}

const stateDir = defaultStateDir();
const paths = {
  wallet: join(stateDir, 'wallet.json'),
  session: join(stateDir, 'session.json'),
  cookies: join(stateDir, 'x-cookies.json'),
  operation: join(stateDir, 'operation.json')
};

function windowsIdentity() {
  const username = process.env.USERNAME;
  if (!username) throw new Error('windows_username_not_available');
  return process.env.USERDOMAIN ? `${process.env.USERDOMAIN}\\${username}` : username;
}

function secureAcl(path, directory = false) {
  if (process.platform !== 'win32') return;
  const suffix = directory ? '(OI)(CI)F' : 'F';
  const result = spawnSync('icacls.exe', [
    path,
    '/inheritance:r',
    '/grant:r',
    `${windowsIdentity()}:${suffix}`,
    `SYSTEM:${suffix}`
  ], { windowsHide: true, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`windows_acl_failed:${result.stderr || result.stdout}`);
}

function ensureStateDir() {
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  secureAcl(stateDir, true);
}

function readJson(path, fallback = null) {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writePrivateJson(path, value) {
  ensureStateDir();
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  secureAcl(temp, false);
  rmSync(path, { force: true });
  renameSync(temp, path);
  secureAcl(path, false);
}

function loadWallet({ create = false } = {}) {
  let wallet = readJson(paths.wallet);
  let created = false;
  if (!wallet && create) {
    const mnemonic = generateMnemonic(english);
    const account = mnemonicToAccount(mnemonic);
    wallet = {
      version: 1,
      kind: 'xyper-windows-managed-wallet',
      address: account.address,
      mnemonic,
      derivationPath: "m/44'/60'/0'/0/0",
      createdAt: new Date().toISOString()
    };
    writePrivateJson(paths.wallet, wallet);
    created = true;
  }
  if (!wallet) throw new Error('wallet_not_initialized:run_setup_first');
  const account = mnemonicToAccount(wallet.mnemonic);
  if (account.address.toLowerCase() !== wallet.address.toLowerCase()) {
    throw new Error('wallet_state_address_mismatch');
  }
  return { wallet, account, created };
}

async function requestJson(url, { method = 'GET', body, token, timeoutMs = 20000 } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (url.startsWith(config.apiBase) && response.status >= 500) {
        throw new Error(`xyper_service_unavailable:http_${response.status}`);
      }
      throw new Error(`${method} ${url} HTTP ${response.status}: ${payload.detail || JSON.stringify(payload)}`);
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

const apiGet = (path, token = '') => requestJson(`${config.apiBase}${path}`, { token });
const apiPost = (path, body, token = '') => requestJson(`${config.apiBase}${path}`, {
  method: 'POST', body, token
});

async function doctor() {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 20) throw new Error(`node_20_required:${process.versions.node}`);
  if (values['dry-run']) {
    return { status: 'ready', dryRun: true, nodeVersion: process.versions.node, chainId: 88811 };
  }
  const [rpc, health, remoteConfig] = await Promise.all([
    requestJson(config.network.rpcUrl, {
      method: 'POST',
      body: { jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }
    }),
    apiGet('/api/agent/v1/health/'),
    apiGet('/api/agent/v1/config/')
  ]);
  const chainId = Number.parseInt(rpc.result, 16);
  if (chainId !== config.network.chainId) throw new Error(`rpc_chain_mismatch:${chainId}`);
  if (health.status !== 'ok') throw new Error(`xyper_health_not_ok:${health.status}`);
  if (!(remoteConfig.chains || []).some((item) => Number(item.chainId) === chainId)) {
    throw new Error(`xyper_chain_not_supported:${chainId}`);
  }
  return { status: 'ready', nodeVersion: process.versions.node, chainId, xyperApiStatus: 'ok' };
}

async function registerWallet(account, referralCode = '') {
  const challenge = await apiPost('/api/agent/v1/auth/wallet/nonce/', {
    address: account.address,
    chainId: config.network.chainId
  });
  const { EIP712Domain: _ignored, ...types } = challenge.typedData?.types || {};
  const signature = await account.signTypedData({
    domain: challenge.typedData.domain,
    types,
    primaryType: challenge.typedData.primaryType,
    message: challenge.typedData.message
  });
  const body = { address: account.address, nonce: challenge.nonce, signature };
  if (referralCode) body.referralCode = referralCode;
  return apiPost('/api/agent/v1/auth/wallet/verify/', body);
}

async function getRuntime({ create = false } = {}) {
  const { wallet, account, created } = loadWallet({ create });
  let session = readJson(paths.session, {});
  const expiresAt = Date.parse(session.tokenExpiresAt || '');
  const tokenUsable = session.agentSessionToken && Number.isFinite(expiresAt) && expiresAt > Date.now() + 60000;
  if (!tokenUsable) {
    const result = await registerWallet(account, values['referral-code']);
    session = {
      ...session,
      agentSessionToken: result.agentSessionToken,
      tokenExpiresAt: result.expiresAt,
      user: result.user,
      wallet: result.wallet,
      registeredAt: session.registeredAt || new Date().toISOString(),
      refreshedAt: new Date().toISOString()
    };
    writePrivateJson(paths.session, session);
  }
  return { wallet, account, created, session, token: session.agentSessionToken };
}

function importCookies(sourcePath) {
  const { cookieState, summary } = normalizeCookieExport(JSON.parse(readFileSync(sourcePath, 'utf8')));
  writePrivateJson(paths.cookies, cookieState);
  return summary;
}

async function loggedInScraper() {
  return createLoggedInScraper(paths.cookies, {
    writeCookieState: (state) => writePrivateJson(paths.cookies, state)
  });
}

function viemClients(account) {
  const chain = {
    id: config.network.chainId,
    name: config.network.name,
    nativeCurrency: { name: 'UNIT0', symbol: 'UNIT0', decimals: 18 },
    rpcUrls: { default: { http: [config.network.rpcUrl] } }
  };
  return {
    publicClient: createPublicClient({ chain, transport: http(config.network.rpcUrl) }),
    walletClient: createWalletClient({ account, chain, transport: http(config.network.rpcUrl) })
  };
}

async function requireGas(account) {
  const { publicClient } = viemClients(account);
  const balance = await publicClient.getBalance({ address: account.address });
  if (balance === 0n) throw new Error(`wallet_needs_unit0:${account.address}`);
}

function normalizeTx(intent) {
  const tx = intent?.txRequest || {};
  const chainId = Number(tx.chainId ?? intent?.approval?.chain_id);
  if (chainId !== config.network.chainId) throw new Error(`unsupported_chain:${chainId}`);
  if (tx.to && tx.data) return { ...tx, chainId };
  const voucher = tx?.args?.voucher;
  const signature = tx?.args?.signature;
  if (tx.method !== 'acceptTweetApproval' || !tx.contract || !voucher || !signature) {
    throw new Error('unsupported_onchain_intent');
  }
  const abi = parseAbi([
    'function acceptTweetApproval((bytes32 approvalId,address wallet,bytes32 tweetIdHash,bytes32 twitterAccountIdHash,bytes32 contentHash,uint48 approvedAt,uint48 deadline) voucher, bytes signature)'
  ]);
  return {
    to: tx.contract,
    data: encodeFunctionData({
      abi,
      functionName: 'acceptTweetApproval',
      args: [{
        approvalId: voucher.approvalId,
        wallet: voucher.wallet,
        tweetIdHash: voucher.tweetIdHash,
        twitterAccountIdHash: voucher.twitterAccountIdHash,
        contentHash: voucher.contentHash,
        approvedAt: BigInt(voucher.approvedAt),
        deadline: BigInt(voucher.deadline)
      }, signature]
    }),
    value: tx.value || '0',
    chainId
  };
}

async function sendTx(account, tx) {
  const { walletClient, publicClient } = viemClients(account);
  const hash = await walletClient.sendTransaction({
    to: tx.to,
    data: tx.data,
    value: BigInt(tx.value || 0)
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

const txUrl = (hash) => `${config.network.explorerUrl.replace(/\/$/, '')}/tx/${hash}`;
const listFrom = (payload) => Array.isArray(payload) ? payload : payload?.results || [];

async function approve(runtime, submissionId) {
  await requireGas(runtime.account);
  const intent = await apiPost(`/api/agent/v1/submissions/${submissionId}/onchain-intent/`, {}, runtime.token);
  const hash = await sendTx(runtime.account, normalizeTx(intent));
  await apiPost(`/api/agent/v1/submissions/${submissionId}/onchain-confirm/`, {
    approvalTxHash: hash
  }, runtime.token);
  return { submissionId, approvalTxHash: hash, approvalExplorerUrl: txUrl(hash) };
}

async function claim(runtime, submissionId) {
  await requireGas(runtime.account);
  const intent = await apiPost(`/api/agent/v1/submissions/${submissionId}/claim-intent/`, {}, runtime.token);
  const hash = await sendTx(runtime.account, normalizeTx(intent));
  await apiPost(`/api/agent/v1/submissions/${submissionId}/claim-confirm/`, {
    claimTxHash: hash
  }, runtime.token);
  return { submissionId, claimTxHash: hash, claimExplorerUrl: txUrl(hash) };
}

async function monitor(runtime) {
  const [campaignData, submissionData] = await Promise.all([
    apiGet(`/api/agent/v1/campaigns/?status=live&joined=false&chainId=${config.network.chainId}`, runtime.token),
    apiGet('/api/agent/v1/me/submissions/?status=submitted,validating,approved,claimable', runtime.token)
  ]);
  const campaigns = listFrom(campaignData);
  const submissions = listFrom(submissionData);
  return {
    status: 'ok',
    activeCampaigns: campaigns,
    claimableSubmissions: submissions.filter((item) => item.status === 'claimable'),
    pendingSubmissions: submissions.filter((item) => item.status !== 'claimable'),
    pendingOperation: readJson(paths.operation)
  };
}

async function submitOperation(runtime, operation) {
  let current = operation;
  if (!current.submissionId) {
    const result = await apiPost(`/api/agent/v1/campaigns/${current.campaignId}/submissions/`, {
      walletAddress: runtime.wallet.address,
      platform: 'x',
      postUrl: current.tweet.tweetUrl,
      externalPostId: current.tweet.tweetId,
      contentText: current.text,
      postedAt: current.tweet.postedAt,
      source: 'agent'
    }, runtime.token);
    const submissionId = result.submissionId || result.id;
    if (!submissionId) throw new Error('submission_id_missing');
    current = { ...current, stage: 'submitted', submissionId };
    writePrivateJson(paths.operation, current);
  }
  const approval = await approve(runtime, current.submissionId);
  current = { ...current, stage: 'completed', ...approval, completedAt: new Date().toISOString() };
  writePrivateJson(paths.operation, current);
  return current;
}

function publicStatus() {
  const wallet = readJson(paths.wallet);
  const session = readJson(paths.session);
  return {
    status: session?.xVerified ? 'verified' : session?.agentSessionToken ? 'registered' : wallet ? 'wallet_ready' : 'not_started',
    evmAddress: wallet?.address || null,
    xVerified: Boolean(session?.xVerified),
    xUsername: session?.xUsername || null,
    stateDir,
    pendingOperation: readJson(paths.operation)
  };
}

async function runSetup() {
  ensureStateDir();
  const { wallet, account, created } = loadWallet({ create: true });
  if (values['dry-run']) {
    writePrivateJson(paths.session, {
      agentSessionToken: 'dry_run_token',
      tokenExpiresAt: new Date(Date.now() + 86400000).toISOString(),
      xVerified: true,
      xUsername: 'dry_run_user'
    });
    return { ...publicStatus(), status: 'verified', dryRun: true, walletCreated: created };
  }
  await doctor();
  const runtime = await getRuntime();
  if (runtime.session.xVerified) return { ...publicStatus(), status: 'verified', walletCreated: created };
  if (values['cookies-file']) importCookies(values['cookies-file']);
  if (!existsSync(paths.cookies)) {
    return {
      ...publicStatus(),
      status: 'registered_needs_cookies',
      nextAction: 'Provide the absolute path to an exported x.com cookies JSON file.'
    };
  }
  const scraper = await loggedInScraper();
  if (!values['allow-post']) {
    return { ...publicStatus(), status: 'needs_post_consent' };
  }
  const challenge = await apiPost('/api/agent/v1/social/x/link/start/', {
    walletAddress: wallet.address
  }, runtime.token);
  const tweet = await publishTweet(scraper, `Linking my wallet to Xyper. ${challenge.code}`);
  const completion = await apiPost('/api/agent/v1/social/x/link/complete/', {
    challengeId: challenge.challengeId,
    tweetUrl: tweet.tweetUrl
  }, runtime.token);
  let verification = completion?.challenge;
  for (let attempt = 0; verification?.status !== 'verified' && attempt < 12; attempt += 1) {
    if (['failed', 'expired'].includes(verification?.status)) throw new Error(`x_verification_${verification.status}`);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 5000));
    verification = await apiGet(
      `/api/agent/v1/social/x/link/status/${challenge.challengeId}/`,
      runtime.token
    );
  }
  const verified = verification?.status === 'verified';
  writePrivateJson(paths.session, {
    ...runtime.session,
    xVerified: verified,
    xUsername: tweet.username,
    verificationTweetUrl: tweet.tweetUrl,
    verificationStatus: verification?.status || 'pending'
  });
  return { ...publicStatus(), status: verified ? 'verified' : 'verification_pending' };
}

async function runCookieCheck() {
  if (!values['cookies-file']) throw new Error('--cookies-file required');
  const summary = importCookies(values['cookies-file']);
  await loggedInScraper();
  return { ...publicStatus(), ...summary };
}

async function run() {
  if (command === 'doctor') return doctor();
  if (command === 'status') return publicStatus();
  if (command === 'setup') return runSetup();
  if (command === 'cookies-check') return runCookieCheck();
  if (values['dry-run']) {
    return {
      status: command === 'monitor' ? 'ok' : 'dry_run',
      command,
      activeCampaigns: command === 'monitor' ? [{ id: 'campaign-dry-run', title: 'Example campaign' }] : undefined,
      wouldPost: command === 'publish',
      wouldSendTransaction: ['publish', 'resume', 'approve', 'claim', 'claim-all'].includes(command)
    };
  }

  const runtime = await getRuntime();
  if (!runtime.session.xVerified) throw new Error('x_account_not_verified:run_setup_first');
  if (command === 'monitor') return monitor(runtime);
  if (command === 'show') {
    if (!values['campaign-id']) throw new Error('--campaign-id required');
    return apiGet(`/api/agent/v1/campaigns/${values['campaign-id']}/`, runtime.token);
  }
  if (command === 'join') {
    if (!values['campaign-id']) throw new Error('--campaign-id required');
    return apiPost(`/api/agent/v1/campaigns/${values['campaign-id']}/join/`, {}, runtime.token);
  }
  if (command === 'publish') {
    if (!values['campaign-id'] || !values.text) throw new Error('--campaign-id and --text required');
    if (!values['allow-post'] || !values['allow-onchain']) {
      throw new Error('--allow-post and --allow-onchain required');
    }
    if (values.text.length > 280) throw new Error(`tweet_too_long:${values.text.length}`);
    await requireGas(runtime.account);
    await apiGet(`/api/agent/v1/campaigns/${values['campaign-id']}/`, runtime.token);
    const tweet = await publishTweet(await loggedInScraper(), values.text);
    const operation = {
      version: 1,
      stage: 'tweet_published',
      campaignId: values['campaign-id'],
      text: values.text,
      tweet,
      startedAt: new Date().toISOString()
    };
    writePrivateJson(paths.operation, operation);
    return submitOperation(runtime, operation);
  }
  if (command === 'resume') {
    if (!values['allow-onchain']) throw new Error('--allow-onchain required');
    const operation = readJson(paths.operation);
    if (!operation || operation.stage === 'completed') throw new Error('no_pending_operation');
    return submitOperation(runtime, operation);
  }
  if (command === 'approve') {
    if (!values['submission-id'] || !values['allow-onchain']) {
      throw new Error('--submission-id and --allow-onchain required');
    }
    return approve(runtime, values['submission-id']);
  }
  if (command === 'claim') {
    if (!values['submission-id'] || !values['allow-onchain']) {
      throw new Error('--submission-id and --allow-onchain required');
    }
    return claim(runtime, values['submission-id']);
  }
  if (command === 'claim-all') {
    if (!values['allow-onchain']) throw new Error('--allow-onchain required');
    const snapshot = await monitor(runtime);
    const claims = [];
    for (const submission of snapshot.claimableSubmissions) {
      claims.push(await claim(runtime, submission.id));
    }
    return { status: 'claimed_all', claims };
  }
  throw new Error(`unknown_command:${command}`);
}

try {
  console.log(JSON.stringify(await run(), null, 2));
} catch (error) {
  console.error(JSON.stringify({
    status: 'error',
    error: error instanceof Error ? error.message : String(error),
    command,
    stateDir,
    pendingOperation: readJson(paths.operation)
  }, null, 2));
  process.exitCode = 1;
}
