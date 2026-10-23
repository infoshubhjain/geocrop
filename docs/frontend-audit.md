# Frontend release audit — GeoCrop satellite field notebook

Checked 2026-10-23 against the previous committed redesign (`HEAD` before this release) and the current working build.

## Product and information architecture

- Primary user job: explore a labeled example, adjust or select the domain input, inspect a defensible result, and export enough provenance to reproduce it.
- Reading order: Boundary selection and source provenance lead; vegetation metrics, scene series, and downloads follow.
- Interaction corrected in this release: Selecting a scene updates headline NDVI, cloud and valid pixel metrics, scene details, and the chart marker from that scene.
- Technical implementation: existing frontend and API architecture was retained. No new runtime dependency was added.

## Evidence

| Check                     | Result                                                                                                                                       |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Previous build JavaScript | 52715 gzip bytes                                                                                                                             |
| Current build JavaScript  | 52737 gzip bytes (+22)                                                                                                                       |
| Current build CSS         | 10841 gzip bytes                                                                                                                             |
| Browser and API checks    | 10 browser tests passed, including real bundled Sentinel example, chronological scene selection, stale response handling, and mobile layout. |
| Screenshots               | See the README linked desktop and mobile captures generated from the current browser flow.                                                   |

Bundle measurements sum the compressed generated `assets/*.js` and `assets/*.css` files. They do not measure first-load latency, network transfer on a specific host, or main-thread work. The previous build was reproduced from the prior commit in an isolated temporary checkout with the same installed dependencies.

## Accessibility and responsive review

- Core controls use visible labels or accessible names. The new selection state uses native buttons/slider controls or an explicit map clear button.
- Browser checks exercise the core flow and phone/tablet widths; existing full-page screenshots are kept with the repo.
- Data remain available in text, tables, or exports when charts or maps cannot be interpreted.
- A formal WCAG audit with assistive technology and automated contrast/axe tooling has not been completed. This remains a release follow-up before claiming accessibility conformance.

## Scientific and operational limits

NDVI is a reflectance index, not a yield estimate or agronomic diagnosis. Live catalog and imagery depend on third-party availability. No screenshot, synthetic example, or model output is evidence of field validation. Public hosting and external data availability are tracked in the README/deployment docs.

## Release checks

- [x] Displayed selection and chart/data agree in browser tests.
- [x] Existing unit/API tests and production build pass.
- [x] Responsive browser workflow passes.
- [ ] Repeat a manual screen-reader review and public-host latency measurement after deployment.
