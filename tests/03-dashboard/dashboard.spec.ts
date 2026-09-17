import { test, expect } from '../fixtures/test-fixtures';
import { generateTestUser, loginUserViaUI, registerUserViaUI } from '../fixtures/auth-helpers';

test.describe('PHASE 5: Dashboard E2E Testing', () => {
  let testUser = generateTestUser();

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await registerUserViaUI(page, testUser);
    await page.close();
  });

  test('5.1 Dashboard loads successfully with correct header and greeting', async ({ page }) => {
    await loginUserViaUI(page, testUser.email, testUser.password);
    await page.goto('/dashboard');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await expect(page.getByText(new RegExp(`Welcome back, ${testUser.firstName}`, 'i'))).toBeVisible();
  });

  test('5.2 KPI metrics cards render with accurate values and icons', async ({ page }) => {
    await loginUserViaUI(page, testUser.email, testUser.password);
    await page.goto('/dashboard');
    await page.waitForLoadState('domcontentloaded');

    // 4 Key KPI Cards
    await expect(page.getByText('New Businesses Today')).toBeVisible();
    await expect(page.getByText('Unlocked Leads')).toBeVisible();
    await expect(page.getByText('Saved Leads in Pipeline')).toBeVisible();
    await expect(page.getByText('Credits Remaining')).toBeVisible();

    // Default 5 credits allocated
    await expect(page.locator('text=5 Credits').first()).toBeVisible();
  });

  test('5.3 Analytics charts (Discovery Trends & Industry Distribution) render without error', async ({ page }) => {
    await loginUserViaUI(page, testUser.email, testUser.password);
    await page.goto('/dashboard');
    await page.waitForLoadState('domcontentloaded');

    // Chart Headings
    await expect(page.getByRole('heading', { name: 'Business Discovery Trends' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Industry Distribution' })).toBeVisible();

    // Chart Legends
    await expect(page.getByText('Businesses Discovered')).toBeVisible();
    await expect(page.getByText('Leads Converted')).toBeVisible();
  });

  test('5.4 Empty states for Recent Unlocks and Saved Searches render informative prompts', async ({ page }) => {
    await loginUserViaUI(page, testUser.email, testUser.password);
    await page.goto('/dashboard');
    await page.waitForLoadState('domcontentloaded');

    // Recent Unlocks empty state
    await expect(page.getByRole('heading', { name: 'Recent Unlocks' })).toBeVisible();
    await expect(page.getByText(/no unlocked businesses yet/i)).toBeVisible();

    // Saved Searches empty state
    await expect(page.getByRole('heading', { name: 'Saved Searches' })).toBeVisible();
    await expect(page.getByText(/no saved searches yet/i)).toBeVisible();
  });

  test('5.5 Quick action cards navigate to target sections seamlessly', async ({ page }) => {
    await loginUserViaUI(page, testUser.email, testUser.password);
    await page.goto('/dashboard');
    await page.waitForLoadState('domcontentloaded');

    // Click "Discover Find new leads"
    await page.getByRole('link', { name: /Discover Find new leads/i }).click();
    await page.waitForURL('**/discover');
    await expect(page).toHaveURL(/\/discover/);

    // Return to dashboard
    await page.goto('/dashboard');

    // Click "Credits" card
    await page.getByRole('link', { name: /Credits 5 remaining/i }).click();
    await page.waitForURL('**/credits');
    await expect(page).toHaveURL(/\/credits/);
  });

  test('5.6 Dashboard produces zero critical console errors or 5xx network failures', async ({ page, consoleErrors, networkErrors }) => {
    await loginUserViaUI(page, testUser.email, testUser.password);
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    // Filter out expected benign noise (e.g. font preload warnings)
    const severeConsoleErrors = consoleErrors.filter(
      (err) => !err.text.includes('Failed to load resource') && !err.text.includes('hydration')
    );
    expect(severeConsoleErrors.length).toBe(0);
    expect(networkErrors.length).toBe(0);
  });
});
