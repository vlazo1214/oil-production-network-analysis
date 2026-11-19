import os, re, json, pickle, hashlib, threading, logging
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path
from typing import Literal, Optional

import numpy as np
import pandas as pd
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

import sim

log = logging.getLogger("uvicorn.error")
DATA = Path(os.environ.get("DATA_DIR", "/data"))
# Expected columns: year, exporter_code, exporter, importer_code, importer, product, value_kUSD, quantity_tons
WEIGHT = "v" if os.environ.get("WEIGHT", "q").lower() in ("v", "value", "value_kusd") else "q"
WCOL = {"q": "quantity_tons", "v": "value_kUSD"}[WEIGHT]
PRODUCT = os.environ.get("PRODUCT") or None      # optional: keep only rows whose `product` equals this

NETS: dict[int, dict] = {}                       # year -> {codes, names, W}
NAMES: dict[int, str] = {}
STATE = {"status": "loading"}
FOCUS: dict = {"russia": None, "ukraine": None}
PRODUCTS: list = []
CACHE: dict = {}
POOL = ProcessPoolExecutor(max_workers=os.cpu_count() or 2)

app = FastAPI()


@app.exception_handler(RequestValidationError)
async def _bad(_: Request, e: RequestValidationError):
    return JSONResponse({"error": "; ".join(f"{'.'.join(map(str, x['loc'][1:]))}: {x['msg']}" for x in e.errors())}, 400)


# ------------------------------------------------------------------ data loading
def _clean_code(col):
    return col.astype(str).str.strip().str.replace(r"\.0$", "", regex=True)


def read_all():
    """Read every CSV in DATA into {year: (codes, W)}. Cached on file size/mtime so restarts are fast."""
    files = sorted(DATA.glob("*.csv"))
    if not files:
        raise FileNotFoundError(f"no CSV files found in {DATA}")
    sig = hashlib.md5(json.dumps([[f.name, f.stat().st_size, int(f.stat().st_mtime)] for f in files] + [WCOL, PRODUCT]).encode()).hexdigest()[:12]
    cache = DATA / "cache" / f"nets_{sig}.pkl"
    if cache.exists():
        return pickle.loads(cache.read_bytes())

    need = ["year", "exporter_code", "importer_code", WCOL]
    parts, names, products = [], {}, set()
    for f in files:
        header = pd.read_csv(f, nrows=0).columns
        missing = [c for c in need if c not in header]
        if missing:
            raise ValueError(f"{f.name}: missing column(s) {missing}; found {list(header)}")
        use = [c for c in ["year", "exporter_code", "exporter", "importer_code", "importer", "product", WCOL] if c in header]
        for ch in pd.read_csv(f, usecols=use, chunksize=1_000_000, na_values=["NA", ""],
                              dtype={"exporter_code": str, "importer_code": str}):
            STATE["status"] = f"reading {f.name}"
            if PRODUCT and "product" in ch:
                ch = ch[ch["product"].astype(str) == PRODUCT]
            if "product" in ch:
                products.update(ch["product"].dropna().astype(str).unique())
            ch = ch.assign(i=_clean_code(ch["exporter_code"]), j=_clean_code(ch["importer_code"]),
                           year=pd.to_numeric(ch["year"], errors="coerce"), w=pd.to_numeric(ch[WCOL], errors="coerce"))
            for side, code in (("exporter", "i"), ("importer", "j")):
                if side in ch:
                    names.update(ch[[code, side]].dropna().drop_duplicates(code).itertuples(index=False, name=None))
            ch = ch.dropna(subset=["year", "w", "i", "j"])
            ch = ch[(ch["w"] > 0) & (ch["i"] != ch["j"])]
            parts.append(ch.groupby([ch["year"].astype(int), "i", "j"], as_index=False)["w"].sum())
    df = pd.concat(parts).groupby(["year", "i", "j"], as_index=False)["w"].sum()
    if df.empty:
        raise ValueError("no usable rows (check the product filter and that quantities are positive)")

    # numeric country codes are used as-is; otherwise (e.g. ISO3) assign ids and keep the labels as names
    raw = sorted(set(df["i"]) | set(df["j"]))
    if all(re.fullmatch(r"\d+", c) for c in raw):
        idmap = {c: int(c) for c in raw}
    else:
        idmap = {c: k + 1 for k, c in enumerate(raw)}
    nm = {idmap[c]: str(names.get(c, c)) for c in raw}
    nets = {}
    for year, g in df.groupby("year"):
        a = g["i"].map(idmap).to_numpy()
        b = g["j"].map(idmap).to_numpy()
        codes = np.union1d(a, b)
        W = np.zeros((len(codes), len(codes)))
        W[np.searchsorted(codes, a), np.searchsorted(codes, b)] = g["w"].to_numpy()
        nets[int(year)] = (codes, W)
    out = {"nets": nets, "names": nm, "products": sorted(products)}
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_bytes(pickle.dumps(out))
    return out


def find_focus():
    def find(key, default):
        for c, n in NAMES.items():
            if key in n.lower():
                return int(c)
        return default if any(default in n["codes"] for n in NETS.values()) else None
    FOCUS["russia"], FOCUS["ukraine"] = find("russia", 643), find("ukraine", 804)


def load_all():
    try:
        if not DATA.is_dir():
            raise FileNotFoundError(f"DATA_DIR {DATA} not found")
        d = read_all()
        NAMES.update(d["names"])
        PRODUCTS[:] = d["products"]
        if len(PRODUCTS) > 1:
            log.warning("file contains %d distinct products (%s ...); set PRODUCT to filter", len(PRODUCTS), PRODUCTS[:3])
        for year, (codes, W) in sorted(d["nets"].items()):
            NETS[year] = {"codes": codes, "names": [NAMES.get(int(c), str(c)) for c in codes], "W": W}
            log.info("loaded %s: %d countries, %d links", year, len(codes), int((W > 0).sum()))
        find_focus()
        STATE["status"] = "ready"
    except Exception as e:
        STATE["status"] = f"error: {e}"
        log.exception("loading failed")


@app.on_event("startup")
def _startup():
    threading.Thread(target=load_all, daemon=True).start()


def years():
    return sorted(NETS)


def ready_or_503():
    if STATE["status"] != "ready":
        return JSONResponse({"error": f"data not ready: {STATE['status']}"}, 503)


def pick_years(req_years: Optional[list[int]]):
    ys = req_years or years()
    bad = [y for y in ys if y not in NETS]
    if bad:
        raise ValueError(f"unknown year(s): {bad}")
    return ys


# ------------------------------------------------------------------ endpoints
@app.get("/api/status")
def status():
    return {"status": STATE["status"], "years": years(), "weight": WEIGHT, "focus": FOCUS, "products": PRODUCTS[:5]}


@app.get("/api/summary")
def summary():
    if (r := ready_or_503()): return r
    if "summary" not in CACHE:
        CACHE["summary"] = {str(y): sim.year_summary(n["codes"], n["names"], n["W"], FOCUS["russia"], FOCUS["ukraine"]) for y, n in sorted(NETS.items())}
    return CACHE["summary"]


@app.get("/api/countries")
def countries():
    if (r := ready_or_503()): return r
    d = {int(c): nm for n in NETS.values() for c, nm in zip(n["codes"], n["names"])}
    return sorted(({"code": c, "name": nm} for c, nm in d.items()), key=lambda x: x["name"])


@app.get("/api/network")
def network(year: Optional[int] = None):
    if (r := ready_or_503()): return r
    year = year or years()[0]
    if year not in NETS:
        return JSONResponse({"error": "unknown year"}, 404)
    if ("net", year) not in CACHE:
        n = NETS[year]
        CACHE[("net", year)] = sim.network_payload(n["codes"], n["names"], n["W"], year)
    return CACHE[("net", year)]


@app.get("/api/country")
def country(year: int, code: int):
    """Profile of one country in one year: volumes, ranks, main partners, and its history across years."""
    if (r := ready_or_503()): return r
    if year not in NETS:
        return JSONResponse({"error": "unknown year"}, 404)
    n = NETS[year]
    idx = np.flatnonzero(n["codes"] == code)
    if not len(idx):
        return JSONResponse({"error": "country does not trade in this year"}, 404)
    i, W, tot = int(idx[0]), n["W"], n["W"].sum()
    ex, im = W.sum(1), W.sum(0)

    def partners(v):
        return [{"code": int(n["codes"][k]), "name": n["names"][k], "volume": float(v[k]), "share": float(100 * v[k] / v.sum())}
                for k in np.argsort(v)[::-1][:6] if v[k] > 0]

    hist = {}
    for y, m in sorted(NETS.items()):
        k = np.flatnonzero(m["codes"] == code)
        e = float(m["W"][k[0]].sum()) if len(k) else 0.0
        im_ = float(m["W"][:, k[0]].sum()) if len(k) else 0.0
        hist[str(y)] = {"exports": e, "imports": im_, "export_share": 100 * e / m["W"].sum()}
    return {"code": code, "name": n["names"][i], "year": year, "exports": float(ex[i]), "imports": float(im[i]),
            "export_share": float(100 * ex[i] / tot), "import_share": float(100 * im[i] / tot),
            "export_rank": int((ex > ex[i]).sum() + 1) if ex[i] > 0 else None,
            "import_rank": int((im > im[i]).sum() + 1) if im[i] > 0 else None,
            "n_buyers": int((W[i] > 0).sum()), "n_suppliers": int((W[:, i] > 0).sum()),
            "top_buyers": partners(W[i]) if ex[i] > 0 else [], "top_suppliers": partners(W[:, i]) if im[i] > 0 else [],
            "history": hist}


class RobReq(BaseModel):
    mode: Literal["node", "edge"] = "node"
    years: Optional[list[int]] = None
    strategies: list[str] = ["random"]
    steps: int = Field(20, ge=2, le=100)
    max_frac: float = Field(0.2, gt=0, le=1)
    runs: int = Field(10, ge=1, le=200)
    adaptive: bool = False
    surge: float = Field(0.1, ge=0, le=5)
    newlinks: bool = False


@app.post("/api/robustness")
def robustness(b: RobReq):
    if (r := ready_or_503()): return r
    try:
        ys = pick_years(b.years)
        allowed = sim.NODE_STRATS if b.mode == "node" else sim.EDGE_STRATS
        if not b.strategies or any(s not in allowed for s in b.strategies):
            raise ValueError(f"strategies for {b.mode} mode must be from {allowed}")
    except ValueError as e:
        return JSONResponse({"error": str(e)}, 400)
    jobs = [(y, s, POOL.submit(sim.curve, NETS[y]["W"], b.mode, s, b.steps, b.max_frac, b.runs, b.adaptive,
                               b.surge, b.newlinks, 42 + q)) for q, (y, s) in enumerate((y, s) for y in ys for s in b.strategies)]
    res: dict = {}
    for y, s, fut in jobs:
        res.setdefault(str(y), {})[s] = fut.result()
    return {"results": res}


class Cut(BaseModel):
    code: int
    reduction: float = Field(1.0, ge=0, le=1)


class ScReq(BaseModel):
    years: Optional[list[int]] = None
    countries: list[Cut] = []
    surge: float = Field(0.1, ge=0, le=5)
    newlinks: bool = True


@app.post("/api/scenario")
def scenario(b: ScReq):
    if (r := ready_or_503()): return r
    try:
        ys = pick_years(b.years)
    except ValueError as e:
        return JSONResponse({"error": str(e)}, 400)
    reds = {c.code: c.reduction for c in b.countries}
    return {"results": {str(y): sim.scenario(NETS[y]["codes"], NETS[y]["names"], NETS[y]["W"], reds, b.surge, b.newlinks) for y in ys}}
