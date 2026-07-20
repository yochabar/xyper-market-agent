import { randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const requiredCookieNames = ['auth_token', 'ct0'];
const bearerToken = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';
const fallbackCreateTweetQueryId = 'hIL9XdleMYEtVXOZVbr8Bg';
const queryIdTtlMs = 24 * 60 * 60 * 1000;
const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const discoveryPages = [
  'https://x.com/?lang=en',
  'https://x.com/explore',
  'https://x.com/notifications',
  'https://x.com/settings/profile'
];
const bundleUrlPattern = /https:\/\/abs\.twimg\.com\/responsive-web\/client-web(?:-legacy)?\/[A-Za-z0-9.-]+\.js/g;
const operationPatterns = [
  { regex: /e\.exports=\{queryId\s*:\s*["']([^"']+)["']\s*,\s*operationName\s*:\s*["']([^"']+)["']/gs, id: 1, name: 2 },
  { regex: /e\.exports=\{operationName\s*:\s*["']([^"']+)["']\s*,\s*queryId\s*:\s*["']([^"']+)["']/gs, id: 2, name: 1 },
  { regex: /operationName\s*[:=]\s*["']([^"']+)["'](.{0,4000}?)queryId\s*[:=]\s*["']([^"']+)["']/gs, id: 3, name: 1 },
  { regex: /queryId\s*[:=]\s*["']([^"']+)["'](.{0,4000}?)operationName\s*[:=]\s*["']([^"']+)["']/gs, id: 1, name: 3 }
];

function readJson(path, fallback = null) {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writePrivateJson(path, value) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  chmodSync(temporary, 0o600);
  renameSync(temporary, path);
  chmodSync(path, 0o600);
}

const tweetFeatures = {
  rweb_video_screen_enabled: true,
  creator_subscriptions_tweet_preview_api_enabled: true,
  premium_content_api_read_enabled: false,
  communities_web_enable_tweet_community_results_fetch: true,
  c9s_tweet_anatomy_moderator_badge_enabled: true,
  responsive_web_grok_analyze_button_fetch_trends_enabled: false,
  responsive_web_grok_analyze_post_followups_enabled: false,
  responsive_web_grok_annotations_enabled: false,
  responsive_web_jetfuel_frame: true,
  post_ctas_fetch_enabled: true,
  responsive_web_grok_share_attachment_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  view_counts_everywhere_api_enabled: true,
  longform_notetweets_consumption_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: true,
  tweet_awards_web_tipping_enabled: false,
  responsive_web_grok_show_grok_translated_post: false,
  responsive_web_grok_analysis_button_from_backend: true,
  creator_subscriptions_quote_tweet_preview_enabled: false,
  longform_notetweets_rich_text_read_enabled: true,
  longform_notetweets_inline_media_enabled: true,
  profile_label_improvements_pcf_label_in_post_enabled: true,
  responsive_web_profile_redirect_enabled: false,
  rweb_tipjar_consumption_enabled: true,
  verified_phone_label_enabled: false,
  articles_preview_enabled: true,
  responsive_web_grok_community_note_auto_translation_is_enabled: false,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  freedom_of_speech_not_reach_fetch_enabled: true,
  standardized_nudges_misinfo: true,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  responsive_web_grok_image_annotation_enabled: true,
  responsive_web_grok_imagine_annotation_enabled: true,
  responsive_web_graphql_timeline_navigation_enabled: true,
  responsive_web_enhance_cards_enabled: false
};

function expirationMs(cookie) {
  const raw = cookie?.expiresAt ?? cookie?.expirationDate ?? cookie?.expires;
  if (raw === undefined || raw === null || raw === '' || raw === -1) return null;
  if (typeof raw === 'number') return raw > 1e12 ? raw : raw * 1000;
  const parsed = Date.parse(String(raw));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizedDomain(value = '') {
  return String(value).toLowerCase().replace(/^\./, '');
}

function domainPriority(domain) {
  if (domain === 'x.com') return 4;
  if (domain.endsWith('.x.com')) return 3;
  if (domain === 'twitter.com') return 2;
  if (domain.endsWith('.twitter.com')) return 1;
  return domain ? -1 : 0;
}

function cookieRecord(cookie) {
  if (typeof cookie === 'string') {
    const pair = cookie.split(';', 1)[0];
    const separator = pair.indexOf('=');
    if (separator <= 0) throw new Error('invalid_cookie_string');
    return { name: pair.slice(0, separator).trim(), value: pair.slice(separator + 1), domain: '' };
  }
  if (!cookie?.name || cookie.value === undefined) throw new Error('invalid_cookie_object');
  const domain = normalizedDomain(cookie.domain);
  if (domainPriority(domain) < 0) return null;
  return {
    name: String(cookie.name),
    value: String(cookie.value),
    domain,
    path: String(cookie.path || '/'),
    secure: cookie.secure !== false,
    httpOnly: Boolean(cookie.httpOnly),
    sameSite: cookie.sameSite || undefined,
    expiresAt: expirationMs(cookie)
  };
}

function cookieEntries(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (parsed?.version === 2 && Array.isArray(parsed.cookies)) return parsed.cookies;
  if (parsed && typeof parsed === 'object') {
    return Object.entries(parsed).map(([name, value]) => ({ name, value }));
  }
  throw new Error('cookies_must_be_json_array_or_object');
}

export function normalizeCookieExport(parsed, now = Date.now()) {
  const current = new Map();
  const expired = new Set();
  for (const entry of cookieEntries(parsed)) {
    const record = cookieRecord(entry);
    if (!record) continue;
    if (record.expiresAt !== null && record.expiresAt !== undefined && record.expiresAt <= now) {
      if (!current.has(record.name)) expired.add(record.name);
      continue;
    }
    const existing = current.get(record.name);
    if (!existing || domainPriority(record.domain) >= domainPriority(existing.domain)) {
      current.set(record.name, record);
      expired.delete(record.name);
    }
  }

  for (const name of requiredCookieNames) {
    if (!current.has(name)) {
      throw new Error(expired.has(name)
        ? `cookies_required_cookie_expired:${name}`
        : `cookies_missing_required_cookie:${name}`);
    }
  }

  return {
    cookieState: { version: 2, cookies: [...current.values()], importedAt: new Date(now).toISOString() },
    summary: {
      status: 'cookies_ready',
      importedCookieCount: current.size,
      requiredCookiesPresent: [...requiredCookieNames],
      expiredCookiesSkipped: expired.size
    }
  };
}

export function importCookies(sourcePath, destinationPath) {
  const raw = readFileSync(sourcePath, 'utf8');
  const { cookieState, summary } = normalizeCookieExport(JSON.parse(raw));
  writePrivateJson(destinationPath, cookieState);
  chmodSync(destinationPath, 0o600);
  return summary;
}

function cookieMap(cookieState) {
  const { cookieState: normalized } = normalizeCookieExport(cookieState);
  return new Map(normalized.cookies.map((cookie) => [cookie.name, cookie]));
}

function cookieHeader(cookies) {
  return [...cookies.values()].map(({ name, value }) => `${name}=${value}`).join('; ');
}

function requestHeaders(client, { json = true, referer = 'https://x.com/' } = {}) {
  const headers = {
    accept: '*/*',
    'accept-language': 'en-US,en;q=0.9',
    authorization: `Bearer ${bearerToken}`,
    cookie: cookieHeader(client.cookies),
    origin: 'https://x.com',
    referer,
    'user-agent': userAgent,
    'x-client-transaction-id': randomBytes(16).toString('hex'),
    'x-client-uuid': client.clientUuid,
    'x-twitter-active-user': 'yes',
    'x-twitter-auth-type': 'OAuth2Session',
    'x-twitter-client-deviceid': client.deviceId,
    'x-twitter-client-language': 'en',
    'x-csrf-token': client.cookies.get('ct0').value
  };
  if (client.userId) headers['x-twitter-client-user-id'] = client.userId;
  if (json) headers['content-type'] = 'application/json';
  return headers;
}

function safeResponseDetails(response, body) {
  const codes = Array.isArray(body?.errors)
    ? body.errors.map((error) => Number(error?.code)).filter(Number.isFinite)
    : [];
  return { codes };
}

function statusError(response, phase, body = {}) {
  const { codes } = safeResponseDetails(response, body);
  if (response.status === 401 || codes.some((code) => [32, 89].includes(code))) {
    return new Error(`x_cookie_session_rejected:http_401:phase_${phase}`);
  }
  if (response.status === 403 || codes.some((code) => [64, 326].includes(code))) {
    return new Error(`x_post_forbidden:http_403:phase_${phase}`);
  }
  if (codes.length > 0) return new Error(`x_post_failed:graphql_code_${codes[0]}:phase_${phase}`);
  return new Error(`x_post_failed:http_${response.status}:phase_${phase}`);
}

async function fetchJson(client, url, init = {}) {
  const response = await fetchRequest(client, url, init);
  persistResponseCookies(client, response);
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

function persistResponseCookies(client, response) {
  const lines = typeof response.headers?.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : (response.headers?.get?.('set-cookie') || '').split(/,(?=[^;,]+=)/).filter(Boolean);
  let changed = false;
  for (const line of lines) {
    const parts = String(line).split(';').map((part) => part.trim());
    const separator = parts[0].indexOf('=');
    if (separator <= 0) continue;
    const name = parts[0].slice(0, separator);
    const value = parts[0].slice(separator + 1);
    const attributes = new Map(parts.slice(1).map((part) => {
      const index = part.indexOf('=');
      return index < 0
        ? [part.toLowerCase(), true]
        : [part.slice(0, index).toLowerCase(), part.slice(index + 1)];
    }));
    const maxAge = Number(attributes.get('max-age'));
    const expiresAt = attributes.has('expires') ? Date.parse(String(attributes.get('expires'))) : null;
    if ((Number.isFinite(maxAge) && maxAge <= 0) || (Number.isFinite(expiresAt) && expiresAt <= Date.now())) {
      changed = client.cookies.delete(name) || changed;
      continue;
    }
    if (!value) continue;
    client.cookies.set(name, {
      ...(client.cookies.get(name) || {}),
      name,
      value,
      domain: normalizedDomain(attributes.get('domain') || 'x.com'),
      path: String(attributes.get('path') || '/'),
      secure: attributes.has('secure'),
      httpOnly: attributes.has('httponly'),
      expiresAt: Number.isFinite(expiresAt) ? expiresAt : null
    });
    changed = true;
  }
  if (changed && requiredCookieNames.every((name) => client.cookies.has(name))) {
    client.writeCookieState({
      version: 2,
      cookies: [...client.cookies.values()],
      importedAt: new Date().toISOString()
    });
  }
}

async function fetchRequest(client, url, init = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), client.timeoutMs);
  try {
    return await client.fetchImpl(url, { ...init, signal: init.signal || controller.signal });
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('x_request_timeout');
    const code = String(error?.cause?.code || error?.code || '').toUpperCase();
    if (code === 'EACCES' || /\bEACCES\b/i.test(String(error?.message || ''))) {
      throw new Error('sandbox_network_blocked:eacces:x.com');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function checkCurrentUser(client) {
  const { response, body } = await fetchJson(client, 'https://x.com/i/api/account/settings.json', {
    headers: requestHeaders(client, { json: false })
  });
  if (response.status === 401 || response.status === 403) throw statusError(response, 'session_check', body);
  if (!response.ok) return null;
  client.username = body?.screen_name || body?.user?.screen_name || null;
  client.userId = String(body?.user_id || body?.user_id_str || body?.user?.id_str || body?.user?.id || '') || null;
  return client.username ? { username: client.username, userId: client.userId } : null;
}

export async function validateCookieSession(client) {
  const identity = await checkCurrentUser(client);
  return {
    status: 'x_session_ready',
    xSessionValid: true,
    xUsername: identity?.username || null,
    xUserId: identity?.userId || null,
    checkedAt: new Date().toISOString()
  };
}

function extractCreateTweetId(source) {
  for (const pattern of operationPatterns) {
    pattern.regex.lastIndex = 0;
    for (const match of source.matchAll(pattern.regex)) {
      if (match[pattern.name] === 'CreateTweet' && /^[A-Za-z0-9_-]+$/.test(match[pattern.id])) {
        return match[pattern.id];
      }
    }
  }
  return null;
}

async function discoverCreateTweetId(client) {
  const bundleUrls = new Set();
  const headers = { 'user-agent': userAgent, accept: 'text/html,*/*;q=0.8', 'accept-language': 'en-US,en;q=0.9' };
  for (const page of discoveryPages) {
    try {
      const response = await fetchRequest(client, page, { headers });
      if (!response.ok) continue;
      const html = await response.text();
      for (const match of html.matchAll(bundleUrlPattern)) bundleUrls.add(match[0]);
    } catch { /* another discovery page may still work */ }
  }
  for (const url of bundleUrls) {
    try {
      const response = await fetchRequest(client, url, { headers });
      if (!response.ok) continue;
      const id = extractCreateTweetId(await response.text());
      if (id) return id;
    } catch { /* another bundle may still work */ }
  }
  return null;
}

async function createTweetQueryId(client, force = false) {
  const cache = readJson(client.queryCacheFile);
  const fetchedAt = Date.parse(cache?.fetchedAt || '');
  if (!force && cache?.createTweet && Number.isFinite(fetchedAt) && Date.now() - fetchedAt <= queryIdTtlMs) {
    return cache.createTweet;
  }
  const discovered = await discoverCreateTweetId(client);
  if (discovered) {
    writePrivateJson(client.queryCacheFile, { version: 1, createTweet: discovered, fetchedAt: new Date().toISOString() });
    return discovered;
  }
  return cache?.createTweet || fallbackCreateTweetQueryId;
}

function createTweetBody(queryId, text) {
  return JSON.stringify({
    variables: {
      tweet_text: text,
      dark_request: false,
      media: { media_entities: [], possibly_sensitive: false },
      semantic_annotation_ids: []
    },
    features: tweetFeatures,
    fieldToggles: { withArticleRichContentState: false },
    queryId
  });
}

function tweetResult(body) {
  return body?.data?.create_tweet?.tweet_results?.result;
}

async function postGraphql(client, queryId, text, generic = false) {
  const url = generic
    ? 'https://x.com/i/api/graphql'
    : `https://x.com/i/api/graphql/${queryId}/CreateTweet`;
  return fetchJson(client, url, {
    method: 'POST',
    headers: requestHeaders(client, { referer: 'https://x.com/compose/post' }),
    body: createTweetBody(queryId, text)
  });
}

async function statusUpdateFallback(client, text) {
  const body = new URLSearchParams({ status: text }).toString();
  return fetchJson(client, 'https://x.com/i/api/1.1/statuses/update.json', {
    method: 'POST',
    headers: {
      ...requestHeaders(client, { json: false, referer: 'https://x.com/compose/post' }),
      'content-type': 'application/x-www-form-urlencoded'
    },
    body
  });
}

export async function createLoggedInScraper(cookiesFile, options = {}) {
  const stored = readJson(cookiesFile);
  if (!stored) throw new Error('x_cookies_not_imported');
  const cookies = cookieMap(stored);
  return {
    cookies,
    cookiesFile,
    queryCacheFile: options.queryCacheFile || join(dirname(cookiesFile), 'x-query-ids.json'),
    fetchImpl: options.fetchImpl || fetch,
    clientUuid: randomUUID(),
    deviceId: randomUUID(),
    timeoutMs: options.timeoutMs || 20000,
    writeCookieState: options.writeCookieState || ((state) => writePrivateJson(cookiesFile, state)),
    username: null,
    userId: null
  };
}

export async function publishTweet(client, text) {
  if (!text || text.length > 280) throw new Error(`tweet_invalid_length:${text?.length || 0}`);
  await checkCurrentUser(client);
  let queryId = await createTweetQueryId(client);
  let attempt = await postGraphql(client, queryId, text);
  if (attempt.response.status === 404) {
    queryId = await createTweetQueryId(client, true);
    attempt = await postGraphql(client, queryId, text);
    if (attempt.response.status === 404) attempt = await postGraphql(client, queryId, text, true);
  }

  let result = tweetResult(attempt.body);
  const errorCodes = Array.isArray(attempt.body?.errors)
    ? attempt.body.errors.map((error) => Number(error?.code)).filter(Number.isFinite)
    : [];
  if (attempt.response.ok && !result?.rest_id && errorCodes.includes(226)) {
    attempt = await statusUpdateFallback(client, text);
    if (attempt.response.ok) result = { rest_id: String(attempt.body?.id_str || attempt.body?.id || '') };
  }
  if (!attempt.response.ok) throw statusError(attempt.response, 'create_tweet', attempt.body);
  if (!result?.rest_id) {
    if (errorCodes.includes(226)) throw new Error('x_post_automation_rejected:code_226');
    if (errorCodes.length > 0) throw statusError(attempt.response, 'create_tweet', attempt.body);
    throw new Error('x_post_failed:tweet_id_missing');
  }

  const username = result?.core?.user_results?.result?.legacy?.screen_name || client.username || 'i/web';
  return {
    tweetId: result.rest_id,
    tweetUrl: `https://x.com/${username}/status/${result.rest_id}`,
    username,
    postedAt: new Date().toISOString()
  };
}

export const __test = { cookieHeader, extractCreateTweetId, requestHeaders };
