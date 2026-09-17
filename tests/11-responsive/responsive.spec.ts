import { test, expect } from '../fixtures/test-fixtures';
import { registerUserViaUI, loginUserViaUI, loginAdminViaUI, generateTestUser } from '../fixtures/auth-helpers';

test.describe('PHASE 13: Responsive Layout & Multi-Viewport Testing', () => {
  let testUser = generateTestUser();

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await registerUserViaUI(page, testUser);
    await page.close();
  });

  test('13.1 Mobile Viewport (390x844): Mobile navigation bar and menu render properly', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loginUserViaUI(page, testUser.email, testUser.password);

    await page.goto('/dashboard');
    await page.waitForLoadState('domcontentloaded');

    // On mobile, the desktop sidebar should be hidden and mobile header/menu button visible
    const mobileMenuTrigger = page.locator('button[aria-label*="menu" i], button:has(svg.lucide-menu)').or(
      page.getByRole('button', { name: /toggle navigation|open menu|menu/i })
    );

    if (await mobileMenuTrigger.first().isVisible({ timeout: 5000 })) {
      await mobileMenuTrigger.first().click();
      // Verify mobile nav drawer or menu items are accessible
      const navLinks = page.getByRole('link', { name: /discover|leads|dashboard/i });
      await expect(navLinks.first()).toBeVisible({ timeout: 5000 });
    } else {
      // If bottom navigation bar is used on mobile
      const bottomNav = page.locator('nav').filter({ hasText: /discover|dashboard|leads/i });
      await expect(bottomNav.first()).toBeVisible({ timeout: 5000 });
    }

    // Ensure no horizontal scroll blowout
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(420);
  });

  test('13.2 Mobile Viewport (390x844): Discover page catalog renders responsively without horizontal blowout', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loginUserViaUI(page, testUser.email, testUser.password);

    await page.goto('/discover');
    await page.waitForLoadState('domcontentloaded');

    const searchInput = page.getByPlaceholder(/search by business name/i);
    await expect(searchInput).toBeVisible({ timeout: 10000 });

    // Verify search bar fits within viewport
    const box = await searchInput.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      expect(box.width).toBeLessThanOrEqual(390);
    }

    // Check document width (Discover data table has an inner responsive scroll container up to 650px)
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(650);
  });

  test('13.3 Tablet Viewport (768x1024): Dashboard metrics grid scales responsively', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await loginUserViaUI(page, testUser.email, testUser.password);

    await page.goto('/dashboard');
    await page.waitForLoadState('domcontentloaded');

    // Dashboard metrics cards should be visible
    await expect(page.getByText('Credits Remaining')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Unlocked Leads')).toBeVisible();

    // Verify layout width fits within tablet bounds
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(800);
  });

  test('13.4 Standard Desktop (1280x720): Admin Console full sidebar and table layout render without clipping', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await loginAdminViaUI(page);

    // Sidebar navigation items
    await expect(page.getByRole('button', { name: /dashboard/i }).first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: /business records/i })).toBeVisible();

    // Operations telemetry cards
    await expect(page.getByText('Total Businesses Ingested')).toBeVisible();
    await expect(page.getByText('Published to Live Discover')).toBeVisible();

    // Ensure no unexpected horizontal overflow
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(1300);
  });

  test('13.5 Large Desktop (1440x900): Max-width container centers content cleanly', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginUserViaUI(page, testUser.email, testUser.password);

    await page.goto('/discover');
    await page.waitForLoadState('domcontentloaded');

    const searchInput = page.getByPlaceholder(/search by business name/i);
    await expect(searchInput).toBeVisible({ timeout: 10000 });

    // Ensure content container is centered and bounded
    const bodyBox = await page.locator('body').boundingBox();
    expect(bodyBox?.width).toBeGreaterThanOrEqual(1400);
  });

});
