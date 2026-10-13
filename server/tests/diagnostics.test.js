import assert from 'node:assert/strict';
import { test } from 'node:test';
import { safeDiagnosticMessage, structuredErrorDetails } from '../src/diagnostics.js';
import { patchUnexpectedUploadResponse } from '../scripts/patch-cloudinary-upload-diagnostics.js';

test('server diagnostic messages redact credential-like values and bound their length', () => {
  const message = safeDiagnosticMessage('Authorization=Bearer123 Cookie: session=private api_secret=verysecret mongodb+srv://user:password@cluster.example/db cloudinary://123:key@api.example ' + 'x'.repeat(800));
  assert.doesNotMatch(message, /Bearer123|session=private|verysecret|user:password|123:key/);
  assert.ok(message.length <= 500);
});

test('structured diagnostics include safe provider status and code fields', () => {
  const details = structuredErrorDetails(Object.assign(new Error('api_key=private Cloudinary rejected request'), {
    name: 'UnexpectedResponse', http_code: 403, provider_message: 'api_secret=private account policy blocked upload',
    provider_code: 'UPLOAD_DISABLED', x_cld_error: 'Upload blocked by policy'
  }));
  assert.deepEqual(details, {
    errorName: 'UnexpectedResponse',
    message: 'api_key=[redacted] Cloudinary rejected request',
    httpStatus: 403,
    cloudinaryCode: 'UPLOAD_DISABLED',
    providerMessage: 'api_secret=[redacted] account policy blocked upload',
    xCldError: 'Upload blocked by policy'
  });
});

test('Cloudinary SDK patch captures only parsed provider diagnostics and is idempotent', () => {
  const source = `    } else {\n      let error = {\n        message: \`Server returned unexpected status code - \${res.statusCode}\`,\n        http_code: res.statusCode,\n        name: "UnexpectedResponse"\n      };\n      if (USE_PROMISES) {\n        deferred.reject(error);\n      }\n      callback({ error });\n    }`;
  const patched = patchUnexpectedUploadResponse(source);
  assert.match(patched, /provider_message/);
  assert.match(patched, /x_cld_error: res\.headers\["x-cld-error"\]/);
  assert.doesNotMatch(patched, /responseHeaders|request_options|Authorization/);
  assert.equal(patchUnexpectedUploadResponse(patched), patched);
});
