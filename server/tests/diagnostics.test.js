import assert from 'node:assert/strict';
import { test } from 'node:test';
import { safeDiagnosticMessage } from '../src/diagnostics.js';

test('server diagnostic messages redact credential-like values and bound their length', () => {
  const message = safeDiagnosticMessage('Authorization=Bearer123 api_secret=verysecret cloudinary://123:key@api.example ' + 'x'.repeat(800));
  assert.doesNotMatch(message, /Bearer123|verysecret|123:key/);
  assert.ok(message.length <= 500);
});
