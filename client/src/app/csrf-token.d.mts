export declare class CsrfTokenManager {
  constructor(fetchImpl?: typeof fetch, apiBase?: string);
  token: string;
  ensureToken(): Promise<string>;
  refreshIfCurrent(rejectedToken: string): Promise<string>;
  refresh(): Promise<string>;
}
