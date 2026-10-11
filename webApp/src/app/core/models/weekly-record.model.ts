/** One player's attendance/payment record for a single match date (fecha). */
export interface WeeklyRecord {
  id: string;
  playerId: string;
  /** ISO date string (yyyy-MM-dd) identifying the fecha/match date. */
  fecha: string;
  /** Confirmed via the WhatsApp poll ("Convocado" in the original spreadsheet). */
  rsvp: boolean | null;
  /** Actually played that date. */
  jugo: boolean | null;
  /** Hosted/paid for the court that date. */
  sede: boolean | null;
  /** Paid the court rental for that date. */
  pago: boolean | null;
  /** Arrived 5+ minutes late (drives Tarjeta Amarilla/Roja per reglamento.md). */
  tarde: boolean | null;
  /** Whether an ExPat player is eligible to play in this specific fecha. */
  cupoExPat?: boolean;
}
