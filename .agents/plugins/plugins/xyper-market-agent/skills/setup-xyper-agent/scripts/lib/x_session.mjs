import { chmodSync, readFileSync } from 'node:fs';
import { Scraper } from 'agent-twitter-client';
import { readJson, writePrivateJson } from './state.mjs';

function toSetCookieStrings(parsed) {
  if (Array.isArray(parsed)) {
    return parsed.map((cookie) => {
      if (typeof cookie === 'string') return cookie;
      if (!cookie?.name || cookie.value === undefined) throw new Error('invalid_cookie_object');
      const domain = cookie.domain || '.twitter.com';
      const path = cookie.path || '/';
      let value = `${cookie.name}=${cookie.value}; Domain=${domain}; Path=${path}; Secure`;
      if (cookie.httpOnly) value += '; HttpOnly';
      return value;
    });
  }
  if (parsed && typeof parsed === 'object') {
    return Object.entries(parsed).map(
      ([name, value]) => `${name}=${value}; Domain=.twitter.com; Path=/; Secure`
    );
  }
  throw new Error('cookies_must_be_json_array_or_object');
}

export function importCookies(sourcePath, destinationPath) {
  const raw = readFileSync(sourcePath, 'utf8');
  const normalized = toSetCookieStrings(JSON.parse(raw));
  const names = normalized.map((value) => value.split('=', 1)[0]);
  if (!names.includes('auth_token') || !names.includes('ct0')) {
    throw new Error('cookies_missing_auth_token_or_ct0');
  }
  writePrivateJson(destinationPath, normalized);
  chmodSync(destinationPath, 0o600);
  return normalized.length;
}

export async function createLoggedInScraper(cookiesFile) {
  const cookies = readJson(cookiesFile);
  if (!cookies) throw new Error('x_cookies_not_imported');
  const scraper = new Scraper();
  await scraper.setCookies(cookies);
  if (!(await scraper.isLoggedIn())) throw new Error('x_cookie_session_invalid');
  return scraper;
}

export async function publishTweet(scraper, text, cookiesFile) {
  const response = await scraper.sendTweet(text);
  const body = await response.json();
  const result = body?.data?.create_tweet?.tweet_results?.result;
  const tweetId = result?.rest_id;
  if (!tweetId) throw new Error(`x_post_failed:${JSON.stringify(body)}`);
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
