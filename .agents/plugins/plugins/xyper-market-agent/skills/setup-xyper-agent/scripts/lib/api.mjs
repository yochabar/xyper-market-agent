export async function requestJson(url, {
  method = 'GET', body, token, timeoutMs = 20000, service = 'remote'
} = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    let response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal
      });
    } catch (error) {
      const code = String(error?.cause?.code || error?.code || '').toUpperCase();
      if (code === 'EACCES' || /\bEACCES\b/i.test(String(error?.message || ''))) {
        throw new Error(`sandbox_network_blocked:eacces:${new URL(url).hostname}`);
      }
      throw error;
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (service === 'xyper' && response.status >= 500) {
        throw new Error(`xyper_service_unavailable:http_${response.status}`);
      }
      const detail = payload.detail || payload.error || JSON.stringify(payload);
      throw new Error(`${method} ${url} HTTP ${response.status}: ${detail}`);
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

export function apiPost(config, path, body, token = '') {
  return requestJson(`${config.apiBase}${path}`, { method: 'POST', body, token, service: 'xyper' });
}

export function apiGet(config, path, token = '') {
  return requestJson(`${config.apiBase}${path}`, { token, service: 'xyper' });
}

export async function verifyRpc(config) {
  const payload = await requestJson(config.network.rpcUrl, {
    method: 'POST',
    body: { jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }
  });
  const chainId = Number.parseInt(payload.result, 16);
  if (chainId !== config.network.chainId) {
    throw new Error(`rpc_chain_mismatch:expected=${config.network.chainId}:actual=${chainId}`);
  }
  return chainId;
}

export async function verifyXyper(config) {
  const [health, remoteConfig] = await Promise.all([
    requestJson(`${config.apiBase}/api/agent/v1/health/`, { service: 'xyper' }),
    requestJson(`${config.apiBase}/api/agent/v1/config/`, { service: 'xyper' })
  ]);
  if (health.status !== 'ok') throw new Error(`xyper_health_not_ok:${health.status || 'unknown'}`);
  const supported = (remoteConfig.chains || []).some(
    (chain) => Number(chain.chainId) === config.network.chainId
  );
  if (!supported) throw new Error(`xyper_chain_not_supported:${config.network.chainId}`);
  return { status: health.status, chainSupported: true };
}

export async function registerWallet(config, account, referralCode = '') {
  const address = account.address;
  const challenge = await apiPost(config, '/api/agent/v1/auth/wallet/nonce/', {
    address,
    chainId: config.network.chainId
  });
  const { EIP712Domain: _ignored, ...types } = challenge.typedData?.types || {};
  const signature = await account.signTypedData({
    domain: challenge.typedData.domain,
    types,
    primaryType: challenge.typedData.primaryType,
    message: challenge.typedData.message
  });
  const verifyBody = { address, nonce: challenge.nonce, signature };
  if (referralCode) verifyBody.referralCode = referralCode;
  return apiPost(config, '/api/agent/v1/auth/wallet/verify/', verifyBody);
}
