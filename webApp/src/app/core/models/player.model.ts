export interface Player {
  id: string;
  galactico: string;
  bullying: string;
  wanombre: string;
  wanumber: string;
  posicion: number;
  activo: boolean;
  /** Current team-balancer rating in the 1..10 range, persisted in IndexedDB. */
  rating?: number;
  /** Hosted the field in the previous season -> seeds PtsTemporadaAnterior. */
  sedeTemporadaAnterior: boolean;
  /** Single lifetime flag (not per-year, unlike the other TDP categories) - contributes TdpWeights.socioFundador once. */
  socioFundador: boolean;
}
