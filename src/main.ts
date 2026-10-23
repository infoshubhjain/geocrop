import L from "leaflet";
import "leaflet/dist/leaflet.css";
import example from "../geocrop/data/example_scene.json";
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
  <header class="topbar"><a class="brand" href="#"><span class="brand-mark" aria-hidden="true"><span></span></span><span>GeoCrop<small>SATELLITE FIELD NOTEBOOK</small></span></a><div class="top-meta"><span class="live-dot"></span> Decision support · Preview</div></header>
  <main class="layout">
    <section class="map-column" aria-label="Field map">
      <div class="map-toolbar"><div class="map-label"><span class="eyebrow">WORKSPACE / IOWA STUDY AREA</span><strong id="field-name">Sample field · Iowa</strong></div><div class="map-actions"><button id="reset-btn" class="button secondary">Reset sample</button><button id="draw-btn" class="button secondary">＋ Select area</button><button id="finish-btn" class="button primary" disabled>Finish boundary</button></div></div>
      <div class="map-stage"><div id="map" role="application" aria-label="Interactive field map. Activate Select area, then click at least three map points inside the outlined example coverage."></div><div id="example-legend" class="map-legend"><strong>NDVI · 9 Jun 2024</strong><span>Bundled Sentinel‑2 scene</span><div class="legend-ramp"></div><div class="legend-scale"><span>−0.2</span><span>0.2</span><span>0.5</span><span>0.8</span></div><small>Outline = selectable example coverage</small></div></div>
      <div class="map-footer"><span id="map-method-note">NDVI overlay and results use the same dated Sentinel‑2 pixels. Mixed edge pixels remain possible.</span><span id="area-chip">Sample area</span></div>
      <section class="below-map"><div class="section-title"><div><span class="eyebrow">LOCATION</span><h2>Find a field</h2></div><span class="muted">Coordinates · WGS84</span></div><div class="coordinate-row"><label>Latitude<input id="latitude" inputmode="decimal" value="41.6995" aria-label="Latitude"></label><label>Longitude<input id="longitude" inputmode="decimal" value="-93.4995" aria-label="Longitude"></label><button id="locate-btn" class="button secondary">Go to point</button></div><p class="muted small">Or draw a polygon on the map. Cross-antimeridian boundaries are not supported.</p></section>
      <details class="geojson-entry"><summary>Paste a boundary GeoJSON</summary><label for="geojson-input" class="muted small">Polygon geometry or Feature · WGS84</label><textarea id="geojson-input" rows="3" placeholder='{"type":"Polygon","coordinates":[[[-93.5,41.7],…]]}'></textarea><button id="apply-geojson" class="button secondary">Use this boundary</button></details>
    </section>
    <aside class="panel" aria-label="Analysis controls and results">
      <div class="panel-heading"><div><span class="eyebrow">CROP CONDITION</span><h1>Field image lab</h1></div><span class="status-pill">BETA</span></div>
      <p class="intro">Draw a boundary, inspect the pixels, and compare observations by date. Reflectance indicators do not diagnose crop health or predict yield.</p>
      <div class="control-card"><label class="field-label" for="source-mode">DATA SOURCE</label><select id="source-mode"><option value="example">Example scene · real Sentinel‑2 pixels</option><option value="demo">Synthetic time series · illustrative</option><option value="live">Live catalog · Sentinel‑2 L2A</option><option value="import">Import GeoTIFF</option></select><div id="source-note" class="helper">Draw any area inside the outlined study area. The NDVI overlay and analysis use one bundled scene acquired 9 June 2024.</div>
        <div id="import-row" hidden><label class="field-label" for="raster-file">3-band reflectance GeoTIFF</label><input id="raster-file" type="file" accept=".tif,.tiff,image/tiff"><div class="helper">One scene; date range is not used. Band 1 red, 2 NIR, 3 SWIR; unit reflectance 0–1. Up to 20 MB.</div></div>
        <div id="date-grid" class="date-grid" hidden><label>FROM<input type="date" id="start-date" value="2024-04-01" disabled></label><label>TO<input type="date" id="end-date" value="2024-09-30" disabled></label></div>
        <button id="analyze-btn" class="button primary analyze">Analyze selected area <span>→</span></button>
      </div>
      <div id="feedback" class="feedback" role="status" aria-live="polite">Draw inside the outlined area or analyze the sample boundary.</div>
      <div id="results" hidden>
        <div class="result-head"><div><span class="eyebrow">VEGETATION INDICATORS</span><h2 id="result-title">Seasonal profile</h2></div><button id="export-btn" class="icon-button" title="Export CSV" aria-label="Export CSV">↧</button></div>
        <div id="data-badge" class="data-badge"></div>
        <div class="ndvi-feature"><div><span id="ndvi-feature-label" class="eyebrow">SELECTED AREA · MEAN NDVI</span><small>Reflectance index, not crop health</small></div><strong id="mean-ndvi">—</strong></div>
        <div class="chart-legend"><span><i class="swatch ndvi"></i>NDVI</span><span id="ndmi-legend"><i class="swatch ndmi"></i>NDMI</span><span id="chart-range" class="muted"></span></div>
        <div id="chart" class="chart" role="img" aria-label="NDVI and NDMI time series"></div>
        <div id="observation-list" class="observation-list" aria-label="Inspect dated observations"></div>
        <div id="scene-list" class="scene-list"></div>
        <div class="quality-grid"><div><span id="cloud-label" class="eyebrow">AOI CLOUD</span><strong id="cloud-value">—</strong></div><div><span class="eyebrow">VALID PIXELS</span><strong id="pixel-value">—</strong></div><div><span class="eyebrow">SELECTED AREA</span><strong id="area-value">—</strong></div></div>
        <details class="provenance"><summary>Methods & provenance</summary><dl id="provenance"></dl></details>
      </div>
      <div class="limits"><span>ⓘ</span><p>Vegetation indices can vary with clouds, soil, crop type, phenology, mixed pixels, and sensor processing. They do not diagnose disease, irrigation need, or yield.</p></div>
      <footer>Live Sentinel‑2 results credit each acquisition year · Hosted by Microsoft Planetary Computer · <a href="https://sentinels.copernicus.eu/documents/247904/690755/Sentinel_Data_Legal_Notice" target="_blank" rel="noreferrer">Sentinel data notice</a> · <a href="https://planetarycomputer.microsoft.com/terms" target="_blank" rel="noreferrer">Service terms</a><p>Esri imagery is visual context only; field indices are calculated from Sentinel‑2 pixels or your imported raster. Imagery coverage dates vary.</p></footer>
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
const satellite = L.tileLayer(
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  {
    maxZoom: 19,
    attribution:
      'Imagery &copy; <a href="https://www.esri.com/">Esri</a>, Maxar, Earthstar Geographics, and the GIS User Community',
  },
);
const streets = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
});
satellite.addTo(map);
const exampleBounds = L.latLngBounds(
  example.bounds as [[number, number], [number, number]],
);
const exampleOverlay = L.imageOverlay("/example-ndvi.png", exampleBounds, {
  opacity: 0.74,
  alt: "Color-coded NDVI pixels from the bundled Sentinel-2 example scene",
  attribution: example.attribution,
}).addTo(map);
const exampleCoverage = L.rectangle(exampleBounds, {
  color: "#f7f3d6",
  weight: 2,
  dashArray: "7 5",
  fill: false,
  interactive: false,
}).addTo(map);
const layersControl = L.control
  .layers(
    { "Satellite imagery": satellite, "Street map": streets },
    { "Example NDVI · 9 Jun 2024": exampleOverlay },
    { position: "topright", collapsed: true },
  )
  .addTo(map);
let exampleOverlayInControl = true;
map.on("overlayremove", (event: L.LayersControlEvent) => {
  if (event.layer === exampleOverlay)
    $("example-legend").setAttribute("hidden", "");
});
map.on("overlayadd", (event: L.LayersControlEvent) => {
  if (
    event.layer === exampleOverlay &&
    ($("source-mode") as HTMLSelectElement).value === "example"
  )
    $("example-legend").removeAttribute("hidden");
});
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
let draftLayers: L.Layer[] = [];
let latest: Result | undefined;
let latestAoi: GeoJSON.Polygon | undefined;
let inputVersion = 0;

const updateAreaLabel = (name: string) => {
  $("field-name").textContent = name;
};
const dates = () => ({
  start: $<HTMLInputElement>("start-date").value,
  end: $<HTMLInputElement>("end-date").value,
});
const setFeedback = (message: string, error = false) => {
  const el = $("feedback");
  el.textContent = message;
  el.classList.toggle("error", error);
};
const clearResults = () => {
  inputVersion++;
  latest = undefined;
  latestAoi = undefined;
  $("results").setAttribute("hidden", "");
  footprintLayer?.remove();
  footprintLayer = undefined;
};

$("draw-btn").addEventListener("click", () => {
  clearResults();
  drawing = true;
  vertices = [];
  draftLayers.forEach((layer) => layer.remove());
  draftLayers = [];
  boundary.remove();
  $("finish-btn").removeAttribute("disabled");
  setFeedback(
    "Click three or more points inside the outlined study area, then finish the boundary.",
  );
});
map.on("click", (event: L.LeafletMouseEvent) => {
  if (!drawing) return;
  vertices.push(event.latlng);
  draftLayers.push(
    L.circleMarker(event.latlng, { radius: 4, color: "#c76a3d" }).addTo(map),
  );
  if (vertices.length > 1)
    draftLayers.push(
      L.polyline(vertices, { color: "#c76a3d", dashArray: "5 5" }).addTo(map),
    );
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
  draftLayers.forEach((layer) => layer.remove());
  draftLayers = [];
  boundary = L.geoJSON(aoi, {
    style: {
      color: "#c76a3d",
      weight: 2,
      fillColor: "#dcaa63",
      fillOpacity: 0.2,
    },
  }).addTo(map);
  updateAreaLabel("Selected area");
  $("area-chip").textContent = "Boundary selected";
  $("finish-btn").setAttribute("disabled", "");
  setFeedback("Boundary selected. Analyze to validate its geometry and area.");
});
$("reset-btn").addEventListener("click", () => {
  clearResults();
  drawing = false;
  vertices = [];
  draftLayers.forEach((layer) => layer.remove());
  draftLayers = [];
  $("finish-btn").setAttribute("disabled", "");
  aoi = structuredClone(sample);
  boundary.remove();
  boundary = L.geoJSON(aoi, {
    style: {
      color: "#c76a3d",
      weight: 2,
      fillColor: "#dcaa63",
      fillOpacity: 0.2,
    },
  }).addTo(map);
  map.fitBounds(exampleBounds, { padding: [35, 35] });
  updateAreaLabel("Sample field · Iowa");
  $("area-chip").textContent = "Sample boundary · 2024 scene";
  setFeedback(
    "Sample boundary restored. Draw inside the outline or analyze this area.",
  );
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
    clearResults();
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
  clearResults();
  const mode = ($("source-mode") as HTMLSelectElement).value;
  $("import-row").toggleAttribute("hidden", mode !== "import");
  $("date-grid").toggleAttribute(
    "hidden",
    mode === "import" || mode === "example",
  );
  $<HTMLInputElement>("start-date").disabled =
    mode === "import" || mode === "example";
  $<HTMLInputElement>("end-date").disabled =
    mode === "import" || mode === "example";
  $("example-legend").toggleAttribute("hidden", mode !== "example");
  if (mode === "example") {
    if (!exampleOverlayInControl) {
      layersControl.addOverlay(exampleOverlay, "Example NDVI · 9 Jun 2024");
      exampleOverlayInControl = true;
    }
    exampleOverlay.addTo(map);
    exampleCoverage.addTo(map);
  } else {
    exampleOverlay.remove();
    exampleCoverage.remove();
    if (exampleOverlayInControl) {
      layersControl.removeLayer(exampleOverlay);
      exampleOverlayInControl = false;
    }
  }
  $("map-method-note").textContent =
    mode === "example"
      ? "NDVI overlay and results use the same dated Sentinel‑2 pixels. Mixed edge pixels remain possible."
      : mode === "demo"
        ? "Synthetic reflectance values are illustrative; the basemap is visual context only."
        : mode === "live"
          ? "Live Sentinel‑2 statistics use the selected scene and boundary; basemap imagery dates may differ."
          : "Imported raster values come from your file; the basemap is visual context only.";
  $("source-note").textContent =
    mode === "example"
      ? "Draw any area inside the outlined study area. The NDVI overlay and analysis use one bundled scene acquired 9 June 2024."
      : mode === "live"
        ? "Searches Planetary Computer scenes. Analyze one scene or select up to five dates for bounded, cloud-masked Sentinel-2 pixel comparisons."
        : mode === "import"
          ? "Imported values are labeled user supplied and are not independently verified."
          : "Synthetic reflectance fixture for the sample Iowa field only; no satellite observations.";
  $("analyze-btn").innerHTML =
    mode === "import"
      ? "Analyze imported GeoTIFF <span>→</span>"
      : mode === "live"
        ? "Search live imagery <span>→</span>"
        : mode === "example"
          ? "Analyze selected area <span>→</span>"
          : "Analyze field <span>→</span>";
});
$<HTMLInputElement>("start-date").addEventListener("change", clearResults);
$<HTMLInputElement>("end-date").addEventListener("change", clearResults);
$<HTMLInputElement>("raster-file").addEventListener("change", clearResults);

async function requestResult() {
  const mode = ($("source-mode") as HTMLSelectElement).value;
  const { start, end } = dates();
  if (
    mode !== "import" &&
    mode !== "example" &&
    (!start || !end || end < start)
  ) {
    setFeedback("Choose a valid date range.", true);
    return;
  }
  const version = inputVersion;
  const resultAoi = structuredClone(aoi.geometry);
  const button = $("analyze-btn") as HTMLButtonElement;
  button.disabled = true;
  setFeedback("Checking boundary and requesting data…");
  try {
    let response: Response;
    if (mode === "import") {
      const file = ($("raster-file") as HTMLInputElement).files?.[0];
      if (!file) throw new Error("Choose a GeoTIFF to import.");
      const form = new FormData();
      form.set("aoi", JSON.stringify(resultAoi));
      form.set("file", file);
      response = await fetch("/api/analysis/import", {
        method: "POST",
        body: form,
      });
    } else {
      const body = JSON.stringify(
        mode === "example"
          ? { aoi: resultAoi }
          : { aoi: resultAoi, start, end },
      );
      response = await fetch(
        mode === "live"
          ? "/api/catalog/search"
          : mode === "example"
            ? "/api/analysis/example"
            : "/api/analysis/demo",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
        },
      );
    }
    const data = await response.json();
    if (version !== inputVersion) return;
    if (!response.ok) throw new Error(data.detail || "Request failed.");
    if (mode === "live") {
      showScenes(data.items || [], data.cached);
      return;
    }
    latest = data;
    latestAoi = resultAoi;
    render(data);
  } catch (error) {
    if (version !== inputVersion) return;
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
  latestAoi = undefined;
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
    const version = inputVersion;
    const resultAoi = structuredClone(aoi.geometry);
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
            aoi: resultAoi,
            item_id: input.dataset.sceneId,
          }),
        });
        const result = await response.json();
        if (version !== inputVersion) return;
        if (!response.ok)
          throw new Error(result.detail || "Scene processing failed");
        areaHa ??= result.area_ha;
        observations.push(...(result.observations || []));
      } catch (error) {
        if (version !== inputVersion) return;
        errors.push(
          input.dataset.sceneId +
            ": " +
            (error instanceof Error ? error.message : "processing failed"),
        );
      }
    }
    if (version !== inputVersion) return;
    batch.disabled = false;
    if (!observations.length) {
      setFeedback(
        errors.join("; ") || "No scenes produced observations.",
        true,
      );
      return;
    }
    observations.sort((a, b) => a.date.localeCompare(b.date));
    const attribution = [
      ...new Set(observations.map((o) => o.acquired?.slice(0, 4))),
    ]
      .filter((year): year is string => !!year && /^\d{4}$/.test(year))
      .map((year) => `Contains modified Copernicus Sentinel data ${year}`)
      .join(" · ");
    const result: Result = {
      source: "live-sentinel-pixels",
      source_label:
        "LIVE SENTINEL-2 MULTI-SCENE ANALYSIS · " +
        observations.length +
        " observations" +
        (errors.length ? " · " + errors.length + " failed" : "") +
        (attribution ? " · " + attribution : ""),
      area_ha: areaHa,
      observations,
      provenance: {
        provider: "Microsoft Planetary Computer / Copernicus Sentinel-2 L2A",
        attribution,
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
    latestAoi = resultAoi;
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
      const version = inputVersion;
      const resultAoi = structuredClone(aoi.geometry);
      analyzeButton.disabled = true;
      analyzeButton.textContent = "Processing bounded pixel window…";
      setFeedback(
        "Signing the public scene assets and processing the selected field window.",
      );
      try {
        const response = await fetch("/api/analysis/live", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ aoi: resultAoi, item_id: scene.id }),
        });
        const data = await response.json();
        if (version !== inputVersion) return;
        if (!response.ok)
          throw new Error(data.detail || "Sentinel-2 pixel analysis failed.");
        latest = data;
        latestAoi = resultAoi;
        render(data);
      } catch (error) {
        if (version !== inputVersion) return;
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
        .querySelectorAll(".preview-control:not(.analyze-control)")
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
        previewButton.textContent = "Preview unavailable · retry";
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
    data.source === "bundled-sentinel-example"
      ? "Selected area · Sentinel-2"
      : data.source === "live-sentinel-pixels"
        ? "Sentinel-2 pixel analysis"
        : "Seasonal profile";
  $("data-badge").textContent =
    data.source_label || "USER IMPORT · source values supplied by user";
  $("data-badge").className =
    `data-badge ${data.source === "synthetic-demo" ? "demo" : data.source === "live-sentinel-pixels" || data.source === "bundled-sentinel-example" ? "live" : "imported"}`;
  $("ndvi-feature-label").textContent =
    obs.length > 1 ? "LATEST MEAN NDVI" : "SELECTED AREA · MEAN NDVI";
  $("mean-ndvi").textContent = obs.at(-1)?.ndvi?.toFixed(3) ?? "—";
  $("area-value").textContent =
    data.area_ha == null ? "—" : `${data.area_ha.toFixed(1)} ha`;
  $("cloud-label").textContent =
    data.source === "synthetic-demo"
      ? "MEAN AOI CLOUD"
      : data.source === "live-sentinel-pixels" ||
          data.source === "bundled-sentinel-example"
        ? "AOI CLOUD"
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
  const observationList = $("observation-list");
  observationList.replaceChildren();
  const selectObservation = (index: number) => {
    const selected = obs[index];
    if (!selected) return;
    $("mean-ndvi").textContent = selected.ndvi?.toFixed(3) ?? "—";
    $("ndvi-feature-label").textContent = `${selected.date} · MEAN NDVI`;
    $("cloud-value").textContent =
      selected.cloud_percent == null
        ? "not provided"
        : `${selected.cloud_percent.toFixed(1)}%`;
    $("pixel-value").textContent = selected.pixel_count.toLocaleString();
    observationList
      .querySelectorAll("button")
      .forEach((button, buttonIndex) => {
        button.setAttribute("aria-pressed", String(buttonIndex === index));
      });
  };
  for (const [index, observation] of obs.entries()) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "observation-item";
    button.setAttribute(
      "aria-label",
      `Inspect observation ${observation.date}`,
    );
    const date = document.createElement("span");
    date.textContent = observation.date;
    const value = document.createElement("strong");
    value.textContent = `NDVI ${observation.ndvi?.toFixed(3) ?? "—"}`;
    button.append(date, value);
    button.addEventListener("click", () => selectObservation(index));
    observationList.append(button);
  }
  if (obs.length) selectObservation(obs.length - 1);
  $("scene-list").replaceChildren();
  if (obs.length) {
    const latestObs = obs.at(-1)!;
    const row = document.createElement("div");
    row.className = "scene-row";
    const title = document.createElement("strong");
    title.textContent = `${latestObs.date} · ${latestObs.resolution_m ?? "unknown"} m`;
    const meta = document.createElement("span");
    meta.textContent =
      data.source === "live-sentinel-pixels" ||
      data.source === "bundled-sentinel-example"
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
  if (observations.length === 1 && observations[0].ndvi_percentiles) {
    const observation = observations[0];
    const { p10, p50, p90 } = observation.ndvi_percentiles!;
    const position = (value: number) =>
      32 + ((Math.max(-1, Math.min(1, value)) + 1) / 2) * 456;
    $("chart").innerHTML =
      `<svg viewBox="0 0 520 130" role="img" aria-label="NDVI distribution for ${observation.date}: mean ${observation.ndvi?.toFixed(3)}, 10th percentile ${p10.toFixed(3)}, median ${p50.toFixed(3)}, 90th percentile ${p90.toFixed(3)}"><text x="32" y="24">NDVI DISTRIBUTION · VALID PIXELS</text><path class="distribution-track" d="M32 62H488"/><path class="distribution-range" d="M${position(p10)} 62H${position(p90)}"/><circle class="distribution-mean" cx="${position(observation.ndvi ?? 0)}" cy="62" r="7"/><path class="distribution-median" d="M${position(p50)} 48V76"/><text x="32" y="100">−1</text><text x="256" y="100" text-anchor="middle">0</text><text x="488" y="100" text-anchor="end">1</text><text x="32" y="121">p10 ${p10.toFixed(3)} · median ${p50.toFixed(3)} · p90 ${p90.toFixed(3)}</text></svg>`;
    return;
  }
  const W = 520,
    H = 150,
    pad = 24;
  const times = observations.map((observation) => Date.parse(observation.date));
  const first = times[0];
  const last = times.at(-1)!;
  const useDates = times.every(Number.isFinite) && last > first;
  const x = (i: number) =>
    pad +
    (useDates
      ? (times[i] - first) / (last - first)
      : i / Math.max(observations.length - 1, 1)) *
      (W - 2 * pad);
  const hasNdmi = observations.some((o) => o.ndmi !== null);
  const lower = observations.some((o) => (o.ndvi ?? 0) < 0 || (o.ndmi ?? 0) < 0)
    ? -1
    : 0;
  const y = (v: number | null) =>
    H -
    pad -
    ((Math.max(lower, Math.min(1, v ?? 0)) - lower) / (1 - lower)) *
      (H - 2 * pad);
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
  const nodes = observations
    .map(
      (o, i) =>
        `<circle cx="${x(i)}" cy="${y(o.ndvi)}" r="3.5" fill="#c76a3d"><title>${safe(o.date)} NDVI ${o.ndvi?.toFixed(3)}</title></circle>${o.ndmi === null ? "" : `<circle cx="${x(i)}" cy="${y(o.ndmi)}" r="3" fill="#4f8874"><title>${safe(o.date)} NDMI ${o.ndmi?.toFixed(3)}</title></circle>`}`,
    )
    .join("");
  $("chart").innerHTML =
    `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${hasNdmi ? "NDVI and NDMI" : "NDVI"} from ${safe(observations[0].date)} to ${safe(observations.at(-1)?.date || "")}, vertical range ${lower} to 1"><path class="gridline" d="M${pad} ${y(1)}H${W - pad} M${pad} ${y((1 + lower) / 2)}H${W - pad} M${pad} ${y(lower)}H${W - pad}"/><path class="line-ndvi" d="${path("ndvi")}"/>${hasNdmi ? `<path class="line-ndmi" d="${path("ndmi")}"/>` : ""}${nodes}<text x="0" y="${y(1) + 3}">1</text><text x="0" y="${y(lower) + 3}">${lower}</text><text x="${pad}" y="${H - 3}">${safe(observations[0].date.slice(5))}</text><text x="${W - pad - 36}" y="${H - 3}">${safe(observations.at(-1)?.date.slice(5) || "")}</text></svg>`;
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
    JSON.stringify(latestAoi),
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

map.fitBounds(exampleBounds, { padding: [40, 40] });
setTimeout(
  () => ($("area-chip").textContent = "Sample boundary · 2024 scene"),
  0,
);
