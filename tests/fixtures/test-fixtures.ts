import { test as base, expect } from '@playwright/test';

export interface ConsoleMessageEntry {
  type: string;
  text: string;
  location: string;
}

export interface NetworkErrorEntry {
  url: string;
  status?: number;
  method: string;
  errorText?: string;
}

export const test = base.extend<{
  consoleErrors: ConsoleMessageEntry[];
  networkErrors: NetworkErrorEntry[];
}>({
  consoleErrors: async ({ page }, use) => {
    const errors: ConsoleMessageEntry[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        errors.push({
          type: msg.type(),
          text: msg.text(),
          location: msg.location().url || '',
        });
      }
    });
    page.on('pageerror', (err) => {
      errors.push({
        type: 'uncaught-exception',
        text: err.message,
        location: err.stack || '',
      });
    });
    await use(errors);
  },

  networkErrors: async ({ page }, use) => {
    const errors: NetworkErrorEntry[] = [];
    page.on('response', (response) => {
      if (response.status() >= 500) {
        errors.push({
          url: response.url(),
          status: response.status(),
          method: response.request().method(),
        });
      }
    });
    page.on('requestfailed', (request) => {
      // Exclude aborts
      if (request.failure()?.errorText !== 'net::ERR_ABORTED') {
        errors.push({
          url: request.url(),
          method: request.method(),
          errorText: request.failure()?.errorText || 'Unknown failure',
        });
      }
    });
    await use(errors);
  },
});

export { expect };
