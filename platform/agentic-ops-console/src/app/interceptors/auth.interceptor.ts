import {
  HttpInterceptorFn,
  HttpErrorResponse,
} from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { AuthService } from '../services/auth.service';

/**
 * Adds `Authorization: Bearer <jwt>` to every outbound request.
 * On 401 responses we clear the stale token and bounce to /login —
 * the catalog server's RFC 7807 error response is preserved for
 * the caller to display.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const token = auth.token();
  const enriched = token
    ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
    : req;
  return next(enriched).pipe(
    catchError((err: HttpErrorResponse) => {
      if (err.status === 401) {
        auth.logout();
        void router.navigate(['/login']);
      }
      return throwError(() => err);
    }),
  );
};
