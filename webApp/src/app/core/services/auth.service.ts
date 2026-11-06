import { Injectable, signal } from '@angular/core';
import {
  User,
  createUserWithEmailAndPassword,
  confirmPasswordReset as fbConfirmPasswordReset,
  EmailAuthProvider,
  onAuthStateChanged,
  reauthenticateWithCredential,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updatePassword,
  verifyPasswordResetCode
} from 'firebase/auth';
import { collection, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from 'firebase/firestore';
import { firebaseAuth, firestore } from './firebase';
import { DataStoreService } from './data-store.service';
import { RemoteSyncService } from './remote-sync.service';
import { PublicUser } from '../models/user.model';
import { environment } from '../../../environments/environment';

const MIN_PASSWORD_LENGTH = 8;
const USERS_COLLECTION = 'users';
const SEED_STATUS_DOC = 'meta/seedStatus';

// Seed account requested by the repo owner; password must be changed on first login.
const SEED_ADMIN_EMAIL = 'i.patricio.hernandez@gmail.com';
const SEED_ADMIN_NAME = 'Pato "Presi" Hernandez';
const SEED_ADMIN_TEMP_PASSWORD = 'Ffch2026-Presi!';

export interface AuthResult {
  success: boolean;
  message?: string;
}

function friendlyAuthError(error: unknown): string {
  const code = (error as { code?: string })?.code ?? '';
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Correo o contraseña incorrectos.';
    case 'auth/email-already-in-use':
      return 'Ya existe una cuenta con ese correo.';
    case 'auth/invalid-email':
      return 'Ingresa un correo electrónico válido.';
    case 'auth/weak-password':
      return `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`;
    case 'auth/too-many-requests':
      return 'Demasiados intentos. Intenta de nuevo más tarde.';
    case 'auth/expired-action-code':
    case 'auth/invalid-action-code':
      return 'El enlace de restablecimiento ya no es válido. Solicita uno nuevo.';
    default:
      return 'Ocurrió un error inesperado. Intenta de nuevo.';
  }
}

/**
 * Accounts live in Firebase Authentication (credentials, verified server-side — never exposed to
 * the client) plus a Firestore `users/{uid}` profile doc (name/role/status), so the Usuarios page
 * lists every account regardless of which browser/device it was created on.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  readonly currentUser = signal<PublicUser | null>(null);
  readonly ready = signal(false);
  private readonly initPromise: Promise<void>;

  constructor(
    private readonly store: DataStoreService,
    private readonly remoteSync: RemoteSyncService
  ) {
    this.initPromise = this.init();
  }

  whenReady(): Promise<void> {
    return this.initPromise;
  }

  private async init(): Promise<void> {
    try {
      await this.seedAdminIfNeeded();
    } catch (error) {
      // Don't let a setup problem (rules not published yet, domain not authorized, etc.) hang the app.
      console.error('No se pudo verificar/crear la cuenta administradora inicial:', error);
    }

    await new Promise<void>((resolve) => {
      const unsubscribe = onAuthStateChanged(firebaseAuth, async (firebaseUser) => {
        await this.syncCurrentUser(firebaseUser);
        unsubscribe();
        resolve();
      });
    });
    onAuthStateChanged(firebaseAuth, (firebaseUser) => void this.syncCurrentUser(firebaseUser));
    this.ready.set(true);
  }

  private async syncCurrentUser(firebaseUser: User | null): Promise<void> {
    if (!firebaseUser) {
      this.currentUser.set(null);
      return;
    }
    try {
      const profile = await this.loadProfile(firebaseUser.uid);
      if (!profile || profile.disabled) {
        this.currentUser.set(null);
        if (profile?.disabled) await signOut(firebaseAuth);
        return;
      }
      this.currentUser.set(profile);
      await this.autoSyncSharedDataIfNeeded();
    } catch (error) {
      // Firestore unreachable/rules misconfigured: fail closed (signed out) instead of hanging init().
      console.error('No se pudo cargar el perfil del usuario:', error);
      this.currentUser.set(null);
    }
  }

  private async loadProfile(uid: string): Promise<PublicUser | null> {
    const snapshot = await getDoc(doc(firestore, USERS_COLLECTION, uid));
    if (!snapshot.exists()) return null;
    return { id: uid, ...(snapshot.data() as Omit<PublicUser, 'id'>) };
  }

  /** Runs once globally (guarded by a public `meta/seedStatus` doc) so the seed admin exists in Firestore. */
  private async seedAdminIfNeeded(): Promise<void> {
    const seedRef = doc(firestore, SEED_STATUS_DOC);
    const seedSnap = await getDoc(seedRef);
    if (seedSnap.exists()) return;

    try {
      const credential = await createUserWithEmailAndPassword(firebaseAuth, SEED_ADMIN_EMAIL, SEED_ADMIN_TEMP_PASSWORD);
      await setDoc(doc(firestore, USERS_COLLECTION, credential.user.uid), {
        email: SEED_ADMIN_EMAIL.toLowerCase(),
        name: SEED_ADMIN_NAME,
        isAdmin: true,
        disabled: false,
        mustChangePassword: true,
        createdAt: new Date().toISOString()
      });
      await signOut(firebaseAuth);
    } catch (error) {
      // If another browser/tab already created it (auth/email-already-in-use), that's fine — just mark seeded.
      if ((error as { code?: string })?.code !== 'auth/email-already-in-use') throw error;
    } finally {
      await setDoc(seedRef, { seeded: true, seededAt: new Date().toISOString() });
    }
  }

  async register(email: string, name: string, password: string): Promise<AuthResult> {
    if (!name.trim()) {
      return { success: false, message: 'Ingresa tu nombre.' };
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      return { success: false, message: `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.` };
    }

    const normalizedEmail = email.trim().toLowerCase();
    try {
      const credential = await createUserWithEmailAndPassword(firebaseAuth, normalizedEmail, password);
      await setDoc(doc(firestore, USERS_COLLECTION, credential.user.uid), {
        email: normalizedEmail,
        name: name.trim(),
        isAdmin: false,
        disabled: false,
        mustChangePassword: false,
        createdAt: new Date().toISOString()
      });
      await signOut(firebaseAuth); // Registering doesn't auto-login; user logs in explicitly.
      return { success: true };
    } catch (error) {
      return { success: false, message: friendlyAuthError(error) };
    }
  }

  async login(email: string, password: string): Promise<AuthResult> {
    try {
      const credential = await signInWithEmailAndPassword(firebaseAuth, email.trim().toLowerCase(), password);
      const profile = await this.loadProfile(credential.user.uid);
      if (!profile || profile.disabled) {
        await signOut(firebaseAuth);
        return { success: false, message: 'Esta cuenta está deshabilitada.' };
      }
      return { success: true };
    } catch (error) {
      return { success: false, message: friendlyAuthError(error) };
    }
  }

  private async autoSyncSharedDataIfNeeded(): Promise<void> {
    const [playersCount, weeklyRecordsCount, tdpHistoryCount] = await Promise.all([
      this.store.players.count(),
      this.store.weeklyRecords.count(),
      this.store.tdpHistory.count()
    ]);

    if (playersCount > 0 || weeklyRecordsCount > 0 || tdpHistoryCount > 0) {
      return;
    }

    try {
      const remote = await this.remoteSync.pull();
      if (remote) await this.store.importAll(remote.data);
    } catch {
      // Ignore sync failures during first login; the user can still use the app with local data or retry later.
    }
  }

  logout(): void {
    void signOut(firebaseAuth);
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<AuthResult> {
    const firebaseUser = firebaseAuth.currentUser;
    const current = this.currentUser();
    if (!firebaseUser || !current) return { success: false, message: 'Debes iniciar sesión.' };
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      return { success: false, message: `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.` };
    }

    try {
      await reauthenticateWithCredential(firebaseUser, EmailAuthProvider.credential(current.email, currentPassword));
      await updatePassword(firebaseUser, newPassword);
      await updateDoc(doc(firestore, USERS_COLLECTION, current.id), { mustChangePassword: false });
      this.currentUser.set({ ...current, mustChangePassword: false });
      return { success: true };
    } catch (error) {
      if ((error as { code?: string })?.code === 'auth/invalid-credential') {
        return { success: false, message: 'La contraseña actual no es correcta.' };
      }
      return { success: false, message: friendlyAuthError(error) };
    }
  }

  /** Sends a real password-reset email via Firebase; the link opens /restablecer-contrasena in this app. */
  async sendForgotPasswordEmail(email: string): Promise<AuthResult> {
    try {
      await sendPasswordResetEmail(firebaseAuth, email.trim().toLowerCase(), {
        url: environment.passwordResetContinueUrl,
        handleCodeInApp: true
      });
      return { success: true };
    } catch (error) {
      // Don't reveal whether the email exists; still report success-shaped message for unknown accounts.
      if ((error as { code?: string })?.code === 'auth/user-not-found') return { success: true };
      return { success: false, message: friendlyAuthError(error) };
    }
  }

  async verifyResetCode(oobCode: string): Promise<{ email: string } | null> {
    try {
      const email = await verifyPasswordResetCode(firebaseAuth, oobCode);
      return { email };
    } catch {
      return null;
    }
  }

  async confirmPasswordReset(oobCode: string, newPassword: string): Promise<AuthResult> {
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      return { success: false, message: `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.` };
    }
    try {
      await fbConfirmPasswordReset(firebaseAuth, oobCode, newPassword);
      return { success: true };
    } catch (error) {
      return { success: false, message: friendlyAuthError(error) };
    }
  }

  async listUsers(): Promise<PublicUser[]> {
    const snapshot = await getDocs(collection(firestore, USERS_COLLECTION));
    return snapshot.docs
      .map((d) => ({ id: d.id, ...(d.data() as Omit<PublicUser, 'id'>) }))
      .sort((a, b) => a.email.localeCompare(b.email));
  }

  /** Only an existing administrator can promote/demote accounts; the last remaining admin cannot be demoted. */
  async setAdmin(userId: string, isAdmin: boolean): Promise<AuthResult> {
    const requester = this.currentUser();
    if (!requester?.isAdmin) return { success: false, message: 'Solo un administrador puede hacer esto.' };

    if (!isAdmin) {
      const guard = await this.blockedIfLastAdmin(userId);
      if (guard) return guard;
    }

    await updateDoc(doc(firestore, USERS_COLLECTION, userId), { isAdmin });
    if (requester.id === userId) {
      this.currentUser.set({ ...requester, isAdmin });
    }
    return { success: true };
  }

  /** Disables login for the account. Full deletion isn't available without a server-side Admin SDK. */
  async setDisabled(userId: string, disabled: boolean): Promise<AuthResult> {
    const requester = this.currentUser();
    if (!requester?.isAdmin) return { success: false, message: 'Solo un administrador puede hacer esto.' };
    if (requester.id === userId) return { success: false, message: 'No puedes deshabilitar tu propia cuenta.' };

    if (disabled) {
      const guard = await this.blockedIfLastAdmin(userId);
      if (guard) return guard;
    }

    await updateDoc(doc(firestore, USERS_COLLECTION, userId), { disabled });
    return { success: true };
  }

  /** Links an account to a roster player (or unlinks with null); a player can be linked to only one account. */
  async setPlayer(userId: string, playerId: string | null): Promise<AuthResult> {
    const requester = this.currentUser();
    if (!requester?.isAdmin) return { success: false, message: 'Solo un administrador puede hacer esto.' };

    if (playerId) {
      const linked = await getDocs(query(collection(firestore, USERS_COLLECTION), where('playerId', '==', playerId)));
      if (linked.docs.some((d) => d.id !== userId)) {
        return { success: false, message: 'Ese jugador ya está vinculado a otra cuenta.' };
      }
    }

    await updateDoc(doc(firestore, USERS_COLLECTION, userId), { playerId });
    if (requester.id === userId) {
      this.currentUser.set({ ...requester, playerId });
    }
    return { success: true };
  }

  private async blockedIfLastAdmin(userId: string): Promise<AuthResult | null> {
    const target = await this.loadProfile(userId);
    if (!target) return { success: false, message: 'Usuario no encontrado.' };
    if (!target.isAdmin) return null;

    const admins = await getDocs(query(collection(firestore, USERS_COLLECTION), where('isAdmin', '==', true)));
    const remaining = admins.docs.filter((d) => d.id !== userId);
    if (remaining.length === 0) {
      return { success: false, message: 'Debe existir al menos un administrador.' };
    }
    return null;
  }

  /** Admin-triggered reset: sends the target user a real password-reset email (no temp password to relay). */
  async adminSendResetEmail(user: PublicUser): Promise<AuthResult> {
    const requester = this.currentUser();
    if (!requester?.isAdmin) return { success: false, message: 'Solo un administrador puede hacer esto.' };
    return this.sendForgotPasswordEmail(user.email);
  }
}
