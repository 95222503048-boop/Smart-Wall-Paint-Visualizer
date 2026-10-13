import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const marker = '// Stillroom: preserve safe provider diagnostics for unexpected upload responses.';

export function patchUnexpectedUploadResponse(source) {
  if (source.includes(marker)) return source;

  const unexpectedResponseBranch = /    } else \{\r?\n      let error = \{\r?\n        message: `Server returned unexpected status code - \$\{res\.statusCode\}`,\r?\n        http_code: res\.statusCode,\r?\n        name: "UnexpectedResponse"\r?\n      \};\r?\n      if \(USE_PROMISES\) \{\r?\n        deferred\.reject\(error\);\r?\n      \}\r?\n      callback\(\{ error \}\);\r?\n    \}/;

  if (!unexpectedResponseBranch.test(source)) {
    throw new Error('Cloudinary uploader response branch did not match the expected SDK source; refusing to patch an unknown version.');
  }

  return source.replace(unexpectedResponseBranch, `    } else {
      // Stillroom: preserve safe provider diagnostics for unexpected upload responses.
      let responseBody = "";
      res.on("data", (chunk) => {
        if (responseBody.length < 16384) responseBody += chunk.toString("utf8").slice(0, 16384 - responseBody.length);
      });
      res.on("end", () => {
        const parsedResponse = parseResult(responseBody, res);
        const providerError = parsedResponse && parsedResponse.error ? parsedResponse.error : {};
        const error = {
          message: \`Server returned unexpected status code - \${res.statusCode}\`,
          http_code: res.statusCode,
          name: "UnexpectedResponse",
          provider_message: typeof providerError.message === "string" ? providerError.message : undefined,
          provider_code: providerError.code ?? providerError.error_code,
          x_cld_error: res.headers["x-cld-error"]
        };
        if (USE_PROMISES) {
          deferred.reject(error);
        }
        callback({ error });
      });
    }`);
}

function applyPatch() {
  const uploaderPath = require.resolve('cloudinary/lib/uploader.js');
  const packagePath = join(dirname(dirname(uploaderPath)), 'package.json');
  const installedPackage = JSON.parse(readFileSync(packagePath, 'utf8'));
  if (installedPackage.version !== '2.11.0') {
    throw new Error(`Cloudinary SDK ${installedPackage.version} is not the reviewed version for this diagnostics patch.`);
  }
  const source = readFileSync(uploaderPath, 'utf8');
  const patchedSource = patchUnexpectedUploadResponse(source);
  if (source !== patchedSource) writeFileSync(uploaderPath, patchedSource);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) applyPatch();
