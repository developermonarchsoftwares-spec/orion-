import { test, expect } from '../fixtures/test-fixtures';
import { loginAdminViaUI } from '../fixtures/auth-helpers';

test.describe('PHASE 9: CSV Ingestion & Import Pipeline Testing', () => {

  test('9.1 Admin can navigate to Import Data view in Monarch Console', async ({ page }) => {
    await loginAdminViaUI(page);

    // Click 'Import Data' navigation in Admin Sidebar
    const importNav = page.getByRole('button', { name: /import data/i });
    await expect(importNav).toBeVisible({ timeout: 10000 });
    await importNav.click();

    // Verify Import View Header
    await expect(page.getByRole('heading', { name: /upload indian business ingestion batch/i })).toBeVisible({ timeout: 8000 });
    await expect(page.getByText('Drag & Drop files here, or browse')).toBeVisible();
    await expect(page.getByText('Download Canonical Template')).toBeVisible();
  });

  test('9.2 Template download API returns valid CSV header schema', async ({ request }) => {
    const res = await request.get('/api/v1/admin/import/template');
    expect(res.status()).toBe(200);

    const contentType = res.headers()['content-type'] || '';
    expect(contentType).toContain('text/csv');

    const csvText = await res.text();
    // Verify required Indian corporate columns
    expect(csvText).toContain('name');
    expect(csvText).toContain('legalName');
    expect(csvText).toContain('cin');
    expect(csvText).toContain('pan');
    expect(csvText).toContain('gstin');
    expect(csvText).toContain('pincode');
    expect(csvText).toContain('state');
  });

  test('9.3 Using canonical sample file populates records and displays file summary', async ({ page }) => {
    await loginAdminViaUI(page);

    await page.getByRole('button', { name: /import data/i }).click();
    await expect(page.getByText('canonical_indian_enterprises_sample.csv')).toBeVisible();

    // Click "Use Real Sample File"
    const sampleBtn = page.getByRole('button', { name: /use real sample file/i });
    await expect(sampleBtn).toBeVisible();
    await sampleBtn.click();

    // Verify file summary card displays detected records
    await expect(page.getByText(/Selected:.*canonical_indian_enterprises_sample\.csv/i)).toBeVisible({ timeout: 6000 });
    await expect(page.getByText(/5 records detected/i)).toBeVisible();

    // Verify Proceed button is enabled
    const proceedBtn = page.getByRole('button', { name: /continue to pre-commit validation/i });
    await expect(proceedBtn).toBeVisible();
    await expect(proceedBtn).toBeEnabled();
  });

  test('9.4 Schema mapping step accurately maps Indian business columns', async ({ page }) => {
    await loginAdminViaUI(page);

    await page.getByRole('button', { name: /import data/i }).click();
    await page.getByRole('button', { name: /use real sample file/i }).click();

    const proceedBtn = page.getByRole('button', { name: /continue to pre-commit validation/i });
    await proceedBtn.click();

    // Step 2: Pre-Commit Validation & Duplicate Analysis
    await expect(page.getByRole('heading', { name: /pre-commit validation & duplicate analysis/i })).toBeVisible({ timeout: 20000 });

    // Verify evaluated rows preview table and metrics
    await expect(page.getByText('Clean & Valid')).toBeVisible();
    await expect(page.getByText('Evaluated Rows Preview', { exact: false })).toBeVisible();
  });

  test('9.5 File validation correctly handles malformed or empty CSV files', async ({ page }) => {
    await loginAdminViaUI(page);

    await page.getByRole('button', { name: /import data/i }).click();

    // Upload an invalid/empty file via hidden file input
    const fileInput = page.locator('input#file-upload');
    await fileInput.setInputFiles({
      name: 'empty_invalid.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('   \n\n  '),
    });

    // Verify validation error message is presented
    await expect(
      page.getByText(/could not parse any records|file appears empty/i).first()
    ).toBeVisible({ timeout: 6000 });
  });
});
