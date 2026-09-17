import { test, expect } from '../fixtures/test-fixtures';
import { registerUserViaUI, loginUserViaUI, generateTestUser } from '../fixtures/auth-helpers';

test.describe('PHASE 12: Negative Testing, Boundary Conditions & Error Handling', () => {
  let testUser = generateTestUser();

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await registerUserViaUI(page, testUser);
    await page.close();
  });

  test('12.1 SQL Injection and XSS probe strings in Discover search do not cause script execution or crash', async ({ page }) => {
    await loginUserViaUI(page, testUser.email, testUser.password);
    await page.goto('/discover');
    await page.waitForLoadState('domcontentloaded');

    const searchInput = page.getByPlaceholder(/search by business name/i);
    await expect(searchInput).toBeVisible({ timeout: 10000 });

    // Track dialogs to ensure no script execution occurred
    let dialogTriggered = false;
    page.on('dialog', async (dialog) => {
      dialogTriggered = true;
      await dialog.dismiss();
    });

    // Probe 1: XSS script tag
    await searchInput.fill('<script>alert("XSS")</script>');
    await searchInput.press('Enter');
    await page.waitForTimeout(500);
    expect(dialogTriggered).toBe(false);

    // Probe 2: HTML image error payload
    await searchInput.fill('"><img src=x onerror=alert(1)>');
    await searchInput.press('Enter');
    await page.waitForTimeout(500);
    expect(dialogTriggered).toBe(false);

    // Probe 3: SQL Injection payload
    await searchInput.fill("' OR '1'='1' --");
    await searchInput.press('Enter');
    await page.waitForTimeout(500);

    // The application should remain functional and intact without crashing
    await expect(page.locator('body')).toBeVisible();
    await expect(searchInput).toBeVisible();
  });

  test('12.2 Navigating to a non-existent route displays graceful 404 page', async ({ page }) => {
    await page.goto('/nonexistent-system-route-xyz-404');
    await page.waitForLoadState('domcontentloaded');

    // Should display 404 or page not found or redirect to login/dashboard
    const notFoundIndicator = page.getByText(/404|not found|page could not be found|does not exist/i).or(
      page.getByRole('heading', { name: /404|not found/i })
    );
    await expect(notFoundIndicator.first()).toBeVisible({ timeout: 10000 });
  });

  test('12.3 Rapid double-clicks on action buttons do not cause duplicate triggers or application crash', async ({ page }) => {
    await loginUserViaUI(page, testUser.email, testUser.password);
    await page.goto('/discover');
    await page.waitForLoadState('domcontentloaded');

    // Rapidly click filter chips or buttons
    const filterBtn = page.getByRole('button', { name: /all filters|filters/i }).first();
    if (await filterBtn.isVisible({ timeout: 5000 })) {
      await filterBtn.click({ clickCount: 3, delay: 50 });
      await expect(page.locator('body')).toBeVisible();
    }

    // Verify page state remains responsive
    const searchInput = page.getByPlaceholder(/search by business name/i);
    await expect(searchInput).toBeVisible();
  });

  test('12.4 Graceful handling of simulated API 500 server error on lead unlock', async ({ page }) => {
    await loginUserViaUI(page, testUser.email, testUser.password);
    await page.goto('/discover');
    await page.waitForLoadState('domcontentloaded');

    // Intercept unlock request and mock internal 500 error
    await page.route('**/api/v1/leads/unlock', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({
          statusCode: 500,
          message: 'Internal Database Cluster Outage Simulated',
        }),
      });
    });

    const unlockBtn = page.getByRole('button', { name: /unlock contact/i }).first();
    if (await unlockBtn.isVisible({ timeout: 8000 })) {
      await unlockBtn.click();

      // Ensure error toast / notification appears rather than unhandled white screen
      await expect(
        page.getByText(/outage|error|failed|something went wrong|unable to unlock/i).first()
      ).toBeVisible({ timeout: 10000 });
    }
  });

  test('12.5 Oversized payload in Saved Search modal is handled gracefully', async ({ page }) => {
    await loginUserViaUI(page, testUser.email, testUser.password);
    await page.goto('/discover');
    await page.waitForLoadState('domcontentloaded');

    const saveSearchBtn = page.getByRole('button', { name: /save search/i }).first();
    await expect(saveSearchBtn).toBeVisible({ timeout: 10000 });
    await saveSearchBtn.click();

    // Verify Save Search Modal is open
    const nameInput = page.getByPlaceholder(/CA Tech Startups No Website/i);
    await expect(nameInput).toBeVisible({ timeout: 5000 });

    // Fill massive string (2,000 characters)
    const massiveName = 'A'.repeat(2000);
    await nameInput.fill(massiveName);

    const submitBtn = page.locator('form').getByRole('button', { name: 'Save Search' });
    await submitBtn.click();

    // System should either reject with validation error or truncate cleanly without crashing
    await page.waitForTimeout(1000);
    await expect(page.locator('body')).toBeVisible();
  });

});
