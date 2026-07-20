import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  createLoggedInScraper,
  importCookies,
  normalizeCookieExport,
  publishTweet,
  validateCookieSession
} from '../lib/x_session.mjs';

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers }
  });
}

function cookieExport() {
  return [
    { name: 'auth_token', value: 'twitter-old', domain: '.twitter.com' },
    { name: 'auth_token', value: 'x-current', domain: '.x.com' },
    { name: 'ct0', value: 'csrf-current', domain: 'x.com' },
    { name: 'other', value: 'kept', domain: '.x.com' },
    { name: 'ignored', value: 'nope', domain: '.example.com' }
  ];
}

function prepareClient(fetchImpl) {
  const directory = mkdtempSync(join(tmpdir(), 'xyper-x-session-'));
  const source = join(directory, 'export.json');
  const destination = join(directory, 'x-cookies.json');
  // Use the public importer so the persisted format is tested too.
  writeFileSync(source, JSON.stringify(cookieExport()));
  importCookies(source, destination);
  return createLoggedInScraper(destination, {
    fetchImpl,
    queryCacheFile: join(directory, 'query.json')
  });
}

test('normalizes exports, prefers x.com cookies, and never stores foreign domains', () => {
  const { cookieState, summary } = normalizeCookieExport(cookieExport(), Date.parse('2026-01-01T00:00:00Z'));
  const values = Object.fromEntries(cookieState.cookies.map(({ name, value }) => [name, value]));
  assert.equal(values.auth_token, 'x-current');
  assert.equal(values.ct0, 'csrf-current');
  assert.equal(values.ignored, undefined);
  assert.equal(summary.importedCookieCount, 3);
});

test('accepts an export containing only current x.com domain cookies', () => {
  const { cookieState } = normalizeCookieExport([
    { name: 'auth_token', value: 'auth', domain: 'x.com' },
    { name: 'ct0', value: 'csrf', domain: '.x.com' }
  ]);
  assert.deepEqual(cookieState.cookies.map(({ domain }) => domain), ['x.com', 'x.com']);
});

test('validates the live cookie session without publishing', async () => {
  const requests = [];
  const client = await prepareClient(async (url, init = {}) => {
    requests.push({ url: String(url), method: init.method || 'GET' });
    return jsonResponse({ screen_name: 'tester', user_id_str: '42' });
  });
  const result = await validateCookieSession(client);
  assert.equal(result.status, 'x_session_ready');
  assert.equal(result.xUsername, 'tester');
  assert.equal(result.xUserId, '42');
  assert.deepEqual(requests, [{ url: 'https://x.com/i/api/account/settings.json', method: 'GET' }]);
});

test('classifies sandbox EACCES separately from rejected cookies', async () => {
  const client = await prepareClient(async () => {
    const error = new Error('fetch failed');
    error.cause = { code: 'EACCES' };
    throw error;
  });
  await assert.rejects(
    () => validateCookieSession(client),
    /sandbox_network_blocked:eacces:x\.com/
  );
});

test('accepts the legacy cookie-string state format', () => {
  const { cookieState } = normalizeCookieExport([
    'auth_token=legacy-auth; Domain=.twitter.com; Path=/',
    'ct0=legacy-csrf; Domain=.twitter.com; Path=/'
  ]);
  assert.deepEqual(cookieState.cookies.map(({ name }) => name), ['auth_token', 'ct0']);
});

test('publishes with OAuth2Session headers and a dynamically discovered query id', async () => {
  const requests = [];
  const fetchImpl = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if (String(url).endsWith('/i/api/account/settings.json')) {
      return jsonResponse(
        { screen_name: 'tester', user_id: '42' },
        200,
        { 'set-cookie': 'ct0=csrf-refreshed; Domain=.x.com; Path=/; Secure' }
      );
    }
    if (String(url).startsWith('https://x.com/i/api/graphql/')) {
      return jsonResponse({ data: { create_tweet: { tweet_results: { result: { rest_id: '12345' } } } } });
    }
    if (String(url).includes('abs.twimg.com')) {
      return new Response('e.exports={queryId:"new-query-id",operationName:"CreateTweet"}', { status: 200 });
    }
    return new Response('<script src="https://abs.twimg.com/responsive-web/client-web/main.abc.js"></script>', { status: 200 });
  };
  const client = await prepareClient(fetchImpl);
  const tweet = await publishTweet(client, 'Xyper verification');
  assert.equal(tweet.tweetUrl, 'https://x.com/tester/status/12345');

  const post = requests.find((request) => request.init.method === 'POST');
  assert.match(post.url, /\/new-query-id\/CreateTweet$/);
  assert.equal(post.init.headers['x-twitter-auth-type'], 'OAuth2Session');
  assert.equal(post.init.headers['x-csrf-token'], 'csrf-refreshed');
  assert.equal(post.init.headers['x-guest-token'], undefined);
  assert.match(post.init.headers.cookie, /auth_token=x-current/);
  assert.equal(JSON.parse(post.init.body).queryId, 'new-query-id');
});

test('classifies a rejected cookie session before attempting to post', async () => {
  const requests = [];
  const client = await prepareClient(async (url) => {
    requests.push(String(url));
    return jsonResponse({ errors: [{ code: 32, message: 'Could not authenticate' }] }, 401);
  });
  await assert.rejects(
    () => publishTweet(client, 'will not be posted'),
    /x_cookie_session_rejected:http_401:phase_session_check/
  );
  assert.equal(requests.length, 1);
});

test('refreshes a rotated query id after 404 and retries once', async () => {
  let bundleVersion = 0;
  const postUrls = [];
  const client = await prepareClient(async (url, init = {}) => {
    const value = String(url);
    if (value.endsWith('/i/api/account/settings.json')) return jsonResponse({ screen_name: 'tester', user_id: '42' });
    if (value.startsWith('https://x.com/i/api/graphql/')) {
      postUrls.push(value);
      if (postUrls.length === 1) return jsonResponse({}, 404);
      return jsonResponse({ data: { create_tweet: { tweet_results: { result: { rest_id: '67890' } } } } });
    }
    if (value.includes('abs.twimg.com')) {
      bundleVersion += 1;
      return new Response(`e.exports={queryId:"query-${bundleVersion}",operationName:"CreateTweet"}`, { status: 200 });
    }
    return new Response('<script src="https://abs.twimg.com/responsive-web/client-web/main.abc.js"></script>', { status: 200 });
  });
  const tweet = await publishTweet(client, 'rotated endpoint');
  assert.equal(tweet.tweetId, '67890');
  assert.deepEqual(postUrls.map((url) => url.match(/graphql\/([^/]+)/)[1]), ['query-1', 'query-2']);
});

test('uses the signed-in status endpoint when GraphQL returns code 226', async () => {
  let fallbackRequest;
  const client = await prepareClient(async (url, init = {}) => {
    const value = String(url);
    if (value.endsWith('/i/api/account/settings.json')) return jsonResponse({ screen_name: 'tester', user_id: '42' });
    if (value.includes('/statuses/update.json')) {
      fallbackRequest = init;
      return jsonResponse({ id_str: '22601' });
    }
    if (value.startsWith('https://x.com/i/api/graphql/')) {
      return jsonResponse({ errors: [{ code: 226, message: 'Automated request' }] });
    }
    if (value.includes('abs.twimg.com')) {
      return new Response('e.exports={queryId:"query-226",operationName:"CreateTweet"}', { status: 200 });
    }
    return new Response('<script src="https://abs.twimg.com/responsive-web/client-web/main.abc.js"></script>', { status: 200 });
  });
  const tweet = await publishTweet(client, 'fallback post');
  assert.equal(tweet.tweetId, '22601');
  assert.equal(fallbackRequest.headers['x-twitter-auth-type'], 'OAuth2Session');
  assert.equal(new URLSearchParams(fallbackRequest.body).get('status'), 'fallback post');
});
