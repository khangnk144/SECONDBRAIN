import { describe, expect, it } from 'vitest';
import { greetingPeriod } from './greeting';

function at(hours: number, minutes: number): Date {
  return new Date(2026, 9, 18, hours, minutes, 0);
}

describe('greetingPeriod', () => {
  it.each([
    [4, 59, 'late'],
    [5, 0, 'morning'],
    [10, 59, 'morning'],
    [11, 0, 'noon'],
    [13, 29, 'noon'],
    [13, 30, 'afternoon'],
    [17, 59, 'afternoon'],
    [18, 0, 'evening'],
    [22, 59, 'evening'],
    [23, 0, 'late'],
    [0, 0, 'late'],
  ] as const)('%i:%i is %s', (hours, minutes, expected) => {
    expect(greetingPeriod(at(hours, minutes))).toBe(expected);
  });
});
