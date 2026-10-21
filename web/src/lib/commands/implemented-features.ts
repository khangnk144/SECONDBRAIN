/**
 * Features a palette command may belong to. The palette lists a command only when its feature is
 * in `IMPLEMENTED_FEATURES` (SPEC F8: "shows only commands whose feature exists in the current
 * build"); later features are named here so a command can be written ahead of them and stays
 * hidden – and the registry test fails – until the feature ships.
 */
export const APP_FEATURES = [
  'notes',
  'daily-notes',
  'quick-capture',
  'today',
  'tasks',
  'calendar',
  'graph',
  'tags',
  'shortcut-sheet',
  'panes',
  'source-mode',
  'tabs',
  'search-index',
  'settings',
  'reminders',
  'attachments',
  'history',
  'ai',
] as const;

export type AppFeature = (typeof APP_FEATURES)[number];

/** What this build has. Adding a feature here is the switch that shows its commands. */
export const IMPLEMENTED_FEATURES: readonly AppFeature[] = [
  'notes',
  'daily-notes',
  'quick-capture',
  'today',
  'tasks',
  'calendar',
  'graph',
  'tags',
  'shortcut-sheet',
  'panes',
  'source-mode',
  'tabs',
  'search-index',
  'settings',
  'reminders',
  'attachments',
  'history',
  'ai',
];

export function isImplemented(feature: AppFeature): boolean {
  return IMPLEMENTED_FEATURES.includes(feature);
}
