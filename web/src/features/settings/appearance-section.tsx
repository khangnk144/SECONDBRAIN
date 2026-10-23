import { useLayoutEffect, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { resolveTheme } from '../../lib/apply-ui-prefs';
import {
  FONT_SIZES,
  LANGUAGES,
  PALETTES,
  STYLES,
  THEMES,
  type FontSize,
  type Language,
  type Palette,
  type Style,
  type ThemePreference,
  type UiPrefs,
} from '../../lib/ui-prefs';
import { useUiPrefsStore } from '../../lib/ui-prefs-store';
import { ChoiceGroup } from './choice-group';
import { readPaletteAccents } from './palette-swatches';
import { SaveStatus } from './save-status';
import { SettingsField, SettingsSection } from './settings-section';
import { useSettingSave } from './use-setting-save';

export const NAME_MAX_LENGTH = 80;

/** Trimmed, NFC; null when it would be refused (1–80 characters). */
export function cleanGreetingName(text: string): string | null {
  const name = text.normalize('NFC').trim();
  const length = [...name].length;
  return length >= 1 && length <= NAME_MAX_LENGTH ? name : null;
}

function NameField({ name }: { name: string }) {
  const { t } = useTranslation();
  const { state, save, fail, clear } = useSettingSave();
  const [draft, setDraft] = useState(name);
  useLayoutEffect(() => setDraft(name), [name]);

  const commit = () => {
    if (draft === name) return;
    const clean = cleanGreetingName(draft);
    if (clean === null) {
      fail(t('settings.appearance.nameInvalid', { max: NAME_MAX_LENGTH }));
      return;
    }
    if (clean === name) return setDraft(name);
    void save({ ui: { name: clean } });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') commit();
    if (event.key === 'Escape') {
      setDraft(name);
      clear();
    }
  };

  return (
    <SettingsField
      label={t('settings.appearance.name')}
      htmlFor="settings-name"
      hint={t('settings.appearance.nameHint')}
      status={<SaveStatus state={state} id="settings-name-status" />}
    >
      <input
        id="settings-name"
        className="text-input settings-input--name"
        value={draft}
        maxLength={NAME_MAX_LENGTH * 2}
        autoComplete="off"
        aria-invalid={state.kind === 'error'}
        aria-describedby="settings-name-status"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={onKeyDown}
      />
    </SettingsField>
  );
}

function PaletteSwatch({ color }: { color: string | undefined }) {
  return (
    <span
      className="settings-swatch"
      aria-hidden="true"
      style={color ? { background: color } : undefined}
    />
  );
}

/**
 * "Giao diện": name, language, theme, style (Bento mềm / Yên tĩnh, F35.1), palette, font size;
 * each applies at once (F18.1).
 */
export function AppearanceSection() {
  const { t } = useTranslation();
  const prefs = useUiPrefsStore((state) => state.prefs);
  const language = useSettingSave();
  const theme = useSettingSave();
  const style = useSettingSave();
  const palette = useSettingSave();
  const fontSize = useSettingSave();
  const shownTheme = resolveTheme(prefs.theme);
  const [accents, setAccents] = useState<Partial<Record<Palette, string>>>({});
  // Re-read when the theme on screen changes: each palette has a light and a dark accent.
  useLayoutEffect(() => setAccents(readPaletteAccents()), [shownTheme]);

  const set = (change: Partial<UiPrefs>, saver: ReturnType<typeof useSettingSave>) =>
    void saver.save({ ui: change });

  return (
    <SettingsSection id="appearance" title={t('settings.appearance.title')}>
      <NameField name={prefs.name} />
      <ChoiceGroup<Language>
        name="settings-language"
        legend={t('settings.appearance.language')}
        value={prefs.language}
        choices={LANGUAGES.map((value) => ({
          value,
          label: t(`settings.appearance.languages.${value}`),
        }))}
        onChange={(value) => set({ language: value }, language)}
        status={<SaveStatus state={language.state} />}
      />
      <ChoiceGroup<ThemePreference>
        name="settings-theme"
        legend={t('settings.appearance.theme')}
        value={prefs.theme}
        choices={THEMES.map((value) => ({
          value,
          label: t(`settings.appearance.themes.${value}`),
        }))}
        onChange={(value) => set({ theme: value }, theme)}
        status={<SaveStatus state={theme.state} />}
      />
      <ChoiceGroup<Style>
        name="settings-style"
        legend={t('style.label')}
        value={prefs.style}
        choices={STYLES.map((value) => ({ value, label: t(`style.choices.${value}`) }))}
        onChange={(value) => set({ style: value }, style)}
        status={<SaveStatus state={style.state} />}
      />
      <ChoiceGroup<Palette>
        name="settings-palette"
        legend={t('settings.appearance.palette')}
        value={prefs.palette}
        choices={PALETTES.map((value) => ({
          value,
          label: t(`settings.appearance.palettes.${value}`),
          adornment: <PaletteSwatch color={accents[value]} />,
        }))}
        onChange={(value) => set({ palette: value }, palette)}
        status={<SaveStatus state={palette.state} />}
      />
      <ChoiceGroup<FontSize>
        name="settings-font-size"
        legend={t('settings.appearance.fontSize')}
        value={prefs.fontSize}
        choices={FONT_SIZES.map((value) => ({
          value,
          label: t('settings.appearance.fontSizeValue', { size: value }),
        }))}
        onChange={(value) => set({ fontSize: value }, fontSize)}
        status={<SaveStatus state={fontSize.state} />}
      />
    </SettingsSection>
  );
}
