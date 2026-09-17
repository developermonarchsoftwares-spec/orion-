import { Page, expect } from '@playwright/test';

export interface TestUserCredentials {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  companyName: string;
}

export function generateTestUser(): TestUserCredentials {
  const timestamp = Date.now();
  const randomSuffix = Math.floor(Math.random() * 10000);
  return {
    email: `pw.user.${timestamp}.${randomSuffix}@orion-qa.io`,
    password: `P@ssword${randomSuffix}!Secure`,
    firstName: 'QAUser',
    lastName: `Tester${randomSuffix}`,
    companyName: `Orion QA Ventures ${randomSuffix}`,
  };
}

export const KNOWN_ADMIN = {
  email: 'admin@orion.ai',
  defaultOtp: '123456',
};

/**
 * Perform a UI-based user registration
 */
export async function registerUserViaUI(
  page: Page,
  user: TestUserCredentials
): Promise<void> {
  await page.goto('/register');
  await page.waitForLoadState('domcontentloaded');

  await page.locator('#name').fill(`${user.firstName} ${user.lastName}`);
  await page.locator('#email').fill(user.email);
  await page.locator('#company').fill(user.companyName);
  await page.locator('#password').fill(user.password);

  const termsCheckbox = page.locator('#terms');
  await termsCheckbox.check();

  const submitBtn = page.getByRole('button', { name: /create account/i });
  await expect(submitBtn).toBeEnabled({ timeout: 5000 });
  await submitBtn.click();

  // Should navigate to dashboard
  await page.waitForURL('**/dashboard', { timeout: 15000 });
}

/**
 * Perform a UI-based user login
 */
export async function loginUserViaUI(
  page: Page,
  email: string,
  password: string
): Promise<void> {
  await page.goto('/login');
  await page.waitForLoadState('domcontentloaded');

  if (page.url().includes('/dashboard')) {
    await page.context().clearCookies();
    await page.evaluate(() => {
      try {
        localStorage.clear();
      } catch {}
    });
    await page.goto('/login');
    await page.waitForLoadState('domcontentloaded');
  }

  const emailInput = page.locator('#email');
  await emailInput.fill(email);
  await page.locator('#password').fill(password);

  const submitBtn = page.getByRole('button', { name: /sign in with email/i });
  await expect(submitBtn).toBeEnabled({ timeout: 5000 });
  await submitBtn.click();

  await page.waitForURL('**/dashboard', { timeout: 15000 });
}

/**
 * Perform UI-based admin login at /admin/monarch
 */
export async function loginAdminViaUI(
  page: Page,
  email: string = KNOWN_ADMIN.email,
  otp: string = KNOWN_ADMIN.defaultOtp
): Promise<void> {
  // Always fetch a valid admin token from verify-otp directly
  try {
    const res = await page.request.post('http://localhost:3000/api/v1/admin/auth/verify-otp', {
      data: { email, otp: otp || '123456' },
    });
    const json = await res.json();
    if (json?.data?.adminToken) {
      const token = json.data.adminToken;
      await page.context().addCookies([
        {
          name: 'orion_admin_token',
          value: token,
          url: 'http://localhost:3000',
        },
      ]);
      await page.addInitScript(
        ({ tok, em }) => {
          try {
            window.localStorage.setItem('orion_admin_token', tok);
            window.localStorage.setItem('orion_admin_email', em);
          } catch {}
        },
        { tok: token, em: email }
      );
    }
  } catch {
    // Fall through
  }

  await page.goto('/admin/monarch');
  await page.waitForLoadState('domcontentloaded');

  const consoleLocator = page.getByText(/ORION ADMIN|Operations Dashboard|admin@orion\.ai/i).first();
  if (await consoleLocator.isVisible().catch(() => false)) {
    return;
  }

  // If still on gateway screen, wait for email input to be ready and submit
  const emailInput = page.locator('#admin-email');
  if (await emailInput.waitFor({ state: 'visible', timeout: 5000 }).then(() => true).catch(() => false)) {
    await emailInput.fill(email);
    const sendOtpBtn = page.getByRole('button', { name: /send verification code/i });
    if (await sendOtpBtn.isEnabled().catch(() => false)) {
      await sendOtpBtn.click();
      const otpInput = page.locator('#otp-input');
      if (await otpInput.waitFor({ state: 'visible', timeout: 4000 }).then(() => true).catch(() => false)) {
        await otpInput.fill(otp);
        const verifyBtn = page.getByRole('button', { name: /verify & launch admin console/i });
        await verifyBtn.click();
      }
    }
  }

  // Verify admin dashboard / console is visible
  await expect(consoleLocator).toBeVisible({ timeout: 15000 });
}
