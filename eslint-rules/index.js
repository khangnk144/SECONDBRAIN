// Local ESLint plugins for project-specific rules (registered in eslint.config.js as
// `i18n/no-literal-ui-strings` and `colors/no-raw-color`).
import noLiteralUiStrings from './i18n-no-literal-ui-strings.js';
import noRawColor from './no-raw-color.js';

export const i18nPlugin = {
  meta: { name: 'second-brain-i18n' },
  rules: { 'no-literal-ui-strings': noLiteralUiStrings },
};

export const colorsPlugin = {
  meta: { name: 'second-brain-colors' },
  rules: { 'no-raw-color': noRawColor },
};
