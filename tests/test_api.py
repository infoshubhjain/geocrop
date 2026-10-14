import json

import anyio
import httpx
import numpy as np
import pytest
from fastapi.testclient import TestClient
from rasterio.io import MemoryFile
from rasterio.transform import from_origin

from geocrop.api import app

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


def test_api_errors_and_headers_are_safe():
    response = client.get("/api/health")
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["x-frame-options"] == "DENY"


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
