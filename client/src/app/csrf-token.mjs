/** Keeps the readable CSRF cookie and the header token in sync across requests. */
export class CsrfTokenManager {
  constructor(fetchImpl = globalThis.fetch.bind(globalThis), apiBase = '/api') {
    this.fetchImpl = fetchImpl;
    this.apiBase = apiBase;
    this.token = '';
    this.refreshInFlight = null;
  }

  ensureToken() {
    if (this.refreshInFlight) return this.refreshInFlight;
    if (this.token) return Promise.resolve(this.token);
    return this.refresh();
  }

  refreshIfCurrent(rejectedToken) {
    if (this.refreshInFlight) return this.refreshInFlight;
    if (this.token && this.token !== rejectedToken) return Promise.resolve(this.token);
    this.token = '';
    return this.refresh();
  }

  refresh() {
    if (this.refreshInFlight) return this.refreshInFlight;
    const request = Promise.resolve().then(() => this.fetchImpl(`${this.apiBase}/auth/csrf`, {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json' }
    })).then(async (response) => {
      if (!response.ok) throw new Error(`CSRF bootstrap failed with HTTP ${response.status}.`);
      const payload = await response.json();
      if (typeof payload?.csrfToken !== 'string' || !payload.csrfToken) throw new Error('CSRF bootstrap returned no token.');
      this.token = payload.csrfToken;
      return this.token;
    });
    const sharedRequest = request.finally(() => {
      if (this.refreshInFlight === sharedRequest) this.refreshInFlight = null;
    });
    this.refreshInFlight = sharedRequest;
    return sharedRequest;
  }
}
