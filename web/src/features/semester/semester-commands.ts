/** Palette command "Mở trang Học kỳ này" (SPEC F25, F8 registry): listed while the page is on. */
import type { AppCommand } from '../../lib/commands/command-registry';
import { useTabsStore } from '../../lib/tabs-store';
import { openableSemesterPage } from './semester-page-store';

export const SEMESTER_COMMANDS: readonly AppCommand[] = [
  {
    id: 'open-semester-page',
    labelKey: 'semester.command',
    keywords: ['học kỳ', 'semester', 'môn học', 'course', 'đồ án', 'project', 'moc'],
    feature: 'notes',
    isAvailable: () => openableSemesterPage() !== null,
    run: () => {
      const path = openableSemesterPage();
      if (path !== null) useTabsStore.getState().openNote(path);
    },
  },
];
