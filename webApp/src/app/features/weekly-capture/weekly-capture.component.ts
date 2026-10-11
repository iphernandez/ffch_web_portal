import { Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DataStoreService } from '../../core/services/data-store.service';
import { AuthService } from '../../core/services/auth.service';
import { Player } from '../../core/models/player.model';
import { WeeklyRecord } from '../../core/models/weekly-record.model';

interface CaptureRow {
  player: Player;
  record: WeeklyRecord;
}

@Component({
  selector: 'app-weekly-capture',
  imports: [FormsModule],
  templateUrl: './weekly-capture.component.html',
  styleUrl: './weekly-capture.component.scss'
})
export class WeeklyCaptureComponent {
  readonly fechas = signal<string[]>([]);
  readonly selectedFecha = signal<string>(this.nextThursday());
  readonly rows = signal<CaptureRow[]>([]);

  constructor(
    private readonly store: DataStoreService,
    private readonly auth: AuthService
  ) {
    void this.loadFechas();
    void this.loadRows();
  }

  get isAdmin(): boolean {
    return this.auth.currentUser()?.isAdmin ?? false;
  }

  private nextThursday(): string {
    const date = new Date();
    date.setDate(date.getDate() + ((4 - date.getDay() + 7) % 7));
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  // Pago applies only from April 1st to September 30th.
  private isPagoSeason(fecha: string): boolean {
    const month = Number(fecha.slice(5, 7));
    return month >= 4 && month <= 9;
  }

  async loadFechas(): Promise<void> {
    const records = await this.store.weeklyRecords.toArray();
    const fechas = Array.from(new Set(records.map((r) => r.fecha))).sort().reverse();
    this.fechas.set(fechas);
  }

  async onFechaChange(fecha: string): Promise<void> {
    this.selectedFecha.set(fecha);
    await this.loadRows();
  }

  async loadRows(): Promise<void> {
    const fecha = this.selectedFecha();
    const players = await this.store.players.filter((p) => p.activo).sortBy('posicion');
    const existing = await this.store.weeklyRecords.where('fecha').equals(fecha).toArray();
    const byPlayer = new Map(existing.map((r) => [r.playerId, r]));
    const pago = this.isPagoSeason(fecha);

    const rows: CaptureRow[] = players.map((player) => ({
      player,
      record:
        byPlayer.get(player.id) ??
        ({
          id: `${player.id}-${fecha}`,
          playerId: player.id,
          fecha,
          rsvp: null,
          jugo: null,
          sede: null,
          pago,
          tarde: false,
          cupoExPat: false
        } as WeeklyRecord)
    }));
    this.rows.set(rows);
  }

  async saveRow(row: CaptureRow): Promise<void> {
    if (!this.isAdmin) return;
    await this.store.weeklyRecords.put(row.record);
    await this.loadFechas();
  }

  async deleteRow(row: CaptureRow): Promise<void> {
    if (!this.isAdmin) return;
    const confirmed = confirm(`¿Eliminar el registro de ${row.player.galactico} para ${this.selectedFecha()}? Esto también elimina cualquier cálculo derivado de ese registro.`);
    if (!confirmed) return;
    await this.store.weeklyRecords.delete(row.record.id);
    await this.loadFechas();
    await this.loadRows();
  }

  async createFecha(fecha: string): Promise<void> {
    if (!this.isAdmin) return;
    if (!fecha) return;
    this.selectedFecha.set(fecha);
    await this.loadRows();
  }

  async deleteFecha(): Promise<void> {
    if (!this.isAdmin) return;
    const fecha = this.selectedFecha();
    const confirmed = confirm(`¿Eliminar la captura completa de ${fecha} para todos los jugadores? Esto también elimina cualquier cálculo derivado de esos registros.`);
    if (!confirmed) return;
    await this.store.weeklyRecords.where('fecha').equals(fecha).delete();
    await this.loadFechas();
    await this.loadRows();
  }
}
