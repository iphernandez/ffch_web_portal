import { Injectable } from '@angular/core';
import {
  Unsubscribe,
  arrayRemove,
  arrayUnion,
  deleteField,
  doc,
  onSnapshot,
  runTransaction,
  setDoc
} from 'firebase/firestore';
import { firestore } from './firebase';
import { DataStoreService } from './data-store.service';
import { RemoteSyncService } from './remote-sync.service';
import { BalancedTeams, BalancerPlayer, TeamRestriction } from './team-balancer.service';

const RESTRICTIONS_DOC = 'meta/teamBalancer';
const TEAMS_DOC = 'meta/teamBalancerTeams';
const HISTORY_LIMIT = 10;

// Pre-Firestore Dexie `settings` keys, read once to migrate a device's existing state.
const LEGACY_KEYS = {
  restrictions: 'team-balancer:restrictions',
  history: 'team-balancer:history',
  pendingTeams: 'team-balancer:pendingTeams',
  lastWinner: 'team-balancer:lastWinner'
} as const;

export type TeamWinner = 'teamA' | 'teamB';

export interface TeamHistoryEntry {
  date: string;
  winner: TeamWinner;
  teamA: string[];
  teamB: string[];
}

export interface StoredPendingTeams extends BalancedTeams {
  substitutes?: BalancerPlayer[];
}

export interface TeamsState {
  pendingTeams: StoredPendingTeams | null;
  history: TeamHistoryEntry[];
  lastWinner: TeamWinner | null;
}

const EMPTY_TEAMS: TeamsState = { pendingTeams: null, history: [], lastWinner: null };

/**
 * Team-balancer state in two Firestore docs, kept live with onSnapshot:
 * `meta/teamBalancerTeams` (pending teams, history, last winner; readable by any signed-in user) and
 * `meta/teamBalancer` (incompatibility restrictions; admin-only). Ratings live in the shared players data.
 */
@Injectable({ providedIn: 'root' })
export class TeamBalancerStateService {
  constructor(
    private readonly store: DataStoreService,
    private readonly remoteSync: RemoteSyncService
  ) {}

  watchTeams(
    onChange: (state: TeamsState) => void,
    onError: (error: unknown) => void,
    canMigrate: boolean
  ): Unsubscribe {
    return onSnapshot(
      doc(firestore, TEAMS_DOC),
      (snapshot) => {
        if (snapshot.exists()) {
          onChange({ ...EMPTY_TEAMS, ...(snapshot.data() as Partial<TeamsState>) });
          return;
        }
        onChange(EMPTY_TEAMS);
        if (canMigrate && !snapshot.metadata.fromCache) void this.migrateTeams().catch(onError);
      },
      onError
    );
  }

  watchRestrictions(onChange: (restrictions: TeamRestriction[]) => void, onError: (error: unknown) => void): Unsubscribe {
    return onSnapshot(
      doc(firestore, RESTRICTIONS_DOC),
      (snapshot) => {
        onChange((snapshot.data()?.['restrictions'] as TeamRestriction[] | undefined) ?? []);
        if (!snapshot.exists() && !snapshot.metadata.fromCache) void this.migrateRestrictions().catch(onError);
      },
      onError
    );
  }

  addRestriction(restriction: TeamRestriction): Promise<void> {
    return this.save(RESTRICTIONS_DOC, { restrictions: arrayUnion(restriction) });
  }

  removeRestriction(restriction: TeamRestriction): Promise<void> {
    return this.save(RESTRICTIONS_DOC, { restrictions: arrayRemove(restriction) });
  }

  setPendingTeams(pendingTeams: StoredPendingTeams): Promise<void> {
    return this.save(TEAMS_DOC, { pendingTeams });
  }

  /** Records the result atomically so two admins can't both apply a result to the same pending teams. */
  async recordResult(entry: TeamHistoryEntry): Promise<void> {
    const ref = doc(firestore, TEAMS_DOC);
    await runTransaction(firestore, async (tx) => {
      const current = (await tx.get(ref)).data() as Partial<TeamsState> | undefined;
      const history = [entry, ...(current?.history ?? [])].slice(0, HISTORY_LIMIT);
      tx.set(ref, { history, lastWinner: entry.winner, pendingTeams: null, updatedAt: new Date().toISOString() }, { merge: true });
    });
  }

  /** Admin-only: merges ratings onto the latest shared data so unpushed local edits elsewhere aren't sent. */
  async pushRatings(ratings: Map<string, number>): Promise<void> {
    const remote = await this.remoteSync.pull();
    if (!remote) return;
    const players = remote.data.players.map((player) =>
      ratings.has(player.id) ? { ...player, rating: ratings.get(player.id) } : player
    );
    await this.remoteSync.push({ ...remote.data, players }, remote.version);
  }

  /** Copies only the `rating` field from the shared data into local players; returns the ones that changed. */
  async pullRatings(): Promise<Map<string, number>> {
    const remote = await this.remoteSync.pull();
    if (!remote) return new Map();
    const local = new Map((await this.store.players.toArray()).map((player) => [player.id, player]));
    const changed = remote.data.players.flatMap((player) => {
      const current = local.get(player.id);
      return current && player.rating !== undefined && current.rating !== player.rating
        ? [{ ...current, rating: player.rating }]
        : [];
    });
    if (changed.length) await this.store.players.bulkPut(changed);
    return new Map(changed.map((player) => [player.id, player.rating]));
  }

  private save(path: string, patch: Record<string, unknown>): Promise<void> {
    return setDoc(doc(firestore, path), { ...patch, updatedAt: new Date().toISOString() }, { merge: true });
  }

  /**
   * Seeds the teams doc from team fields an earlier version stored in the restrictions doc (moving them out),
   * or else from this device's old Dexie settings. The transaction keeps a second admin from overwriting it.
   */
  private async migrateTeams(): Promise<void> {
    const [history, pendingTeams, lastWinner] = await Promise.all([
      this.store.getSetting(LEGACY_KEYS.history),
      this.store.getSetting(LEGACY_KEYS.pendingTeams),
      this.store.getSetting(LEGACY_KEYS.lastWinner)
    ]);
    const fromDexie: TeamsState = {
      history: history ? (JSON.parse(history) as TeamHistoryEntry[]).slice(0, HISTORY_LIMIT) : [],
      pendingTeams: pendingTeams ? (JSON.parse(pendingTeams) as StoredPendingTeams) : null,
      lastWinner: lastWinner === 'teamA' || lastWinner === 'teamB' ? lastWinner : null
    };

    const teamsRef = doc(firestore, TEAMS_DOC);
    const restrictionsRef = doc(firestore, RESTRICTIONS_DOC);
    await runTransaction(firestore, async (tx) => {
      if ((await tx.get(teamsRef)).exists()) return;
      const legacy = (await tx.get(restrictionsRef)).data() as Partial<TeamsState> | undefined;
      const hasLegacy = !!legacy && ('history' in legacy || 'pendingTeams' in legacy || 'lastWinner' in legacy);
      const source: TeamsState = hasLegacy
        ? {
            pendingTeams: legacy.pendingTeams ?? null,
            history: (legacy.history ?? []).slice(0, HISTORY_LIMIT),
            lastWinner: legacy.lastWinner ?? null
          }
        : fromDexie;
      if (!hasLegacy && !source.history.length && !source.pendingTeams && !source.lastWinner) return;

      const now = new Date().toISOString();
      tx.set(teamsRef, { ...source, updatedAt: now, migratedAt: now });
      if (hasLegacy) {
        tx.update(restrictionsRef, { history: deleteField(), pendingTeams: deleteField(), lastWinner: deleteField() });
      }
    });
  }

  private async migrateRestrictions(): Promise<void> {
    const restrictions = await this.store.getSetting(LEGACY_KEYS.restrictions);
    if (!restrictions) return;
    const ref = doc(firestore, RESTRICTIONS_DOC);
    await runTransaction(firestore, async (tx) => {
      if ((await tx.get(ref)).exists()) return;
      const now = new Date().toISOString();
      tx.set(ref, { restrictions: JSON.parse(restrictions) as TeamRestriction[], updatedAt: now, migratedAt: now });
    });
  }
}
