export function safeDiagnosticMessage(value) {
  return String(value || 'Request failed')
    .replace(/cloudinary:\/\/[^@\s]+@/gi, 'cloudinary://[redacted]@')
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
    .replace(/(api[_ -]?secret|api[_ -]?key|password|authorization|cookie|csrf|jwt|token)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}
