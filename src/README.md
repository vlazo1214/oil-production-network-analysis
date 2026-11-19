# Crude oil trade network, 2021–2024

FastAPI + numpy/scipy/python-igraph backend, Node/Express static server and proxy, Docker Compose.

## Run
1. Put your cleaned CSV(s) in `data/`. Required columns:
   `year, exporter_code, exporter, importer_code, importer, product, value_kUSD, quantity_tons`
   One file with all years, or one file per year, both work: the year is read from the `year` column.
2. `docker compose up --build`, open http://localhost:3000.
   The first start aggregates the CSVs and caches the result in `data/cache/` (re-used until a file changes).

Settings (docker-compose.yml): `WEIGHT` = `q` (quantity_tons, default) or `v` (value_kUSD);
`PRODUCT` = optional exact match on the `product` column if the file holds more than one product.
Rows with missing or non-positive weights, and self-trade, are dropped. Country names come from the file itself.
Numeric country codes are used as-is; non-numeric codes (e.g. ISO3) are handled too.
Russia and Ukraine are found by name (falling back to codes 643 / 804).

## Model
- Directed weighted network; edge i→j = oil exported by i to j in a year.
- Consumption is fixed: each surviving importer's demand = its baseline imports.
- After a removal, importers re-source the shortfall from surviving exporters, each shipping at most
  (1 + headroom) × baseline exports, via existing partners or (optionally) any exporter. Iterative proportional allocation.
- Metrics: unmet demand, share of countries >10% short, delivered volume, largest connected component.
- Node orders: random (Monte Carlo mean), exports, imports, betweenness, supplier PageRank, optionally re-ranked after each removal.
  Edge orders: random, busiest, smallest.
- Removing an importer also removes its demand, so read "unmet demand" together with "volume delivered".
- Edge removal does not reduce exporter capacity, so with "new suppliers" on it is mostly absorbed; leave it off to see route fragility.

API: `GET /api/status|summary|countries|network?year=|country?year=&code=`, `POST /api/robustness|scenario`.
