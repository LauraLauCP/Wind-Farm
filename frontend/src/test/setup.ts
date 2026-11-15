// Test environment bootstrap: jsdom + Testing Library matchers + cleanup.
// vitest runs without `globals: true`, so auto-cleanup must be wired by hand.
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});
