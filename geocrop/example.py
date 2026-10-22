"""Offline analysis of the bundled, dated Sentinel-2 example scene."""

import json
from functools import lru_cache
from pathlib import Path

import numpy as np
from pyproj import Transformer
from rasterio.features import geometry_mask
from rasterio.transform import from_origin
from shapely import transform as transform_geometry
from shapely.geometry import box

from .live import index_summary

DATA = Path(__file__).with_name("data")
METADATA = json.loads((DATA / "example_scene.json").read_text())
GRID = METADATA["grid"]
TRANSFORM = from_origin(GRID["west"], GRID["north"], GRID["pixel_m"], GRID["pixel_m"])
EXTENT = box(
    GRID["west"],
    GRID["north"] - GRID["height"] * GRID["pixel_m"],
    GRID["west"] + GRID["width"] * GRID["pixel_m"],
    GRID["north"],
)
TO_GRID = Transformer.from_crs("EPSG:4326", GRID["crs"], always_xy=True)


@lru_cache(maxsize=1)
def pixels() -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    with np.load(DATA / "example_scene.npz") as data:
        return data["red"], data["nir"], data["scl"]


def analyze_example(geom) -> dict:
    projected = transform_geometry(geom, TO_GRID.transform, interleaved=False)
    if not EXTENT.covers(projected):
        raise ValueError(
            "This example covers only the outlined Iowa study area. Draw inside its boundary or use Live catalog elsewhere."
        )
    inside = geometry_mask(
        [projected.__geo_interface__],
        (GRID["height"], GRID["width"]),
        TRANSFORM,
        invert=True,
    )
    if not inside.any():
        raise ValueError("Draw a larger area so it includes at least one example pixel.")
    red, nir, scl = pixels()
    return index_summary(red, nir, scl, inside)
