# Crude oil trade network robustness, 2021–2024 (Python backend)

FastAPI + numpy/scipy/python-igraph API, Node/Express static server and proxy, Docker Compose.

## Run
1. Copy the yearly BACI CSVs (columns `t,i,j,k,v,q`) into `data/` (year is read from the filename, e.g. `...Y2021...`).
   Optionally add `country_codes_V*.csv` for country names.
2. `docker compose up --build`, open http://localhost:3000.
   First start streams the CSVs and caches the crude-oil matrices in `data/cache/`.

Settings in docker-compose.yml: `HS_CODE` (2709), `WEIGHT` (`q` tonnes, `v` value). Flows with missing `q` are skipped when `WEIGHT=q`.

## Model
- Directed weighted network; edge i→j = crude oil exported by i to j in a year.
- Consumption is fixed: each surviving importer's demand = its baseline imports.
- After a removal, importers re-source the shortfall from surviving exporters, each shipping at most
  (1 + headroom) × baseline exports, via existing partners or (optionally) any exporter. Iterative proportional allocation.
- Metrics: unmet demand, share of countries >10% short, delivered volume, largest weakly connected component.
- Node orders: random (Monte Carlo mean), exports, imports, betweenness, supplier PageRank, optionally re-ranked after each removal.
  Edge orders: random, heaviest, lightest.
- Supply-shock tab: cut a country's exports (default Russia, 643) on each year's network.
- Removing an importer also removes its demand, so read "unmet demand" together with "delivered volume".

API: `GET /api/status|summary|countries|network?year=`, `POST /api/robustness|scenario`.
