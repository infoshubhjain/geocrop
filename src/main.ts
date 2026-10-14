import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./style.css";

type Observation = {
  date: string;
  scene_id?: string;
  acquired?: string | null;
  scene_cloud_percent?: number | null;
  ndvi: number | null;
  ndmi: number | null;
  pixel_count: number;
  masked_pixel_count?: number;
  cloud_percent: number | null;
  nodata_percent?: number;
  resolution_m?: number | null;
  ndvi_percentiles?: { p10: number; p50: number; p90: number };
  mask: string;
};
type Result = {
  source: string;
  source_label?: string;
  area_ha?: number;
  observations?: Observation[];
  provenance?: Record<string, unknown>;
};
type Scene = {
  id: string;
  datetime: string;
  cloud_percent: number | null;
  platform?: string;
  gsd_m?: number;
  footprint?: GeoJSON.Geometry;
  source_url: string;
  preview_url: string;
};

const sample: GeoJSON.Feature<GeoJSON.Polygon> = {
  type: "Feature",
  properties: { name: "Sample field · Iowa" },
  geometry: {
    type: "Polygon",
    coordinates: [
      [
        [-93.504, 41.696],
        [-93.495, 41.696],
        [-93.495, 41.703],
        [-93.504, 41.703],
        [-93.504, 41.696],
      ],
    ],
  },
};
const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
  <header class="topbar"><a class="brand" href="#"><span class="brand-mark">✳</span><span>GeoCrop<small>FIELD INTELLIGENCE</small></span></a><div class="top-meta"><span class="live-dot"></span> Decision support · Preview</div></header>
  <main class="layout">
    <section class="map-column" aria-label="Field map">
      <div class="map-toolbar"><div class="map-label"><span class="eyebrow">WORKSPACE / FIELD 01</span><strong id="field-name">Sample field · Iowa</strong></div><div class="map-actions"><button id="draw-btn" class="button secondary">＋ Draw boundary</button><button id="finish-btn" class="button primary" disabled>Finish boundary</button></div></div>
      <div id="map" role="application" aria-label="Interactive field map. Activate Draw boundary, then click at least three map points."></div>
      <div class="map-footer"><span>ⓘ Imagery pixels are 10–20 m; field averages include mixed edge pixels.</span><span id="area-chip">Sample area</span></div>
      <section class="below-map"><div class="section-title"><div><span class="eyebrow">LOCATION</span><h2>Find a field</h2></div><span class="muted">Coordinates · WGS84</span></div><div class="coordinate-row"><label>Latitude<input id="latitude" inputmode="decimal" value="41.6995" aria-label="Latitude"></label><label>Longitude<input id="longitude" inputmode="decimal" value="-93.4995" aria-label="Longitude"></label><button id="locate-btn" class="button secondary">Go to point</button></div><p class="muted small">Or draw a polygon on the map. Cross-antimeridian boundaries are not supported.</p></section>
      <details class="geojson-entry"><summary>Paste a boundary GeoJSON</summary><label for="geojson-input" class="muted small">Polygon geometry or Feature · WGS84</label><textarea id="geojson-input" rows="3" placeholder='{"type":"Polygon","coordinates":[[[-93.5,41.7],…]]}'></textarea><button id="apply-geojson" class="button secondary">Use this boundary</button></details>
    </section>
    <aside class="panel" aria-label="Analysis controls and results">
      <div class="panel-heading"><div><span class="eyebrow">CROP CONDITION</span><h1>Observe your field</h1></div><span class="status-pill">BETA</span></div>
      <p class="intro">Track spectral changes across dates. Indicators describe surface reflectance, not crop health or yield.</p>
      <div class="control-card"><label class="field-label" for="source-mode">DATA SOURCE</label><select id="source-mode"><option value="demo">Synthetic demo · always available</option><option value="live">Live catalog · Sentinel‑2 L2A</option><option value="import">Import GeoTIFF</option></select><div id="source-note" class="helper">Deterministic sample data, clearly labeled. No satellite observations.</div>
        <div id="import-row" hidden><label class="field-label" for="raster-file">3-band reflectance GeoTIFF</label><input id="raster-file" type="file" accept=".tif,.tiff,image/tiff"><div class="helper">One scene; date range is not used. Band 1 red, 2 NIR, 3 SWIR; unit reflectance 0–1. Up to 20 MB.</div></div>
        <div class="date-grid"><label>FROM<input type="date" id="start-date" value="2024-04-01"></label><label>TO<input type="date" id="end-date" value="2024-09-30"></label></div>
        <button id="analyze-btn" class="button primary analyze">Analyze field <span>→</span></button>
      </div>
      <div id="feedback" class="feedback" role="status" aria-live="polite">Choose a source and analyze the sample field.</div>
      <div id="results" hidden>
        <div class="result-head"><div><span class="eyebrow">VEGETATION INDICATORS</span><h2 id="result-title">Seasonal profile</h2></div><button id="export-btn" class="icon-button" title="Export CSV" aria-label="Export CSV">↧</button></div>
        <div id="data-badge" class="data-badge"></div>
        <div class="chart-legend"><span><i class="swatch ndvi"></i>NDVI</span><span id="ndmi-legend"><i class="swatch ndmi"></i>NDMI</span><span id="chart-range" class="muted"></span></div>
        <div id="chart" class="chart" role="img" aria-label="NDVI and NDMI time series"></div>
        <div id="scene-list" class="scene-list"></div>
        <div class="quality-grid"><div><span id="cloud-label" class="eyebrow">AOI CLOUD</span><strong id="cloud-value">—</strong></div><div><span class="eyebrow">VALID PIXELS</span><strong id="pixel-value">—</strong></div><div><span class="eyebrow">FIELD AREA</span><strong id="area-value">—</strong></div></div>
        <details class="provenance"><summary>Methods & provenance</summary><dl id="provenance"></dl></details>
      </div>
      <div class="limits"><span>ⓘ</span><p>Vegetation indices can vary with clouds, soil, crop type, phenology, mixed pixels, and sensor processing. They do not diagnose disease, irrigation need, or yield.</p></div>
      <footer>Sentinel‑2 data © ESA/Copernicus · Hosted by Microsoft Planetary Computer · <a href="https://planetarycomputer.microsoft.com/terms" target="_blank" rel="noreferrer">Service terms</a><p>OpenStreetMap receives map viewport tile requests.</p></footer>
    </aside>
  </main>`;

const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const map = L.map("map", { zoomControl: false }).setView(
  [41.6995, -93.4995],
  14,
);
L.control.zoom({ position: "bottomright" }).addTo(map);
L.control.scale({ position: "bottomleft", imperial: false }).addTo(map);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
}).addTo(map);
let aoi: GeoJSON.Feature<GeoJSON.Polygon> = structuredClone(sample);
let boundary = L.geoJSON(aoi, {
  style: {
    color: "#c76a3d",
    weight: 2,
    fillColor: "#dcaa63",
    fillOpacity: 0.2,
  },
}).addTo(map);
let footprintLayer: L.GeoJSON | undefined;
let drawing = false;
let vertices: L.LatLng[] = [];
let latest: Result | undefined;

const updateAreaLabel = (name: string) => {
  $("field-name").textContent = name;
};
const geo = () => ({ type: "Feature", properties: {}, geometry: aoi.geometry });
const dates = () => ({
  start: $<HTMLInputElement>("start-date").value,
  end: $<HTMLInputElement>("end-date").value,
});
const setFeedback = (message: string, error = false) => {
  const el = $("feedback");
  el.textContent = message;
  el.classList.toggle("error", error);
};

$("draw-btn").addEventListener("click", () => {
  drawing = true;
  vertices = [];
  boundary.remove();
  $("finish-btn").removeAttribute("disabled");
  setFeedback(
    "Click three or more points inside your field, then finish the boundary.",
  );
});
map.on("click", (event: L.LeafletMouseEvent) => {
  if (!drawing) return;
  vertices.push(event.latlng);
  L.circleMarker(event.latlng, { radius: 4, color: "#c76a3d" }).addTo(map);
  if (vertices.length > 1)
    L.polyline(vertices, { color: "#c76a3d", dashArray: "5 5" }).addTo(map);
});
$("finish-btn").addEventListener("click", () => {
  if (vertices.length < 3) {
    setFeedback("Add at least three boundary points.", true);
    return;
  }
  const ring = vertices.map((p) => [p.lng, p.lat]);
  ring.push(ring[0]);
  aoi = {
    type: "Feature",
    properties: {},
    geometry: { type: "Polygon", coordinates: [ring] },
  };
  drawing = false;
  map.eachLayer((layer) => {
    if (layer instanceof L.CircleMarker || layer instanceof L.Polyline)
      map.removeLayer(layer);
  });
  boundary = L.geoJSON(aoi, {
    style: {
      color: "#c76a3d",
      weight: 2,
      fillColor: "#dcaa63",
      fillOpacity: 0.2,
    },
  }).addTo(map);
  updateAreaLabel("Selected field");
  $("area-chip").textContent = "Boundary selected";
  $("finish-btn").setAttribute("disabled", "");
  setFeedback("Boundary selected. Analyze to validate its geometry and area.");
});
$("locate-btn").addEventListener("click", () => {
  const lat = Number($<HTMLInputElement>("latitude").value),
    lon = Number($<HTMLInputElement>("longitude").value);
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    Math.abs(lat) > 85 ||
    Math.abs(lon) > 180
  ) {
    setFeedback("Enter a valid latitude and longitude.", true);
    return;
  }
  map.setView([lat, lon], 14);
  setFeedback("Map centered on the coordinate.");
});
$<HTMLButtonElement>("apply-geojson").addEventListener("click", () => {
  try {
    const parsed = JSON.parse($<HTMLTextAreaElement>("geojson-input").value);
    const geometry = parsed.type === "Feature" ? parsed.geometry : parsed;
    if (
      geometry?.type !== "Polygon" ||
      !Array.isArray(geometry.coordinates) ||
      geometry.coordinates.length !== 1 ||
      !Array.isArray(geometry.coordinates[0]) ||
      geometry.coordinates[0].length < 4 ||
      geometry.coordinates[0].length > 2001 ||
      geometry.coordinates[0].some(
        (point: unknown) =>
          !Array.isArray(point) ||
          point.length !== 2 ||
          point.some(
            (value: unknown) =>
              typeof value !== "number" || !Number.isFinite(value),
          ),
      ) ||
      JSON.stringify(geometry.coordinates[0][0]) !==
        JSON.stringify(geometry.coordinates[0].at(-1))
    ) {
      throw new Error("Paste one Polygon without holes.");
    }
    aoi = { type: "Feature", properties: {}, geometry };
    boundary.remove();
    boundary = L.geoJSON(aoi, {
      style: {
        color: "#c76a3d",
        weight: 2,
        fillColor: "#dcaa63",
        fillOpacity: 0.2,
      },
    }).addTo(map);
    map.fitBounds(boundary.getBounds(), { padding: [40, 40] });
    updateAreaLabel("Selected field");
    $("area-chip").textContent = "Boundary selected";
    setFeedback(
      "Boundary selected. Analyze to validate its geometry and area.",
    );
  } catch (error) {
    setFeedback(
      error instanceof Error ? error.message : "Invalid GeoJSON.",
      true,
    );
  }
});
$("source-mode").addEventListener("change", () => {
  const mode = ($("source-mode") as HTMLSelectElement).value;
  $("import-row").toggleAttribute("hidden", mode !== "import");
  $<HTMLInputElement>("start-date").disabled = mode === "import";
  $<HTMLInputElement>("end-date").disabled = mode === "import";
  $("source-note").textContent =
    mode === "live"
      ? "Searches Planetary Computer scenes. Analyze one scene or select up to five dates for bounded, cloud-masked Sentinel-2 pixel comparisons."
      : mode === "import"
        ? "Imported values are labeled user supplied and are not independently verified."
        : "Synthetic reflectance fixture for the sample Iowa field only; no satellite observations.";
  $("analyze-btn").innerHTML =
    mode === "import"
      ? "Analyze imported GeoTIFF <span>→</span>"
      : mode === "live"
        ? "Search live imagery <span>→</span>"
        : "Analyze field <span>→</span>";
});

async function requestResult() {
  const { start, end } = dates();
  if (!start || !end || end < start) {
    setFeedback("Choose a valid date range.", true);
    return;
  }
  const mode = ($("source-mode") as HTMLSelectElement).value;
  const button = $("analyze-btn") as HTMLButtonElement;
  button.disabled = true;
  setFeedback("Checking boundary and requesting data…");
  try {
    let response: Response;
    if (mode === "import") {
      const file = ($("raster-file") as HTMLInputElement).files?.[0];
      if (!file) throw new Error("Choose a GeoTIFF to import.");
      const form = new FormData();
      form.set("aoi", JSON.stringify(geo().geometry));
      form.set("file", file);
      response = await fetch("/api/analysis/import", {
        method: "POST",
        body: form,
      });
    } else {
      const body = JSON.stringify({ aoi: geo().geometry, start, end });
      response = await fetch(
        mode === "live" ? "/api/catalog/search" : "/api/analysis/demo",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
        },
      );
    }
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || "Request failed.");
    if (mode === "live") {
      showScenes(data.items || [], data.cached);
      return;
    }
    latest = data;
    render(data);
  } catch (error) {
    setFeedback(
      error instanceof Error
        ? error.message
        : "Request failed. Check the API and try again.",
      true,
    );
  } finally {
    button.disabled = false;
  }
}
$("analyze-btn").addEventListener("click", requestResult);

function showScenes(scenes: Scene[], cached: boolean) {
  latest = undefined;
  $("results").removeAttribute("hidden");
  $("result-title").textContent =
    `${scenes.length} live scene${scenes.length === 1 ? "" : "s"} found`;
  $("data-badge").textContent =
    `LIVE CATALOG · ${cached ? "cached 5 min" : "fresh metadata"} · not analyzed`;
  $("data-badge").className = "data-badge live";
  $("chart").innerHTML =
    '<div class="empty-state">Choose a scene below to analyze actual Sentinel-2 pixels over the selected field.</div>';
  const sceneCloud = scenes
    .map((scene) => scene.cloud_percent)
    .filter((value): value is number => value !== null);
  $("cloud-label").textContent = "MEAN SCENE CLOUD";
  $("cloud-value").textContent = sceneCloud.length
    ? `${(sceneCloud.reduce((a, b) => a + b, 0) / sceneCloud.length).toFixed(1)}%`
    : "not provided";
  $("pixel-value").textContent = "—";
  $("area-value").textContent = "—";
  $("scene-list").replaceChildren();
  const batch = document.createElement("button");
  batch.type = "button";
  batch.className = "button secondary";
  batch.textContent = "Analyze selected scenes (max 5)";
  batch.addEventListener("click", async () => {
    const selected = [
      ...$("scene-list").querySelectorAll<HTMLInputElement>(
        "input[data-scene-id]:checked",
      ),
    ];
    if (!selected.length || selected.length > 5) {
      setFeedback(
        "Select between 1 and 5 scenes for a comparable multi-date analysis.",
        true,
      );
      return;
    }
    batch.disabled = true;
    const observations: Observation[] = [];
    const errors: string[] = [];
    let areaHa: number | undefined;
    for (const input of selected) {
      try {
        const response = await fetch("/api/analysis/live", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            aoi: geo().geometry,
            item_id: input.dataset.sceneId,
          }),
        });
        const result = await response.json();
        if (!response.ok)
          throw new Error(result.detail || "Scene processing failed");
        areaHa ??= result.area_ha;
        observations.push(...(result.observations || []));
      } catch (error) {
        errors.push(
          input.dataset.sceneId +
            ": " +
            (error instanceof Error ? error.message : "processing failed"),
        );
      }
    }
    batch.disabled = false;
    if (!observations.length) {
      setFeedback(
        errors.join("; ") || "No scenes produced observations.",
        true,
      );
      return;
    }
    observations.sort((a, b) => a.date.localeCompare(b.date));
    const result: Result = {
      source: "live-sentinel-pixels",
      source_label:
        "LIVE SENTINEL-2 MULTI-SCENE ANALYSIS · " +
        observations.length +
        " observations" +
        (errors.length ? " · " + errors.length + " failed" : ""),
      area_ha: areaHa,
      observations,
      provenance: {
        provider: "Microsoft Planetary Computer / Copernicus Sentinel-2 L2A",
        scenes: observations.map(
          ({ scene_id, acquired, scene_cloud_percent }) => ({
            scene_id,
            acquired,
            scene_cloud_percent,
          }),
        ),
        failures: errors,
        note: "Dates are processed independently; failures are omitted and no values are interpolated.",
      },
    };
    latest = result;
    render(result);
    if (errors.length)
      setFeedback(
        "Processed " +
          observations.length +
          " scenes; " +
          errors.length +
          " failed: " +
          errors.join("; "),
        true,
      );
  });
  $("scene-list").append(batch);
  footprintLayer?.remove();
  const features: GeoJSON.Feature[] = [];
  for (const scene of scenes) {
    if (scene.footprint)
      features.push({
        type: "Feature",
        properties: {},
        geometry: scene.footprint,
      });
    const row = document.createElement("div");
    row.className = "scene-row";
    const title = document.createElement("strong");
    title.textContent = scene.datetime
      ? new Date(scene.datetime).toLocaleDateString()
      : scene.id;
    const meta = document.createElement("span");
    meta.textContent = `${scene.platform || "Sentinel‑2"} · cloud ${scene.cloud_percent ?? "n/a"}% · ${scene.gsd_m ?? 10} m`;
    const actions = document.createElement("div");
    actions.className = "scene-actions";
    const source = document.createElement("a");
    const select = document.createElement("input");
    select.type = "checkbox";
    select.dataset.sceneId = scene.id;
    select.setAttribute(
      "aria-label",
      "Select scene " + scene.id + " for multi-date analysis",
    );
    source.href = scene.source_url;
    source.target = "_blank";
    source.rel = "noreferrer";
    source.textContent = "STAC record ↗";
    source.className = "source-link";
    const previewButton = document.createElement("button");
    previewButton.type = "button";
    previewButton.className = "preview-control";
    previewButton.textContent = "Load true-color preview";
    const analyzeButton = document.createElement("button");
    analyzeButton.type = "button";
    analyzeButton.className = "preview-control analyze-control";
    analyzeButton.textContent = "Analyze NDVI pixels";
    analyzeButton.setAttribute(
      "aria-label",
      `Analyze NDVI pixels from Sentinel-2 scene ${scene.id}`,
    );
    analyzeButton.addEventListener("click", async () => {
      analyzeButton.disabled = true;
      analyzeButton.textContent = "Processing bounded pixel window…";
      setFeedback(
        "Signing the public scene assets and processing the selected field window.",
      );
      try {
        const response = await fetch("/api/analysis/live", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ aoi: geo().geometry, item_id: scene.id }),
        });
        const data = await response.json();
        if (!response.ok)
          throw new Error(data.detail || "Sentinel-2 pixel analysis failed.");
        latest = data;
        render(data);
      } catch (error) {
        setFeedback(
          error instanceof Error
            ? error.message
            : "Sentinel-2 pixel analysis failed.",
          true,
        );
        analyzeButton.disabled = false;
        analyzeButton.textContent = "Retry pixel analysis";
      }
    });
    previewButton.addEventListener("click", () => {
      $("scene-list")
        .querySelectorAll(".scene-preview")
        .forEach((image) => image.remove());
      $("scene-list")
        .querySelectorAll(".preview-control")
        .forEach((button) => {
          button.textContent = "Load true-color preview";
        });
      const preview = document.createElement("img");
      preview.src = scene.preview_url;
      preview.alt = `True-color Sentinel-2 preview for ${scene.datetime}`;
      preview.className = "scene-preview";
      preview.onerror = () => {
        preview.alt = "Preview unavailable from the imagery provider.";
        preview.hidden = true;
      };
      previewButton.textContent = "Preview loading…";
      row.append(preview);
      preview.onload = () => {
        previewButton.textContent = "Preview loaded · up to 512 px";
      };
    });
    actions.append(select, source, previewButton, analyzeButton);
    row.append(title, meta, actions);
    $("scene-list").append(row);
  }
  if (features.length)
    footprintLayer = L.geoJSON(features, {
      style: {
        color: "#547f71",
        weight: 1,
        fillOpacity: 0.05,
        dashArray: "4 4",
      },
    }).addTo(map);
  $("provenance").replaceChildren();
  addProvenance({
    source: "Microsoft Planetary Computer STAC",
    collection: "sentinel-2-l2a",
    asset_bands: "B04 red, B08 NIR (10 m); B11 SWIR and SCL (20 m)",
    catalog_url:
      "https://planetarycomputer.microsoft.com/api/stac/v1/collections/sentinel-2-l2a",
    attribution:
      "ESA/Copernicus Sentinel‑2; hosted and processed by Microsoft Planetary Computer / Esri",
  });
  setFeedback(
    scenes.length
      ? "Live metadata loaded. Select a scene for its public source record."
      : "No live scenes found for this boundary and date range.",
  );
}

function render(data: Result) {
  footprintLayer?.remove();
  footprintLayer = undefined;
  const obs = data.observations || [];
  $("ndmi-legend").toggleAttribute(
    "hidden",
    data.source === "live-sentinel-pixels" ||
      !obs.some((item) => item.ndmi !== null),
  );
  $("results").removeAttribute("hidden");
  $("result-title").textContent =
    data.source === "live-sentinel-pixels"
      ? "Sentinel-2 pixel analysis"
      : "Seasonal profile";
  $("data-badge").textContent =
    data.source_label || "USER IMPORT · source values supplied by user";
  $("data-badge").className =
    `data-badge ${data.source === "synthetic-demo" ? "demo" : data.source === "live-sentinel-pixels" ? "live" : "imported"}`;
  $("area-value").textContent =
    data.area_ha == null ? "—" : `${data.area_ha.toFixed(1)} ha`;
  $("cloud-label").textContent =
    data.source === "synthetic-demo"
      ? "MEAN AOI CLOUD"
      : data.source === "live-sentinel-pixels"
        ? "SCENE CLOUD"
        : "CLOUD DATA";
  const clouds = obs
    .map((o) => o.cloud_percent)
    .filter((x): x is number => x !== null);
  $("cloud-value").textContent = clouds.length
    ? `${(clouds.reduce((a, b) => a + b, 0) / clouds.length).toFixed(1)}%`
    : "not provided";
  $("pixel-value").textContent = obs.length
    ? (obs.at(-1)?.pixel_count ?? 0).toLocaleString()
    : "—";
  $("chart-range").textContent =
    `${obs.length} observation${obs.length === 1 ? "" : "s"}`;
  drawChart(obs);
  $("scene-list").replaceChildren();
  if (obs.length) {
    const latestObs = obs.at(-1)!;
    const row = document.createElement("div");
    row.className = "scene-row";
    const title = document.createElement("strong");
    title.textContent = `${latestObs.date} · ${latestObs.resolution_m ?? "unknown"} m`;
    const meta = document.createElement("span");
    meta.textContent =
      data.source === "live-sentinel-pixels"
        ? `NDVI ${latestObs.ndvi?.toFixed(3)} · p10 ${latestObs.ndvi_percentiles?.p10.toFixed(3)} / p50 ${latestObs.ndvi_percentiles?.p50.toFixed(3)} / p90 ${latestObs.ndvi_percentiles?.p90.toFixed(3)} · ${latestObs.pixel_count.toLocaleString()} valid of ${(latestObs.pixel_count + (latestObs.masked_pixel_count || 0)).toLocaleString()} AOI pixels · ${latestObs.mask}`
        : `Cloud ${latestObs.cloud_percent ?? "n/a"}% · nodata ${latestObs.nodata_percent ?? "not reported"}% · ${latestObs.mask}`;
    row.append(title, meta);
    $("scene-list").append(row);
  }
  $("provenance").replaceChildren();
  addProvenance(data.provenance || {});
  setFeedback(
    `${obs.length} observation${obs.length === 1 ? "" : "s"} ready · ${data.area_ha?.toFixed(1) ?? "—"} ha boundary validated.`,
  );
}

function addProvenance(values: Record<string, unknown>) {
  for (const [key, value] of Object.entries(values)) {
    const dt = document.createElement("dt");
    dt.textContent = key.replaceAll("_", " ");
    const dd = document.createElement("dd");
    dd.textContent = String(value);
    $("provenance").append(dt, dd);
  }
}

function drawChart(observations: Observation[]) {
  if (!observations.length) {
    $("chart").innerHTML =
      '<div class="empty-state">No scenes matched. Try another date range or use the demo fixture.</div>';
    return;
  }
  const W = 520,
    H = 150,
    pad = 24;
  const x = (i: number) =>
    pad + (i * (W - 2 * pad)) / Math.max(observations.length - 1, 1);
  const y = (v: number | null) =>
    H - pad - Math.max(0, Math.min(1, v ?? 0)) * (H - 2 * pad);
  const path = (key: "ndvi" | "ndmi") =>
    observations
      .map((o, i) => `${i ? "L" : "M"}${x(i)},${y(o[key])}`)
      .join(" ");
  const safe = (value: string) =>
    value.replace(
      /[&<>"']/g,
      (char) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[char]!,
    );
  const hasNdmi = observations.some((o) => o.ndmi !== null);
  const nodes = observations
    .map(
      (o, i) =>
        `<circle cx="${x(i)}" cy="${y(o.ndvi)}" r="3.5" fill="#c76a3d"><title>${safe(o.date)} NDVI ${o.ndvi?.toFixed(3)}</title></circle>${o.ndmi === null ? "" : `<circle cx="${x(i)}" cy="${y(o.ndmi)}" r="3" fill="#4f8874"><title>${safe(o.date)} NDMI ${o.ndmi?.toFixed(3)}</title></circle>`}`,
    )
    .join("");
  $("chart").innerHTML =
    `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${hasNdmi ? "NDVI and NDMI" : "NDVI"} from ${safe(observations[0].date)} to ${safe(observations.at(-1)?.date || "")}"><path class="gridline" d="M${pad} ${y(1)}H${W - pad} M${pad} ${y(0.5)}H${W - pad} M${pad} ${y(0)}H${W - pad}"/><path class="line-ndvi" d="${path("ndvi")}"/>${hasNdmi ? `<path class="line-ndmi" d="${path("ndmi")}"/>` : ""}${nodes}<text x="${pad}" y="${H - 3}">${safe(observations[0].date.slice(5))}</text><text x="${W - pad - 36}" y="${H - 3}">${safe(observations.at(-1)?.date.slice(5) || "")}</text></svg>`;
}

$("export-btn").addEventListener("click", () => {
  if (!latest?.observations?.length) {
    setFeedback("Live catalog metadata is not exported as field statistics.");
    return;
  }
  const rows = latest.observations.map((o) => [
    o.date,
    o.scene_id ?? "",
    o.acquired ?? "",
    o.scene_cloud_percent ?? "",
    o.ndvi,
    o.ndmi,
    o.cloud_percent,
    o.nodata_percent ?? "",
    o.pixel_count,
    o.resolution_m ?? "",
    latest?.area_ha ?? "",
    latest?.source,
    JSON.stringify(latest?.provenance ?? {}),
    JSON.stringify(aoi.geometry),
  ]);
  const csv = [
    [
      "date",
      "scene_id",
      "acquired",
      "scene_cloud_percent",
      "ndvi",
      "ndmi",
      "cloud_percent",
      "nodata_percent",
      "valid_pixels",
      "resolution_m",
      "area_ha",
      "source",
      "provenance_json",
      "aoi_geojson",
    ],
    ...rows,
  ]
    .map((row) =>
      row
        .map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`)
        .join(","),
    )
    .join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "geocrop-field-observations.csv";
  link.click();
  URL.revokeObjectURL(url);
});

map.fitBounds(boundary.getBounds(), { padding: [40, 40] });
setTimeout(() => ($("area-chip").textContent = "Sample boundary · demo"), 0);
