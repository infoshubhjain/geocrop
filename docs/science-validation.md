# Independent Sentinel-2 reference check

GeoCrop's live NDVI calculation was compared on 2026-10-21 with a separate rasterio calculation for Sentinel-2 L2A scene `S2A_MSIL2A_20240609T165901_R069_T15TVG_20240610T012559` over the sample Iowa polygon in the app. The independent script reads B04 directly on its pixel grid, reprojects B08 bilinearly and SCL by nearest neighbor, applies each band's STAC scale and offset, excludes SCL classes 0, 1, 2, 3, 7, 8, 9, 10, 11, and computes NDVI over pixels inside the polygon. It does not import GeoCrop's analysis functions.

| Check             | Independent result | GeoCrop result |
| ----------------- | -----------------: | -------------: |
| Valid pixels      |              5,796 |          5,796 |
| Masked AOI pixels |                  0 |              0 |
| Mean NDVI         |       0.3099592987 |   0.3099592987 |
| NDVI p10          |       0.1964354962 |   0.1964354962 |
| NDVI median       |       0.3228924016 |   0.3228924016 |
| NDVI p90          |       0.3851507706 |   0.3851507706 |

Run `python scripts/verify_live_reference.py` after installing the project. Use `--api http://localhost:8000` to check a local build. The script retrieves the named public scene, independently recalculates these values, then compares them with the API within `1e-6`. The repository's small, hand-built raster fixtures run in CI without external network access; the real-scene check is opt-in because the STAC, SAS, and cloud assets can be unavailable or reprocessed.

This agreement checks implementation consistency for one scene and polygon. It does not establish ground truth crop condition, yield, irrigation need, atmospheric accuracy, or cloud-mask accuracy. The sample's zero masked pixels do not exercise every masking class; offline fixtures cover the mask branches. Output is an area mean of selected pixels, with mixed edges and acquisition-specific conditions. **Contains modified Copernicus Sentinel data 2024.** Source: [Copernicus Sentinel legal notice](https://sentinels.copernicus.eu/documents/247904/690755/Sentinel_Data_Legal_Notice), imagery hosted by [Microsoft Planetary Computer](https://planetarycomputer.microsoft.com/terms).
