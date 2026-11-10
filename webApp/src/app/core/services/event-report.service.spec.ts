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

  it('marks guests in the WhatsApp summary', () => {
    const guest = registration({ userId: 'guest-1', playerId: '', playerName: 'Ana', guest: true });
    expect(service.toWhatsapp(event, [guest])).toContain('1. Ana (invitado)');
  });

  it('builds a confirmation email with details, answers and escaped HTML', () => {
    const email = service.confirmationEmail(
      { ...event, locationUrl: 'https://maps.app.goo.gl/abc' },
      registration({ userName: '<b>Pato</b>', answers: { drinks: true, dish: 'Postre', note: '<script>' } }),
      'https://example.com/#/evento'
    );
    expect(email.subject).toBe('Inscripción recibida: Gala');
    expect(email.text).toContain('Lugar: Hillsboro');
    expect(email.text).toContain('Mapa / enlace: https://maps.app.goo.gl/abc');
    expect(email.text).toContain('Platillo: Postre');
    expect(email.html).toContain('<a href="https://maps.app.goo.gl/abc">');
    expect(email.html).toContain('&lt;script&gt;');
    expect(email.html).not.toContain('<b>Pato</b>');
  });

  it('omits options from the email when not attending', () => {
    const email = service.confirmationEmail(event, registration({ attending: false }), 'https://example.com');
    expect(email.text).toContain('Asistiré: No');
    expect(email.text).not.toContain('Bebidas');
  });
});
