import { TdpHistoryCategory } from './tdp.model';

/** Events map 1:1 to a TDP category, so attending one marks that category for the event's year. */
export type EventCategory = Extract<TdpHistoryCategory, 'pretemporada' | 'gala' | 'teamBuilding'>;

export const EVENT_CATEGORIES: Array<{ value: EventCategory; label: string }> = [
  { value: 'pretemporada', label: 'Pre Temporada' },
  { value: 'gala', label: 'Galas' },
  { value: 'teamBuilding', label: 'Team Building' }
];

export type EventOptionType = 'checkbox' | 'text' | 'choice';

/** Extra configurable question on top of the always-present "attending" option. */
export interface EventOption {
  id: string;
  label: string;
  type: EventOptionType;
  /** Only enforced for attendees. For checkbox it means "must be checked". */
  required?: boolean;
  /** Values for type 'choice'. */
  choices?: string[];
  /** Max attendees that can check a checkbox, or pick each value of a choice; null/absent = unlimited. */
  limit?: number | null;
}

/** Firestore `events/{id}`, where id = `${category}-${year}`. */
export interface FfchEvent {
  id: string;
  category: EventCategory;
  title: string;
  description: string;
  /** Local date-time as entered in `<input type="datetime-local">` (YYYY-MM-DDTHH:mm). */
  date: string;
  location: string;
  /** Optional link for the location (Google Maps or any page); only http(s) URLs are accepted. */
  locationUrl?: string | null;
  options: EventOption[];
  /** Registration deadline as entered (datetime-local); null = open until the event is disabled. */
  deadline?: string | null;
  /** Same deadline as epoch ms, so Firestore rules can compare it with request.time. */
  deadlineMs?: number | null;
  updatedAt: string;
}

/** Firestore `events/{eventId}/registrations/{uid}`; immutable for the user once created. */
export interface EventRegistration {
  userId: string;
  userName: string;
  playerId: string;
  playerName: string;
  attending: boolean;
  answers: EventAnswers;
  submittedAt: string;
  paid?: boolean;
  /** Set by an admin client once the attendance was written into the shared TDP history. */
  appliedToTdp?: boolean;
  /** Name of the admin who registered on the player's behalf. */
  registeredBy?: string;
  /** Admin-added attendee who is neither a user nor a roster player (playerId is ''); never counts for TDP. */
  guest?: boolean;
}

export const GUEST_NAME_MAX_LENGTH = 80;

export type EventAnswers = Record<string, boolean | string>;

export function isRegistrationOpen(event: Pick<FfchEvent, 'deadlineMs'>, now = Date.now()): boolean {
  return !event.deadlineMs || now < event.deadlineMs;
}

export function formatEventDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('es-MX', { dateStyle: 'full', timeStyle: 'short' });
}

export function eventCategoryLabel(category: EventCategory): string {
  return EVENT_CATEGORIES.find((option) => option.value === category)?.label ?? category;
}

/** Returns the URL only if it's an absolute http(s) URL, so `javascript:` and similar can't be stored or linked. */
export function safeHttpUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

export function eventYear(event: Pick<FfchEvent, 'date'>): number {
  return Number(event.date.slice(0, 4));
}

export function eventId(category: EventCategory, date: string): string {
  return `${category}-${date.slice(0, 4)}`;
}
