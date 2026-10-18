// Flags user-visible text written as literals in the web UI. Every string a user reads must go
// through i18next `t()` so the Vietnamese and English bundles stay complete.
import path from 'node:path';
import { isAllowedText, loadAllowlist } from './lib/allowlist.js';
import { matchesAnyGlob } from './lib/glob-to-regexp.js';
import {
  isIdentifierLike,
  messageArgumentStrings,
  staticStrings,
} from './lib/ui-string-candidates.js';

const TEXT_ATTRIBUTES = new Set([
  'aria-label',
  'aria-description',
  'aria-placeholder',
  'aria-valuetext',
  'aria-roledescription',
  'title',
  'placeholder',
  'alt',
  'label',
]);
const BUTTON_INPUT_TYPES = new Set(['submit', 'button', 'reset']);
const MESSAGE_FUNCTIONS = new Set([
  'toast',
  'notify',
  'showError',
  'showToast',
  'alert',
  'confirm',
  'prompt',
  'setError',
]);
const MESSAGE_OBJECTS = new Set(['toast', 'notify']);

/** @param {any} callee */
function isMessageCallee(callee) {
  if (callee.type === 'Identifier') return MESSAGE_FUNCTIONS.has(callee.name);
  if (callee.type === 'MemberExpression' && !callee.computed) {
    if (callee.object.type === 'Identifier' && MESSAGE_OBJECTS.has(callee.object.name)) return true;
    return callee.property.type === 'Identifier' && MESSAGE_FUNCTIONS.has(callee.property.name);
  }
  return false;
}

/** @param {any} name */
function attributeName(name) {
  if (name.type === 'JSXIdentifier') return name.name;
  if (name.type === 'JSXNamespacedName') return `${name.namespace.name}:${name.name.name}`;
  return '';
}

/** `<input type="submit" value="…">` (and button/reset): the value is the visible label. */
function isButtonInputValue(/** @type {any} */ attribute) {
  const element = attribute.parent;
  if (!element || element.type !== 'JSXOpeningElement') return false;
  if (element.name.type !== 'JSXIdentifier' || element.name.name !== 'input') return false;
  const type = element.attributes.find(
    (/** @type {any} */ a) => a.type === 'JSXAttribute' && attributeName(a.name) === 'type',
  );
  const typeValue = type && type.value && type.value.type === 'Literal' ? type.value.value : '';
  return typeof typeValue === 'string' && BUTTON_INPUT_TYPES.has(typeValue.toLowerCase());
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow literal user-visible UI text; use i18n t() instead.' },
    schema: [
      {
        type: 'object',
        properties: { allowlistPath: { type: 'string' }, rootDir: { type: 'string' } },
        additionalProperties: false,
      },
    ],
    messages: {
      literal:
        'UI text "{{text}}" must go through t(). Add keys to vi.json and en.json, or (for icons, units, code, brand names only) to web/src/i18n/lint-allowlist.json.',
    },
  },
  create(context) {
    const options = context.options[0] ?? {};
    const allowlist = loadAllowlist(options.allowlistPath);
    const rootDir = options.rootDir ?? context.cwd;
    const relFile = path.relative(rootDir, context.filename);
    if (allowlist.ignoreFiles.length > 0 && matchesAnyGlob(relFile, allowlist.ignoreFiles))
      return {};

    /** @param {{ node: any, value: string, display?: string }} candidate */
    function check({ node, value, display }) {
      if (isAllowedText(allowlist, value)) return;
      const text = (display ?? value).trim().replace(/\s+/g, ' ');
      context.report({
        node,
        messageId: 'literal',
        data: { text: text.length > 40 ? `${text.slice(0, 40)}…` : text },
      });
    }

    return {
      JSXText(node) {
        check({ node, value: node.value });
      },
      JSXExpressionContainer(node) {
        const parent = node.parent;
        if (parent.type !== 'JSXElement' && parent.type !== 'JSXFragment') return;
        for (const s of staticStrings(node.expression)) check(s);
      },
      JSXAttribute(node) {
        const name = attributeName(node.name);
        const isText = TEXT_ATTRIBUTES.has(name) || (name === 'value' && isButtonInputValue(node));
        if (!isText || !node.value) return;
        const valueNode =
          node.value.type === 'JSXExpressionContainer' ? node.value.expression : node.value;
        for (const s of staticStrings(valueNode)) check(s);
      },
      CallExpression(node) {
        if (!isMessageCallee(node.callee)) return;
        for (const arg of node.arguments) {
          for (const s of messageArgumentStrings(arg)) {
            // Kind/variant/key arguments ('info', 'error', 'fieldName') are not UI text.
            if (!s.display && isIdentifierLike(s.value)) continue;
            check(s);
          }
        }
      },
    };
  },
};

export default rule;
