/**
 * YAML text for property values written by the app (SPEC §4.3, F7). One style everywhere: plain
 * scalars when they read back as the same value, otherwise double quotes; arrays in flow style.
 * Calendar dates (`2026-11-05`) stay plain: the core schema reads them back as strings.
 */
import { parse as parseYaml } from 'yaml';
import { VaultError } from '../vault/vault-types.js';

/** Property names the app writes: a letter or `_` first, then letters, digits, `_` or `-`. */
const KEY_NAME = /^[\p{L}_][\p{L}\p{N}_-]*$/u;
const MAX_KEY_LENGTH = 100;

/** Characters that start YAML syntax when they open a plain scalar. */
const INDICATOR_START = /^[-?:,[\]{}#&*!|>'"%@`]/;
/** Anywhere in a plain scalar, `: ` and ` #` change its meaning. */
const UNSAFE_INSIDE = /: |:$| #/;
const FLOW_INDICATOR = /[,[\]{}]/;

export type PropertyValue = string | number | boolean | null | (string | number | boolean)[];

/** Control characters, NEL, line/paragraph separators and BOM need escapes (double quotes). */
function hasSpecialCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f || code === 0x85 || code === 0x2028 || code === 0x2029) {
      return true;
    }
    if (code === 0xfeff) return true;
  }
  return false;
}

function unsupported(key: string, message: string): VaultError {
  return new VaultError('VALIDATION', message, { key, reason: 'unsupported-value' });
}

export function isPropertyKey(key: unknown): key is string {
  return typeof key === 'string' && key.length <= MAX_KEY_LENGTH && KEY_NAME.test(key);
}

/** The plain text parses back to exactly this string (as a value, or as a flow-list item). */
function readsBackAs(value: string, flow: boolean): boolean {
  try {
    const parsed: unknown = parseYaml(flow ? `[${value}]` : value, {
      schema: 'core',
      logLevel: 'silent',
    });
    return flow
      ? Array.isArray(parsed) && parsed.length === 1 && parsed[0] === value
      : parsed === value;
  } catch {
    return false;
  }
}

/** A string as a plain scalar when that is unambiguous, else double-quoted (JSON escapes are YAML). */
export function formatYamlString(value: string, flow = false): string {
  const plain =
    value !== '' &&
    value.trim() === value &&
    !INDICATOR_START.test(value) &&
    !UNSAFE_INSIDE.test(value) &&
    !hasSpecialCharacter(value) &&
    !(flow && FLOW_INDICATOR.test(value)) &&
    readsBackAs(value, flow);
  return plain ? value : JSON.stringify(value);
}

function formatScalar(key: string, value: unknown, flow: boolean): string {
  if (typeof value === 'string') return formatYamlString(value, flow);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw unsupported(key, 'Numbers must be finite.');
    return Object.is(value, -0) ? '-0' : String(value);
  }
  throw unsupported(key, 'Only text, numbers, true/false and lists of them can be written.');
}

/**
 * The YAML text after `key: ` for a value from a request. `null` is not formatted (it means
 * "remove the key"); nested lists and objects are refused.
 */
export function formatPropertyValue(key: string, value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => formatScalar(key, item, true)).join(', ')}]`;
  }
  return formatScalar(key, value, false);
}
