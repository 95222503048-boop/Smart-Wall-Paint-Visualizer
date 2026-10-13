import { HttpErrorResponse, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, from, switchMap, throwError } from 'rxjs';
import { CsrfTokenManager } from './csrf-token.mjs';

const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);
const csrfFailureMessage = 'Security check failed. Refresh the page and try again.';

function withCsrfToken(req: HttpRequest<unknown>, token: string) {
  return req.clone({ withCredentials: true, setHeaders: { 'X-CSRF-Token': token } });
}

export const csrfInterceptor: HttpInterceptorFn = (req, next) => {
  if (safeMethods.has(req.method.toUpperCase()) || !req.url.startsWith('/api/')) return next(req);
  const csrf = inject(CsrfTokenManager);
  return from(csrf.ensureToken()).pipe(switchMap((token) => next(withCsrfToken(req, token)).pipe(
    catchError((error: unknown) => {
      if (!(error instanceof HttpErrorResponse) || error.status !== 403 || error.error?.message !== csrfFailureMessage) return throwError(() => error);
      return from(csrf.refreshIfCurrent(token)).pipe(switchMap((freshToken) => next(withCsrfToken(req, freshToken))));
    })
  )));
};
