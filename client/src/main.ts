import { bootstrapApplication } from '@angular/platform-browser';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { AppComponent } from './app/app.component';
import { csrfInterceptor } from './app/csrf.interceptor';
import { CsrfTokenManager } from './app/csrf-token.mjs';

bootstrapApplication(AppComponent, {
  providers: [
    provideHttpClient(withInterceptors([csrfInterceptor])),
    { provide: CsrfTokenManager, useValue: new CsrfTokenManager() }
  ]
}).catch((err) => console.error(err));
