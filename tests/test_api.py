import json

import anyio
import httpx
import numpy as np
import pytest
from fastapi.testclient import TestClient
from rasterio.io import MemoryFile
from rasterio.transform import from_origin

from geocrop import api as api_module
from geocrop.api import app, bounded_json
from geocrop.live import analyze_cogs

client = TestClient(app)
SAMPLE = {
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
BODY = {"aoi": SAMPLE, "start": "2024-04-01", "end": "2024-09-30"}


def test_health_and_demo_response():
    assert client.get("/api/health").json()["status"] == "ok"
    response = client.post("/api/analysis/demo", json=BODY)
    assert response.status_code == 200
    data = response.json()
    assert data["source"] == "synthetic-demo"
    assert data["source_label"].startswith("SYNTHETIC DEMO")
    assert len(data["observations"]) == 6
    assert data["provenance"]["crs"]
    assert all(
        o["cloud_percent"] is not None and o["ndmi"] is not None for o in data["observations"]
    )


def test_synthetic_demo_rejects_areas_outside_its_sample_grid():
    elsewhere = {
        **BODY,
        "aoi": {
            "type": "Polygon",
            "coordinates": [
                [
                    [-122.42, 37.77],
                    [-122.41, 37.77],
                    [-122.41, 37.78],
                    [-122.42, 37.78],
                    [-122.42, 37.77],
                ]
            ],
        },
    }
    response = client.post("/api/analysis/demo", json=elsewhere)
    assert response.status_code == 422
    assert "sample Iowa field" in response.json()["detail"]


def test_api_rejects_bad_aoi_and_long_date_range():
    bad = {**BODY, "aoi": {"type": "Point", "coordinates": [0, 0]}}
    assert client.post("/api/analysis/demo", json=bad).status_code == 422
    long = {**BODY, "start": "2020-01-01", "end": "2024-01-01"}
    assert client.post("/api/catalog/search", json=long).status_code == 422


def test_json_body_limit_rejects_chunked_requests_without_content_length():
    async def check():
        async def body():
            yield b'{"padding":"'
            yield b"x" * 1_000_001
            yield b'"}'

        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as streamed:
            response = await streamed.post(
                "/api/catalog/search",
                content=body(),
                headers={"Content-Type": "application/json"},
            )
        assert response.status_code == 413
        assert response.json()["detail"] == "Request body is too large."

    anyio.run(check)


def test_provider_json_reader_enforces_streamed_response_limit():
    async def check():
        async def respond(_request):
            return httpx.Response(200, content=b'{"padding":"123456"}')

        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as mocked:
            with pytest.raises(ValueError, match="response exceeded"):
                await bounded_json(mocked, "https://example.test/item", limit=8)

    anyio.run(check)


def test_api_errors_and_headers_are_safe():
    response = client.get("/api/health")
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["x-frame-options"] == "DENY"


def test_live_endpoint_validates_scene_identity_before_provider_access():
    response = client.post("/api/analysis/live", json={"aoi": SAMPLE, "item_id": "invalid/id"})
    assert response.status_code == 422


def test_live_catalog_and_analysis_validate_provider_assets_and_hide_signed_urls(monkeypatch):
    original_client = httpx.AsyncClient
    analyzed_hrefs = []

    def respond(request):
        if request.url.path.endswith("/search"):
            assert request.method == "POST"
            return httpx.Response(
                200,
                json={
                    "features": [
                        {
                            "id": "scene-1",
                            "properties": {"datetime": "2024-06-01T10:00:00Z"},
                            "assets": {"B04": {}, "B08": {}, "SCL": {}},
                        }
                    ]
                },
            )
        if request.url.path.endswith("/items/scene-1"):
            assets = {
                name: {"href": f"https://sample.blob.core.windows.net/{name}.tif"}
                for name in ("B04", "B08", "SCL")
            }
            return httpx.Response(
                200,
                json={
                    "collection": "sentinel-2-l2a",
                    "id": "scene-1",
                    "properties": {"datetime": "2024-06-01T10:00:00Z"},
                    "assets": assets,
                },
            )
        if request.url.path.endswith("/sign"):
            return httpx.Response(200, json={"href": request.url.params["href"] + "?sig=private"})
        raise AssertionError(f"Unexpected provider request: {request.url}")

    monkeypatch.setattr(
        api_module.httpx,
        "AsyncClient",
        lambda **kwargs: original_client(transport=httpx.MockTransport(respond), **kwargs),
    )

    def analyze(_aoi, *hrefs_and_scales):
        analyzed_hrefs.extend(hrefs_and_scales[:3])
        return {
            "ndvi": 0.6,
            "ndvi_percentiles": {"p10": 0.5, "p50": 0.6, "p90": 0.7},
            "pixel_count": 10,
            "masked_pixel_count": 2,
            "cloud_percent": 0.0,
            "nodata_percent": 0.0,
            "resolution_m": 10,
            "crs": "EPSG:32615",
            "processing_grid": "B04 grid",
        }

    monkeypatch.setattr(api_module, "analyze_cogs", analyze)
    search = client.post("/api/catalog/search", json=BODY)
    assert search.status_code == 200
    assert search.json()["items"][0]["id"] == "scene-1"
    result = client.post("/api/analysis/live", json={"aoi": SAMPLE, "item_id": "scene-1"})
    assert result.status_code == 200, result.text
    assert result.json()["observations"][0]["ndvi"] == pytest.approx(0.6)
    assert len(analyzed_hrefs) == 3 and all("sig=private" in href for href in analyzed_hrefs)
    assert "sig=private" not in result.text


def test_cog_analysis_aligns_20m_assets_to_10m_roi_grid():
    assets = []
    for resolution, value, dtype in [(10, 0.1, "float32"), (20, 0.4, "float32"), (20, 4, "uint8")]:
        size = 100 // resolution
        profile = {
            "driver": "GTiff",
            "height": size,
            "width": size,
            "count": 1,
            "dtype": dtype,
            "crs": "EPSG:32615",
            "transform": from_origin(458000, 4617000, resolution, resolution),
        }
        memory = MemoryFile()
        with memory.open(**profile) as dataset:
            dataset.write(np.full((size, size), value, dtype=dtype), 1)
        assets.append(memory)
    try:
        result = analyze_cogs(
            SAMPLE, *(asset.name for asset in assets), {"B04": (1, 0), "B08": (1, 0)}
        )
    finally:
        for asset in assets:
            asset.close()
    assert result["resolution_m"] == 10
    assert result["processing_grid"].startswith("B04 native 10 m")
    assert result["pixel_count"] > 0
    assert result["ndvi"] == pytest.approx(0.6)


def test_import_calculates_indices_and_rejects_unscaled_reflectance():
    profile = {
        "driver": "GTiff",
        "height": 100,
        "width": 100,
        "count": 3,
        "dtype": "float32",
        "crs": "EPSG:32615",
        "transform": from_origin(458000, 4617000, 10, 10),
    }
    with MemoryFile() as memory:
        with memory.open(**profile) as dataset:
            dataset.write(np.full((100, 100), 0.1, dtype="float32"), 1)
            dataset.write(np.full((100, 100), 0.4, dtype="float32"), 2)
            dataset.write(np.full((100, 100), 0.2, dtype="float32"), 3)
        tif = memory.read()
    response = client.post(
        "/api/analysis/import",
        data={"aoi": json.dumps(SAMPLE)},
        files={"file": ("fixture.tif", tif, "image/tiff")},
    )
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["source"] == "user-import"
    assert data["observations"][0]["ndvi"] == pytest.approx(0.6)
    assert data["observations"][0]["ndmi"] == pytest.approx(1 / 3)

    with MemoryFile() as memory:
        with memory.open(**profile) as dataset:
            dataset.write(np.full((100, 100), 1000, dtype="float32"), 1)
            dataset.write(np.full((100, 100), 4000, dtype="float32"), 2)
            dataset.write(np.full((100, 100), 2000, dtype="float32"), 3)
        unscaled = memory.read()
    response = client.post(
        "/api/analysis/import",
        data={"aoi": json.dumps(SAMPLE)},
        files={"file": ("unscaled.tif", unscaled, "image/tiff")},
    )
    assert response.status_code == 422
    assert "scaled to 0–1" in response.json()["detail"]
