// Finds the literal text pieces an expression can render, for the i18n lint rule.

/**
 * @typedef {{ node: any, value: string, display?: string }} Candidate
 * `value` is what the allowlist is checked against; `display` (optional) is shown in the report.
 */

/**
 * Literal text an expression can evaluate to: plain strings, template literals (static parts of
 * interpolated templates too), `+` concatenation, ternary/logical branches and TS wrappers.
 * @param {any} node
 * @returns {Candidate[]}
 */
export function staticStrings(node) {
  if (!node) return [];
  switch (node.type) {
    case 'Literal':
      return typeof node.value === 'string' ? [{ node, value: node.value }] : [];
    case 'TemplateLiteral': {
      const parts = node.quasis.map((/** @type {any} */ q) => q.value.cooked ?? q.value.raw);
      if (node.expressions.length === 0) return [{ node, value: parts.join('') }];
      // `Còn ${n} ngày` renders "Còn … ngày": check the static parts together, plus literals
      // inside the interpolations (`${done ? 'Đã lưu' : x}`).
      return [
        { node, value: parts.join(' '), display: parts.join('…') },
        ...node.expressions.flatMap((/** @type {any} */ e) => staticStrings(e)),
      ];
    }
    case 'BinaryExpression':
      if (node.operator !== '+') return [];
      return [...staticStrings(node.left), ...staticStrings(node.right)];
    case 'ConditionalExpression':
      return [...staticStrings(node.consequent), ...staticStrings(node.alternate)];
    case 'LogicalExpression':
      return staticStrings(node.right);
    case 'TSAsExpression':
    case 'TSSatisfiesExpression':
    case 'TSNonNullExpression':
      return staticStrings(node.expression);
    default:
      return [];
  }
}

/**
 * Like `staticStrings`, but also looks into object-literal arguments
 * (`toast({ message: '…' })`) — used for message-helper calls.
 * @param {any} node
 * @returns {Candidate[]}
 */
export function messageArgumentStrings(node) {
  if (node && node.type === 'ObjectExpression') {
    /** @type {Candidate[]} */
    const out = [];
    for (const prop of node.properties) {
      if (prop.type === 'Property') out.push(...messageArgumentStrings(prop.value));
    }
    return out;
  }
  return staticStrings(node);
}

// Variant/kind/key arguments such as 'info', 'error', 'save-ok', 'fieldName', 'toast.saved'.
const IDENTIFIER_LIKE = /^[a-z][a-zA-Z0-9]*(?:[._:-][a-zA-Z0-9]+)*$/;

/** @param {string} value */
export function isIdentifierLike(value) {
  return IDENTIFIER_LIKE.test(value.trim());
}
