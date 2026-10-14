# Technical strategy

Niche: reproducible, quality-audited field observations across selected Sentinel-2 L2A scenes. The target user is a researcher or grower comparing what imagery samples actually support. The contribution is bounded COG processing and per-date quality metadata—not crop diagnosis or yield prediction.

| Direction                                            |  CS | Domain | Useful | Distinct | Feasible | Verifiable | Accessible | Interview | Total / 40 |
| ---------------------------------------------------- | --: | -----: | -----: | -------: | -------: | ---------: | ---------: | --------: | ---------: |
| Multi-date quality-audited observations **selected** |   5 |      5 |      4 |        4 |        4 |          5 |          4 |         5 |         36 |
| Crop classifier on CropHarvest                       |   5 |      4 |      3 |        3 |        3 |          4 |          5 |         4 |         31 |
| Multisensor yield/stress forecast                    |   5 |      3 |      4 |        4 |        2 |          2 |          4 |         5 |         29 |

Alternatives: [Google Earth Engine Sentinel-2](https://developers.google.com/earth-engine/datasets/catalog/COPERNICUS_S2_HARMONIZED) and [Sentinel Hub](https://docs.sentinel-hub.com/api/latest/evalscript/) provide large-scale collection processing; [Planetary Computer](https://planetarycomputer.microsoft.com/docs/quickstart/using-stac/) exposes STAC/COG assets; [CropHarvest](https://github.com/nasaharvest/cropharvest) provides crop-labeled benchmark data; [s2cloudless](https://github.com/sentinel-hub/sentinel2-cloud-detector) provides cloud detection. GeoCrop's scope is to expose per-field pixel support and processing choices in a small no-account workflow, not to recreate those platforms.

Technical proof: use per-scene STAC scales, B04 analysis grid, bilinear B08 and nearest-neighbor SCL alignment, explicit class mask, valid/masked counts, percentiles, CRS, and scene provenance. Bound multi-scene mode and preserve individual failures. Test independent raster values, masking, ordering, and provenance.

Scope: no interpolation, crop classification, stress diagnosis, or yield prediction. NDVI is a unitless spectral index; temporal observations are not a harmonized phenology product and can differ due to crop stage, atmosphere, clouds, and acquisition conditions.
