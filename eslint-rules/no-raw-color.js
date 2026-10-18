// Flags colors written as literals in web TS/TSX: hex, color functions (rgb/hsl/oklch/lab/…)
// anywhere in a string, and CSS named colors (`white`, `red`, …) when a string is the value of
// a color property (style objects, SVG/JSX color attributes, `ctx.fillStyle = …`). Colors come
// only from the design tokens in web/src/styles/tokens.css (var(--token) or getComputedStyle).
import { findNamedColors, findRawColorMatches, isColorProperty } from './lib/raw-color-patterns.js';
import { staticStrings } from './lib/ui-string-candidates.js';

/** @param {any} key */
function propertyKeyName(key) {
  if (!key) return '';
  if (key.type === 'Identifier') return key.name;
  if (key.type === 'Literal' && typeof key.value === 'string') return key.value;
  return '';
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow raw color literals; use design tokens.' },
    schema: [],
    messages: {
      raw: 'Raw color "{{color}}" — use a design token (var(--…)) from web/src/styles/tokens.css.',
    },
  },
  create(context) {
    /** @param {any} node @param {string} text */
    function checkPatterns(node, text) {
      for (const { match } of findRawColorMatches(text)) {
        context.report({ node, messageId: 'raw', data: { color: match.replace(/\s*\($/, '()') } });
      }
    }

    /** Named colors in the literal values of a color property. @param {any} valueNode */
    function checkNamed(valueNode) {
      for (const s of staticStrings(valueNode)) {
        for (const { match } of findNamedColors(s.value)) {
          context.report({ node: s.node, messageId: 'raw', data: { color: match } });
        }
      }
    }

    return {
      Literal(node) {
        if (typeof node.value === 'string') checkPatterns(node, node.value);
      },
      TemplateElement(node) {
        checkPatterns(node, node.value.cooked ?? node.value.raw);
      },
      Property(node) {
        if (!node.computed && isColorProperty(propertyKeyName(node.key))) checkNamed(node.value);
      },
      JSXAttribute(node) {
        if (node.name.type !== 'JSXIdentifier' || !isColorProperty(node.name.name)) return;
        if (!node.value) return;
        checkNamed(
          node.value.type === 'JSXExpressionContainer' ? node.value.expression : node.value,
        );
      },
      AssignmentExpression(node) {
        const left = node.left;
        if (left.type !== 'MemberExpression' || left.computed) return;
        if (isColorProperty(propertyKeyName(left.property))) checkNamed(node.right);
      },
    };
  },
};

export default rule;
