import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { resetUiStyle } from '../lib/testing/ui-style-test-kit';

afterEach(() => {
  cleanup();
  // Tests run in the calm style unless they opt in with withStyle('bento') (F35.1).
  resetUiStyle();
});
