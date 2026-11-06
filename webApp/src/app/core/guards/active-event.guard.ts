import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { EventService } from '../services/event.service';

/** Hides the event registration page for everyone while no event is enabled. */
export const activeEventGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const events = inject(EventService);
  const router = inject(Router);

  await auth.whenReady();
  if (!auth.currentUser()) return router.parseUrl('/login');
  try {
    if (await events.fetchActiveEvent()) return true;
  } catch (error) {
    console.error('No se pudo verificar el evento activo:', error);
  }
  return router.parseUrl('/');
};
