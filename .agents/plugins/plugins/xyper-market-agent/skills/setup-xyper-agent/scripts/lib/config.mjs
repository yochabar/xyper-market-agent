import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const defaultsPath = resolve(here, '../../references/defaults.json');
const defaults = JSON.parse(readFileSync(defaultsPath, 'utf8'));

export function getConfig() {
  return {
    apiBase: (process.env.XYPER_API_BASE || defaults.xyperApiBase).replace(/\/$/, ''),
    appBaseUrl: (process.env.XYPER_APP_BASE_URL || defaults.xyperAppBaseUrl).replace(/\/$/, ''),
    network: {
      ...defaults.network,
      rpcUrl: process.env.UNIT_ZERO_RPC_URL || defaults.network.rpcUrl
    }
  };
}
