from __future__ import annotations

import os
import time
from collections import defaultdict
from datetime import date
from pathlib import Path
from urllib.parse import quote, urlparse

import httpx
import numpy as np
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from rasterio.io import MemoryFile
from rasterio.mask import mask as raster_mask
from rasterio.warp import transform_geom
from starlette.datastructures import UploadFile

from .geo import synthetic_scene, validate_aoi, validate_dates

STAC_URL = os.getenv("GEOCROP_STAC_URL", "https://planetarycomputer.microsoft.com/api/stac/v1")
parsed_stac = urlparse(STAC_URL)
if (
    parsed_stac.scheme != "https"
    or parsed_stac.hostname != "planetarycomputer.microsoft.com"
    or parsed_stac.path.rstrip("/") != "/api/stac/v1"
    or parsed_stac.query
    or parsed_stac.fragment
):
    raise RuntimeError(
        "GEOCROP_STAC_URL must use the official HTTPS Planetary Computer STAC endpoint."
    )
MAX_AOI_HA = float(os.getenv("GEOCROP_MAX_AOI_HA", "10000"))
MAX_DATE_DAYS = int(os.getenv("GEOCROP_MAX_DATE_DAYS", "1095"))
MAX_IMPORT_BYTES = 20 * 1024 * 1024
app = FastAPI(title="GeoCrop API", version="0.1.0")
# shortcut: process-local cache is ephemeral; use shared storage if running multiple replicas.
cache: dict[str, tuple[float, dict]] = {}
# shortcut: process-local rate limits are per worker; put a shared gateway in front before scaling.
requests_by_ip: dict[str, list[float]] = defaultdict(list)


class AnalysisRequest(BaseModel):
    aoi: dict
    start: date
    end: date


def checked(payload: AnalysisRequest):
    try:
        geom, area = validate_aoi(payload.aoi, MAX_AOI_HA)
        validate_dates(payload.start, payload.end, MAX_DATE_DAYS)
        return geom, area
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@app.middleware("http")
async def protections(request: Request, call_next):
    key = request.client.host if request.client else "unknown"
    now = time.time()
    recent = [stamp for stamp in requests_by_ip[key] if now - stamp < 60]
    if len(recent) >= 60:
        return JSONResponse(
            {"detail": "Request limit reached. Try again in a minute."}, status_code=429
        )
    content_length = request.headers.get("content-length")
    if request.url.path == "/api/analysis/import" and not content_length:
        return JSONResponse(
            {"detail": "Import requests must include a bounded content length."}, status_code=411
        )
    max_body_bytes = (
        MAX_IMPORT_BYTES + 100_000 if request.url.path == "/api/analysis/import" else 1_000_000
    )
    if (
        request.url.path.startswith("/api/")
        and content_length
        and content_length.isdigit()
        and int(content_length) > max_body_bytes
    ):
        return JSONResponse({"detail": "Request body is too large."}, status_code=413)
    recent.append(now)
    requests_by_ip[key] = recent
    if len(requests_by_ip) > 2048:
        requests_by_ip.pop(next(iter(requests_by_ip)))
    response = await call_next(request)
    response.headers.update(
        {
            "X-Content-Type-Options": "nosniff",
            "X-Frame-Options": "DENY",
            "Referrer-Policy": "strict-origin-when-cross-origin",
            "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
            "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://tile.openstreetmap.org https://planetarycomputer.microsoft.com; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
        }
    )
    return response


@app.get("/api/health")
async def health():
    return {"status": "ok", "provider": "Microsoft Planetary Computer STAC", "demo": "available"}


@app.post("/api/catalog/search")
async def search(payload: AnalysisRequest):
    # shortcut: live results include metadata and previews; add bounded COG processing when live index statistics are required.
    _, _ = checked(payload)
    key = f"{payload.aoi}|{payload.start}|{payload.end}"
    if key in cache and cache[key][0] > time.time():
        return {**cache[key][1], "cached": True}
    body = {
        "collections": ["sentinel-2-l2a"],
        "intersects": payload.aoi,
        "datetime": f"{payload.start.isoformat()}T00:00:00Z/{payload.end.isoformat()}T23:59:59Z",
        "limit": 20,
        "sortby": [{"field": "properties.datetime", "direction": "desc"}],
    }
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(8), follow_redirects=False) as client:
            response = None
            for attempt in range(2):
                try:
                    response = await client.post(f"{STAC_URL}/search", json=body)
                    response.raise_for_status()
                    break
                except (httpx.TimeoutException, httpx.NetworkError, httpx.HTTPStatusError):
                    if attempt == 1:
                        raise
            data = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise HTTPException(
            502, "Live catalog is unavailable. Try again or use the labeled demo data."
        ) from exc
    items = []
    for item in data.get("features", []):
        props = item.get("properties", {})
        items.append(
            {
                "id": item.get("id"),
                "datetime": props.get("datetime"),
                "cloud_percent": props.get("eo:cloud_cover"),
                "platform": props.get("platform"),
                "processing_level": props.get("processing:level", "L2A"),
                "gsd_m": props.get("gsd", 10),
                "assets": [
                    name
                    for name in ("B04", "B08", "B11", "SCL", "visual")
                    if name in item.get("assets", {})
                ],
                "footprint": item.get("geometry"),
                "source": "Microsoft Planetary Computer / Copernicus Sentinel-2 L2A",
                "source_url": f"{STAC_URL}/collections/sentinel-2-l2a/items/{item.get('id')}",
                "preview_url": f"https://planetarycomputer.microsoft.com/api/data/v1/item/preview.png?collection=sentinel-2-l2a&item={quote(str(item.get('id')), safe='')}&assets=visual&asset_bidx=visual%7C1,2,3&nodata=0&format=png&max_size=512",
            }
        )
    result = {"source": "live", "collection": "sentinel-2-l2a", "items": items, "cached": False}
    cache[key] = (time.time() + 300, result)
    if len(cache) > 256:
        cache.pop(next(iter(cache)))
    return result


@app.post("/api/analysis/demo")
async def demo(payload: AnalysisRequest):
    geom, area = checked(payload)
    days = (payload.end - payload.start).days
    count = min(6, max(1, days // 30 + 1))
    observations = []
    for index in range(count):
        when = date.fromordinal(payload.start.toordinal() + (days * index // max(count - 1, 1)))
        observations.append({"date": when.isoformat(), **synthetic_scene(index, geom)})
    return {
        "source": "synthetic-demo",
        "source_label": "SYNTHETIC DEMO · not satellite observations",
        "area_ha": round(area, 2),
        "observations": observations,
        "provenance": {
            "sensor": "hand-authored synthetic fixture",
            "bands": "red, NIR, SWIR (simulated reflectance, unitless 0–1)",
            "processing_level": "synthetic; not a satellite product",
            "resolution_m": 10,
            "mask": "simulated SCL-like cloud class 9 excluded",
            "formulas": "NDVI=(NIR−Red)/(NIR+Red); NDMI=(NIR−SWIR)/(NIR+SWIR)",
            "crs": "EPSG:32615 analysis grid; AOI supplied as EPSG:4326",
            "resampling": "none; synthetic bands share a grid",
        },
    }


@app.post("/api/analysis/import")
async def import_raster(request: Request):
    form = await request.form(max_files=1, max_fields=1, max_part_size=MAX_IMPORT_BYTES)
    aoi_raw = form.get("aoi")
    upload = form.get("file")
    if not isinstance(aoi_raw, str) or not isinstance(upload, UploadFile):
        raise HTTPException(422, "Upload a GeoTIFF and provide its field boundary.")
    import json

    try:
        aoi = json.loads(aoi_raw)
        _, area = validate_aoi(aoi, MAX_AOI_HA)
        raw = await upload.read(MAX_IMPORT_BYTES + 1)
        if len(raw) > MAX_IMPORT_BYTES:
            raise HTTPException(413, "GeoTIFF must be 20 MB or smaller.")
        with MemoryFile(raw) as memfile, memfile.open() as dataset:
            if (
                dataset.crs is None
                or dataset.count < 3
                or dataset.width * dataset.height > 5_000_000
            ):
                raise HTTPException(
                    422,
                    "GeoTIFF needs a CRS, 3 bands (red, NIR, SWIR), and at most 5 million pixels.",
                )
            transformed = transform_geom("EPSG:4326", dataset.crs, aoi)
            pixels, _ = raster_mask(
                dataset, [transformed], crop=True, indexes=[1, 2, 3], filled=False
            )
            valid = ~np.ma.getmaskarray(pixels).any(axis=0)
            red, nir, swir = [pixels[i].astype("float32") for i in range(3)]
            valid &= (
                np.isfinite(red)
                & np.isfinite(nir)
                & np.isfinite(swir)
                & ((nir + red) != 0)
                & ((nir + swir) != 0)
            )
            if not valid.any():
                raise HTTPException(422, "No valid pixels overlap this boundary.")
            ndvi = (nir - red) / (nir + red)
            ndmi = (nir - swir) / (nir + swir)
            reflectance = np.stack([red, nir, swir])
            if np.nanmin(reflectance) < 0 or np.nanmax(reflectance) > 1:
                raise HTTPException(
                    422, "Imported reflectance must be scaled to 0–1 before upload."
                )
            return {
                "source": "user-import",
                "source_label": "USER IMPORT · reflectance scale supplied by user",
                "area_ha": round(area, 2),
                "observations": [
                    {
                        "date": dataset.tags().get("ACQUISITION_DATE", "date not supplied"),
                        "ndvi": float(ndvi[valid].mean()),
                        "ndmi": float(ndmi[valid].mean()),
                        "pixel_count": int(valid.sum()),
                        "cloud_percent": None,
                        "resolution_m": None,
                        "mask": "dataset nodata/mask only",
                    }
                ],
                "provenance": {
                    "sensor": dataset.tags().get("SENSOR", "user supplied; unknown"),
                    "bands": "Band 1 red, band 2 NIR, band 3 SWIR; unit reflectance 0–1",
                    "processing_level": "user supplied; not independently verified",
                    "resolution_m": None,
                    "mask": "dataset nodata/mask only",
                    "formulas": "NDVI=(NIR−Red)/(NIR+Red); NDMI=(NIR−SWIR)/(NIR+SWIR)",
                    "crs": dataset.crs.to_string(),
                    "resampling": "none",
                },
            }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            422, "Could not read this GeoTIFF or clip it to the selected boundary."
        ) from exc


dist = Path(__file__).resolve().parent.parent / "dist"
if dist.is_dir():
    from fastapi.staticfiles import StaticFiles

    app.mount("/", StaticFiles(directory=dist, html=True), name="web")
