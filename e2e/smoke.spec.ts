import { expect, test } from "@playwright/test";

test("production policy permits the default satellite tiles", async ({
  page,
}) => {
  await page.route("https://server.arcgisonline.com/**", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"/>',
    }),
  );
  await page.goto("/");
  await expect(
    page.locator(".leaflet-tile[src*='World_Imagery']").first(),
  ).toHaveJSProperty("naturalWidth", 256);
});

test("bundled Sentinel example shows its coverage and exports selected pixels", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Field image lab" }),
  ).toBeVisible();
  await expect(page.locator(".leaflet-control-layers-toggle")).toBeVisible();
  await expect(
    page.locator(".leaflet-tile[src*='World_Imagery']").first(),
  ).toBeVisible();
  await expect(page.locator('img[src="/example-ndvi.png"]')).toBeVisible();
  await expect(page.locator("#example-legend")).toBeVisible();
  await page.getByRole("button", { name: /Analyze selected area/ }).click();
  await expect(page.getByText(/BUNDLED SENTINEL-2 EXAMPLE/)).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.locator("#mean-ndvi")).not.toHaveText("—");
  await expect(page.locator("#chart svg")).toBeVisible();
  await expect(page.locator(".distribution-range")).toHaveAttribute("d", /H/);
  await expect(page.locator("#cloud-label")).toHaveText("AOI CLOUD");
  await page.screenshot({
    path: "test-results/screenshot-desktop.png",
    fullPage: true,
  });
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV" }).click();
  expect((await download).suggestedFilename()).toBe(
    "geocrop-field-observations.csv",
  );
});

test("changing a boundary hides old statistics and prevents stale responses", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Analyze selected area/ }).click();
  await expect(page.locator("#chart svg")).toBeVisible();
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
  await expect(page.locator("#results")).toBeHidden();

  let finishRequest: (() => void) | undefined;
  await page.route("**/api/analysis/example", async (route) => {
    await new Promise<void>((resolve) => {
      finishRequest = resolve;
    });
    await route.fulfill({
      json: { source: "bundled-sentinel-example", observations: [] },
    });
  });
  await page.getByRole("button", { name: /Analyze selected area/ }).click();
  await expect.poll(() => !!finishRequest).toBe(true);
  await page.getByLabel("DATA SOURCE").selectOption("live");
  finishRequest?.();
  await expect(page.locator("#results")).toBeHidden();
});

test("import ignores disabled dates and plots negative NDVI below zero", async ({
  page,
}) => {
  await page.route("**/api/analysis/import", (route) =>
    route.fulfill({
      json: {
        source: "user-import",
        source_label: "USER IMPORT",
        area_ha: 1,
        observations: [
          {
            date: "2024-06-01",
            ndvi: -0.5,
            ndmi: null,
            pixel_count: 10,
            cloud_percent: null,
            mask: "nodata",
          },
        ],
      },
    }),
  );
  await page.goto("/");
  await page.getByLabel("DATA SOURCE").selectOption("demo");
  await page.getByLabel("TO").fill("2024-01-01");
  await page.getByLabel("DATA SOURCE").selectOption("import");
  await page.locator("#raster-file").setInputFiles({
    name: "sample.tif",
    mimeType: "image/tiff",
    buffer: Buffer.from("probe"),
  });
  await page.getByRole("button", { name: /Analyze imported GeoTIFF/ }).click();
  await expect(page.locator("#chart svg")).toHaveAttribute(
    "aria-label",
    /vertical range -1 to 1/,
  );
  const pointY = Number(
    await page.locator('#chart circle[fill="#c76a3d"]').getAttribute("cy"),
  );
  const zeroY = 24 + (150 - 48) / 2;
  expect(pointY).toBeGreaterThan(zeroY);
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
  await expect(page.locator('img[src="/example-ndvi.png"]')).toBeHidden();
  await expect(page.locator(".leaflet-control-layers-list")).not.toContainText(
    "Example NDVI",
  );
  await page.getByLabel("DATA SOURCE").selectOption("example");
  await expect(page.locator('img[src="/example-ndvi.png"]')).toBeVisible();
});

test("boundary drawing selects part of the example and keeps coverage visible", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Select area/ }).click();
  const map = await page.locator("#map").boundingBox();
  if (!map) throw new Error("Map is not visible");
  for (const [x, y] of [
    [0.37, 0.4],
    [0.44, 0.4],
    [0.44, 0.6],
    [0.37, 0.6],
  ]) {
    await page.mouse.click(map.x + map.width * x, map.y + map.height * y);
  }
  await page.getByRole("button", { name: "Finish boundary" }).click();
  await expect(
    page.getByText(
      "Boundary selected. Analyze to validate its geometry and area.",
    ),
  ).toBeVisible();
  await expect(page.locator("#example-legend")).toBeVisible();
  await page.getByRole("button", { name: /Analyze selected area/ }).click();
  await expect(page.getByText(/boundary validated/)).toBeVisible({
    timeout: 15_000,
  });
  await page.screenshot({
    path: "test-results/screenshot-selection.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Reset sample" }).click();
  await expect(page.locator("#results")).toBeHidden();
  await expect(page.locator("#field-name")).toHaveText("Sample field · Iowa");
});

test("synthetic time series remains labeled and hides the real-scene overlay", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("DATA SOURCE").selectOption("demo");
  await expect(page.locator("#example-legend")).toBeHidden();
  await expect(page.locator('img[src="/example-ndvi.png"]')).toBeHidden();
  await page.getByRole("button", { name: /Analyze field/ }).click();
  await expect(page.getByText(/SYNTHETIC DEMO/)).toBeVisible();
  await expect(page.locator("#chart svg")).toBeVisible();
  const firstObservation = page.locator("#observation-list button").first();
  await firstObservation.click();
  await expect(firstObservation).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#ndvi-feature-label")).toContainText("MEAN NDVI");
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
  await page.getByRole("button", { name: /Analyze selected area/ }).click();
  await expect(page.getByText(/boundary validated/)).toBeVisible({
    timeout: 15_000,
  });
});

test("mobile layout stays within the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 900 });
  await page.goto("/");
  expect(
    await page.locator("body").evaluate((el) => el.scrollWidth),
  ).toBeLessThanOrEqual(720);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Field image lab" }),
  ).toBeVisible();
  await expect(page.locator("#map")).toBeVisible();
  await page.getByRole("button", { name: /Analyze selected area/ }).click();
  await expect(page.locator("#chart svg")).toBeVisible();
  expect(
    await page.locator("body").evaluate((el) => el.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.screenshot({
    path: "test-results/screenshot-mobile.png",
    fullPage: true,
  });
});

test("analyzes selected Sentinel scenes chronologically and exports scene provenance", async ({
  page,
}) => {
  await page.route("https://example.test/preview", (route) => route.abort());
  await page.route("**/api/catalog/search", (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: "scene-later",
            datetime: "2024-06-01T10:00:00Z",
            cloud_percent: 8,
            source_url: "https://example.test/later",
            preview_url: "https://example.test/preview",
          },
          {
            id: "scene-earlier",
            datetime: "2024-05-01T10:00:00Z",
            cloud_percent: 5,
            source_url: "https://example.test/earlier",
            preview_url: "https://example.test/preview",
          },
          {
            id: "scene-middle",
            datetime: "2024-05-02T10:00:00Z",
            cloud_percent: 6,
            source_url: "https://example.test/middle",
            preview_url: "https://example.test/preview",
          },
        ],
        cached: false,
      },
    }),
  );
  await page.route("**/api/analysis/live", async (route) => {
    const id = (route.request().postDataJSON() as { item_id: string }).item_id;
    const date =
      id === "scene-earlier"
        ? "2024-05-01"
        : id === "scene-middle"
          ? "2024-05-02"
          : "2024-06-01";
    await route.fulfill({
      json: {
        source: "live-sentinel-pixels",
        source_label: "LIVE",
        observations: [
          {
            date,
            scene_id: id,
            acquired: date + "T10:00:00Z",
            scene_cloud_percent: id === "scene-earlier" ? 5 : 8,
            ndvi: 0.6,
            ndmi: null,
            cloud_percent: 5,
            pixel_count: 12,
            mask: "SCL",
          },
        ],
        provenance: { scene_id: id },
      },
    });
  });
  await page.goto("/");
  await page.getByLabel("DATA SOURCE").selectOption("live");
  await page.getByRole("button", { name: /Search live imagery/ }).click();
  await page
    .getByRole("button", { name: "Load true-color preview" })
    .first()
    .click();
  await expect(
    page.getByRole("button", { name: "Preview unavailable · retry" }),
  ).toBeVisible();
  await expect(page.locator(".analyze-control").first()).toHaveText(
    "Analyze NDVI pixels",
  );
  await page
    .getByLabel("Select scene scene-later for multi-date analysis")
    .check();
  await page
    .getByLabel("Select scene scene-earlier for multi-date analysis")
    .check();
  await page
    .getByLabel("Select scene scene-middle for multi-date analysis")
    .check();
  await page
    .getByRole("button", { name: "Analyze selected scenes (max 5)" })
    .click();
  await expect(page.getByText(/MULTI-SCENE ANALYSIS/)).toBeVisible();
  await expect(page.locator("#cloud-label")).toHaveText("AOI CLOUD");
  await expect(page.locator("#ndmi-legend")).toBeHidden();
  await expect(page.locator("#chart svg")).toBeVisible();
  const positions = await page
    .locator('#chart circle[fill="#c76a3d"]')
    .evaluateAll((circles) =>
      circles.map((circle) => Number(circle.getAttribute("cx"))),
    );
  expect(positions).toHaveLength(3);
  expect(positions[1] - positions[0]).toBeLessThan(
    (positions[2] - positions[1]) / 10,
  );
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV" }).click();
  const file = await download;
  const fs = await import("node:fs/promises");
  const content = await fs.readFile(await file.path(), "utf8");
  expect(content.indexOf("scene-earlier")).toBeLessThan(
    content.indexOf("scene-later"),
  );
  expect(content).toContain("scene_cloud_percent");
});
