const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const api = async (p, body) => {
  const r = await fetch('/api/' + p, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
};
const fmt = (v, d = 2) => Number(v).toLocaleString(undefined, { maximumFractionDigits: d });
const pct = (a, b) => a ? (b - a) / a * 100 : 0;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const YC = { 2021: '#8aa4b8', 2022: '#ef6b5b', 2023: '#f2a33a', 2024: '#45c0d0' };
const yc = y => YC[y] || '#b99cf0';
const DASH = [[], [8, 4], [2, 4], [10, 4, 2, 4], [1, 5]];

Chart.defaults.color = '#8d9dab';
Chart.defaults.borderColor = '#263441';
Chart.defaults.font.family = '"Avenir Next","Segoe UI",system-ui,sans-serif';
const charts = {};
const draw = (id, cfg) => { charts[id]?.destroy(); cfg.options = { responsive: true, maintainAspectRatio: false, animation: false, ...cfg.options }; charts[id] = new Chart($('#' + id), cfg); };
const banner = (msg, err) => { const b = $('#banner'); b.hidden = !msg; b.textContent = msg || ''; b.className = err ? 'err' : ''; };
const withBusy = async (btn, fn) => { btn.disabled = true; banner('Running the simulation… larger runs can take a few seconds.'); try { await fn(); banner(''); } catch (e) { banner(e.message, true); } btn.disabled = false; };

/* segmented control: items = [{v, label}] */
function seg(sel, items, value, onChange) {
  const el = $(sel);
  el.innerHTML = items.map(i => `<button type="button" data-v="${i.v}" class="${String(i.v) === String(value) ? 'on' : ''}" aria-pressed="${String(i.v) === String(value)}">${i.label}</button>`).join('');
  el.onclick = e => { const b = e.target.closest('button'); if (!b) return; el.querySelectorAll('button').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b); }); onChange(b.dataset.v); };
}
/* multi-select chips; set = Set of values */
function chips(sel, items, set, onChange) {
  const el = $(sel);
  el.innerHTML = items.map(i => i.group ? `<span class="chip grp">${i.group}</span>` :
    `<button type="button" class="chip ${set.has(String(i.v)) ? 'on' : ''}" data-v="${i.v}" aria-pressed="${set.has(String(i.v))}">${i.sw ? `<i class="sw" style="background:${i.sw}"></i>` : ''}${i.label}${i.hint ? `<small>${i.hint}</small>` : ''}</button>`).join('');
  el.onclick = e => { const b = e.target.closest('button.chip'); if (!b) return; const v = b.dataset.v; set.has(v) ? set.delete(v) : set.add(v); b.classList.toggle('on', set.has(v)); b.setAttribute('aria-pressed', set.has(v)); onChange?.(); };
}
const dchip = (a, b) => { const p = pct(a, b); return `<span class="delta ${p > 0 ? 'up' : 'down'}">${p > 0 ? '▲' : '▼'} ${fmt(Math.abs(p), 1)}%</span>`; };

let ST = {}, YEARS = [], UNIT = { div: 1e6, label: 'Mt' }, SUM = {}, COUNTRIES = [], FOCUS = {};
const vol = v => { const x = v / UNIT.div; return fmt(x, x < 10 ? 2 : 1); };

/* ---------- tabs ---------- */
$$('#tabs button').forEach(b => b.onclick = () => {
  $$('#tabs button,.tab').forEach(e => e.classList.remove('on'));
  b.classList.add('on'); $('#' + b.dataset.tab).classList.add('on'); window.scrollTo({ top: 0 });
});

/* ---------- boot ---------- */
async function boot() {
  for (;;) {
    try { ST = await api('status'); } catch { ST = { status: 'waiting for the data service' }; }
    if (ST.status === 'ready') break;
    if (String(ST.status).startsWith('error')) { $('#loading').classList.add('done'); return banner(ST.status, true); }
    $('#loading-text').textContent = 'Reading trade data: ' + ST.status; await new Promise(r => setTimeout(r, 1500));
  }
  YEARS = ST.years; FOCUS = ST.focus || {};
  UNIT = ST.weight === 'v' ? { div: 1e6, label: 'USD bn' } : { div: 1e6, label: 'Mt' };
  [SUM, COUNTRIES] = await Promise.all([api('summary'), api('countries')]);
  $('#country-list').innerHTML = COUNTRIES.map(c => `<option value="${esc(c.name)}">`).join('');
  $('#sc-country').innerHTML = COUNTRIES.map(c => `<option value="${c.code}" ${c.code === FOCUS.russia ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  const first = YEARS.includes(2022) ? 2022 : YEARS.at(-1);
  netYear = first;
  seg('#net-years', YEARS.map(y => ({ v: y, label: y })), first, y => { netYear = +y; loadNetwork(); });
  seg('#map-flows', [{ v: 0, label: 'Selected only' }, { v: 40, label: 'Top 40' }, { v: 100, label: 'Top 100' }, { v: 250, label: 'Top 250' }], mapFlows, v => { mapFlows = +v; M?.flows(); });
  initRobust(); initScenario(); overview();
  await loadNetwork();
  $('#loading').classList.add('done');
}

/* ============ 1. NETWORK ============ */
const METRICS = {
  out_strength: ['Export volume', 'Volume of oil a country sells abroad. Brighter amber means a bigger supplier.'],
  in_strength: ['Import volume', 'Volume of oil a country buys. Brighter teal means a bigger consumer.'],
  out_degree: ['Number of customers', 'How many different countries it sells to.'],
  in_degree: ['Number of suppliers', 'How many different countries it buys from. More suppliers means more options if one fails.'],
  pr_out: ['Supplier influence (PageRank)', 'Counts not just how much a country sells but how well-connected its customers are.'],
  pr_in: ['Buyer influence (PageRank)', 'Counts how much of the network ultimately flows toward a country. Brighter teal means more.'],
  betweenness: ['Bridge role (betweenness)', 'How often a country sits on the shortest trade path between two others. High values mark intermediaries the network leans on.'],
  closeness: ['Reach (closeness)', 'How few steps it takes to get from this country to all others.'],
};
$('#net-metric').innerHTML = Object.entries(METRICS).map(([k, v]) => `<option value="${k}">${v[0]}</option>`).join('');
let netYear, NET, SEL = null, PROF = null, mapFlows = 100, GEO = null, M = null;
const NETS = {};
const metric = () => $('#net-metric').value;
const mval = (d, m) => m.includes('strength') ? vol(d[m]) : m.includes('degree') ? fmt(d[m], 0) : fmt(d[m], 4);
const isFocus = c => c === FOCUS.russia || c === FOCUS.ukraine;
$('#net-metric').onchange = () => { renderMetricInfo(); renderRank(); renderView(); };
$('#net-search').onchange = e => {
  const q = e.target.value.trim().toLowerCase(); if (!q) return;
  const c = COUNTRIES.find(c => c.name.toLowerCase() === q) || COUNTRIES.find(c => c.name.toLowerCase().startsWith(q));
  if (c) selectCountry(c.code); else banner('No country matches “' + e.target.value + '”.', true);
};

async function loadNetwork() {
  NET = NETS[netYear] ||= await api('network?year=' + netYear);
  renderMetricInfo(); renderStats(); renderTopo(); renderRank(); renderDeg();
  await renderView();
  SEL ? selectCountry(SEL, true) : renderProfile(null);
}
function renderMetricInfo() { $('#metric-desc').textContent = METRICS[metric()][1]; $('#rank-metric').textContent = METRICS[metric()][0].toLowerCase(); }

function renderStats() {
  const s = SUM[netYear], p = SUM[netYear - 1], T = k => (p ? ` ${dchip(p[k], s[k])} <span>vs ${netYear - 1}</span>` : '');
  const card = (k, v, d) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div><div class="d">${d}</div></div>`;
  const top = s.top_exporters[0], ru = s.ru_share;
  $('#net-stats').innerHTML = card('Countries trading', s.nodes, T('nodes')) + card('Trade links', fmt(s.edges, 0), T('edges')) +
    card(`Total flow (${UNIT.label})`, vol(s.volume), T('volume')) + card('Largest exporter', esc(top.name), `${fmt(top.share, 1)}% of global flow`) +
    (FOCUS.russia != null ? card('Russia’s share of exports', fmt(ru, 1) + '%', T('ru_share')) : '');
}

function renderTopo() {
  const t = NET.topology;
  const items = [['Density', fmt(t.density, 3), 'Share of all possible country pairs that actually trade.'],
    ['Reciprocity', fmt(t.reciprocity, 3), 'Share of links that also run the other way.'],
    ['Clustering', fmt(t.clustering, 3), 'How often two partners of a country also trade with each other.'],
    ['Typical distance', fmt(t.avg_path, 2) + ' steps', 'Average number of links between two countries (ignoring direction).'],
    ['Diameter', t.diameter + ' steps', 'The longest shortest path between any two countries.'],
    ['Connected core', `${t.lwcc} of ${t.nodes}`, 'Countries in the largest block that is linked together.'],
    ['Export concentration', fmt(t.hhi_exports, 3), 'Herfindahl index: 0 = supply spread evenly, 1 = one country sells everything.'],
    ['Import concentration', fmt(t.hhi_imports, 3), 'Same measure for demand.']];
  $('#topo').innerHTML = items.map(([k, v, d]) => `<div class="tile"><span>${k}</span><b>${v}</b><small>${d}</small></div>`).join('');
}

function renderRank() {
  const m = metric(), top = [...NET.nodes].sort((a, b) => b[m] - a[m]).slice(0, 12);
  $('#rank').innerHTML = `<table><tr><th>#</th><th>Country</th><th>${METRICS[m][0].split(' (')[0]}</th><th>Exports</th><th>Imports</th></tr>` +
    top.map((n, i) => `<tr class="click ${n.code === SEL ? 'sel' : ''}" data-code="${n.code}"><td>${i + 1}</td><td>${esc(n.name)}</td><td>${mval(n, m)}</td><td>${vol(n.out_strength)}</td><td>${vol(n.in_strength)}</td></tr>`).join('') + '</table>';
}
$('#rank').onclick = e => { const r = e.target.closest('tr[data-code]'); r && selectCountry(+r.dataset.code); };

function renderDeg() {
  const ccdf = k => { const v = NET.nodes.map(n => n[k]).filter(x => x > 0), u = [...new Set(v)].sort((a, b) => a - b);
    return u.map(x => ({ x, y: v.filter(z => z >= x).length / v.length })); };
  draw('deg-chart', { type: 'line', data: { datasets: [
    { label: 'Suppliers per importer', data: ccdf('in_degree'), borderColor: '#45c0d0', backgroundColor: '#45c0d0', pointRadius: 3 },
    { label: 'Customers per exporter', data: ccdf('out_degree'), borderColor: '#f2a33a', backgroundColor: '#f2a33a', pointRadius: 3 }] },
    options: { scales: { x: { type: 'logarithmic', title: { display: true, text: 'number of partners (k)' } }, y: { type: 'logarithmic', title: { display: true, text: 'share of countries with at least k' } } } } });
}


/* ---------- world map ---------- */
const HUE = { out_strength: '#f2a33a', out_degree: '#f2a33a', pr_out: '#f2a33a', in_strength: '#45c0d0', in_degree: '#45c0d0', pr_in: '#45c0d0', betweenness: '#b79cf2', closeness: '#b79cf2' };
async function renderView() {
  try { await ensureGeo(); renderMap(); }
  catch (e) { banner('Could not load the map: ' + e.message, true); }
}
/* load boundaries once; match the user's countries to them; anchor each country at the centre of its largest landmass */
async function ensureGeo() {
  if (GEO) return GEO;
  banner('Loading the map…');
  const topo = await (await fetch('/vendor/world/countries-50m.json')).json();
  const feats = topojson.feature(topo, topo.objects.countries).features;
  const { place, unplaced } = Geo.match(feats.map(f => ({ id: f.id, name: f.properties.name })), COUNTRIES, ST.codes_numeric !== false);
  const cent = feats.map(f => { let g = f.geometry;
    if (g.type === 'MultiPolygon') { let best = null, ba = -1; g.coordinates.forEach(c => { const p = { type: 'Polygon', coordinates: c }, a = d3.geoArea(p); if (a > ba) { ba = a; best = p; } }); g = best; }
    return d3.geoCentroid(g); });
  GEO = { feats, place, unplaced, cent }; banner(''); return GEO;
}

/* Countries are the nodes: land is shaded by the chosen metric and links are arcs between countries; there are no markers. */
function renderMap() {
  const W = 960, H = 500, m = metric(), hue = HUE[m], svg = d3.select('#map'); svg.selectAll('*').remove();
  const proj = d3.geoNaturalEarth1().fitSize([W, H], { type: 'Sphere' }), path = d3.geoPath(proj);
  const at = {}, byFeat = {};
  NET.nodes.forEach(n => { const f = GEO.place[n.code]; if (f != null) { at[n.code] = { ...n, feat: f, pt: GEO.cent[f] }; byFeat[f] = at[n.code]; } });
  const vmax = d3.max(Object.values(at), n => n[m]) || 1, ramp = d3.interpolateRgb('#1a2833', hue);
  const shade = n => n[m] > 0 ? ramp(.16 + .84 * Math.pow(n[m] / vmax, .4)) : '#17232e';
  const ranked = Object.values(at).sort((a, b) => b[m] - a[m]);
  $('#legend-map').innerHTML = `<span>${METRICS[m][0]}: low<i class="ramp" style="background:linear-gradient(90deg,#1a2833,${hue})"></i>high</span><span><i class="line out"></i>sells to</span><span><i class="line in"></i>buys from</span><span class="muted">scroll to zoom · drag to pan</span>`;

  const g = svg.append('g');
  g.append('path').datum({ type: 'Sphere' }).attr('d', path).attr('fill', '#0c1722').attr('stroke', '#1d2b38');
  g.append('path').datum(d3.geoGraticule10()).attr('d', path).attr('fill', 'none').attr('stroke', '#142230').attr('stroke-width', .5);
  const land = g.append('g').selectAll('path').data(GEO.feats.map((f, i) => ({ f, i })).filter(d => d.f.properties.name !== 'Antarctica')).join('path')
    .attr('d', d => path(d.f)).attr('class', d => 'land' + (byFeat[d.i] ? ' has' : '')).attr('fill', d => byFeat[d.i] ? shade(byFeat[d.i]) : '#0f1923');
  const bgG = g.append('g'), hoverG = g.append('g'), selG = g.append('g'), ringG = g.append('g'), labG = g.append('g');
  const arc = (a, b) => path({ type: 'LineString', coordinates: [at[a].pt, at[b].pt] });
  const ok = e => at[e.s] && at[e.t];
  const T = labG.selectAll('text').data(Object.values(at)).join('text').text(d => d.name).attr('x', d => proj(d.pt)[0]).attr('text-anchor', 'middle');
  let k = 1;
  /* Label placement: most important first, skip any label that would overlap one already placed; more labels as you zoom in. */
  const labels = f => {
    const limit = k < 2 ? 14 : k < 4 ? 30 : 70, pool = new Set(ranked.slice(0, limit));
    [SEL, FOCUS.russia, FOCUS.ukraine].forEach(c => at[c] && pool.add(at[c]));
    const prio = d => d.code === SEL ? 2 : isFocus(d.code) ? 1 : 0, placed = [], show = new Set();
    [...pool].sort((a, b) => prio(b) - prio(a) || b[m] - a[m]).forEach(d => {
      const [x, y] = proj(d.pt), w = (d.name.length * 5.4 + 6) / f, h = 13 / f, box = [x - w / 2, y - h / 2, x + w / 2, y + h / 2];
      if (prio(d) || !placed.some(p => box[0] < p[2] && box[2] > p[0] && box[1] < p[3] && box[3] > p[1])) { show.add(d.code); placed.push(box); }
    });
    T.attr('display', d => show.has(d.code) ? null : 'none');
  };
  const sizes = () => { const f = Math.pow(k, .6); T.attr('font-size', 11 / f).attr('y', d => proj(d.pt)[1] + 4 / f).style('stroke-width', 3 / f); ringG.selectAll('circle').attr('r', 9 / Math.pow(k, .8)); labels(f); };

  function flows() {
    bgG.selectAll('*').remove(); selG.selectAll('*').remove();
    if (mapFlows) {
      const bg = NET.edges.filter(ok).slice(0, mapFlows), lw = d3.scaleSqrt().domain([0, bg[0]?.w || 1]).range([.5, 3.5]);
      bgG.selectAll('path').data(bg).join('path').attr('class', 'fl-bg').attr('d', e => arc(e.s, e.t)).attr('stroke-width', e => lw(e.w));
    }
    if (PROF && PROF.code === SEL && PROF.year === netYear && at[SEL]) {
      const out = PROF.flows_out.filter(f => at[f.code]).slice(0, 60).map(f => ({ s: SEL, t: f.code, w: f.volume, dir: 'out' }));
      const inn = PROF.flows_in.filter(f => at[f.code]).slice(0, 60).map(f => ({ s: f.code, t: SEL, w: f.volume, dir: 'in' }));
      const all = [...out, ...inn], lw = d3.scaleSqrt().domain([0, d3.max(all, e => e.w) || 1]).range([1, 5]);
      selG.selectAll('path').data(all).join('path').attr('class', e => 'fl ' + e.dir).attr('d', e => arc(e.s, e.t)).attr('stroke-width', e => lw(e.w))
        .append('title').text(e => `${at[e.s].name} → ${at[e.t].name}: ${vol(e.w)} ${UNIT.label}`);
    }
  }
  function hover(code) {      // busiest links of the country under the pointer (from the top-600 links)
    hoverG.selectAll('*').remove(); bgG.attr('opacity', code == null ? 1 : .25);
    if (code == null) return;
    const es = NET.edges.filter(e => ok(e) && (e.s === code || e.t === code)).slice(0, 40), lw = d3.scaleSqrt().domain([0, es[0]?.w || 1]).range([1, 4.5]);
    hoverG.selectAll('path').data(es).join('path').attr('class', e => 'fl-hover ' + (e.s === code ? 'out' : 'in')).attr('d', e => arc(e.s, e.t)).attr('stroke-width', e => lw(e.w));
  }
  function restyle() {
    const sel = n => n && n.code === SEL;
    land.attr('stroke', d => sel(byFeat[d.i]) ? '#fff' : isFocus(byFeat[d.i]?.code) ? '#b9c8d4' : '#2a3c4b').attr('stroke-width', d => sel(byFeat[d.i]) ? 1.6 : isFocus(byFeat[d.i]?.code) ? .8 : .5)
      .attr('stroke-dasharray', d => isFocus(byFeat[d.i]?.code) && !sel(byFeat[d.i]) ? '3 3' : null);
    ringG.selectAll('*').remove();                      // a single ring marks the selected country so small ones can be found
    if (at[SEL]) ringG.append('circle').attr('class', 'ring').attr('cx', proj(at[SEL].pt)[0]).attr('cy', proj(at[SEL].pt)[1]);
    sizes(); flows();
  }
  M = { restyle, flows };

  const wrap = $('.graph-wrap'), tip = $('#tip');
  const move = e => { const b = wrap.getBoundingClientRect(); tip.style.left = Math.min(e.clientX - b.left + 14, b.width - 250) + 'px'; tip.style.top = e.clientY - b.top + 14 + 'px'; };
  land.on('mouseenter', (e, d) => { const n = byFeat[d.i]; tip.hidden = false;
      tip.innerHTML = n ? `<b>${esc(n.name)}</b><br>${METRICS[m][0]}: ${mval(n, m)}<br>Exports ${vol(n.out_strength)} · Imports ${vol(n.in_strength)} ${UNIT.label}<br><span class="muted">Click for details and all links</span>`
        : `<b>${esc(d.f.properties.name)}</b><br><span class="muted">No crude oil trade recorded this year</span>`;
      n && hover(n.code); })
    .on('mousemove', move).on('mouseleave', () => { tip.hidden = true; hover(null); });
  land.filter(d => byFeat[d.i]).on('click', (e, d) => selectCountry(byFeat[d.i].code));
  const zoom = d3.zoom().scaleExtent([1, 12]).extent([[0, 0], [W, H]]).translateExtent([[0, 0], [W, H]]).on('zoom', e => { k = e.transform.k; g.attr('transform', e.transform); sizes(); });
  svg.call(zoom).on('dblclick.zoom', null);
  $('#map-reset').onclick = () => svg.call(zoom.transform, d3.zoomIdentity);

  const missing = NET.nodes.filter(n => GEO.place[n.code] == null), sum = (a, f) => a.reduce((t, n) => t + n[f], 0);
  const note = $('#map-note'); note.hidden = !missing.length;
  if (missing.length) note.textContent = `Not shown on the map (no location): ${missing.slice(0, 6).map(n => n.name).join(', ')}${missing.length > 6 ? ` and ${missing.length - 6} more` : ''}. Together they account for ${fmt(100 * sum(missing, 'out_strength') / sum(NET.nodes, 'out_strength'), 1)}% of exports and ${fmt(100 * sum(missing, 'in_strength') / sum(NET.nodes, 'in_strength'), 1)}% of imports. They still count in every statistic.`;
  restyle();
}

/* country profile */
async function selectCountry(code) {
  SEL = code; PROF = null;
  M?.restyle(); renderRank();
  try { PROF = await api(`country?year=${netYear}&code=${code}`); renderProfile(PROF); }
  catch (e) { const nm = COUNTRIES.find(c => c.code === code)?.name || 'This country'; $('#profile').innerHTML = `<div class="empty"><div class="big">${esc(nm)}</div><p>Not part of the ${netYear} trade network (no recorded crude oil flows that year).</p></div>`; }
  M?.restyle();
}
function renderProfile(p) {
  const el = $('#profile');
  if (!p) {
    const quick = [FOCUS.russia, ...NET.topology && SUM[netYear].top_exporters.slice(0, 3).map(e => e.code), SUM[netYear].top_importers[0].code].filter((c, i, a) => c != null && a.indexOf(c) === i);
    el.innerHTML = `<div class="empty"><div class="big">Country profile</div><p>Click a country on the map, a row in the ranking, or search above, to see who a country buys from and sells to.</p>
      <div class="chips">${quick.map(c => `<button class="chip" data-code="${c}">${esc(COUNTRIES.find(x => x.code === c)?.name || c)}</button>`).join('')}</div></div>`;
    return;
  }
  const net = p.exports - p.imports, role = net >= 0 ? ['Net exporter', 'exp'] : ['Net importer', 'imp'];
  const bars = (list, color) => list.length ? `<div class="bars">${list.map(b => `<div class="bar-row"><span data-code="${b.code}" title="Open ${esc(b.name)}">${esc(b.name)}</span><span class="t"><i style="width:${b.share}%;background:${color}"></i></span><em>${fmt(b.share, 0)}%</em></div>`).join('')}</div>` : '<p class="hint">None.</p>';
  const mx = Math.max(...Object.values(p.history).map(h => h.exports), 1e-9);
  const hist = Object.entries(p.history).map(([y, h]) => `<div class="bar-row"><span>${y}</span><span class="t"><i style="width:${100 * h.exports / mx}%;background:${+y === netYear ? '#f2a33a' : '#4a5d6c'}"></i></span><em>${vol(h.exports)}</em></div>`).join('');
  el.innerHTML = `<h2>${esc(p.name)}<span class="badge ${role[1]}">${role[0]}</span></h2>
    <div class="kv2"><div><span>Exports (${UNIT.label})</span><b>${vol(p.exports)}</b></div><div><span>Imports (${UNIT.label})</span><b>${vol(p.imports)}</b></div>
    <div><span>Share of world exports</span><b>${fmt(p.export_share, 1)}%</b></div><div><span>Export rank</span><b>${p.export_rank ? '#' + p.export_rank : '—'}</b></div>
    <div><span>Customers</span><b>${p.n_buyers}</b></div><div><span>Suppliers</span><b>${p.n_suppliers}</b></div></div>
    ${p.top_buyers.length ? `<h4>Sells mostly to <small class="muted">share of its exports</small></h4>${bars(p.top_buyers, '#f2a33a')}` : ''}
    ${p.top_suppliers.length ? `<h4>Buys mostly from <small class="muted">share of its imports</small></h4>${bars(p.top_suppliers, '#45c0d0')}` : ''}
    <h4>Exports over time (${UNIT.label})</h4><div class="bars">${hist}</div>`;
}
$('#profile').onclick = e => { const t = e.target.closest('[data-code]'); t && selectCountry(+t.dataset.code); };

/* ============ 2. YEARS COMPARED ============ */
function overview() {
  const ys = Object.keys(SUM).sort(), a = SUM[ys[0]], b = SUM[ys.at(-1)];
  const card = (k, A, B, f, note) => `<div class="stat"><div class="k">${k}</div><div class="v">${f(A)} → ${f(B)}</div><div class="d">${dchip(A, B)} <span>${ys[0]} to ${ys.at(-1)}${note || ''}</span></div></div>`;
  $('#ov-cards').innerHTML = (FOCUS.russia != null ? card('Russia’s share of exports', a.ru_share, b.ru_share, v => fmt(v, 1) + '%') + card('Countries buying from Russia', a.ru_partners, b.ru_partners, v => fmt(v, 0)) : '') +
    card('Export concentration (HHI)', a.hhi_exports, b.hhi_exports, v => fmt(v, 3), ', higher = fewer suppliers dominate') +
    card('Trade links', a.edges, b.edges, v => fmt(v, 0)) + card('Typical distance', a.avg_path, b.avg_path, v => fmt(v, 2));
  const rows = [['Countries trading', 'nodes', 0], ['Trade links', 'edges', 0], ['Density', 'density', 4], ['Reciprocity', 'reciprocity', 3], ['Clustering', 'clustering', 3],
    ['Typical distance (steps)', 'avg_path', 2], ['Diameter (steps)', 'diameter', 0], ['Connected core (countries)', 'lwcc', 0], ['Strongly connected groups', 'scc', 0],
    ['Export concentration (HHI)', 'hhi_exports', 3], ['Import concentration (HHI)', 'hhi_imports', 3], [`Total flow (${UNIT.label})`, 'volume', 1, v => v / UNIT.div],
    ...(FOCUS.russia != null ? [['Russia: share of exports (%)', 'ru_share', 2], ['Russia: number of customers', 'ru_partners', 0]] : []),
    ...(FOCUS.ukraine != null ? [['Ukraine: share of exports (%)', 'ua_share', 3], ['Ukraine: number of customers', 'ua_partners', 0]] : [])];
  $('#ov-table').innerHTML = `<table><tr><th></th>${ys.map(y => `<th>${y}</th>`).join('')}<th>${ys[0]} → ${ys.at(-1)}</th></tr>` + rows.map(([l, k, d, f = x => x]) => {
    const A = f(a[k]), B = f(b[k]); return `<tr><td>${l}</td>${ys.map(y => `<td>${fmt(f(SUM[y][k]), d)}</td>`).join('')}<td>${A ? dchip(A, B) : '—'}</td></tr>`; }).join('') + '</table>';
  const top = [...new Set(ys.flatMap(y => SUM[y].top_exporters.slice(0, 8).map(e => e.name)))];
  draw('ov-chart', { type: 'bar', data: { labels: top, datasets: ys.map(y => ({ label: y, backgroundColor: yc(y), borderRadius: 3, data: top.map(n => SUM[y].top_exporters.find(e => e.name === n)?.share ?? 0) })) },
    options: { scales: { y: { title: { display: true, text: '% of global flow' } } } } });
}

/* ============ 3. ROBUSTNESS ============ */
const NODE_S = [{ group: 'Random' }, { v: 'random', label: 'Random failures', hint: 'bad luck' },
  { group: 'Targeted attack' }, { v: 'out_strength', label: 'Biggest exporters first' }, { v: 'in_strength', label: 'Biggest importers first', hint: 'also removes their demand' },
  { v: 'betweenness', label: 'Key intermediaries first' }, { v: 'pagerank_out', label: 'Most influential suppliers first' }];
const EDGE_S = [{ group: 'Random' }, { v: 'random', label: 'Random routes', hint: 'bad luck' },
  { group: 'Targeted' }, { v: 'heaviest', label: 'Busiest routes first' }, { v: 'lightest', label: 'Smallest routes first' }];
const lblFor = (mode, v) => (mode === 'node' ? NODE_S : EDGE_S).find(x => x.v === v)?.label || v;
const RMET = { unmet: ['Unmet demand', 'Share of all remaining countries’ oil demand that can no longer be supplied. Lower is better.'],
  affected: ['Countries short', 'Share of countries missing more than 10% of the oil they need.'],
  retained: ['Volume delivered', 'Total oil still delivered compared with the original network. Higher is better.'],
  lwcc: ['Connected core', 'Share of countries still linked into one connected trading block.'] };
const RB = { mode: 'node', strats: new Set(['random', 'out_strength']), years: new Set() };
let ROB, robMetric = 'unmet';
const modeList = () => RB.mode === 'node' ? NODE_S : EDGE_S;

function initRobust() {
  YEARS.forEach(y => RB.years.add(String(y)));
  renderRobControls();
  $('#rob-mode').onclick = e => { const b = e.target.closest('button'); if (!b) return; setMode(b.dataset.v); };
  $$('.preset').forEach(b => b.onclick = () => preset(b.dataset.preset));
  $('#rob-form').onsubmit = e => { e.preventDefault(); runRobust(); };
}
function setMode(m, strats) {
  RB.mode = m; $$('#rob-mode button').forEach(b => b.classList.toggle('on', b.dataset.v === m));
  RB.strats = new Set(strats || (m === 'node' ? ['random', 'out_strength'] : ['random', 'heaviest']));
  $('#rob-max').value = m === 'node' ? 20 : 50; $('#adapt-wrap').style.display = m === 'node' ? '' : 'none'; renderRobControls();
}
function renderRobControls() {
  chips('#rob-strats', modeList(), RB.strats);
  chips('#rob-years', YEARS.map(y => ({ v: y, label: y, sw: yc(y) })), RB.years);
}
function preset(p) {
  if (p === 'attack') setMode('node', ['random', 'out_strength']);
  if (p === 'full') setMode('node', ['random', 'out_strength', 'betweenness', 'pagerank_out']);
  if (p === 'routes') setMode('edge', ['random', 'heaviest']);
  YEARS.forEach(y => RB.years.add(String(y))); renderRobControls(); runRobust();
}
function runRobust() {
  return withBusy($('#rob-go'), async () => {
    const years = [...RB.years].map(Number).sort(), strategies = [...RB.strats];
    if (!years.length || !strategies.length) throw new Error('Pick at least one removal order and one year.');
    ROB = await api('robustness', { mode: RB.mode, years, strategies, steps: +$('#rob-steps').value, max_frac: $('#rob-max').value / 100, runs: +$('#rob-runs').value,
      adaptive: RB.mode === 'node' && $('#rob-adaptive').checked, surge: $('#rob-surge').value / 100, newlinks: $('#rob-new').checked });
    ROB.mode = RB.mode; $('#rob-out').hidden = false; renderRob();
    $('#rob-out').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}
const trapz = (x, y) => y.reduce((a, v, i) => i ? a + (x[i] - x[i - 1]) * (v + y[i - 1]) / 2 : 0, 0);
const score = c => trapz(c.x, c.unmet.map(u => 100 - u)) / (c.x.at(-1) * 100);
const tipping = c => { const i = c.unmet.findIndex(u => u >= 10); return i < 0 ? null : c.x[i]; };

function renderRob() {
  const R = ROB.results, ys = Object.keys(R).sort(), strats = Object.keys(R[ys[0]]), unit = ROB.mode === 'node' ? 'countries' : 'trade routes', LBL = Object.fromEntries(strats.map(x => [x, lblFor(ROB.mode, x)]));
  seg('#rob-metric', Object.entries(RMET).map(([k, v]) => ({ v: k, label: v[0] })), robMetric, v => { robMetric = v; renderRobChart(); });
  renderRobChart();
  // insights
  const first = ys[0], last = ys.at(-1);
  $('#rob-insights').innerHTML = strats.map(s => {
    const a = score(R[first][s]), b = score(R[last][s]), ta = tipping(R[first][s]), tb = tipping(R[last][s]);
    const tp = y => { const t = tipping(R[y][s]); return t == null ? `never within ${fmt(R[y][s].x.at(-1), 0)}%` : `${fmt(t, 1)}%`; };
    let cls = 'flat', head = `Score ${fmt(b, 2)} in ${last}`, body = `10% of demand goes unmet after removing ${tp(last)} of ${unit}.`;
    if (ys.length > 1) {
      const d = b - a; cls = d < -.02 ? 'bad' : d > .02 ? 'good' : 'flat';
      head = d < -.02 ? `More fragile in ${last} than in ${first}` : d > .02 ? `More robust in ${last} than in ${first}` : `About as robust in ${last} as in ${first}`;
      body = `Score ${fmt(a, 2)} → ${fmt(b, 2)}. A 10% shortfall arrives after removing ${tp(first)} of ${unit} in ${first}, versus ${tp(last)} in ${last}.`;
    }
    return `<div class="insight ${cls}"><b>${LBL[s]}: ${head}</b><p>${body}</p></div>`;
  }).join('');
  // scorecard
  $('#rob-table').innerHTML = `<table><tr><th>Removal order</th>${ys.map(y => `<th>${y}</th>`).join('')}</tr>` + strats.map(s =>
    `<tr><td>${LBL[s]}</td>${ys.map(y => { const c = R[y][s], sc = score(c), t = tipping(c);
      return `<td><div class="score"><b>${fmt(sc, 2)}</b><span class="t"><i style="width:${sc * 100}%;background:${sc > .8 ? '#7bd389' : sc > .5 ? '#f2a33a' : '#ef6b5b'}"></i></span></div><small class="muted">${t == null ? 'no 10% shortfall' : '10% short at ' + fmt(t, 1) + '%'}</small></td>`; }).join('')}</tr>`).join('') + '</table>';
}
function renderRobChart() {
  const R = ROB.results, ys = Object.keys(R).sort(), strats = Object.keys(R[ys[0]]), LBL = Object.fromEntries(strats.map(x => [x, lblFor(ROB.mode, x)]));
  $('#rob-metric-desc').textContent = RMET[robMetric][1];
  $('#rob-legend').innerHTML = ys.map(y => `<span><i class="dot" style="background:${yc(y)}"></i>${y}</span>`).join('') +
    strats.map((s, i) => `<span><svg width="34" height="8"><line x1="0" x2="34" y1="4" y2="4" stroke="#8d9dab" stroke-width="2.5" stroke-dasharray="${DASH[i % 5].join(' ')}"/></svg> ${LBL[s]}</span>`).join('');
  const ds = []; for (const y of ys) strats.forEach((s, i) => ds.push({ label: `${y} · ${LBL[s]}`, borderColor: yc(y), borderDash: DASH[i % 5], borderWidth: 2.2, pointRadius: 0, tension: .15,
    data: R[y][s].x.map((x, k) => ({ x, y: R[y][s][robMetric][k] })) }));
  draw('rob-chart', { type: 'line', data: { datasets: ds }, options: { interaction: { mode: 'nearest', intersect: false }, plugins: { legend: { display: false } },
    scales: { x: { type: 'linear', title: { display: true, text: `% of ${ROB.mode === 'node' ? 'countries' : 'trade routes'} removed` } }, y: { min: 0, max: 100, title: { display: true, text: RMET[robMetric][0] + ' (%)' } } } } });
}

/* ============ 4. SHOCK ============ */
const SCY = new Set();
let SC, scYear;
function initScenario() {
  YEARS.forEach(y => SCY.add(String(y)));
  chips('#sc-years', YEARS.map(y => ({ v: y, label: y, sw: yc(y) })), SCY);
  $('#sc-red').oninput = e => $('#sc-red-v').textContent = e.target.value + '%';
  $$('[data-red]').forEach(b => b.onclick = () => { $('#sc-red').value = b.dataset.red; $('#sc-red-v').textContent = b.dataset.red + '%'; });
  $('#sc-form').onsubmit = e => { e.preventDefault(); runShock(); };
  $('#sc-sort').onchange = () => SC && renderShockBars();
}
function runShock() {
  return withBusy($('#sc-form .go'), async () => {
    const years = [...SCY].map(Number).sort(); if (!years.length) throw new Error('Pick at least one year.');
    const code = +$('#sc-country').value, red = $('#sc-red').value / 100;
    SC = { name: $('#sc-country').selectedOptions[0].text, red, res: (await api('scenario', { years, countries: [{ code, reduction: red }], surge: $('#sc-surge').value / 100, newlinks: $('#sc-new').checked })).results };
    const ys = Object.keys(SC.res).sort(); scYear = ys.at(-1);
    $('#sc-out').hidden = false;
    seg('#sc-year', ys.map(y => ({ v: y, label: y })), scYear, y => { scYear = y; renderShockBars(); });
    renderShock(); $('#sc-out').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}
function renderShock() {
  const R = SC.res, ys = Object.keys(R).sort(), what = SC.red >= .995 ? `loses all its exports` : `loses ${fmt(SC.red * 100, 0)}% of its exports`;
  $('#sc-cards').innerHTML = ys.map(y => { const d = R[y], bad = d.residual_unmet > 5;
    return `<div class="stat"><div class="k">${y}</div><div class="v ${bad ? 'bad' : 'good'}">${fmt(d.direct_unmet, 1)}% → ${fmt(d.residual_unmet, 1)}%</div><div class="d">global demand unmet, before → after the market adjusts. ${esc(SC.name)} supplied ${fmt(d.removed_share, 1)}% of all flow.</div></div>`; }).join('');
  if (ys.length > 1) { const a = R[ys[0]].residual_unmet, b = R[ys.at(-1)].residual_unmet, d = b - a;
    $('#sc-cards').insertAdjacentHTML('afterbegin', `<div class="insight ${d > .3 ? 'bad' : d < -.3 ? 'good' : 'flat'}" style="grid-column:1/-1"><b>If ${esc(SC.name)} ${what}, the world is ${d > .3 ? `more exposed in ${ys.at(-1)} than in ${ys[0]}` : d < -.3 ? `less exposed in ${ys.at(-1)} than in ${ys[0]}` : `about as exposed in ${ys.at(-1)} as in ${ys[0]}`}</b><p>${fmt(a, 1)}% of demand stays unmet in ${ys[0]} versus ${fmt(b, 1)}% in ${ys.at(-1)}, after other exporters have used their spare capacity.</p></div>`); }
  draw('sc-chart', { type: 'bar', data: { labels: ys, datasets: [
    { label: 'Before the market adjusts', backgroundColor: '#ef6b5b', borderRadius: 3, data: ys.map(y => R[y].direct_unmet) },
    { label: 'After the market adjusts', backgroundColor: '#45c0d0', borderRadius: 3, data: ys.map(y => R[y].residual_unmet) }] },
    options: { scales: { y: { title: { display: true, text: '% of global demand unmet' }, beginAtZero: true } } } });
  renderShockBars();
}
function renderShockBars() {
  const d = SC.res[scYear]; if (!d) return;
  const top = [...d.countries].sort((a, b) => b[$('#sc-sort').value] - a[$('#sc-sort').value]).slice(0, 15);
  draw('sc-chart2', { type: 'bar', data: { labels: top.map(c => c.name), datasets: [
    { label: 'Share of demand lost at first', backgroundColor: '#ef6b5b', borderRadius: 3, data: top.map(c => c.direct_pct) },
    { label: 'Still unmet after the market adjusts', backgroundColor: '#45c0d0', borderRadius: 3, data: top.map(c => c.residual_pct) }] },
    options: { indexAxis: 'y', scales: { x: { max: 100, title: { display: true, text: '% of the importer’s demand' } } } } });
  $('#sc-sup').innerHTML = d.suppliers.length ? `<table><tr><th>Exporter (${scYear})</th><th>Extra volume (${UNIT.label})</th><th>Increase over usual exports</th></tr>` +
    d.suppliers.map(s => `<tr><td>${esc(s.name)}</td><td>${vol(s.extra)}</td><td>${fmt(s.extra_pct, 1)}%</td></tr>`).join('') + '</table>' : '<p class="hint">No exporter increased its volume under these settings.</p>';
}

boot();
