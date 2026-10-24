# GeoCrop: product design brief

## Audit and direction

1. **Difference:** A field-boundary notebook reports the actual valid Sentinel-2 pixels behind each dated vegetation observation.
2. **User:** A student, researcher, or grower investigating image coverage and temporal differences rather than asking for an automated diagnosis.
3. **Concept:** An editorial satellite field notebook: imagery dominates the canvas, with a compact scientific ledger for measurements and provenance. Earth and vegetation colors refer to the source imagery.
4. **Primary action:** Select a boundary, choose bundled/synthetic/live/imported data, analyze, inspect a date, and export the observation ledger.
5. **Technical proof:** Pixel masks, percentiles, cloud and no-data counts, acquisition dates, scene IDs, and processing grid metadata remain inspectable alongside results.
6. **Visualization:** Spatial NDVI overlay tied to the selected field; a single-scene percentile range or multi-date time series with selected point and honest gaps for missing indices.
7. **Remove:** Any suggestion that basemap imagery supplies index values or that missing reflectance equals zero. The basemap is visual context only.
8. **Complete it:** Make plotted observations selectable by pointer and ensure unavailable values create gaps instead of false zero measurements. The dated button list remains the keyboard path.

## Implementation map

`src/main.ts` owns the Leaflet workspace, source choice, analysis requests, ledger, chart, and CSV. `geocrop/api.py` exposes bundled example, synthetic, live STAC, and import routes. `geocrop/geo.py`, `example.py`, and `live.py` validate boundaries and process raster grids. Vite, Leaflet, FastAPI, rasterio, and pyproj are existing dependencies. The interface is one spatial workspace; source controls are part of analysis, not fake navigation.

Bundled Sentinel pixels are real but historical and limited to the outlined Iowa study area. Synthetic time series are labeled. Live STAC and tile providers are external and can fail. The current browser baseline is ten flows plus eight Python tests; JavaScript was 52,737 gzip bytes before this pass. The raster/API work, rather than chart rendering, is the likely cost center; no client optimization is justified without timing data.

## Feature and route inventory

- **Screen:** One Leaflet field workspace with boundary tools, coordinates, source selector, vegetation results, observation ledger, provenance, and export. No decorative navigation routes or shared UI package.
- **API:** `GET /api/health`; `POST /api/catalog/search`, `/api/analysis/live`, `/api/analysis/demo`, `/api/analysis/example`, and `/api/analysis/import`. These routes have distinct source and validation paths.
- **Working controls:** Boundary drawing/paste, date range, scene selection, source choice, import, analysis, date ledger, and CSV. Results and overlays depend on the chosen source; live failure does not silently substitute synthetic data.
- **Presentation only:** Esri/OSM basemap imagery and notebook brand art. Tile images provide orientation and are not used for NDVI/NDMI arithmetic.
- **Constraint:** Live COG reads and provider requests can be slow or unavailable; server caps bound pixels and date/scene counts. No measured client-render bottleneck was found.

## Priorities and acceptance

- **P1 completed:** A plot point and its dated button select the same scene. A null NDVI/NDMI does not render a point or a line segment to zero; a browser fixture verifies this.
- **P2:** Preserve provenance, masked-pixel counts, geometry limits, loading/error states, CSV, and phone layout.
- **Out of scope:** Yield prediction, crop stress diagnosis, and interpolated phenology would need labeled validation data and a separate model.
