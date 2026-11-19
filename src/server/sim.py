"""Network analysis and robustness simulation on a weighted adjacency matrix W (W[i, j] = i exports to j).

Model: every surviving importer keeps its consumption fixed (= baseline imports). Supply lost to removed
nodes/edges is re-sourced from surviving exporters, who can ship at most (1 + surge) x baseline exports.
Rerouting uses existing partners only, or any exporter when newlinks=True (iterative proportional
allocation with exporter capacity limits).
"""
import numpy as np
import igraph as ig
from scipy.sparse import csr_matrix
from scipy.sparse.csgraph import connected_components

NODE_STRATS = ("random", "out_strength", "in_strength", "betweenness", "pagerank_out")
EDGE_STRATS = ("random", "heaviest", "lightest")


def nz(x):
    x = float(x)
    return x if np.isfinite(x) else 0.0


def to_graph(W, thr=0.0):
    i, j = np.nonzero(W > thr)
    g = ig.Graph(n=W.shape[0], edges=list(zip(i.tolist(), j.tolist())), directed=True)
    return g, W[i, j]


def betweenness(W):
    """Directed betweenness with distance = median_flow / flow (heavier link = shorter)."""
    n = W.shape[0]
    g, w = to_graph(W)
    if g.ecount() == 0:
        return np.zeros(n)
    b = np.array(g.betweenness(directed=True, weights=(np.median(w) / w).tolist()))
    return b / max((n - 1) * (n - 2), 1)


def pagerank(W, reverse=False):
    g, w = to_graph(W.T if reverse else W)
    if g.ecount() == 0:
        return np.full(W.shape[0], 1 / W.shape[0])
    return np.array(g.pagerank(directed=True, weights=w.tolist()))


def centralities(W):
    g, _ = to_graph(W)
    return {
        "in_strength": W.sum(0), "out_strength": W.sum(1),
        "in_degree": np.array(g.indegree(), float), "out_degree": np.array(g.outdegree(), float),
        "pr_in": pagerank(W),                      # importance as a destination
        "pr_out": pagerank(W, reverse=True),       # importance as a supplier
        "betweenness": betweenness(W),
        "closeness": np.array(g.closeness(mode="all", normalized=True), float),
    }


def topology(W):
    n = W.shape[0]
    g, _ = to_graph(W)
    gu = g.as_undirected(mode="collapse")
    ex, im, tot = W.sum(1), W.sum(0), W.sum()
    m = g.ecount()
    return {
        "nodes": n, "edges": m, "density": nz(m / (n * (n - 1))),
        "reciprocity": nz(g.reciprocity()),
        "clustering": nz(gu.transitivity_undirected(mode="zero")),
        "avg_path": nz(gu.average_path_length(directed=False, unconn=True)),
        "diameter": int(gu.diameter(directed=False, unconn=True)),
        "lwcc": max(g.connected_components(mode="weak").sizes()),
        "scc": len(g.connected_components(mode="strong")),
        "volume": float(tot), "hhi_exports": nz(((ex / tot) ** 2).sum()), "hhi_imports": nz(((im / tot) ** 2).sum()),
    }


def network_payload(codes, names, W, year, max_edges=600):
    c = centralities(W)
    def partners(w):
        return [{"name": names[j], "w": float(w[j])} for j in np.argsort(-w)[:5] if w[j] > 0]
    nodes = [{"code": int(codes[i]), "name": names[i], **{k: nz(v[i]) for k, v in c.items()},
              "buyers": partners(W[i, :]), "suppliers": partners(W[:, i])} for i in range(len(codes))]
    flat = np.argsort(W.ravel())[::-1][: min(max_edges, int((W > 0).sum()))]
    ii, jj = np.unravel_index(flat, W.shape)
    edges = [{"s": int(codes[a]), "t": int(codes[b]), "w": float(W[a, b])} for a, b in zip(ii, jj)]
    return {"year": year, "nodes": nodes, "edges": edges, "topology": topology(W)}


def year_summary(codes, names, W, ru=None, ua=None):
    ex, im, tot = W.sum(1), W.sum(0), W.sum()

    def top(v):
        return [{"code": int(codes[i]), "name": names[i], "share": float(100 * v[i] / tot)} for i in np.argsort(v)[::-1][:10]]

    def focus(c):
        i = np.flatnonzero(codes == c) if c is not None else []
        return (float(100 * ex[i[0]] / tot), int((W[i[0]] > 0).sum())) if len(i) else (0.0, 0)

    s = topology(W)
    s["ru_share"], s["ru_partners"] = focus(ru)
    s["ua_share"], s["ua_partners"] = focus(ua)
    s["top_exporters"], s["top_importers"] = top(ex), top(im)
    return s


# ---------------------------------------------------------------- simulation
def reroute(W, Wd, D, cap, alive, surge, newlinks, iters=30):
    n, totD = len(D), D.sum()
    for _ in range(iters):
        short = np.maximum(D - W.sum(0), 0) * alive
        if short.sum() <= 1e-9 * totD:
            break
        spare = np.maximum(cap * (1 + surge) - W.sum(1), 0)
        if newlinks:
            P = np.repeat(spare[:, None], n, axis=1)
            np.fill_diagonal(P, 0)
        else:
            P = Wd * spare[:, None]
        cs = P.sum(0)
        need = np.divide(short, cs, out=np.zeros(n), where=cs > 0)
        R = P * need[None, :]
        out = R.sum(1)
        f = np.where(out > spare, spare / np.maximum(out, 1e-300), 1.0)
        A = R * f[:, None]
        if A.sum() <= 1e-9 * totD:
            break
        W += A
    return W


def evaluate(W, W0, D, alive):
    n = len(D)
    Da = D * alive
    deliv = np.minimum(W.sum(0), Da)
    short = Da - deliv
    pos = Da > 0
    _, lab = connected_components(csr_matrix(W > 1e-9 * W0.sum()), directed=True, connection="weak")
    totD = Da.sum()
    return (nz(100 * short.sum() / totD) if totD > 0 else 0.0,
            nz(100 * np.count_nonzero((short > 0.1 * Da) & pos) / max(pos.sum(), 1)),
            nz(100 * deliv.sum() / D.sum()),
            100 * np.bincount(lab).max() / n)


def sim_nodes(W0, removed, surge, newlinks):
    n = W0.shape[0]
    D, X = W0.sum(0), W0.sum(1)
    alive = np.ones(n, bool)
    alive[removed] = False
    Wd = W0.copy()
    Wd[removed, :] = 0
    Wd[:, removed] = 0
    W = reroute(Wd.copy(), Wd, D, X * alive, alive, surge, newlinks)
    return evaluate(W, W0, D, alive)


def sim_edges(W0, E, surge, newlinks):
    D, X = W0.sum(0), W0.sum(1)
    Wd = W0.copy()
    Wd[E[:, 0], E[:, 1]] = 0
    W = reroute(Wd.copy(), Wd, D, X, np.ones(len(D), bool), surge, newlinks)
    return evaluate(W, W0, D, np.ones(len(D), bool))


def node_score(W, s):
    if s == "out_strength": return W.sum(1)
    if s == "in_strength": return W.sum(0)
    if s == "pagerank_out": return pagerank(W, reverse=True)
    if s == "betweenness": return betweenness(W)
    raise ValueError(f"unknown node strategy {s}")


def node_order(W0, strat, max_k, adaptive, rng):
    n = W0.shape[0]
    if strat == "random":
        return rng.permutation(n)[:max_k]
    if not adaptive:
        return np.argsort(-node_score(W0, strat), kind="stable")[:max_k]
    alive, Wd, order = np.ones(n, bool), W0.copy(), []
    for _ in range(max_k):               # re-rank on the damaged network after each removal
        s = node_score(Wd, strat)
        s[~alive] = -np.inf
        v = int(np.argmax(s))
        order.append(v)
        alive[v] = False
        Wd[v, :] = 0
        Wd[:, v] = 0
    return np.array(order)


def edge_order(W0, E, strat, rng):
    w = W0[E[:, 0], E[:, 1]]
    if strat == "random": return rng.permutation(len(E))
    if strat == "heaviest": return np.argsort(-w, kind="stable")
    if strat == "lightest": return np.argsort(w, kind="stable")
    raise ValueError(f"unknown edge strategy {strat}")


def curve(W0, mode, strat, steps, max_frac, runs, adaptive, surge, newlinks, seed):
    """Runs in a worker process; takes only the matrix, so it is picklable under any start method."""
    n = W0.shape[0]
    E = np.argwhere(W0 > 0)
    total = n if mode == "node" else len(E)
    max_k = int(np.clip(int(max_frac * total), 1, total))
    ks = np.unique(np.round(np.linspace(0, max_k, steps + 1)).astype(int))
    nrun = runs if strat == "random" else 1
    acc = np.zeros((len(ks), 4))
    for r in range(nrun):
        rng = np.random.default_rng(seed * 1000 + r)
        order = node_order(W0, strat, max_k, adaptive, rng) if mode == "node" else edge_order(W0, E, strat, rng)
        for a, k in enumerate(ks):
            acc[a] += sim_nodes(W0, order[:k], surge, newlinks) if mode == "node" else sim_edges(W0, E[order[:k]], surge, newlinks)
    acc /= nrun
    return {"x": (100 * ks / total).tolist(), "unmet": acc[:, 0].tolist(), "affected": acc[:, 1].tolist(),
            "retained": acc[:, 2].tolist(), "lwcc": acc[:, 3].tolist()}


def scenario(codes, names, W0, reductions, surge, newlinks):
    """Cut the exports of the given countries (reductions: code -> fraction 0..1) and reroute."""
    n = W0.shape[0]
    D, X = W0.sum(0), W0.sum(1)
    scale = np.ones(n)
    for c, r in reductions.items():
        i = np.flatnonzero(codes == c)
        if len(i): scale[i[0]] = 1 - r
    Wd = W0 * scale[:, None]
    alive = np.ones(n, bool)
    W = reroute(Wd.copy(), Wd, D, X * scale, alive, surge, newlinks)
    pre, post = evaluate(Wd, W0, D, alive), evaluate(W, W0, D, alive)
    direct, resid = D - Wd.sum(0), np.maximum(D - W.sum(0), 0)
    dep = (W0 * (scale < 1)[:, None]).sum(0) / np.maximum(D, 1e-300)
    countries = [{"code": int(codes[j]), "name": names[j], "demand": float(D[j]), "dependence": float(100 * dep[j]),
                  "direct_loss": float(direct[j]), "direct_pct": nz(100 * direct[j] / D[j]),
                  "residual_pct": nz(100 * resid[j] / D[j])}
                 for j in range(n) if direct[j] > 1e-9 * D.sum()]
    gain = W.sum(1) - Wd.sum(1)
    suppliers = [{"code": int(codes[i]), "name": names[i], "extra": float(gain[i]), "extra_pct": nz(100 * gain[i] / X[i])}
                 for i in np.argsort(-gain)[:10] if gain[i] > 0]
    return {"direct_unmet": pre[0], "residual_unmet": post[0], "affected_direct": pre[1], "affected_after": post[1],
            "removed_share": nz(100 * (W0.sum() - Wd.sum()) / W0.sum()), "countries": countries, "suppliers": suppliers}
