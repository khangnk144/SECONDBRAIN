import { describe, expect, it } from 'vitest';
import { cleanName, MAX_NAME_LENGTH, validateName } from './name-validation';
import { isStandardFolder } from './standard-folders';

describe('note and folder name validation', () => {
  it('accepts Vietnamese names with spaces and trims accidental whitespace', () => {
    expect(validateName(cleanName('  Đồ án Giải tích 1  '))).toBeNull();
    expect(cleanName('Giải'.normalize('NFD'))).toBe('Giải');
  });

  it.each([
    ['', 'empty'],
    ['a/b', 'characters'],
    ['a\\b', 'characters'],
    ['what?', 'characters'],
    ['say "hi"', 'characters'],
    ['a|b', 'characters'],
    ['tab\there', 'characters'],
    ['CON', 'reserved'],
    ['nul.md', 'reserved'],
    ['com1', 'reserved'],
    ['LPT9', 'reserved'],
    ['ghi chú.', 'trailingDot'],
    ['.ẩn', 'dotStart'],
    ['x'.repeat(MAX_NAME_LENGTH + 1), 'tooLong'],
  ])('%j → %s', (name, problem) => {
    expect(validateName(name)).toBe(problem);
  });

  it('knows the standard folders and their fixed subfolders, case-insensitively', () => {
    expect(isStandardFolder('0 Inbox')).toBe(true);
    expect(isStandardFolder('3 resources/papers')).toBe(true);
    expect(isStandardFolder('wiki/research-gaps')).toBe(true);
    expect(isStandardFolder('2 Areas/Giải tích')).toBe(false);
  });
});
