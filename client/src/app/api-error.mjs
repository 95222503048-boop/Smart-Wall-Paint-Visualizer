const fallbackMessage = 'Something went wrong. Please try again.';
const networkMessage = 'Stillroom could not be reached. Check your connection and try again.';

function isSensitiveOrTechnical(value) {
  return /<!doctype|<html|<body|<head|<title|\bstack trace\b|\bat\s+\S+\s*\(|\b(password|authorization|cookie|csrf|jwt|secret|token)\s*[:=]/i.test(value);
}

function safeText(value) {
  if (typeof value !== 'string') return '';
  const text = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text || text.length > 320 || isSensitiveOrTechnical(text)) return '';
  if (/\b(bad gateway|gateway timeout|upstream|cloudflare|vercel edge|nginx)\b/i.test(text)) return '';
  return text;
}

async function responseMessage(body) {
  if (typeof Blob !== 'undefined' && body instanceof Blob) {
    try { return await responseMessage(await body.text()); } catch { return ''; }
  }
  if (typeof body === 'string') {
    const text = body.trim();
    if (!text) return '';
    try { return responseMessage(JSON.parse(text)); }
    catch { return safeText(text); }
  }
  if (body && typeof body === 'object') return safeText(body.message);
  return '';
}

function safeRequestPath(url) {
  if (typeof url !== 'string') return '';
  const path = url.replace(/^https?:\/\/[^/]+/i, '').split(/[?#]/, 1)[0];
  return /^\/[a-z0-9/_-]{1,240}$/i.test(path) ? path : '';
}

export async function describeApiError(error) {
  const status = Number.isInteger(error?.status) && error.status >= 0 ? error.status : null;
  const responseRequestId = error?.headers?.get?.('X-Request-Id') || error?.error?.requestId || '';
  const requestId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(responseRequestId) ? responseRequestId : '';
  let message = await responseMessage(error?.error);
  if (!message) message = safeText(error?.message);
  if (status === 0 || (!status && /failed to fetch|fetch failed|networkerror|network request failed/i.test(error?.message || ''))) {
    message = networkMessage;
  } else if (!message && [502, 503, 504].includes(status)) {
    message = `Stillroom's service could not complete the request (HTTP ${status}). Please try again shortly.${requestId ? ` Reference: ${requestId}.` : ''}`;
  } else if (!message && status) {
    message = `The request could not be completed (HTTP ${status}). Please try again.`;
  } else if (!message) {
    message = fallbackMessage;
  }
  if (requestId && status >= 500 && !message.includes(requestId)) message += ` Reference: ${requestId}.`;
  return { message, status, requestPath: safeRequestPath(error?.url), requestId };
}

export function isMissingOriginalImage(error) {
  return Number(error?.status) === 410;
}
