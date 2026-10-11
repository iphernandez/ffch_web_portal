import { Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DataStoreService } from '../../core/services/data-store.service';
import { AuthService } from '../../core/services/auth.service';
import { Player } from '../../core/models/player.model';

function slugify(text: string): string {
  return (
    text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'player'
  );
}

@Component({
  selector: 'app-roster',
  imports: [FormsModule],
  templateUrl: './roster.component.html',
  styleUrl: './roster.component.scss'
})
export class RosterComponent {
  readonly players = signal<Player[]>([]);

  readonly newPlayer: Partial<Player> = {
    activo: true,
    sedeTemporadaAnterior: false,
    socioFundador: false
  };
  constructor(
    private readonly store: DataStoreService,
    private readonly auth: AuthService
  ) {
    void this.load();
  }

  get isAdmin(): boolean {
    return this.auth.currentUser()?.isAdmin ?? false;
  }

  async load(): Promise<void> {
    const players = await this.store.players.orderBy('posicion').toArray();
    this.players.set(players);
  }

  async addPlayer(): Promise<void> {
    if (!this.isAdmin) return;
    const galactico = this.newPlayer.galactico?.trim();
    if (!galactico) return;

    let id = slugify(galactico);
    const existingIds = new Set(this.players().map((p) => p.id));
    while (existingIds.has(id)) id += '-2';

    const player: Player = {
      id,
      galactico,
      bullying: this.newPlayer.bullying?.trim() ?? '',
      wanombre: this.newPlayer.wanombre?.trim() ?? '',
      wanumber: this.newPlayer.wanumber?.trim() ?? '',
      posicion: this.newPlayer.posicion ?? this.players().length + 1,
      activo: true,
      sedeTemporadaAnterior: !!this.newPlayer.sedeTemporadaAnterior,
      socioFundador: !!this.newPlayer.socioFundador
    };

    await this.store.players.add(player);
    this.newPlayer.galactico = '';
    this.newPlayer.bullying = '';
    this.newPlayer.wanombre = '';
    this.newPlayer.wanumber = '';
    this.newPlayer.posicion = undefined;
    this.newPlayer.sedeTemporadaAnterior = false;
    this.newPlayer.socioFundador = false;
    await this.load();
  }

  async updatePlayer(player: Player): Promise<void> {
    if (!this.isAdmin) return;
    await this.store.players.put(player);
  }

  async removePlayer(player: Player): Promise<void> {
    if (!this.isAdmin) return;
    await this.store.players.delete(player.id);
    await this.store.weeklyRecords.where('playerId').equals(player.id).delete();
    await this.store.tdpHistory.where('playerId').equals(player.id).delete();
    await this.load();
  }
}
