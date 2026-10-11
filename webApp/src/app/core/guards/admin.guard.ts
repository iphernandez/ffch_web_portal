import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

/** Restricts routes intended for administrators. */
export const adminGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  await auth.whenReady();
  const user = auth.currentUser();
  if (!user) return router.parseUrl('/login');
  if (user.isAdmin) return true;
  return router.parseUrl('/');
};
