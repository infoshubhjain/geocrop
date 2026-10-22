# Selectable Sentinel-2 example: implementation plan

## Goal and acceptance criteria

The default experience lets a visitor draw any valid polygon **inside the visible Iowa study-area outline**, analyze that exact area without waiting for an upstream service, and see the same dated NDVI pixels as a translucent map overlay. Different selected areas must produce different summaries when their source pixels differ. A boundary outside coverage must receive a clear error. The original synthetic time series remains a separately labeled illustration.

## Milestones

| Milestone                  | Implementation                                                                                                                                                           | Completion check                                                                                                          |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Pin a public scene         | Fix one Sentinel-2 L2A scene ID and read its B04 red, B08 NIR, and SCL assets from Microsoft Planetary Computer.                                                         | Scene ID, acquisition time, STAC URL, processing method, and attribution are committed as metadata.                       |
| Bundle a compact example   | Reproject the three bands to one EPSG:3857 grid; scale reflectance, mask invalid SCL classes, save compressed arrays and an RGBA NDVI overlay from those same arrays.    | The 112 × 112 pixel fixture and overlay load without credentials at runtime. The grid covers the default sample boundary. |
| Analyze arbitrary subareas | Validate the user polygon, require it to fit inside the fixture footprint, rasterize it on the fixture grid, and summarize valid pixels with the existing NDVI function. | Two separate polygons produce repeatable, differing results; outside or subpixel selections fail clearly.                 |
| Make coverage visible      | Show the raster overlay, dashed coverage outline, fixed color legend, source toggle, draw interaction, and reset action.                                                 | Browser flow can draw, analyze, export, and reset; the selected boundary and coverage remain distinct.                    |
| Explain and deploy         | Show a single-scene percentile distribution, attribution and scientific limits; include assets in Vercel and Render builds.                                              | API, browser, build, format, and public deployment checks pass.                                                           |

## Data and processing

- **Source:** Sentinel-2 L2A scene `S2A_MSIL2A_20240609T165901_R069_T15TVG_20240610T012559`, acquired 2024-06-09, retrieved from its [public STAC record](https://planetarycomputer.microsoft.com/api/stac/v1/collections/sentinel-2-l2a/items/S2A_MSIL2A_20240609T165901_R069_T15TVG_20240610T012559). **Contains modified Copernicus Sentinel data 2024.**
- **Build:** `python scripts/build_example_scene.py` signs the public COG asset URLs, uses B04/B08 bilinear resampling and SCL nearest-neighbor resampling, applies the source scale and offset, and writes `geocrop/data/example_scene.npz`, `geocrop/data/example_scene.json`, and `public/example-ndvi.png`. Run this only when intentionally updating the pinned example; the deployed application reads the committed files and makes no network call for this mode.
- **Grid:** 112 × 112 pixels in EPSG:3857 with 13.4 projected meters per pixel, approximately 10 ground meters at this latitude. The image overlay uses this same Web Mercator footprint, so its cells line up with the map and the server's polygon mask.
- **Analysis:** the server rasterizes the chosen WGS84 polygon on that grid and calls the same `index_summary` used by live analysis. It reports mean NDVI, p10/median/p90, valid and masked counts, AOI cloud and nodata percentages, area, and source provenance. The PNG visualizes those same NDVI values, with transparent invalid pixels and a fixed −0.2 to 0.8 color scale.
- **Coverage:** the entire polygon must fit inside the dashed study-area outline. A polygon outside it gets HTTP 422 and guidance to use the live catalog. This avoids silently analyzing a partial or unrelated footprint.

## Scientific limits

This example demonstrates georeferencing, polygon masking, spectral indices, visual alignment, and reproducible statistics from a real acquisition. It is **one historical scene**, not a current field condition or time series. The Esri basemap may have a different capture date; it is visual context, not analysis input. A drawn area may include roads, buildings, soil, or mixed field edges. NDVI alone does not diagnose crop health, disease, water stress, or yield. The chosen scene has no invalid SCL pixels within the fixture; offline fixture tests exercise masking branches. For time comparison, use the live catalog and select multiple scenes.

## Cost and deployment

The example requires no Google API key, runtime imagery request, database, object storage, or paid service. Vercel serves the small PNG; the existing Render service keeps the 53 KB compressed raster in its Docker image and caches it in memory on first use. Render Free still has cold starts. The bundled image is a modified Sentinel product and must retain the Copernicus attribution in the UI, API, CSV, and documentation. See the [Copernicus Sentinel legal notice](https://sentinels.copernicus.eu/documents/247904/690755/Sentinel_Data_Legal_Notice).
