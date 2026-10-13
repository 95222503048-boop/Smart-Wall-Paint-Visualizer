import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { createAuthRouter } from '../src/routes/auth.js';
import { authCookieName, csrfCookieName, csrfProtection, readCookie } from '../src/middleware.js';

const user = { _id: 'user-1', name: 'Stillroom User', email: 'user@example.com', role: 'user', passwordHash: 'hashed-password' };

function makeApp() {
  const persistedSession = { _id: 'session-1', user: user._id };
  const UserModel = {
    async exists() { return false; },
    async create(document) { return { ...user, ...document }; },
    findOne() { return { select: async () => user }; }
  };
  const SessionModel = {
    async create() { return persistedSession; },
    async findOneAndUpdate() {}
  };
  const app = express();
  app.use(express.json());
  app.use('/api', csrfProtection);
  app.use('/api/auth', createAuthRouter({
    UserModel,
    SessionModel,
    signAuthToken: () => 'signed-test-session',
    hashPassword: async () => 'hashed-password',
    comparePassword: async () => true,
    loginRateLimit: (_req, _res, next) => next(),
    registrationRateLimit: (_req, _res, next) => next(),
    authenticateUser(req, res, next) {
      if (readCookie(req, authCookieName) !== 'signed-test-session') return res.status(401).json({ message: 'Sign in to continue.' });
      req.user = user;
      req.authSessionId = persistedSession._id;
      next();
    }
  }));
  app.post('/api/protected-test', (_req, res) => res.json({ ok: true }));
  app.use((error, _req, res, _next) => res.status(500).json({ message: error.message }));
  return app;
}

async function withServer(t) {
  const server = createServer(makeApp());
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve, reject) => {
    server.closeAllConnections();
    server.close((error) => error ? reject(error) : resolve());
  }));
  return `http://127.0.0.1:${server.address().port}/api`;
}

async function bootstrap(baseUrl) {
  const response = await fetch(`${baseUrl}/auth/csrf`);
  const body = await response.json();
  const setCookie = response.headers.get('set-cookie') || '';
  const cookieValue = setCookie.match(/(?:^|,\s*)swv_csrf=([^;]+)/)?.[1];
  return { response, token: body.csrfToken, cookie: `${csrfCookieName}=${cookieValue}` };
}

test('CSRF bootstrap returns a token matching the readable cookie with the API cookie path', async (t) => {
  const baseUrl = await withServer(t);
  const { response, token, cookie } = await bootstrap(baseUrl);
  assert.equal(response.status, 200);
  assert.match(token, /^[0-9a-f]{64}$/);
  assert.equal(cookie, `${csrfCookieName}=${token}`);
  assert.match(response.headers.get('set-cookie'), /Path=\/api/);
  assert.doesNotMatch(response.headers.get('set-cookie'), /HttpOnly/);
});

test('CSRF validation rejects a missing cookie', async (t) => {
  const baseUrl = await withServer(t);
  const response = await fetch(`${baseUrl}/protected-test`, { method: 'POST', headers: { 'X-CSRF-Token': 'token' } });
  assert.equal(response.status, 403);
});

test('CSRF validation rejects a missing header', async (t) => {
  const baseUrl = await withServer(t);
  const response = await fetch(`${baseUrl}/protected-test`, { method: 'POST', headers: { Cookie: `${csrfCookieName}=token` } });
  assert.equal(response.status, 403);
});

test('CSRF validation rejects a mismatched cookie and header', async (t) => {
  const baseUrl = await withServer(t);
  const response = await fetch(`${baseUrl}/protected-test`, { method: 'POST', headers: { Cookie: `${csrfCookieName}=cookie-token`, 'X-CSRF-Token': 'header-token' } });
  assert.equal(response.status, 403);
});

test('a bootstrapped token permits login and the issued session cookie persists to /me', async (t) => {
  const baseUrl = await withServer(t);
  const { token, cookie } = await bootstrap(baseUrl);
  const login = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie, 'X-CSRF-Token': token },
    body: JSON.stringify({ email: user.email, password: 'correct horse battery staple' })
  });
  assert.equal(login.status, 200);
  const authCookie = login.headers.get('set-cookie')?.match(/(?:^|,\s*)swv_access=([^;]+)/)?.[1];
  assert.equal(authCookie, 'signed-test-session');
  const session = await fetch(`${baseUrl}/auth/me`, { headers: { Cookie: `${authCookieName}=${authCookie}` } });
  assert.equal(session.status, 200);
  assert.deepEqual((await session.json()).user, { id: user._id, name: user.name, email: user.email, role: user.role });
});

test('a bootstrapped token permits registration', async (t) => {
  const baseUrl = await withServer(t);
  const { token, cookie } = await bootstrap(baseUrl);
  const response = await fetch(`${baseUrl}/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie, 'X-CSRF-Token': token },
    body: JSON.stringify({ name: 'New member', email: 'new@example.com', password: 'correct horse battery staple' })
  });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).user.email, 'new@example.com');
});
