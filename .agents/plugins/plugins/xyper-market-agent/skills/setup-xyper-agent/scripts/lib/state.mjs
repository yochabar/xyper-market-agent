import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { generateMnemonic } from '@scure/bip39';
import { wordlist as english } from '@scure/bip39/wordlists/english';
import { mnemonicToAccount } from 'viem/accounts';

export function resolveStateDir(explicit = '') {
  return resolve(explicit || process.env.XYPER_AGENT_HOME || join(homedir(), '.xyper-market-agent'));
}

export function ensurePrivateDir(path) {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true, mode: 0o700 });
    chmodSync(path, 0o700);
    return;
  }
  const permissions = statSync(path).mode & 0o777;
  if ((permissions & 0o077) !== 0) {
    throw new Error(`state_dir_permissions_too_open:${path}:expected=700`);
  }
}

export function readJson(path, fallback = null) {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function writePrivateJson(path, value) {
  ensurePrivateDir(dirname(path));
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  chmodSync(temp, 0o600);
  renameSync(temp, path);
  chmodSync(path, 0o600);
}

export function walletPath(stateDir) {
  return join(stateDir, 'wallet.json');
}

export function sessionPath(stateDir) {
  return join(stateDir, 'session.json');
}

export function cookiesPath(stateDir) {
  return join(stateDir, 'x-cookies.json');
}

export function loadOrCreateWallet(stateDir) {
  const path = walletPath(stateDir);
  const existing = readJson(path);
  if (existing) {
    return { ...loadWallet(stateDir), created: false };
  }

  const mnemonic = generateMnemonic(english);
  const account = mnemonicToAccount(mnemonic);
  const wallet = {
    version: 1,
    kind: 'xyper-unit-zero-managed-wallet',
    address: account.address,
    mnemonic,
    derivationPath: "m/44'/60'/0'/0/0",
    createdAt: new Date().toISOString()
  };
  writePrivateJson(path, wallet);
  return { wallet, account, created: true, path };
}

export function loadWallet(stateDir) {
  const path = walletPath(stateDir);
  const wallet = readJson(path);
  if (!wallet) throw new Error('wallet_not_initialized:run_setup_first');
  const account = mnemonicToAccount(wallet.mnemonic);
  if (account.address.toLowerCase() !== String(wallet.address).toLowerCase()) {
    throw new Error('wallet_state_address_mismatch');
  }
  return { wallet, account, path };
}
