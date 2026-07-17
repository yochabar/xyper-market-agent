import { chmodSync, readFileSync } from 'node:fs';
import { Scraper } from 'agent-twitter-client';
import { readJson, writePrivateJson } from './state.mjs';

const requiredCookieNames = ['auth_token', 'ct0'];

function expirationMs(cookie) {
  const raw = cookie?.expirationDate ?? cookie?.expires;
  if (raw === undefined || raw === null || raw === '' || raw === -1) return null;
  if (typeof raw === 'number') return raw > 1e12 ? raw : raw * 1000;
  const parsed = Date.parse(String(raw));
  return Number.isFinite(parsed) ? parsed : null;
}

function cookieRecord(cookie) {
  if (typeof cookie === 'string') {
    const pair = cookie.split(';', 1)[0];
    const separator = pair.indexOf('=');
    if (separator <= 0) throw new Error('invalid_cookie_string');
    return { name: pair.slice(0, separator).trim(), value: pair.slice(separator + 1) };
  }
  if (!cookie?.name || cookie.value === undefined) throw new Error('invalid_cookie_object');
  const domain = String(cookie.domain || '').toLowerCase().replace(/^\./, '');
  if (domain && domain !== 'x.com' && !domain.endsWith('.x.com') &&
      domain !== 'twitter.com' && !domain.endsWith('.twitter.com')) {
    return null;
  }
  return {
    name: String(cookie.name),
    value: String(cookie.value),
    expiresAt: expirationMs(cookie)
  };
}

export function normalizeCookieExport(parsed, now = Date.now()) {
  const entries = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object'
      ? Object.entries(parsed).map(([name, value]) => ({ name, value }))
      : null;
  if (!entries) throw new Error('cookies_must_be_json_array_or_object');

  const current = new Map();
  const expired = new Set();
  for (const entry of entries) {
    const record = cookieRecord(entry);
    if (!record) continue;
    if (record.expiresAt !== null && record.expiresAt !== undefined && record.expiresAt <= now) {
      expired.add(record.name);
      continue;
    }
    current.set(record.name, record.value);
    expired.delete(record.name);
  }

  for (const name of requiredCookieNames) {
    if (!current.has(name)) {
      throw new Error(expired.has(name)
        ? `cookies_required_cookie_expired:${name}`
        : `cookies_missing_required_cookie:${name}`);
    }
  }

  return {
    cookies: [...current.entries()].map(([name, value]) =>
      `${name}=${value}; Domain=.twitter.com; Path=/; Secure${name === 'auth_token' ? '; HttpOnly' : ''}`
    ),
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
  const { cookies, summary } = normalizeCookieExport(JSON.parse(raw));
  writePrivateJson(destinationPath, cookies);
  chmodSync(destinationPath, 0o600);
  return summary;
}

export async function createLoggedInScraper(cookiesFile) {
  const cookies = readJson(cookiesFile);
  if (!cookies) throw new Error('x_cookies_not_imported');
  const scraper = new Scraper();
  await scraper.setCookies(cookies);
  const installedNames = new Set((await scraper.getCookies()).map((cookie) => cookie.key));
  if (!requiredCookieNames.every((name) => installedNames.has(name))) {
    throw new Error('x_cookie_import_incompatible:required_cookies_not_loaded');
  }
  return scraper;
}

export async function publishTweet(scraper, text, cookiesFile) {
  let response;
  try {
    response = await scraper.sendTweet(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/\b401\b|unauthori[sz]ed|authentication required|"code"\s*:\s*(32|89)\b/i.test(message)) {
      throw new Error('x_cookie_session_rejected:http_401_during_post');
    }
    if (/\b403\b|forbidden|"code"\s*:\s*(64|326)\b/i.test(message)) {
      throw new Error('x_post_forbidden:http_403');
    }
    throw new Error('x_post_failed:request_rejected');
  }
  const body = await response.json().catch(() => ({}));
  if (response.status === 401) throw new Error('x_cookie_session_rejected:http_401_during_post');
  if (response.status === 403) throw new Error('x_post_forbidden:http_403');
  if (!response.ok) throw new Error(`x_post_failed:http_${response.status}`);
  const result = body?.data?.create_tweet?.tweet_results?.result;
  const tweetId = result?.rest_id;
  if (!tweetId) throw new Error('x_post_failed:tweet_id_missing');
  const username = result?.core?.user_results?.result?.legacy?.screen_name || 'i/web';
  const refreshed = await scraper.getCookies();
  writePrivateJson(cookiesFile, refreshed);
  return {
    tweetId,
    tweetUrl: `https://x.com/${username}/status/${tweetId}`,
    username,
    postedAt: new Date().toISOString()
  };
}
