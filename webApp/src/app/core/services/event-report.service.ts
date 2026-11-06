import { Injectable } from '@angular/core';
import { EventAnswers, EventOption, EventRegistration, FfchEvent, formatEventDate } from '../models/event.model';

export type OptionUsage = Record<string, number>;

/** Pure helpers for event registrations: option capacity, validation, CSV report and WhatsApp summary. */
@Injectable({ providedIn: 'root' })
export class EventReportService {
  usageKey(optionId: string, choice?: string): string {
    return choice === undefined ? optionId : `${optionId}::${choice}`;
  }

  /** Counts, among attendees only, how many checked each checkbox and picked each choice value. */
  usage(event: FfchEvent, registrations: EventRegistration[]): OptionUsage {
    const usage: OptionUsage = {};
    for (const registration of registrations) {
      if (!registration.attending) continue;
      for (const option of event.options) {
        const value = registration.answers[option.id];
        if (option.type === 'checkbox' && value === true) {
          usage[option.id] = (usage[option.id] ?? 0) + 1;
        } else if (option.type === 'choice' && typeof value === 'string' && value) {
          const key = this.usageKey(option.id, value);
          usage[key] = (usage[key] ?? 0) + 1;
        }
      }
    }
    return usage;
  }

  /** Remaining spots, or null when the option has no limit. */
  remaining(option: EventOption, usage: OptionUsage, choice?: string): number | null {
    if (!option.limit) return null;
    return Math.max(0, option.limit - (usage[this.usageKey(option.id, choice)] ?? 0));
  }

  /** Returns an error message, or null if the answers are valid for an attendee. */
  validate(event: FfchEvent, answers: EventAnswers, registrations: EventRegistration[]): string | null {
    const usage = this.usage(event, registrations);
    for (const option of event.options) {
      const value = answers[option.id];
      const filled = option.type === 'checkbox' ? value === true : typeof value === 'string' && value.trim() !== '';
      if (option.required && !filled) return `"${option.label}" es obligatoria.`;

      if (option.type === 'choice' && filled && !(option.choices ?? []).includes(value as string)) {
        return `"${value}" no es una opción válida de "${option.label}".`;
      }
      const choice = option.type === 'choice' ? (value as string) : undefined;
      if (filled && option.type !== 'text' && this.remaining(option, usage, choice) === 0) {
        return `"${choice ?? option.label}" ya alcanzó su cupo (${option.limit}).`;
      }
    }
    return null;
  }

  /** Keeps only answers for the configured options, normalized to their type. */
  clean(options: EventOption[], answers: EventAnswers): EventAnswers {
    return Object.fromEntries(
      options.map((option) => {
        const value = answers[option.id];
        return [option.id, option.type === 'checkbox' ? value === true : String(value ?? '').trim().slice(0, 200)];
      })
    );
  }

  emptyAnswers(options: EventOption[]): EventAnswers {
    return Object.fromEntries(options.map((option) => [option.id, option.type === 'checkbox' ? false : '']));
  }

  answerText(registration: EventRegistration, option: EventOption): string {
    const value = registration.answers[option.id];
    if (option.type === 'checkbox') return value === true ? 'Sí' : 'No';
    return typeof value === 'string' && value ? value : '—';
  }

  toCsv(event: FfchEvent, registrations: EventRegistration[]): string {
    const header = ['Jugador', 'Usuario', 'Asiste', ...event.options.map((option) => option.label), 'Fecha inscripción', 'Registrado por'];
    const rows = registrations.map((registration) => [
      registration.playerName,
      registration.userName,
      registration.attending ? 'Sí' : 'No',
      ...event.options.map((option) => (registration.attending ? this.answerText(registration, option) : '')),
      registration.submittedAt,
      registration.registeredBy ?? ''
    ]);
    // BOM so Excel opens accents correctly.
    return '\uFEFF' + [header, ...rows].map((row) => row.map((cell) => this.csvCell(cell)).join(',')).join('\r\n');
  }

  toWhatsapp(event: FfchEvent, registrations: EventRegistration[]): string {
    const attendees = registrations.filter((registration) => registration.attending);
    const absent = registrations.filter((registration) => !registration.attending);
    const lines = [`*${event.title}*`, `📅 ${formatEventDate(event.date)}`, `📍 ${event.location}`, '', `✅ Asisten (${attendees.length}):`];

    attendees.forEach((registration, index) => {
      const details = event.options
        .map((option) => {
          const value = registration.answers[option.id];
          if (option.type === 'checkbox') return value === true ? option.label : '';
          return typeof value === 'string' && value ? `${option.label}: ${value}` : '';
        })
        .filter(Boolean);
      lines.push(`${index + 1}. ${registration.playerName}${details.length ? ' — ' + details.join(', ') : ''}`);
    });

    if (absent.length) {
      lines.push('', `❌ No asisten (${absent.length}): ${absent.map((registration) => registration.playerName).join(', ')}`);
    }

    const usage = this.usage(event, registrations);
    const totals = event.options
      .map((option) => {
        if (option.type === 'checkbox') {
          return `- ${option.label}: ${usage[option.id] ?? 0}${option.limit ? `/${option.limit}` : ''}`;
        }
        if (option.type === 'choice') {
          const parts = (option.choices ?? []).map(
            (choice) => `${choice} ${usage[this.usageKey(option.id, choice)] ?? 0}${option.limit ? `/${option.limit}` : ''}`
          );
          return `- ${option.label}: ${parts.join(', ')}`;
        }
        return '';
      })
      .filter(Boolean);
    if (totals.length) lines.push('', '📊 Resumen:', ...totals);

    return lines.join('\n');
  }

  private csvCell(value: string): string {
    // Neutralize spreadsheet formula injection from user-entered text.
    const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
    return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
  }
}
