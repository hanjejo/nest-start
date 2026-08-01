import { expect, test } from '@playwright/test';

test.describe('NestStart FE ↔ API integration', () => {
  test('creates a user through the UI and lists it from the API', async ({
    page,
  }) => {
    const stamp = Date.now();
    const name = `Ada ${stamp}`;
    const email = `ada.${stamp}@example.com`;

    await page.goto('/');

    await expect(page.getByText('NestStart')).toBeVisible();
    await page.getByTestId('name-input').fill(name);
    await page.getByTestId('email-input').fill(email);
    await page.getByTestId('submit-user').click();

    await expect(page.getByTestId('status')).toContainText(`Added ${name}`);
    await expect(page.getByTestId('user-list')).toContainText(name);
    await expect(page.getByTestId('user-list')).toContainText(email);

    const apiUsers = await page.request.get('http://localhost:3000/api/user');
    expect(apiUsers.ok()).toBeTruthy();
    const body = (await apiUsers.json()) as Array<{
      name: string;
      email: string;
    }>;
    expect(body.some((user) => user.email === email && user.name === name)).toBe(
      true,
    );
  });
});
