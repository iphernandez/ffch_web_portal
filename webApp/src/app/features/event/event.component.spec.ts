import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventRegistration, FfchEvent } from '../../core/models/event.model';
import { AuthService } from '../../core/services/auth.service';
import { DataStoreService } from '../../core/services/data-store.service';
import { EventReportService } from '../../core/services/event-report.service';
import { EventService } from '../../core/services/event.service';
import { EventComponent } from './event.component';

describe('EventComponent payment tracking', () => {
  const event: FfchEvent = {
    id: 'gala-2026', category: 'gala', title: 'Gala', description: '', date: '2026-12-12T18:30',
    location: '', options: [], updatedAt: ''
  };
  const registration: EventRegistration = {
    userId: 'user-1', userName: 'Ana', playerId: 'player-1', playerName: 'Ana',
    attending: true, answers: {}, submittedAt: ''
  };
  const currentUser = signal({ id: 'admin', name: 'Admin', email: '', isAdmin: true });
  const setRegistrationPaid = vi.fn();

  beforeEach(async () => {
    currentUser.set({ id: 'admin', name: 'Admin', email: '', isAdmin: true });
    setRegistrationPaid.mockReset().mockResolvedValue(undefined);
    await TestBed.configureTestingModule({
      imports: [EventComponent],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { currentUser } },
        { provide: EventService, useValue: {
          fetchActiveEvent: vi.fn().mockResolvedValue(event),
          listRegistrations: vi.fn().mockResolvedValue([registration]),
          getMyRegistration: vi.fn().mockResolvedValue(null),
          setRegistrationPaid
        } },
        { provide: DataStoreService, useValue: {
          players: { orderBy: () => ({ toArray: () => Promise.resolve([]) }) },
          getSetting: vi.fn().mockResolvedValue(null)
        } },
        EventReportService
      ]
    }).compileComponents();
  });

  async function render() {
    const fixture = TestBed.createComponent(EventComponent);
    await fixture.whenStable();
    fixture.detectChanges();
    const checkbox = fixture.nativeElement.querySelector('.attendees-table input[type="checkbox"]') as HTMLInputElement;
    return { fixture, checkbox };
  }

  it('lets admins mark and unmark payment', async () => {
    const { fixture, checkbox } = await render();
    expect(checkbox.checked).toBe(false);
    checkbox.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(setRegistrationPaid).toHaveBeenCalledWith(event.id, registration.userId, true);
    expect(checkbox.checked).toBe(true);
    checkbox.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(setRegistrationPaid).toHaveBeenLastCalledWith(event.id, registration.userId, false);
    expect(checkbox.checked).toBe(false);
  });

  it('shows payment read-only to non-admins', async () => {
    currentUser.set({ id: 'user', name: 'User', email: '', isAdmin: false });
    const { fixture, checkbox } = await render();
    fixture.componentInstance.registrations.set([{ ...registration, paid: true }]);
    fixture.detectChanges();
    expect(checkbox.checked).toBe(true);
    expect(checkbox.disabled).toBe(true);
    checkbox.click();
    expect(checkbox.checked).toBe(true);
    expect(setRegistrationPaid).not.toHaveBeenCalled();
  });

  it('restores the previous state when saving fails', async () => {
    setRegistrationPaid.mockRejectedValue(new Error('Error de conexión'));
    const { fixture, checkbox } = await render();
    checkbox.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(checkbox.checked).toBe(false);
    expect(fixture.componentInstance.statusMessage()).toBe('Error de conexión');
  });
});
