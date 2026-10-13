export function safeDiagnosticMessage(value) {
  return String(value || 'Request failed')
    .replace(/mongodb(?:\+srv)?:\/\/[^\s"'<>]+/gi, 'mongodb://[redacted]')
    .replace(/cloudinary:\/\/[^@\s]+@/gi, 'cloudinary://[redacted]@')
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
    .replace(/(authorization|cookie|set-cookie|x-csrf-token)\s*[:=]\s*[^\r\n]*/gi, '$1=[redacted]')
    .replace(/(api[_ -]?secret|api[_ -]?key|password|authorization|cookie|csrf|jwt|token)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}

export function structuredErrorDetails(error) {
  const status = Number(error?.http_code ?? error?.statusCode ?? error?.status);
  const code = error?.code ?? error?.error?.code;
  return {
    errorName: safeDiagnosticMessage(error?.name || 'Error'),
    message: safeDiagnosticMessage(error?.message || 'Operation failed'),
    ...(Number.isFinite(status) ? { httpStatus: status } : {}),
    ...(code !== undefined ? { cloudinaryCode: safeDiagnosticMessage(code) } : {})
  };
}
