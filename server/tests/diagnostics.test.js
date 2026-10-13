import assert from 'node:assert/strict';
import { test } from 'node:test';
import { safeDiagnosticMessage, structuredErrorDetails } from '../src/diagnostics.js';

test('server diagnostic messages redact credential-like values and bound their length', () => {
  const message = safeDiagnosticMessage('Authorization=Bearer123 Cookie: session=private api_secret=verysecret mongodb+srv://user:password@cluster.example/db cloudinary://123:key@api.example ' + 'x'.repeat(800));
  assert.doesNotMatch(message, /Bearer123|session=private|verysecret|user:password|123:key/);
  assert.ok(message.length <= 500);
});

test('structured diagnostics include safe provider status and code fields', () => {
  const details = structuredErrorDetails(Object.assign(new Error('api_key=private Cloudinary rejected request'), {
    name: 'CloudinaryError', http_code: 403, code: 'NOT_ALLOWED'
  }));
  assert.deepEqual(details, {
    errorName: 'CloudinaryError',
    message: 'api_key=[redacted] Cloudinary rejected request',
    httpStatus: 403,
    cloudinaryCode: 'NOT_ALLOWED'
  });
});
