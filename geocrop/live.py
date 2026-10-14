from __future__ import annotations

from contextlib import ExitStack

import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.features import geometry_mask, geometry_window
from rasterio.mask import mask as raster_mask
from rasterio.vrt import WarpedVRT
from rasterio.warp import transform_geom

MAX_LIVE_PIXELS = 1_000_000
CLOUD_CLASSES = (8, 9, 10)
INVALID_SCL = (0, 1, 2, 3, 7, 8, 9, 10, 11)


def index_summary(red, nir, scl, inside=None):
    red, nir, scl = (
        np.asarray(red, dtype=np.float64),
        np.asarray(nir, dtype=np.float64),
        np.asarray(scl),
    )
    denominator = nir + red
    inside = np.ones(scl.shape, dtype=bool) if inside is None else inside
    valid = (
        inside
        & np.isfinite(red)
        & np.isfinite(nir)
        & np.isfinite(denominator)
        & (denominator > 0)
        & ~np.isin(scl, INVALID_SCL)
    )
    total = int(inside.sum())
    values = (nir[valid] - red[valid]) / denominator[valid]
    cloud = inside & np.isin(scl, CLOUD_CLASSES)
    if not values.size:
        raise ValueError("No valid, cloud-free Sentinel-2 pixels overlap this boundary.")
    return {
        "ndvi": float(values.mean()),
        "ndvi_percentiles": {
            "p10": float(np.percentile(values, 10)),
            "p50": float(np.percentile(values, 50)),
            "p90": float(np.percentile(values, 90)),
        },
        "pixel_count": int(values.size),
        "masked_pixel_count": total - int(values.size),
        "cloud_percent": round(float(cloud.sum() / max(total, 1) * 100), 1),
        "nodata_percent": round(
            float(
                (inside & ((scl == 0) | ~np.isfinite(red) | ~np.isfinite(nir))).sum()
                / max(total, 1)
                * 100
            ),
            1,
        ),
    }


def analyze_cogs(
    aoi: dict, red_href: str, nir_href: str, scl_href: str, scales: dict[str, tuple[float, float]]
) -> dict:
    geometry = None
    with (
        rasterio.Env(
            GDAL_HTTP_TIMEOUT=8, GDAL_HTTP_MAX_RETRY=1, GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR"
        ),
        ExitStack() as stack,
    ):
        red_ds = stack.enter_context(rasterio.open(red_href))
        geometry = transform_geom("EPSG:4326", red_ds.crs, aoi)
        window = geometry_window(red_ds, [geometry])
        if window.width * window.height > MAX_LIVE_PIXELS:
            raise ValueError(
                f"This scene window exceeds the {MAX_LIVE_PIXELS:,}-pixel processing limit. Draw a smaller region."
            )
        red_arr, transform = raster_mask(
            red_ds, [geometry], crop=True, filled=False, all_touched=False
        )
        height, width = red_arr.shape[1:]
        if width * height > MAX_LIVE_PIXELS:
            raise ValueError(
                f"This scene window exceeds the {MAX_LIVE_PIXELS:,}-pixel processing limit. Draw a smaller region."
            )
        grid = {"crs": red_ds.crs, "transform": transform, "width": width, "height": height}
        nir_src = stack.enter_context(rasterio.open(nir_href))
        scl_src = stack.enter_context(rasterio.open(scl_href))
        nir_vrt = stack.enter_context(WarpedVRT(nir_src, **grid, resampling=Resampling.bilinear))
        scl_vrt = stack.enter_context(WarpedVRT(scl_src, **grid, resampling=Resampling.nearest))
        nir_arr, _ = raster_mask(nir_vrt, [geometry], crop=True, filled=False, all_touched=False)
        scl_arr, _ = raster_mask(scl_vrt, [geometry], crop=True, filled=False, all_touched=False)
        red_values = red_arr[0].astype(np.float64).filled(np.nan)
        nir_values = nir_arr[0].astype(np.float64).filled(np.nan)
        scl_values = np.ma.filled(scl_arr[0], 0)
        inside = geometry_mask(
            [geometry], out_shape=(height, width), transform=transform, invert=True
        )
        red_scale, red_offset = scales["B04"]
        nir_scale, nir_offset = scales["B08"]
        summary = index_summary(
            red_values * red_scale + red_offset,
            nir_values * nir_scale + nir_offset,
            scl_values,
            inside,
        )
        return {
            **summary,
            "resolution_m": abs(float(red_ds.transform.a)),
            "crs": str(red_ds.crs),
            "processing_grid": "B04 native 10 m grid; B08 bilinear and SCL nearest-neighbor reprojection to B04 grid",
        }
