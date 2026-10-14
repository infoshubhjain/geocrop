import { expect, test } from "@playwright/test";

test("sample field produces labeled indices and CSV export", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Observe your field" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Analyze field/ }).click();
  await expect(page.getByText(/SYNTHETIC DEMO/)).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.locator("#chart svg")).toBeVisible();
  await expect(page.getByText(/Cloud/)).toBeVisible();
  await page.screenshot({ path: "docs/screenshot.png", fullPage: true });
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV" }).click();
  expect((await download).suggestedFilename()).toBe(
    "geocrop-field-observations.csv",
  );
});

test("coordinate controls center the map and source selector explains live records", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Go to point" }).click();
  await expect(page.getByText("Map centered on the coordinate.")).toBeVisible();
  await page.getByLabel("DATA SOURCE").selectOption("live");
  await expect(
    page.getByText(/Searches Planetary Computer scenes/),
  ).toBeVisible();
});

test("boundary drawing accepts a polygon and explains synthetic coverage limits", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Draw boundary/ }).click();
  const map = await page.locator("#map").boundingBox();
  if (!map) throw new Error("Map is not visible");
  for (const [x, y] of [
    [0.35, 0.3],
    [0.65, 0.3],
    [0.65, 0.7],
    [0.35, 0.7],
  ]) {
    await page.mouse.click(map.x + map.width * x, map.y + map.height * y);
  }
  await page.getByRole("button", { name: "Finish boundary" }).click();
  await expect(
    page.getByText(
      "Boundary selected. Analyze to validate its geometry and area.",
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: /Analyze field/ }).click();
  await expect(
    page.getByText(/Synthetic demo covers only the sample Iowa field/),
  ).toBeVisible({ timeout: 15_000 });
});

test("keyboard-friendly GeoJSON entry selects a boundary", async ({ page }) => {
  await page.goto("/");
  await page.getByText("Paste a boundary GeoJSON").click();
  await page.getByLabel("Polygon geometry or Feature · WGS84").fill(
    JSON.stringify({
      type: "Polygon",
      coordinates: [
        [
          [-93.501, 41.699],
          [-93.499, 41.699],
          [-93.499, 41.701],
          [-93.501, 41.701],
          [-93.501, 41.699],
        ],
      ],
    }),
  );
  await page.getByRole("button", { name: "Use this boundary" }).click();
  await expect(
    page.getByText(
      "Boundary selected. Analyze to validate its geometry and area.",
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: /Analyze field/ }).click();
  await expect(page.getByText(/boundary validated/)).toBeVisible({
    timeout: 15_000,
  });
});

test("mobile layout stays within the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Observe your field" }),
  ).toBeVisible();
  await expect(page.locator("#map")).toBeVisible();
  expect(
    await page.locator("body").evaluate((el) => el.scrollWidth),
  ).toBeLessThanOrEqual(390);
});
