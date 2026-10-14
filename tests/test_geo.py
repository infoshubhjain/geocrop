from datetime import date

import pytest

from geocrop.geo import GRID_SHAPE, GRID_TRANSFORM, synthetic_scene, validate_aoi, validate_dates
from geocrop.live import index_summary

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


def test_sample_boundary_area_is_plausible():
    geom, area = validate_aoi(SAMPLE)
    assert geom.is_valid
    assert 40 < area < 80


def test_invalid_geometry_and_antimeridian_are_rejected():
    with pytest.raises(ValueError, match="valid"):
        validate_aoi({"type": "Polygon", "coordinates": [[[0, 0], [1, 1], [0, 1], [1, 0], [0, 0]]]})
    with pytest.raises(ValueError, match="antimeridian"):
        validate_aoi(
            {
                "type": "Polygon",
                "coordinates": [[[179, 1], [-179, 1], [-179, 2], [179, 2], [179, 1]]],
            }
        )


def test_dates_have_inclusive_order_and_span_bounds():
    validate_dates(date(2024, 1, 1), date(2024, 1, 1))
    with pytest.raises(ValueError, match="on or after"):
        validate_dates(date(2024, 2, 1), date(2024, 1, 1))
    with pytest.raises(ValueError, match="limited"):
        validate_dates(date(2020, 1, 1), date(2024, 1, 1))


def test_synthetic_raster_is_aligned_bounded_masked_and_repeatable():
    geom, _ = validate_aoi(SAMPLE)
    a = synthetic_scene(2, geom)
    assert a == synthetic_scene(2, geom)
    assert GRID_SHAPE == (100, 100)
    assert GRID_TRANSFORM.a == 10 and GRID_TRANSFORM.e == -10
    assert a["pixel_count"] > 0
    assert 0 <= a["cloud_percent"] < 100
    assert 0 <= a["nodata_percent"] < 100
    assert -1 <= a["ndvi"] <= 1 and -1 <= a["ndmi"] <= 1


def test_live_ndvi_uses_cloud_and_nodata_masks_and_reports_pixel_counts():
    result = index_summary(
        [[0.1, 0.2], [0.0, 0.1]],
        [[0.3, 0.2], [0.0, 0.3]],
        [[4, 9], [0, 4]],
    )
    assert result["pixel_count"] == 2
    assert result["masked_pixel_count"] == 2
    assert result["ndvi"] == pytest.approx(0.5)
    assert result["cloud_percent"] == 25
    assert result["ndvi_percentiles"]["p50"] == pytest.approx(0.5)


def test_live_ndvi_rejects_a_fully_masked_scene():
    with pytest.raises(ValueError, match="No valid, cloud-free"):
        index_summary([[0.1]], [[0.4]], [[9]])
