import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describeApiError } from './api-error.mjs';

test('extracts a safe structured JSON error and strips query strings from diagnostics', async () => {
  assert.deepEqual(await describeApiError({ status: 413, url: 'https://site.test/api/projects/upload?jwt=secret', error: { message: 'Image exceeds the 20 MB limit.' } }), {
    message: 'Image exceeds the 20 MB limit.', status: 413, requestPath: '/api/projects/upload', requestId: ''
  });
});

test('extracts JSON error messages from Blob response bodies', async () => {
  const error = { status: 410, url: '/api/projects/id/image', error: new Blob([JSON.stringify({ message: 'This room photo is no longer available.' })], { type: 'application/json' }) };
  assert.equal((await describeApiError(error)).message, 'This room photo is no longer available.');
});

test('keeps safe plain-text errors but replaces HTML and gateway bodies', async () => {
  assert.equal((await describeApiError({ status: 429, error: 'Upload limit reached. Try later.' })).message, 'Upload limit reached. Try later.');
  assert.match((await describeApiError({ status: 502, error: '<html><title>Bad Gateway</title></html>' })).message, /HTTP 502/);
  assert.match((await describeApiError({ status: 502, error: 'upstream connect error' })).message, /HTTP 502/);
  assert.match((await describeApiError({ status: 502, error: new Blob(['<html><h1>Bad Gateway</h1></html>']) })).message, /HTTP 502/);
});

test('reports network failures and safe ordinary JavaScript exceptions', async () => {
  assert.match((await describeApiError({ status: 0, message: 'Http failure response' })).message, /could not be reached/);
  assert.equal((await describeApiError(new Error('The photo could not be decoded.'))).message, 'The photo could not be decoded.');
});

test('surfaces only a validated request ID as a safe support reference', async () => {
  const requestId = '65e3f5a8-3e6f-4eb4-a641-bcb2eb3afc54';
  const error = { status: 500, headers: { get: () => requestId }, error: { message: 'Something went wrong. Please try again.' } };
  const detail = await describeApiError(error);
  assert.equal(detail.requestId, requestId);
  assert.match(detail.message, new RegExp(requestId));
});

test('never shows stacks or secret-bearing error text', async () => {
  assert.doesNotMatch((await describeApiError({ status: 500, error: { message: 'password=not-for-users' } })).message, /password/);
  assert.doesNotMatch((await describeApiError(new Error('Error: failed\n at Handler (/private/server.js)'))).message, /Handler|server\.js/);
});
