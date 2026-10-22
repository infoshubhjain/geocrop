from __future__ import annotations

import asyncio
import json
import os
import time
from collections import defaultdict
from contextlib import AsyncExitStack
from datetime import date
from pathlib import Path
from urllib.parse import quote, urlparse

import httpx
import numpy as np
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from rasterio.io import MemoryFile
from rasterio.mask import mask as raster_mask
from rasterio.warp import transform_geom
from starlette.datastructures import UploadFile

from .example import METADATA as EXAMPLE_METADATA
from .example import analyze_example
from .geo import supports_synthetic, synthetic_scene, validate_aoi, validate_dates
from .live import MAX_LIVE_PIXELS, analyze_cogs

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
BODY_SLOTS = asyncio.Semaphore(4)
# Large rasters expand into several arrays; keep one import in memory at a time.
IMPORT_SLOTS = asyncio.Semaphore(1)
LIVE_SLOTS = asyncio.Semaphore(2)
app = FastAPI(title="GeoCrop API", version="0.1.0")
# shortcut: process-local cache is ephemeral; use shared storage if running multiple replicas.
cache: dict[str, tuple[float, dict]] = {}
# shortcut: process-local rate limits are per worker; put a shared gateway in front before scaling.
requests_by_ip: dict[str, list[float]] = defaultdict(list)


class AnalysisRequest(BaseModel):
    aoi: dict
    start: date
    end: date


class LiveAnalysisRequest(BaseModel):
    aoi: dict
    item_id: str = Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9._-]+$")


class ExampleAnalysisRequest(BaseModel):
    aoi: dict


async def bounded_json(
    client: httpx.AsyncClient,
    url: str,
    *,
    method: str = "GET",
    json_body: dict | None = None,
    params: dict | None = None,
    limit: int = 1_000_000,
) -> dict:
    async with client.stream(method, url, json=json_body, params=params) as response:
        response.raise_for_status()
        if int(response.headers.get("content-length", "0") or 0) > limit:
            raise ValueError("Provider response exceeded its size limit.")
        chunks, size = [], 0
        async for chunk in response.aiter_bytes():
            size += len(chunk)
            if size > limit:
                raise ValueError("Provider response exceeded its size limit.")
            chunks.append(chunk)
    return json.loads(b"".join(chunks))


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
            "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://server.arcgisonline.com https://tile.openstreetmap.org https://planetarycomputer.microsoft.com; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
        }
    )
    return response


@app.get("/api/health")
async def health():
    return {"status": "ok", "provider": "Microsoft Planetary Computer STAC", "demo": "available"}


@app.post("/api/catalog/search")
async def search(payload: AnalysisRequest):
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
            for attempt in range(2):
                try:
                    data = await bounded_json(
                        client, f"{STAC_URL}/search", method="POST", json_body=body
                    )
                    break
                except (httpx.TimeoutException, httpx.NetworkError, httpx.HTTPStatusError):
                    if attempt == 1:
                        raise
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


@app.post("/api/analysis/live")
async def live_analysis(payload: LiveAnalysisRequest):
    try:
        geom, area = validate_aoi(payload.aoi, MAX_AOI_HA)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    item_url = f"{STAC_URL}/collections/sentinel-2-l2a/items/{quote(payload.item_id, safe='')}"
    sas_url = "https://planetarycomputer.microsoft.com/api/sas/v1/sign"
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(8), follow_redirects=False) as client:
            item = await bounded_json(client, item_url)
            if item.get("collection") != "sentinel-2-l2a" or item.get("id") != payload.item_id:
                raise ValueError(
                    "Selected record is not a Sentinel-2 L2A scene from the configured catalog."
                )
            asset_data = item.get("assets", {})
            hrefs = {}
            scales = {}
            for name in ("B04", "B08", "SCL"):
                asset = asset_data.get(name)
                href = asset.get("href") if isinstance(asset, dict) else None
                parsed = urlparse(href or "")
                if (
                    parsed.scheme != "https"
                    or not parsed.hostname
                    or not parsed.hostname.endswith(".blob.core.windows.net")
                ):
                    raise ValueError(
                        f"The scene has no supported public {name} Cloud-Optimized GeoTIFF asset."
                    )
                if name != "SCL":
                    band = (asset.get("raster:bands") or [{}])[0]
                    scales[name] = (float(band.get("scale", 0.0001)), float(band.get("offset", 0)))
                hrefs[name] = href

            async def sign(href: str) -> str:
                signed = (
                    await bounded_json(client, sas_url, params={"href": href}, limit=50_000)
                ).get("href")
                signed_parsed = urlparse(signed or "")
                if (
                    signed_parsed.scheme != "https"
                    or signed_parsed.hostname != urlparse(href).hostname
                    or not signed_parsed.query
                ):
                    raise ValueError("Planetary Computer returned an invalid signed asset URL.")
                return signed

            signed_hrefs = await asyncio.gather(
                *(sign(hrefs[name]) for name in ("B04", "B08", "SCL"))
            )
        async with LIVE_SLOTS:
            stats = await asyncio.to_thread(
                analyze_cogs, geom.__geo_interface__, *signed_hrefs, scales
            )
    except HTTPException:
        raise
    except (
        httpx.HTTPError,
        ValueError,
        KeyError,
        TypeError,
        OSError,
        RuntimeError,
        TimeoutError,
    ) as exc:
        message = (
            str(exc)
            if isinstance(exc, ValueError)
            else "The live Sentinel-2 scene could not be processed. Try another scene or use the explicitly labeled demo/import workflows."
        )
        raise HTTPException(502, message) from exc
    props = item.get("properties", {})
    year = str(props.get("datetime", ""))[:4]
    if len(year) != 4 or not year.isdigit():
        raise HTTPException(502, "Selected scene has no valid acquisition year.")
    attribution = f"Contains modified Copernicus Sentinel data {year}"
    return {
        "source": "live-sentinel-pixels",
        "source_label": f"LIVE SENTINEL-2 PIXEL ANALYSIS · {attribution} · not agronomic diagnosis",
        "area_ha": round(area, 2),
        "observations": [
            {
                "date": (props.get("datetime") or "")[:10],
                "scene_id": payload.item_id,
                "acquired": props.get("datetime"),
                **stats,
                "scene_cloud_percent": props.get("eo:cloud_cover"),
                "ndmi": None,
                "mask": "SCL classes 0,1,2,3,7,8,9,10,11 excluded; only valid AOI pixels summarized",
            }
        ],
        "provenance": {
            "provider": "Microsoft Planetary Computer / Copernicus Sentinel-2 L2A",
            "attribution": attribution,
            "collection": "sentinel-2-l2a",
            "scene_id": payload.item_id,
            "acquired": props.get("datetime"),
            "scene_cloud_percent": props.get("eo:cloud_cover"),
            "bands": "B04 red and B08 NIR (10 m); SCL (20 m, nearest-neighbor aligned)",
            "reflectance_scale": {
                "B04": {"scale": scales["B04"][0], "offset": scales["B04"][1]},
                "B08": {"scale": scales["B08"][0], "offset": scales["B08"][1]},
                "fallback": "scale 0.0001 and offset 0 when STAC raster:bands metadata is absent",
            },
            "index": "NDVI=(NIR−Red)/(NIR+Red), unitless; p10/p50/p90 and mean over valid pixels",
            "valid_pixels": stats["pixel_count"],
            "masked_pixels": stats["masked_pixel_count"],
            "processing_limit": f"At most {MAX_LIVE_PIXELS:,} pixels in the B04 scene window",
            "processing_grid": stats["processing_grid"],
            "crs": stats["crs"],
            "coverage_note": "Only pixels overlapping this AOI and selected scene were processed; mixed pixels, cloud-mask errors, and crop-stage interpretation remain possible.",
        },
    }


@app.post("/api/analysis/demo")
async def demo(payload: AnalysisRequest):
    geom, area = checked(payload)
    if not supports_synthetic(geom):
        raise HTTPException(
            422, "Synthetic demo covers only the sample Iowa field. Reset the boundary to use it."
        )
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


@app.post("/api/analysis/example")
async def example_analysis(payload: ExampleAnalysisRequest):
    try:
        geom, area = validate_aoi(payload.aoi, MAX_AOI_HA)
        summary = analyze_example(geom)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    return {
        "source": "bundled-sentinel-example",
        "source_label": f"BUNDLED SENTINEL-2 EXAMPLE · {EXAMPLE_METADATA['attribution']}",
        "area_ha": round(area, 2),
        "observations": [
            {
                "date": EXAMPLE_METADATA["acquired"][:10],
                "scene_id": EXAMPLE_METADATA["scene_id"],
                "acquired": EXAMPLE_METADATA["acquired"],
                "ndmi": None,
                "resolution_m": 10,
                "mask": "Sentinel-2 L2A SCL cloud, shadow, snow, unclassified, and nodata classes excluded",
                **summary,
            }
        ],
        "provenance": {
            "provider": "Copernicus Sentinel-2 L2A via Microsoft Planetary Computer",
            "attribution": EXAMPLE_METADATA["attribution"],
            "scene_id": EXAMPLE_METADATA["scene_id"],
            "acquired": EXAMPLE_METADATA["acquired"],
            "stac_url": EXAMPLE_METADATA["stac_url"],
            "processing": EXAMPLE_METADATA["processing"],
            "coverage_note": "Bundled historical scene; values describe only selected, valid pixels on the acquisition date, not current crop health.",
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
            if any(np.any((band[valid] < 0) | (band[valid] > 1)) for band in (red, nir, swir)):
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


class ApiBodyLimitMiddleware:
    def __init__(self, downstream):
        self.downstream = downstream

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or not scope.get("path", "").startswith("/api/"):
            return await self.downstream(scope, receive, send)
        importing = scope["path"] == "/api/analysis/import"
        limit = MAX_IMPORT_BYTES + 100_000 if importing else 1_000_000
        async with AsyncExitStack() as stack:
            await stack.enter_async_context(BODY_SLOTS)
            if importing:
                await stack.enter_async_context(IMPORT_SLOTS)
            chunks = []
            size = 0
            while True:
                message = await receive()
                if message["type"] == "http.disconnect":
                    return
                if message["type"] != "http.request":
                    continue
                chunk = message.get("body", b"")
                size += len(chunk)
                if size > limit:
                    response = JSONResponse(
                        {"detail": "Request body is too large."}, status_code=413
                    )
                    return await response(scope, receive, send)
                chunks.append(chunk)
                if not message.get("more_body", False):
                    break
            body = b"".join(chunks)
            replay = True

            async def replay_receive():
                nonlocal replay
                if replay:
                    replay = False
                    return {"type": "http.request", "body": body, "more_body": False}
                return await receive()

            return await self.downstream(scope, replay_receive, send)


app = ApiBodyLimitMiddleware(app)
