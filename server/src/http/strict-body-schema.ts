import { VaultError } from '../vault/vault-types.js';

/**
 * A small JSON-schema subset checked strictly. Fastify's own validator removes unknown properties
 * silently (`removeAdditional`), so routes that must refuse them (settings: the session token and
 * `vaultPath` are never writable) check the raw body with this instead and answer
 * 400 `VALIDATION` with `details.field` naming the first offending field.
 */
export type BodySchemaType =
  'object' | 'array' | 'string' | 'integer' | 'number' | 'boolean' | 'null';

export interface BodySchema {
  type: BodySchemaType | readonly BodySchemaType[];
  properties?: Readonly<Record<string, BodySchema>>;
  required?: readonly string[];
  /** Only `false` is supported: unknown properties are refused. */
  additionalProperties?: false;
  enum?: readonly unknown[];
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  items?: BodySchema;
  maxItems?: number;
}

export interface BodyProblem {
  /** Dotted path of the field (`ui.fontSize`, `ai.folders.2`), `body` for the whole body. */
  field: string;
  reason: string;
}

function typeOf(value: unknown): BodySchemaType | 'other' {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  if (typeof value === 'string' || typeof value === 'boolean' || typeof value === 'object')
    return typeof value as BodySchemaType;
  return 'other';
}

function matchesType(schema: BodySchema, actual: BodySchemaType | 'other'): boolean {
  const allowed: readonly BodySchemaType[] =
    typeof schema.type === 'string' ? [schema.type] : schema.type;
  return (
    allowed.includes(actual as BodySchemaType) ||
    (actual === 'integer' && allowed.includes('number'))
  );
}

const join = (parent: string, key: string | number) =>
  parent === '' ? String(key) : `${parent}.${key}`;

function scalarProblem(schema: BodySchema, value: unknown): string | null {
  if (schema.enum && !schema.enum.includes(value)) return 'not-allowed';
  if (typeof value === 'string') {
    const length = [...value].length;
    if (schema.minLength !== undefined && length < schema.minLength) return 'too-short';
    if (schema.maxLength !== undefined && length > schema.maxLength) return 'too-long';
    if (schema.pattern !== undefined && !new RegExp(schema.pattern, 'u').test(value))
      return 'pattern';
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) return 'out-of-range';
    if (schema.maximum !== undefined && value > schema.maximum) return 'out-of-range';
  }
  return null;
}

export function findBodyProblem(
  schema: BodySchema,
  value: unknown,
  field = '',
): BodyProblem | null {
  const at = field === '' ? 'body' : field;
  if (!matchesType(schema, typeOf(value))) return { field: at, reason: 'type' };
  const scalar = scalarProblem(schema, value);
  if (scalar) return { field: at, reason: scalar };
  if (Array.isArray(value)) {
    if (schema.maxItems !== undefined && value.length > schema.maxItems)
      return { field: at, reason: 'too-many-items' };
    if (!schema.items) return null;
    for (const [i, item] of value.entries()) {
      const problem = findBodyProblem(schema.items, item, join(field, i));
      if (problem) return problem;
    }
    return null;
  }
  if (typeOf(value) !== 'object') return null;
  const object = value as Record<string, unknown>;
  for (const key of schema.required ?? [])
    if (!(key in object)) return { field: join(field, key), reason: 'required' };
  for (const [key, item] of Object.entries(object)) {
    const child = schema.properties?.[key];
    if (!child) {
      if (schema.additionalProperties === false)
        return { field: join(field, key), reason: 'unknown-field' };
      continue;
    }
    const problem = findBodyProblem(child, item, join(field, key));
    if (problem) return problem;
  }
  return null;
}

/** The 400 `VALIDATION` error every strict route answers with. */
export function bodyValidationError(problem: BodyProblem, message?: string): VaultError {
  return new VaultError('VALIDATION', message ?? `Invalid value for "${problem.field}".`, {
    field: problem.field,
    reason: problem.reason,
  });
}

/** Checks `value` against `schema`; throws the 400 error on the first problem. */
export function assertBody<T>(schema: BodySchema, value: unknown): T {
  const problem = findBodyProblem(schema, value);
  if (problem) throw bodyValidationError(problem);
  return value as T;
}
