import { expect, test } from "@playwright/test";

test("marketing page loads", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/MyFinancier/);
});

test("sign-in page renders the form", async ({ page }) => {
  await page.goto("/signin");
  await expect(
    page.getByRole("heading", { name: "Welcome back." }),
  ).toBeVisible();
  await expect(page.getByPlaceholder("Username")).toBeVisible();
  await expect(page.getByPlaceholder("Password")).toBeVisible();
});

test("protected routes redirect signed-out users to sign-in", async ({
  page,
}) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/signin$/);
});
