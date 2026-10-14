from __future__ import annotations

from datetime import date

import numpy as np
from pyproj import Geod, Transformer
from rasterio.features import geometry_mask
from rasterio.transform import from_origin
from shapely import transform as transform_geometry
from shapely.geometry import box, shape

GEOD = Geod(ellps="WGS84")
TO_UTM = Transformer.from_crs("EPSG:4326", "EPSG:32615", always_xy=True)
GRID_TRANSFORM = from_origin(458000, 4617000, 10, 10)
GRID_SHAPE = (100, 100)
SYNTHETIC_EXTENT = box(458000, 4616000, 459000, 4617000)


def validate_aoi(geojson: dict, max_area_ha: float = 10_000) -> tuple[object, float]:
    if (
        not isinstance(geojson, dict)
        or geojson.get("type") != "Polygon"
        or not isinstance(geojson.get("coordinates"), list)
        or len(geojson["coordinates"]) != 1
    ):
        raise ValueError("Use one Polygon without holes in WGS84 (EPSG:4326).")
    coords = geojson["coordinates"][0]
    if not isinstance(coords, list) or len(coords) < 4 or len(coords) > 2001:
        raise ValueError("The boundary needs 3–2,000 vertices and a closing coordinate.")
    if any(
        not isinstance(point, (list, tuple))
        or len(point) != 2
        or any(
            isinstance(v, bool) or not isinstance(v, (int, float)) or not np.isfinite(v)
            for v in point
        )
        for point in coords
    ):
        raise ValueError("Coordinates must be finite longitude/latitude pairs.")
    if coords[0] != coords[-1]:
        raise ValueError("Polygon ring must repeat its first coordinate at the end.")
    lons, lats = zip(*coords)
    if min(lons) < -180 or max(lons) > 180 or min(lats) < -85 or max(lats) > 85:
        raise ValueError("Coordinates must be within longitude ±180° and latitude ±85°.")
    if max(lons) - min(lons) > 180:
        raise ValueError("Boundaries crossing the antimeridian are not supported.")
    geom = shape(geojson)
    if not geom.is_valid or geom.is_empty:
        raise ValueError("Boundary must be a valid, non-empty polygon.")
    area_m2, _ = GEOD.geometry_area_perimeter(geom)
    area_ha = abs(area_m2) / 10_000
    if area_ha < 0.1 or area_ha > max_area_ha:
        raise ValueError(f"Area must be between 0.1 and {max_area_ha:,.0f} hectares.")
    return geom, area_ha


def validate_dates(start: date, end: date, max_days: int = 1095) -> None:
    if end < start:
        raise ValueError("End date must be on or after start date.")
    if (end - start).days > max_days:
        raise ValueError(f"Date range is limited to {max_days} days.")


def supports_synthetic(geom) -> bool:
    projected = transform_geometry(geom, TO_UTM.transform, interleaved=False)
    return SYNTHETIC_EXTENT.covers(projected)


def synthetic_scene(index: int, geom) -> dict:
    """Analyze a deterministic, hand-authored synthetic 10 m reflectance grid."""
    projected = transform_geometry(geom, TO_UTM.transform, interleaved=False)
    mask = geometry_mask([projected.__geo_interface__], GRID_SHAPE, GRID_TRANSFORM, invert=True)
    rows, cols = np.indices(GRID_SHAPE)
    vigor = 0.55 + 0.025 * index + 0.06 * np.sin((cols + index * 4) / 13) + 0.04 * np.cos(rows / 17)
    red = np.clip(0.12 - (vigor - 0.62) * 0.10, 0.04, 0.2)
    nir = np.clip(0.30 + (vigor - 0.62) * 0.5, 0.15, 0.55)
    swir = np.clip(0.20 - (vigor - 0.62) * 0.25, 0.08, 0.35)
    scl = np.full(GRID_SHAPE, 4, dtype=np.uint8)
    scl[(rows * 3 + cols * 7 + index * 11) % 29 == 0] = 9
    scl[(rows * 13 + cols * 5 + index) % 137 == 0] = 0
    valid = mask & ~np.isin(scl, [0, 9])
    ndvi = (nir - red) / (nir + red)
    ndmi = (nir - swir) / (nir + swir)
    return {
        "ndvi": float(ndvi[valid].mean()) if valid.any() else None,
        "ndmi": float(ndmi[valid].mean()) if valid.any() else None,
        "pixel_count": int(valid.sum()),
        "cloud_percent": round(float((mask & (scl == 9)).sum() / max(mask.sum(), 1) * 100), 1),
        "nodata_percent": round(float((mask & (scl == 0)).sum() / max(mask.sum(), 1) * 100), 1),
        "resolution_m": 10,
        "mask": "synthetic SCL-like classes; class 9 (cloud) excluded",
    }
