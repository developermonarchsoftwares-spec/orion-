import { test, expect } from '../fixtures/test-fixtures';
import { loginAdminViaUI } from '../fixtures/auth-helpers';

test.describe('PHASE 11: Admin Console & Monarch Platform Management', () => {

  test('11.1 Admin console loads with core telemetry and operations dashboard', async ({ page }) => {
    await loginAdminViaUI(page);

    // Verify operations dashboard heading & telemetry cards
    await expect(page.getByRole('heading', { name: /operations dashboard/i })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Total Businesses Ingested')).toBeVisible();
    await expect(page.getByText('Published to Live Discover')).toBeVisible();
    await expect(page.getByText('Active Platform Subscribers')).toBeVisible();
    await expect(page.getByText('Automated Data Quality & Validation Telemetry')).toBeVisible();
  });

  test('11.2 Business Records view renders record table and search filter', async ({ page }) => {
    await loginAdminViaUI(page);

    // Navigate to Business Records view
    const recordsBtn = page.getByRole('button', { name: /business records/i });
    await expect(recordsBtn).toBeVisible({ timeout: 10000 });
    await recordsBtn.click();

    // Verify Business Records Table
    await expect(page.getByPlaceholder(/search records by name/i)).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: /export csv/i })).toBeVisible();

    // Verify table headers
    await expect(page.getByRole('columnheader', { name: 'Business Name' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Industry & Category' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Status', exact: true })).toBeVisible();
  });

  test('11.3 Inspecting a business record opens the detail inspection modal', async ({ page }) => {
    await loginAdminViaUI(page);

    await page.getByRole('button', { name: /business records/i }).click();
    await page.waitForLoadState('domcontentloaded');

    // Click on the first business row to open preview/details modal
    const firstRow = page.locator('tbody tr').first();
    await expect(firstRow).toBeVisible({ timeout: 10000 });
    await firstRow.click();

    // Verify business details modal is opened
    await expect(page.getByRole('heading', { name: /business record/i }).or(page.getByRole('heading', { name: /details/i })).first()).toBeVisible({ timeout: 8000 });
  });

  test('11.4 Users Management view displays registered customers and plan filters', async ({ page }) => {
    await loginAdminViaUI(page);

    // Navigate to Users view
    const usersBtn = page.getByRole('button', { name: /users & customers/i });
    await expect(usersBtn).toBeVisible({ timeout: 10000 });
    await usersBtn.click();

    // Verify Users Management view loaded
    await expect(page.getByRole('heading', { name: /customer & (user|account) management/i }).first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByPlaceholder(/search by name, company, email/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /create customer user/i })).toBeVisible();
  });

  test('11.5 System Health view displays cluster services and telemetry status', async ({ page }) => {
    await loginAdminViaUI(page);

    // Navigate to System Health view
    const healthBtn = page.getByRole('button', { name: /system health/i });
    await expect(healthBtn).toBeVisible({ timeout: 10000 });
    await healthBtn.click();

    // Verify System Health view loaded
    await expect(page.getByRole('heading', { name: /system health & microservices observability|platform infrastructure health/i }).first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/all systems operational/i).first()).toBeVisible();

    // Verify services listed
    await expect(page.getByText(/primary cockroachdb master cluster|elasticsearch|ingestion/i).first()).toBeVisible();
  });
});
