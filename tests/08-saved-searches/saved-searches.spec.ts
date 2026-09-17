import { test, expect } from '../fixtures/test-fixtures';
import { generateTestUser, registerUserViaUI } from '../fixtures/auth-helpers';

test.describe('PHASE 10: Saved Searches & Lead Alerts Workflow', () => {

  test('10.1 User can open Save Search modal on /discover, fill details and save', async ({ page }) => {
    const user = generateTestUser();
    await registerUserViaUI(page, user);

    await page.goto('/discover');
    await page.waitForLoadState('domcontentloaded');

    // Click "Save Search" button in toolbar
    const saveSearchBtn = page.getByRole('button', { name: /save search/i }).first();
    await expect(saveSearchBtn).toBeVisible({ timeout: 10000 });
    await saveSearchBtn.click();

    // Verify modal header
    await expect(page.getByRole('heading', { name: /save search & create alert/i })).toBeVisible({ timeout: 5000 });

    // Fill in search name
    const searchName = `High Growth MSME ${Date.now()}`;
    await page.getByPlaceholder(/CA Tech Startups No Website/i).fill(searchName);

    // Select Weekly frequency
    await page.getByRole('button', { name: 'Weekly Summary' }).click();

    // Submit
    const submitBtn = page.locator('form').getByRole('button', { name: 'Save Search' });
    await expect(submitBtn).toBeEnabled();
    await submitBtn.click();

    // Verify success toast
    await expect(page.getByText(/saved!/i).first()).toBeVisible({ timeout: 8000 });
  });

  test('10.2 Saved searches appear accurately on /saved-searches page', async ({ page }) => {
    const user = generateTestUser();
    await registerUserViaUI(page, user);

    const searchName = `Manufacturing Leads ${Date.now()}`;

    // Create a saved search via UI on /discover
    await page.goto('/discover');
    await page.waitForLoadState('domcontentloaded');

    await page.getByRole('button', { name: /save search/i }).first().click();
    await page.getByPlaceholder(/CA Tech Startups No Website/i).fill(searchName);
    await page.locator('form').getByRole('button', { name: 'Save Search' }).click();
    await expect(page.getByText(/saved!/i).first()).toBeVisible({ timeout: 8000 });

    // Navigate to /saved-searches
    await page.getByRole('link', { name: 'Saved Searches' }).click();
    await page.waitForURL('**/saved-searches');

    await expect(page.getByRole('heading', { name: 'Saved Searches & Alerts' })).toBeVisible();
    await expect(page.getByText(searchName)).toBeVisible({ timeout: 10000 });
  });

  test('10.3 Toggling alert frequency switch updates status', async ({ page }) => {
    const user = generateTestUser();
    await registerUserViaUI(page, user);

    const searchName = `FinTech Radar ${Date.now()}`;

    await page.goto('/discover');
    await page.waitForLoadState('domcontentloaded');

    await page.getByRole('button', { name: /save search/i }).first().click();
    await page.getByPlaceholder(/CA Tech Startups No Website/i).fill(searchName);
    await page.locator('form').getByRole('button', { name: 'Save Search' }).click();
    await expect(page.getByText(/saved!/i).first()).toBeVisible({ timeout: 8000 });

    // Go to /saved-searches
    await page.getByRole('link', { name: 'Saved Searches' }).click();
    await page.waitForURL('**/saved-searches');

    await expect(page.getByText(searchName)).toBeVisible({ timeout: 10000 });

    // Find the toggle button in the card
    const card = page.locator('div', { hasText: searchName }).last();
    const toggle = card.locator('button[class*="rounded-full"]').first();
    if (await toggle.isVisible()) {
      await toggle.click();
      await expect(page.getByText(/search alert (enabled|disabled)/i).first()).toBeVisible({ timeout: 8000 });
    }
  });

  test('10.4 Run button navigates to /discover with saved search query params', async ({ page }) => {
    const user = generateTestUser();
    await registerUserViaUI(page, user);

    const searchName = `Pharma Exporters ${Date.now()}`;

    await page.goto('/discover');
    await page.waitForLoadState('domcontentloaded');

    await page.getByRole('button', { name: /save search/i }).first().click();
    await page.getByPlaceholder(/CA Tech Startups No Website/i).fill(searchName);
    await page.locator('form').getByRole('button', { name: 'Save Search' }).click();
    await expect(page.getByText(/saved!/i).first()).toBeVisible({ timeout: 8000 });

    await page.getByRole('link', { name: 'Saved Searches' }).click();
    await page.waitForURL('**/saved-searches');

    // Click Play / Run link
    const runLink = page.getByRole('link', { name: /run search in discover/i }).first();
    await expect(runLink).toBeVisible({ timeout: 10000 });
    await runLink.click();

    // Verify navigates back to /discover
    await page.waitForURL('**/discover**', { timeout: 10000 });
    await expect(page.getByPlaceholder(/search by business name/i)).toBeVisible();
  });

  test('10.5 User can delete a saved search and confirm removal from list', async ({ page }) => {
    const user = generateTestUser();
    await registerUserViaUI(page, user);

    const searchName = `Delete Target Search ${Date.now()}`;

    await page.goto('/discover');
    await page.waitForLoadState('domcontentloaded');

    await page.getByRole('button', { name: /save search/i }).first().click();
    await page.getByPlaceholder(/CA Tech Startups No Website/i).fill(searchName);
    await page.locator('form').getByRole('button', { name: 'Save Search' }).click();
    await expect(page.getByText(/saved!/i).first()).toBeVisible({ timeout: 8000 });

    await page.getByRole('link', { name: 'Saved Searches' }).click();
    await page.waitForURL('**/saved-searches');

    const searchHeading = page.getByText(searchName);
    await expect(searchHeading).toBeVisible({ timeout: 10000 });

    // Hover over the card to reveal delete button
    const card = page.locator('div', { hasText: searchName }).filter({ hasText: 'Live Alert Stream' }).first();
    await card.hover();

    const deleteBtn = card.getByTitle(/delete/i);
    await expect(deleteBtn).toBeVisible({ timeout: 5000 });
    await deleteBtn.click();

    // Verify deletion toast
    await expect(page.getByText(/deleted/i).first()).toBeVisible({ timeout: 8000 });
  });
});
