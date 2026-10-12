import { Component, computed, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { marked } from 'marked';
import { DataStoreService } from '../../core/services/data-store.service';
import { ScoringService, PlayerScoreSummary } from '../../core/services/scoring.service';
import { TeamBalancerService } from '../../core/services/team-balancer.service';

interface StandingRow {
  playerId: string;
  posicion: number;
  galactico: string;
  bullying: string;
  summary: PlayerScoreSummary;
  rating: number;
}

const ANNOUNCEMENTS_PATH = 'anuncios.md';
const ANNOUNCEMENTS_COLLAPSED_KEY = 'ffch.announcements.collapsed';

@Component({
  selector: 'app-dashboard',
  imports: [RouterLink],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss'
})
export class DashboardComponent {
  readonly loading = signal(true);
  readonly rows = signal<StandingRow[]>([]);
  readonly sortedRows = computed(() => [...this.rows()].sort((a, b) => b.summary.puntos - a.summary.puntos));

  readonly announcements = signal<string[]>([]);
  readonly announcementsCollapsed = signal(localStorage.getItem(ANNOUNCEMENTS_COLLAPSED_KEY) === 'true');

  toggleAnnouncements(): void {
    const next = !this.announcementsCollapsed();
    this.announcementsCollapsed.set(next);
    localStorage.setItem(ANNOUNCEMENTS_COLLAPSED_KEY, String(next));
  }

  constructor(
    private readonly store: DataStoreService,
    private readonly scoring: ScoringService,
    private readonly balancer: TeamBalancerService
  ) {
    void this.load();
    void this.loadAnnouncements();
  }

  private async loadAnnouncements(): Promise<void> {
    try {
      const response = await fetch(new URL(ANNOUNCEMENTS_PATH, document.baseURI));
      if (!response.ok) return;
      const markdown = (await response.text()).replace(/<!--[\s\S]*?-->/g, '');
      const items = markdown
        .split(/^\s*---\s*$/m)
        .map((block) => block.trim())
        .filter((block) => block.length > 0)
        .map((block) => marked.parse(block, { async: false }));
      this.announcements.set(items);
    } catch {
      // Announcements are optional; ignore load failures.
    }
  }

  async load(): Promise<void> {
    this.loading.set(true);
    const [players, weeklyRecords, tdpHistory, seasonConfig] = await Promise.all([
      this.store.players.toArray(),
      this.store.weeklyRecords.toArray(),
      this.store.tdpHistory.toArray(),
      this.store.getSeasonConfig()
    ]);

    const activePlayers = players.filter((p) => p.activo);
    const summaries = new Map(
      activePlayers.map((player) => [
        player.id,
        this.scoring.summarizePlayer(
          player.id,
          weeklyRecords,
          tdpHistory,
          seasonConfig.weights,
          player.sedeTemporadaAnterior,
          seasonConfig.ptsTemporadaAnteriorIncludedInSum,
          player.socioFundador
        )
      ])
    );
    const maxPoints = Math.max(0, ...Array.from(summaries.values(), (s) => s.puntos));

    const rows: StandingRow[] = activePlayers.map((player) => {
      const summary = summaries.get(player.id)!;
      return {
        playerId: player.id,
        posicion: player.posicion,
        galactico: player.galactico,
        bullying: player.bullying,
        summary,
        rating: player.rating ?? this.balancer.toRatingFromPoints(summary.puntos, maxPoints || 1)
      };
    });

    this.rows.set(rows);
    this.loading.set(false);
  }
}
