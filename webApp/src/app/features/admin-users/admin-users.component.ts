import { Component, computed, signal } from '@angular/core';
import { AuthService } from '../../core/services/auth.service';
import { DataStoreService } from '../../core/services/data-store.service';
import { Player } from '../../core/models/player.model';
import { PublicUser } from '../../core/models/user.model';

@Component({
  selector: 'app-admin-users',
  imports: [],
  templateUrl: './admin-users.component.html',
  styleUrl: './admin-users.component.scss'
})
export class AdminUsersComponent {
  readonly users = signal<PublicUser[]>([]);
  readonly players = signal<Player[]>([]);
  readonly loading = signal(true);
  readonly statusMessage = signal('');
  readonly statusIsError = signal(false);

  /** playerId -> userId, to prevent linking one player to two accounts. */
  readonly linkedPlayers = computed(
    () => new Map(this.users().filter((user) => user.playerId).map((user) => [user.playerId as string, user.id]))
  );

  constructor(
    private readonly auth: AuthService,
    private readonly store: DataStoreService
  ) {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    const [users, players] = await Promise.all([this.auth.listUsers(), this.store.players.orderBy('galactico').toArray()]);
    this.users.set(users);
    this.players.set(players);
    this.loading.set(false);
  }

  isLinkedToOther(playerId: string, user: PublicUser): boolean {
    const owner = this.linkedPlayers().get(playerId);
    return !!owner && owner !== user.id;
  }

  async setPlayer(user: PublicUser, playerId: string): Promise<void> {
    const result = await this.auth.setPlayer(user.id, playerId || null);
    await this.reportAndReload(result);
  }

  async toggleAdmin(user: PublicUser): Promise<void> {
    const result = await this.auth.setAdmin(user.id, !user.isAdmin);
    await this.reportAndReload(result);
  }

  async toggleDisabled(user: PublicUser): Promise<void> {
    const action = user.disabled ? 'habilitar' : 'deshabilitar';
    if (!confirm(`¿Seguro que quieres ${action} la cuenta de ${user.name} (${user.email})?`)) return;
    const result = await this.auth.setDisabled(user.id, !user.disabled);
    await this.reportAndReload(result);
  }

  async resetPassword(user: PublicUser): Promise<void> {
    const result = await this.auth.adminSendResetEmail(user);
    this.statusIsError.set(!result.success);
    this.statusMessage.set(
      result.success
        ? `Se envió un correo de restablecimiento a ${user.email}.`
        : (result.message ?? 'No se pudo enviar el correo de restablecimiento.')
    );
  }

  private async reportAndReload(result: { success: boolean; message?: string }): Promise<void> {
    this.statusIsError.set(!result.success);
    this.statusMessage.set(result.success ? '' : (result.message ?? 'No se pudo completar la acción.'));
    await this.load();
  }
}
