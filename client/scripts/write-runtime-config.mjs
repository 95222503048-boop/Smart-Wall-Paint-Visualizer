import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const directory = path.dirname(fileURLToPath(import.meta.url));
const target = path.resolve(directory, '../src/assets/runtime-config.js');
const configuredUrl = process.env.API_BASE_URL || (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:4000');
let apiBaseUrl;

try {
  if (!configuredUrl) throw new Error();
  const parsed = new URL(configuredUrl);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:')) {
    throw new Error();
  }
  apiBaseUrl = parsed.origin;
} catch {
  throw new Error('API_BASE_URL must be a valid server origin (use https:// in production).');
}

await writeFile(target, `window.__STILLROOM_CONFIG__ = ${JSON.stringify({ apiBaseUrl })};\n`, 'utf8');
console.log(`Client API configured for ${apiBaseUrl}`);
