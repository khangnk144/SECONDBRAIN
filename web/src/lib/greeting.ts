/**
 * Time-of-day greeting periods (local time):
 *   05:00–10:59 morning
 *   11:00–13:29 noon
 *   13:30–17:59 afternoon
 *   18:00–22:59 evening
 *   23:00–04:59 late
 */
export type GreetingPeriod = 'morning' | 'noon' | 'afternoon' | 'evening' | 'late';

export function greetingPeriod(date: Date): GreetingPeriod {
  const minutes = date.getHours() * 60 + date.getMinutes();
  if (minutes >= 5 * 60 && minutes < 11 * 60) return 'morning';
  if (minutes >= 11 * 60 && minutes < 13 * 60 + 30) return 'noon';
  if (minutes >= 13 * 60 + 30 && minutes < 18 * 60) return 'afternoon';
  if (minutes >= 18 * 60 && minutes < 23 * 60) return 'evening';
  return 'late';
}
