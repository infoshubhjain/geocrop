"""Independently compare one pinned Sentinel-2 scene with GeoCrop's live API.

Run with network access: python scripts/verify_live_reference.py
"""

import argparse
import json

import httpx
import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.features import geometry_mask, geometry_window
from rasterio.warp import reproject, transform_geom
from rasterio.windows import transform as window_transform

SCENE = "S2A_MSIL2A_20240609T165901_R069_T15TVG_20240610T012559"
AOI = {
    "type": "Polygon",
    "coordinates": [
        [
            [-93.504, 41.696],
            [-93.495, 41.696],
            [-93.495, 41.703],
            [-93.504, 41.703],
            [-93.504, 41.696],
        ]
    ],
}
EXPECTED = {
    "ndvi": 0.30995929870098393,
    "pixel_count": 5796,
    "masked_pixel_count": 0,
    "ndvi_percentiles": {
        "p10": 0.19643549621660253,
        "p50": 0.32289240156262916,
        "p90": 0.38515077060100067,
    },
}
HOST = "https://planetarycomputer.microsoft.com"


def independent_summary() -> dict:
    item = httpx.get(f"{HOST}/api/stac/v1/collections/sentinel-2-l2a/items/{SCENE}", timeout=20)
    item.raise_for_status()
    assets = item.json()["assets"]
    urls = {}
    for name in ("B04", "B08", "SCL"):
        signed = httpx.get(
            f"{HOST}/api/sas/v1/sign", params={"href": assets[name]["href"]}, timeout=20
        )
        signed.raise_for_status()
        urls[name] = signed.json()["href"]
    scales = {name: (assets[name].get("raster:bands") or [{}])[0] for name in ("B04", "B08")}

    with (
        rasterio.Env(
            GDAL_HTTP_TIMEOUT=8, GDAL_HTTP_MAX_RETRY=1, GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR"
        ),
        rasterio.open(urls["B04"]) as red_ds,
        rasterio.open(urls["B08"]) as nir_ds,
        rasterio.open(urls["SCL"]) as scl_ds,
    ):
        polygon = transform_geom("EPSG:4326", red_ds.crs, AOI)
        window = geometry_window(red_ds, [polygon])
        grid = window_transform(window, red_ds.transform)
        red = red_ds.read(1, window=window, masked=True).astype("float64").filled(np.nan)
        nir = np.full(red.shape, np.nan, dtype="float64")
        scl = np.zeros(red.shape, dtype="uint8")
        reproject(
            rasterio.band(nir_ds, 1),
            nir,
            src_nodata=nir_ds.nodata,
            dst_transform=grid,
            dst_crs=red_ds.crs,
            dst_nodata=np.nan,
            resampling=Resampling.bilinear,
        )
        reproject(
            rasterio.band(scl_ds, 1),
            scl,
            src_nodata=scl_ds.nodata,
            dst_transform=grid,
            dst_crs=red_ds.crs,
            dst_nodata=0,
            resampling=Resampling.nearest,
        )
        red = red * float(scales["B04"].get("scale", 0.0001)) + float(
            scales["B04"].get("offset", 0)
        )
        nir = nir * float(scales["B08"].get("scale", 0.0001)) + float(
            scales["B08"].get("offset", 0)
        )
        inside = geometry_mask([polygon], red.shape, grid, invert=True)
        valid = (
            inside
            & np.isfinite(red)
            & np.isfinite(nir)
            & ((red + nir) > 0)
            & ~np.isin(scl, [0, 1, 2, 3, 7, 8, 9, 10, 11])
        )
        values = (nir[valid] - red[valid]) / (nir[valid] + red[valid])
        return {
            "ndvi": float(values.mean()),
            "pixel_count": int(valid.sum()),
            "masked_pixel_count": int(inside.sum() - valid.sum()),
            "ndvi_percentiles": {
                name: float(np.percentile(values, percentile))
                for name, percentile in (("p10", 10), ("p50", 50), ("p90", 90))
            },
        }


def compare(actual: dict, expected: dict, label: str) -> None:
    for key in ("pixel_count", "masked_pixel_count"):
        if actual[key] != expected[key]:
            raise AssertionError(f"{label} {key}: {actual[key]} != {expected[key]}")
    for key, value in (("ndvi", expected["ndvi"]), *expected["ndvi_percentiles"].items()):
        measured = actual["ndvi"] if key == "ndvi" else actual["ndvi_percentiles"][key]
        if abs(measured - value) > 1e-6:
            raise AssertionError(f"{label} {key}: {measured} != {value}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api", default="https://geocrop-three.vercel.app")
    args = parser.parse_args()
    independent = independent_summary()
    compare(independent, EXPECTED, "Pinned reference")
    response = httpx.post(
        f"{args.api.rstrip('/')}/api/analysis/live",
        json={"aoi": AOI, "item_id": SCENE},
        timeout=120,
    )
    response.raise_for_status()
    actual = response.json()["observations"][0]
    compare(actual, independent, "GeoCrop")
    print(
        json.dumps({"scene": SCENE, "independent": independent, "geocrop_matches": True}, indent=2)
    )


if __name__ == "__main__":
    main()
