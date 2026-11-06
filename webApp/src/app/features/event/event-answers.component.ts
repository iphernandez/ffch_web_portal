import { Component, input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { EventAnswers, EventOption } from '../../core/models/event.model';
import { EventReportService, OptionUsage } from '../../core/services/event-report.service';

/** Inputs for an event's extra options; mutates the given `answers` object in place. */
@Component({
  selector: 'app-event-answers',
  imports: [FormsModule],
  template: `
    @for (option of options(); track option.id) {
      @switch (option.type) {
        @case ('checkbox') {
          <label class="check">
            <input
              type="checkbox"
              [ngModel]="answers()[option.id]"
              (ngModelChange)="set(option.id, $event)"
              [ngModelOptions]="{ standalone: true }"
              [disabled]="remaining(option) === 0 && answers()[option.id] !== true"
            />
            {{ option.label }}{{ option.required ? ' *' : '' }} {{ spotsText(option) }}
          </label>
        }
        @case ('choice') {
          <label>
            {{ option.label }}{{ option.required ? ' *' : '' }}
            <select
              [ngModel]="answers()[option.id]"
              (ngModelChange)="set(option.id, $event)"
              [ngModelOptions]="{ standalone: true }"
            >
              <option value="">Selecciona…</option>
              @for (choice of option.choices ?? []; track choice) {
                <option [value]="choice" [disabled]="remaining(option, choice) === 0">
                  {{ choice }} {{ spotsText(option, choice) }}
                </option>
              }
            </select>
          </label>
        }
        @default {
          <label>
            {{ option.label }}{{ option.required ? ' *' : '' }}
            <input
              type="text"
              maxlength="200"
              [ngModel]="answers()[option.id]"
              (ngModelChange)="set(option.id, $event)"
              [ngModelOptions]="{ standalone: true }"
            />
          </label>
        }
      }
    }
  `,
  styles: `
    :host {
      display: contents;
    }
    label {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }
    label.check {
      flex-direction: row;
      align-items: center;
      gap: 0.5rem;
    }
    input[type='text'] {
      min-width: 18rem;
    }
  `
})
export class EventAnswersComponent {
  readonly options = input.required<EventOption[]>();
  readonly answers = input.required<EventAnswers>();
  readonly usage = input<OptionUsage>({});

  constructor(private readonly report: EventReportService) {}

  set(optionId: string, value: boolean | string): void {
    this.answers()[optionId] = value;
  }

  remaining(option: EventOption, choice?: string): number | null {
    return this.report.remaining(option, this.usage(), choice);
  }

  spotsText(option: EventOption, choice?: string): string {
    const left = this.remaining(option, choice);
    if (left === null) return '';
    return left === 0 ? '(sin cupo)' : `(quedan ${left})`;
  }
}
