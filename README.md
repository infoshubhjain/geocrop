# GeoCrop

GeoCrop is a responsive, map-first demonstrator for exploring vegetation indicators over a field boundary. It is decision support, not agronomic diagnosis or yield prediction.

![GeoCrop sample field analysis](docs/screenshot.png)

## Quick start

Requirements: Python 3.11+, Node.js 20+, and a modern browser. No credentials are needed for the synthetic demo.

```sh
python3 -m venv .venv
source .venv/bin/activate
pip install -e '.[test]'
npm ci
```

In one terminal run `uvicorn geocrop.api:app --reload`; in another run `npm run dev`. Open <http://localhost:5173>. The sample Iowa boundary and date range are ready to analyze. To run the production build locally, use `npm run build` then `uvicorn geocrop.api:app`; FastAPI serves `dist/` when it exists.

## What works

- Draw a polygon or use latitude/longitude to navigate. Boundaries use WGS84 / EPSG:4326, one valid polygon, no holes, no antimeridian crossing, 0.1–10,000 ha, up to 2,000 vertices. Date spans are limited to 1,095 days.
- **Synthetic demo:** repeatable hand-authored 10 m reflectance grid for the sample Iowa field; cloud and no-data masks; NDVI/NDMI summaries; time-series and CSV with provenance. All values are labeled synthetic. Other AOIs are rejected in demo mode rather than returning misleading empty statistics.
- **Live Sentinel‑2 analysis:** searches Planetary Computer STAC for Sentinel‑2 L2A. Choose a returned scene to sign its public B04/B08/SCL Cloud-Optimized GeoTIFF assets and compute NDVI from real pixels clipped to the AOI. The response includes acquisition/source metadata, valid and masked pixels, scene cloud cover, quantiles, scale/offset, CRS, and processing grid. Pixel analysis is capped at 1,000,000 B04 window pixels; larger areas fail explicitly. Scene previews remain visual context only.
- **Import:** calculates NDVI/NDMI from a user-provided GeoTIFF clipped to the selected AOI. Supply red, NIR, and SWIR as bands 1–3, reflectance scaled to 0–1, with a CRS and no more than 5 million pixels / 20 MB. The import date and sensor tags are unverified. No automatic resampling is performed.

## Architecture

- `src/`: TypeScript + Vite UI; Leaflet map and OpenStreetMap base tiles.
- `geocrop/api.py`: FastAPI endpoints, bounded STAC search/cache, SAS asset signing, live analysis, import handling and response validation. `geocrop/live.py` aligns B08 bilinearly and SCL with nearest-neighbor to the B04 10 m grid before cloud/nodata masking and NDVI calculation.
- `geocrop/geo.py`: WGS84 geometry/area checks, EPSG:32615 synthetic raster grid, index and mask calculations.
- No account, external farm-location storage, queue, database, or AI service. AOIs are sent to the STAC provider for live search and again with the selected scene for pixel analysis. Live assets are signed server-side through Planetary Computer and read through bounded COG range access; signed URLs are never returned to the browser. Demo and import calculations are local to the server process. OpenStreetMap receives viewport tile requests, which reveal the approximate map area and network address to that service.

## Methods and data dictionary

| Field            | Meaning                                                                                                                                                           |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ndvi`           | `(NIR − Red) / (NIR + Red)`; unitless, mathematically bounded −1 to 1 when inputs are nonnegative and denominator is positive.                                    |
| `ndmi`           | `(NIR − SWIR) / (NIR + SWIR)`; unitless, same bound under those conditions.                                                                                       |
| `cloud_percent`  | Synthetic SCL-like class 9 fraction for demo; selected-scene SCL cloud classes 8–10 over AOI pixels for live analysis; absent for imports. Catalog `eo:cloud_cover` describes the whole scene, not the AOI. |
| `nodata_percent` | Synthetic class 0 fraction for demo; Sentinel-2 SCL class 0 or missing reflectance pixels for live analysis. Imported data uses its own masks/nodata.                  |
| `pixel_count`    | Unmasked pixels contributing to the AOI mean; not a count of plants or a precise field-edge measurement.                                                          |
| `resolution_m`   | Nominal pixel size where known. Edge pixels and mixed land cover make field means approximate.                                                                    |
| `area_ha`        | Geodesic polygon area calculated on the WGS84 ellipsoid.                                                                                                          |

Sentinel‑2 L2A B04 red and B08 NIR are processed on the native B04 10 m grid; B08 is bilinearly aligned if the scene grid differs, and 20 m SCL is nearest-neighbor aligned. Live NDVI uses STAC `raster:bands` scale/offset (default scale 0.0001, offset 0), excludes SCL classes 0,1,2,3,7,8,9,10,11 and invalid denominators, and reports p10/p50/p90. The 1,000,000-pixel limit applies to the clipped B04 scene window. A live result covers only that scene and selected AOI, not the entire farm. For imports, scale to unit reflectance first; processing and mask quality are not independently verified. Demo arrays share a 10 m EPSG:32615 grid, so no resampling occurs. Synthetic values are not satellite observations.

Indices show spectral surface conditions. Clouds, nodata, mixed pixels, soil, crop type, phenology, sensor differences, atmospheric processing, and acquisition timing limit interpretation. They do not identify crop type, diagnose disease, determine irrigation need, establish causality, or predict yield. Unit tests check implementation behavior, not scientific validity.

## Data sources, attribution, and terms

| Source                            | Use                                                           | Attribution / terms                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Microsoft Planetary Computer STAC | Live Sentinel‑2 L2A metadata search; 5-minute in-memory cache | [STAC API](https://planetarycomputer.microsoft.com/docs/reference/stac/), [Sentinel‑2 collection](https://planetarycomputer.microsoft.com/api/stac/v1/collections/sentinel-2-l2a), [Planetary Computer terms](https://planetarycomputer.microsoft.com/terms). Anonymous STAC metadata is currently accessible; some asset data access uses temporary SAS signing and is throttled.                                     |
| ESA / Copernicus Sentinel‑2       | Underlying source imagery referenced by the collection        | [Copernicus Sentinel data terms](https://scihub.copernicus.eu/twiki/pub/SciHubWebPortal/TermsConditions/Sentinel_Data_Terms_and_Conditions.pdf); attribute “Contains modified Copernicus Sentinel data”. The collection metadata also lists Microsoft as host and Esri as processor. The STAC `license: proprietary` label describes the collection record; it is not treated here as the underlying Sentinel license. |
| OpenStreetMap                     | Map base tiles                                                | © OpenStreetMap contributors; [copyright and attribution](https://www.openstreetmap.org/copyright). Public tile service usage limits apply; production deployments should choose an appropriate tile service.                                                                                                                                                                                                          |
| Synthetic fixture                 | Offline demo only                                             | Hand-authored by this project; explicitly synthetic, no external license or observation claims.                                                                                                                                                                                                                                                                                                                        |

Terms and endpoints were checked on 2026-10-14. Provider terms and availability can change; re-check before production use. This project does not redistribute source imagery.

## Environment and limits

Copy `.env.example` only if changing deployment values. The STAC URL defaults to the official Planetary Computer host; never set it from request data. Limits default to 10,000 ha, 1,095 days, 20 catalog results, 5-minute metadata cache, 60 API requests/minute/IP, 20 MB/5-million-pixel user imports, and 1 million live Sentinel-2 AOI-window pixels. Live pixel reads use 8-second GDAL network timeouts and one retry; the catalog/STAC calls use an 8-second timeout. Live search has an 8-second request timeout and one retry. Cache entries are in-memory and disappear on restart. No secrets are required or logged. AOIs are not logged or persisted.

`/api/health` reports process readiness, not upstream provider availability. `/api/catalog/search` validates the AOI and sends it to the configured public catalog. `/api/analysis/demo` is limited to the sample Iowa AOI; `/api/analysis/import` returns user-raster statistics; `/api/analysis/live` accepts only a scene ID from the fixed Sentinel-2 collection and processes signed B04/B08/SCL assets server-side. Provider failures return an explicit error and never fall back to synthetic data. Every API request body is streamed through a hard byte cap (1 MB normally; 20 MB plus multipart overhead for imports), even when the request has no `Content-Length`. At most 4 API request bodies and 2 raster imports are buffered/processed at once per process. Errors are bounded and user-facing; provider URLs are fixed by the service, not supplied by a browser.

## Tests and CI

```sh
pytest
ruff check geocrop tests
ruff format --check geocrop tests
npm run format:check
npm run typecheck
npm test
npm run build
```

The Playwright smoke flow covers sample analysis, chart/quality display, CSV export, coordinate navigation, and source selection. CI runs Python lint/format, API and geometry tests, frontend type checking, E2E interactions, format checking, and the production build. It downloads Chromium for the E2E browser. Unit and fixture tests cover masked NDVI, cloud/nodata classes, empty valid pixels, 20 m-to-10 m resampling, CRS/grid handling, and the demo path; live access remains dependent on Planetary Computer and Azure asset availability.

## Deployment runbook

Build a self-contained app image with Docker and run it on port 8000:

```sh
docker compose up --build
```

Then check `http://localhost:8000/api/health` and visit `http://localhost:8000`. The image includes the static frontend and geospatial API. No database or paid services are needed. Live catalog and imagery requests use public services with their own availability and rate limits. `render.yaml` prepares an optional free Render Blueprint; connect the repository and explicitly create the service to deploy it. No hosting account was connected from this workspace, so there is no live URL yet. Render free services can spin down while idle and have usage limits; review the [current free-plan details](https://render.com/docs/free) before deployment.

For production, terminate TLS at the host, keep the app private until access controls and operational rate limiting are configured, use an appropriate tile provider, and review public API exposure. The included in-process per-IP limiter is for a small demonstrator, not a substitute for a production gateway. Uploaded files are processed in memory and discarded. Farm boundaries remain in browser/server memory for the request only.

## Troubleshooting

- If `npm ci` fails, use Node 20 or later and rerun it after removing `node_modules`.
- If live scene search or pixel processing fails, check the public STAC/SAS service and try another scene or a smaller AOI; use the explicitly labeled synthetic demo or raster import as an independent workflow.
- If an import is rejected, check band order, unit reflectance scaling, CRS, pixel dimensions, file size, and AOI overlap.
- If the map is blank, check access to OpenStreetMap tiles; the demo analysis still runs without the basemap.
