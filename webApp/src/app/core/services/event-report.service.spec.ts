import { EventRegistration, FfchEvent } from '../models/event.model';
import { EventReportService } from './event-report.service';

describe('EventReportService', () => {
  const service = new EventReportService();

  const event: FfchEvent = {
    id: 'gala-2026',
    category: 'gala',
    title: 'Gala',
    description: '',
    date: '2026-12-12T18:30',
    location: 'Hillsboro',
    updatedAt: '',
    options: [
      { id: 'drinks', label: 'Bebidas', type: 'checkbox', limit: 1 },
      { id: 'dish', label: 'Platillo', type: 'choice', choices: ['Postre', 'Ensalada'], limit: 1, required: true },
      { id: 'note', label: 'Nota', type: 'text' }
    ]
  };

  const registration = (overrides: Partial<EventRegistration>): EventRegistration => ({
    userId: 'u1',
    userName: 'User',
    playerId: 'p1',
    playerName: 'Pato',
    attending: true,
    answers: {},
    submittedAt: '2026-11-01T00:00:00.000Z',
    ...overrides
  });

  const existing = [
    registration({ answers: { drinks: true, dish: 'Postre', note: '' } }),
    registration({ userId: 'u2', playerName: 'Rafa', attending: false, answers: { drinks: true } })
  ];

  it('counts usage only for attendees', () => {
    expect(service.usage(event, existing)).toEqual({ drinks: 1, 'dish::Postre': 1 });
  });

  it('rejects missing required answers and full options', () => {
    expect(service.validate(event, { drinks: false, dish: '' }, existing)).toContain('obligatoria');
    expect(service.validate(event, { drinks: true, dish: 'Ensalada' }, existing)).toContain('cupo');
    expect(service.validate(event, { drinks: false, dish: 'Postre' }, existing)).toContain('cupo');
    expect(service.validate(event, { drinks: false, dish: 'Ensalada' }, existing)).toBeNull();
  });

  it('escapes CSV cells and neutralizes formulas', () => {
    const csv = service.toCsv(event, [registration({ playerName: '=HYPERLINK("x")', answers: { note: 'a, b' } })]);
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv).toContain('"a, b"');
  });

  it('builds a WhatsApp summary with attendees and totals', () => {
    const text = service.toWhatsapp(event, existing);
    expect(text).toContain('✅ Asisten (1):');
    expect(text).toContain('1. Pato — Bebidas, Platillo: Postre');
    expect(text).toContain('❌ No asisten (1): Rafa');
    expect(text).toContain('- Bebidas: 1/1');
    expect(text).toContain('- Platillo: Postre 1/1, Ensalada 0/1');
  });
});
