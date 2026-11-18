import os, re, threading, logging
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
HS = int(os.environ.get("HS_CODE", "2709"))
WEIGHT = os.environ.get("WEIGHT", "q")          # q = tonnes, v = value (k USD)

NETS: dict[int, dict] = {}                       # year -> {codes, names, W}
NAMES: dict[int, str] = {}
STATE = {"status": "loading"}
CACHE: dict = {}
POOL = ProcessPoolExecutor(max_workers=os.cpu_count() or 2)

app = FastAPI()


@app.exception_handler(RequestValidationError)
async def _bad(_: Request, e: RequestValidationError):
    return JSONResponse({"error": "; ".join(f"{'.'.join(map(str, x['loc'][1:]))}: {x['msg']}" for x in e.errors())}, 400)


# ------------------------------------------------------------------ data loading
def load_names():
    for f in DATA.glob("country_codes*.csv"):
        try:
            df = pd.read_csv(f)
            col = next(c for c in ("country_name_abbreviation", "country_name", "country_name_full") if c in df)
            NAMES.update(zip(df["country_code"].astype(int), df[col].astype(str)))
        except Exception as e:
            log.warning("could not read %s: %s", f, e)


def read_year(path: Path, year: int):
    cache = DATA / "cache" / f"net_{year}_{HS}_{WEIGHT}.npz"
    if cache.exists():
        z = np.load(cache)
        return z["codes"], z["W"]
    parts = []
    for ch in pd.read_csv(path, usecols=["i", "j", "k", "v", "q"], chunksize=2_000_000,
                          dtype={"i": "int64", "j": "int64", "k": "int64", "v": "float64", "q": "float64"},
                          na_values=["NA", ""]):
        ch = ch[ch["k"] // 100 == HS][["i", "j", WEIGHT]].dropna()
        parts.append(ch[(ch[WEIGHT] > 0) & (ch["i"] != ch["j"])])
    df = pd.concat(parts).groupby(["i", "j"], as_index=False)[WEIGHT].sum()
    if df.empty:
        raise ValueError(f"no HS {HS} flows found in {path.name}")
    codes = np.union1d(df["i"].to_numpy(), df["j"].to_numpy())
    W = np.zeros((len(codes), len(codes)))
    W[np.searchsorted(codes, df["i"]), np.searchsorted(codes, df["j"])] = df[WEIGHT].to_numpy()
    cache.parent.mkdir(parents=True, exist_ok=True)
    np.savez(cache, codes=codes, W=W)
    return codes, W


def load_all():
    try:
        if not DATA.is_dir():
            raise FileNotFoundError(f"DATA_DIR {DATA} not found")
        load_names()
        for f in sorted(DATA.glob("*.csv")):
            low = f.name.lower()
            if "country" in low or "product" in low:
                continue
            m = re.search(r"Y(20\d{2})", f.name) or re.search(r"(?<!\d)(20\d{2})(?!\d)", f.name)
            if not m:
                continue
            year = int(m.group(1))
            STATE["status"] = f"loading {year}"
            codes, W = read_year(f, year)
            NETS[year] = {"codes": codes, "names": [NAMES.get(int(c), str(c)) for c in codes], "W": W}
            log.info("loaded %s: %d nodes, %d edges", year, len(codes), int((W > 0).sum()))
        if not NETS:
            raise FileNotFoundError(f"no yearly CSV files found in {DATA}")
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
    return {"status": STATE["status"], "years": years(), "weight": WEIGHT, "hs": HS}


@app.get("/api/summary")
def summary():
    if (r := ready_or_503()): return r
    if "summary" not in CACHE:
        CACHE["summary"] = {str(y): sim.year_summary(n["codes"], n["names"], n["W"]) for y, n in sorted(NETS.items())}
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
