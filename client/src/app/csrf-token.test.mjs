import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CsrfTokenManager } from './csrf-token.mjs';

const responseFor = (token) => ({ ok: true, status: 200, async json() { return { csrfToken: token }; } });

test('the default fetch implementation is invoked with the global context', async () => {
  const previousFetch = globalThis.fetch;
  let receivedThis;
  let receivedUrl;
  let receivedOptions;
  globalThis.fetch = function (url, options) {
    receivedThis = this;
    receivedUrl = url;
    receivedOptions = options;
    return Promise.resolve(responseFor('token-default'));
  };

  try {
    const manager = new CsrfTokenManager();
    assert.equal(await manager.ensureToken(), 'token-default');
    assert.equal(receivedThis, globalThis);
    assert.equal(receivedUrl, '/api/auth/csrf');
    assert.equal(receivedOptions.credentials, 'same-origin');
    assert.equal(receivedOptions.cache, 'no-store');
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('concurrent token bootstrap attempts share one request and one token', async () => {
  let calls = 0;
  let release;
  const pendingResponse = new Promise((resolve) => { release = resolve; });
  const manager = new CsrfTokenManager(async (url, options) => {
    calls++;
    assert.equal(url, '/api/auth/csrf');
    assert.equal(options.credentials, 'same-origin');
    assert.equal(options.cache, 'no-store');
    return pendingResponse;
  });
  const first = manager.ensureToken();
  const second = manager.ensureToken();
  release(responseFor('token-a'));
  assert.deepEqual(await Promise.all([first, second]), ['token-a', 'token-a']);
  assert.equal(calls, 1);
});

test('a current token is reused without unnecessary refreshes', async () => {
  let calls = 0;
  const manager = new CsrfTokenManager(async () => { calls++; return responseFor('token-a'); });
  assert.equal(await manager.ensureToken(), 'token-a');
  assert.equal(await manager.ensureToken(), 'token-a');
  assert.equal(calls, 1);
});

test('a stale-token rejection refreshes once and later requests use the refreshed token', async () => {
  let calls = 0;
  const manager = new CsrfTokenManager(async () => responseFor(`token-${++calls}`));
  const first = await manager.ensureToken();
  assert.equal(first, 'token-1');
  const [refreshedA, refreshedB] = await Promise.all([
    manager.refreshIfCurrent(first),
    manager.refreshIfCurrent(first)
  ]);
  assert.equal(refreshedA, 'token-2');
  assert.equal(refreshedB, 'token-2');
  assert.equal(await manager.ensureToken(), 'token-2');
  assert.equal(calls, 2);
});

test('a protected request after refresh uses the token written by the latest bootstrap', async () => {
  let calls = 0;
  let csrfCookie = '';
  const manager = new CsrfTokenManager(async () => {
    const token = `token-${++calls}`;
    csrfCookie = token;
    return responseFor(token);
  });
  const staleToken = await manager.ensureToken();
  const refreshed = await manager.refreshIfCurrent(staleToken);
  const protectedRequestHeader = await manager.ensureToken();
  assert.equal(refreshed, csrfCookie);
  assert.equal(protectedRequestHeader, csrfCookie);
});

test('a late rejection for an older token keeps the already-current token', async () => {
  let calls = 0;
  const manager = new CsrfTokenManager(async () => responseFor(`token-${++calls}`));
  const oldToken = await manager.ensureToken();
  manager.token = 'token-newer';
  assert.equal(await manager.refreshIfCurrent(oldToken), 'token-newer');
  assert.equal(calls, 1);
});
