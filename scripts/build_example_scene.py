"""Regenerate the bundled Iowa Sentinel-2 example from public COG assets.

Run with network access: python scripts/build_example_scene.py
"""

import json
from pathlib import Path

import httpx
import numpy as np
import rasterio
from pyproj import Transformer
from rasterio.enums import Resampling
from rasterio.transform import from_origin
from rasterio.vrt import WarpedVRT

from geocrop.live import INVALID_SCL

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "geocrop" / "data"
PUBLIC = ROOT / "public"
SCENE = "S2A_MSIL2A_20240609T165901_R069_T15TVG_20240610T012559"
HOST = "https://planetarycomputer.microsoft.com"
# EPSG:3857 makes each PNG pixel line up with Leaflet's default map projection.
WEST, NORTH, PIXEL, WIDTH, HEIGHT = -10409000.0, 5116850.0, 13.4, 112, 112
GRID = from_origin(WEST, NORTH, PIXEL, PIXEL)


def signed_assets() -> tuple[dict, dict]:
    item = httpx.get(f"{HOST}/api/stac/v1/collections/sentinel-2-l2a/items/{SCENE}", timeout=20)
    item.raise_for_status()
    item = item.json()
    urls = {}
    for band in ("B04", "B08", "SCL"):
        signed = httpx.get(
            f"{HOST}/api/sas/v1/sign", params={"href": item["assets"][band]["href"]}, timeout=20
        )
        signed.raise_for_status()
        urls[band] = signed.json()["href"]
    return item, urls


def read_band(url: str, resampling: Resampling) -> np.ma.MaskedArray:
    with (
        rasterio.open(url) as source,
        WarpedVRT(
            source,
            crs="EPSG:3857",
            transform=GRID,
            width=WIDTH,
            height=HEIGHT,
            resampling=resampling,
        ) as warped,
    ):
        return warped.read(1, masked=True)


def main() -> None:
    item, urls = signed_assets()
    with rasterio.Env(
        GDAL_HTTP_TIMEOUT=8, GDAL_HTTP_MAX_RETRY=1, GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR"
    ):
        red_raw = read_band(urls["B04"], Resampling.bilinear)
        nir_raw = read_band(urls["B08"], Resampling.bilinear)
        scl_raw = read_band(urls["SCL"], Resampling.nearest)
    scales = {}
    for band in ("B04", "B08"):
        metadata = (item["assets"][band].get("raster:bands") or [{}])[0]
        scales[band] = (float(metadata.get("scale", 0.0001)), float(metadata.get("offset", 0)))
    red = red_raw.astype("float32").filled(np.nan) * scales["B04"][0] + scales["B04"][1]
    nir = nir_raw.astype("float32").filled(np.nan) * scales["B08"][0] + scales["B08"][1]
    scl = np.ma.filled(scl_raw, 0).astype("uint8")
    valid = np.isfinite(red) & np.isfinite(nir) & ((red + nir) > 0) & ~np.isin(scl, INVALID_SCL)
    if valid.sum() < WIDTH * HEIGHT * 0.5:
        raise RuntimeError("Selected scene has insufficient valid pixels for the example.")
    ndvi = np.full(red.shape, np.nan, dtype="float32")
    ndvi[valid] = (nir[valid] - red[valid]) / (nir[valid] + red[valid])

    # Fixed legend range: tan (-0.2), yellow (0.2), light green (0.5), dark green (0.8).
    stops = [
        (-0.2, (139, 87, 54)),
        (0.2, (225, 195, 97)),
        (0.5, (136, 176, 92)),
        (0.8, (38, 105, 60)),
    ]
    rgba = np.zeros((4, HEIGHT, WIDTH), dtype="uint8")
    for channel in range(3):
        rgba[channel] = np.interp(
            np.nan_to_num(ndvi, nan=-0.2),
            [value for value, _ in stops],
            [color[channel] for _, color in stops],
        ).astype("uint8")
    rgba[3, valid] = 255

    DATA.mkdir(exist_ok=True)
    PUBLIC.mkdir(exist_ok=True)
    np.savez_compressed(DATA / "example_scene.npz", red=red, nir=nir, scl=scl)
    with rasterio.open(
        PUBLIC / "example-ndvi.png",
        "w",
        driver="PNG",
        width=WIDTH,
        height=HEIGHT,
        count=4,
        dtype="uint8",
    ) as image:
        image.write(rgba)
    to_wgs84 = Transformer.from_crs("EPSG:3857", "EPSG:4326", always_xy=True)
    east = WEST + WIDTH * PIXEL
    south = NORTH - HEIGHT * PIXEL
    west_lon, south_lat = to_wgs84.transform(WEST, south)
    east_lon, north_lat = to_wgs84.transform(east, NORTH)
    if not (
        west_lon < -93.504 and east_lon > -93.495 and south_lat < 41.696 and north_lat > 41.703
    ):
        raise RuntimeError("Example grid does not cover the app's default Iowa boundary.")
    metadata = {
        "scene_id": SCENE,
        "acquired": item["properties"]["datetime"],
        "bounds": [[south_lat, west_lon], [north_lat, east_lon]],
        "grid": {
            "crs": "EPSG:3857",
            "west": WEST,
            "north": NORTH,
            "pixel_m": PIXEL,
            "width": WIDTH,
            "height": HEIGHT,
        },
        "valid_pixels": int(valid.sum()),
        "attribution": "Contains modified Copernicus Sentinel data 2024",
        "stac_url": f"{HOST}/api/stac/v1/collections/sentinel-2-l2a/items/{SCENE}",
        "processing": "B04/B08 bilinear and SCL nearest-neighbor resampling to an EPSG:3857 grid; invalid SCL classes masked",
    }
    (DATA / "example_scene.json").write_text(json.dumps(metadata, indent=2) + "\n")
    print(
        f"Wrote example: {valid.sum()} valid of {WIDTH * HEIGHT} pixels, bounds {metadata['bounds']}"
    )


if __name__ == "__main__":
    main()
