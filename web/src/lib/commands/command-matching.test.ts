import { beforeAll, describe, expect, it } from 'vitest';
import { i18n, initI18n } from '../../i18n';
import { CommandMatchTier, matchCommands, rankCommand } from './command-matching';
import { APP_COMMANDS, type AppCommand } from './command-registry';

const labelIn = (lng: 'vi' | 'en') => (command: AppCommand) => i18n.t(command.labelKey, { lng });
const vi = labelIn('vi');
const en = labelIn('en');
const ids = (text: string, label = vi) => matchCommands(APP_COMMANDS, text, label).map((c) => c.id);
const tier = (id: string, text: string, label = vi) => {
  const command = APP_COMMANDS.find((candidate) => candidate.id === id);
  if (!command) throw new Error(`no command ${id}`);
  return rankCommand(command, text, label)?.tier ?? null;
};

describe('palette command ranking (F8.4)', () => {
  beforeAll(() => {
    initI18n('vi');
  });

  it("typing a command's exact name puts that command first", () => {
    expect(ids('mở hôm nay')[0]).toBe('openToday');
    expect(ids('mở hôm nay')).toContain('daily-note');
    expect(ids('Mở ghi chú hôm nay')[0]).toBe('daily-note');
    expect(ids('ghi chú mới')[0]).toBe('new-note');
    for (const command of APP_COMMANDS) expect(ids(vi(command))[0], vi(command)).toBe(command.id);
    for (const command of APP_COMMANDS) {
      expect(ids(en(command), en)[0], en(command)).toBe(command.id);
    }
  });

  it('ignores case, diacritics and spacing for the exact name', () => {
    expect(tier('openToday', 'MO HOM NAY')).toBe(CommandMatchTier.Exact);
    expect(tier('toggle-left-pane', 'an / hien  ngan trai')).toBe(CommandMatchTier.Exact);
    expect(ids('xay lai chi muc')).toEqual(['rebuild-index']);
  });

  it('a label that starts with the text beats one that only shares its words', () => {
    expect(tier('daily-note', 'mở ghi chú')).toBe(CommandMatchTier.LabelPrefix);
    expect(tier('new-note', 'mở ghi chú')).toBe(CommandMatchTier.LabelWords);
    expect(ids('mở ghi chú').slice(0, 2)).toEqual(['daily-note', 'new-note']);
    expect(ids('mo gh')[0]).toBe('daily-note');
  });

  it('word prefixes in the label beat keyword matches; closer labels first', () => {
    // "today" names both labels; "Open Today" has fewer words left over.
    expect(ids('today', en).slice(0, 2)).toEqual(['openToday', 'daily-note']);
    // "inbox" is only a keyword of quick capture; "ghi" starts label words.
    expect(tier('quick-capture', 'inbox')).toBe(CommandMatchTier.Keywords);
    expect(ids('ghi')).toEqual(['quick-capture', 'new-note', 'daily-note']);
    // A mix of label and keyword words is a keyword match, ranked after label matches.
    expect(tier('openCalendar', 'mở deadline')).toBe(CommandMatchTier.Keywords);
  });

  it('a blank text keeps registry order; no match returns nothing', () => {
    expect(ids('')).toEqual(APP_COMMANDS.map((c) => c.id));
    expect(ids('   ')).toEqual(APP_COMMANDS.map((c) => c.id));
    expect(ids('zzz')).toEqual([]);
    expect(tier('openToday', 'lịch')).toBeNull();
  });
});
