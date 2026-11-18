const $ = s => document.querySelector(s);
const api = async (p, body) => {
  const r = await fetch('/api/' + p, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
};
const YC = { 2021: '#5b6b77', 2022: '#b83a2b', 2023: '#d68910', 2024: '#1e6f8c' };
const yc = y => YC[y] || '#7a4aa8';
const DASH = [[], [7, 3], [2, 3], [9, 3, 2, 3], [1, 4]];
const fmt = (v, d = 2) => Number(v).toLocaleString(undefined, { maximumFractionDigits: d });
const charts = {};
const draw = (id, cfg) => { charts[id]?.destroy(); cfg.options = { responsive: true, maintainAspectRatio: false, animation: false, ...cfg.options }; charts[id] = new Chart($('#' + id), cfg); };
const banner = (msg, err) => { const b = $('#banner'); b.hidden = !msg; b.textContent = msg || ''; b.className = err ? 'err' : ''; };
const checks = (id, name, items, on) => { $(id).innerHTML = items.map(([v, l], i) => `<label><input type="checkbox" name="${name}" value="${v}" ${on(v, i) ? 'checked' : ''}> ${l}</label>`).join(''); };
const picked = name => [...document.querySelectorAll(`input[name=${name}]:checked`)].map(e => e.value);
const withBusy = async (btn, fn) => { btn.disabled = true; banner('Running simulation…'); try { await fn(); banner(''); } catch (e) { banner(e.message, true); } btn.disabled = false; };

let ST = {}, YEARS = [], UNIT = { div: 1e6, label: 'Mt' };

document.querySelectorAll('nav button').forEach(b => b.onclick = () => {
  document.querySelectorAll('nav button,.tab').forEach(e => e.classList.remove('on'));
  b.classList.add('on'); $('#' + b.dataset.tab).classList.add('on');
});

async function boot() {
  for (;;) {
    try { ST = await api('status'); } catch { ST = { status: 'waiting for the API' }; }
    if (ST.status === 'ready') break;
    if (String(ST.status).startsWith('error')) return banner(ST.status, true);
    banner('Reading BACI files: ' + ST.status); await new Promise(r => setTimeout(r, 2000));
  }
  banner('');
  YEARS = ST.years;
  UNIT = ST.weight === 'v' ? { div: 1e6, label: 'USD bn' } : { div: 1e6, label: 'Mt' };
  const yopts = YEARS.map(y => `<option>${y}</option>`).join('');
  $('#net-year').innerHTML = yopts; $('#sc-year').innerHTML = yopts;
  checks('#rob-years', 'ry', YEARS.map(y => [y, y]), () => true);
  checks('#sc-years', 'sy', YEARS.map(y => [y, y]), () => true);
  const cs = await api('countries');
  $('#sc-country').innerHTML = cs.map(c => `<option value="${c.code}" ${c.code === 643 ? 'selected' : ''}>${c.name}</option>`).join('');
  setStrats(); overview(); loadNetwork();
}

/* ---------- years compared ---------- */
async function overview() {
  const S = await api('summary'), ys = Object.keys(S).sort();
  const rows = [['Countries trading', 'nodes', 0], ['Trade links', 'edges', 0], ['Density', 'density', 4],
    ['Reciprocity', 'reciprocity', 3], ['Clustering coefficient', 'clustering', 3], ['Average path length', 'avg_path', 2],
    ['Diameter', 'diameter', 0], ['Largest weakly connected component', 'lwcc', 0], ['Strongly connected components', 'scc', 0],
    ['Export concentration (HHI)', 'hhi_exports', 3], ['Import concentration (HHI)', 'hhi_imports', 3],
    [`Total flow (${UNIT.label})`, 'volume', 1, v => v / UNIT.div],
    ['Russia, share of global exports (%)', 'ru_share', 2], ['Russia, number of importers', 'ru_partners', 0],
    ['Ukraine, share of global exports (%)', 'ua_share', 3], ['Ukraine, number of importers', 'ua_partners', 0]];
  $('#ov-table').innerHTML = `<table><tr><th></th>${ys.map(y => `<th>${y}</th>`).join('')}<th>${ys[0]}→${ys.at(-1)}</th></tr>` +
    rows.map(([l, k, d, f = x => x]) => {
      const a = f(S[ys[0]][k]), b = f(S[ys.at(-1)][k]), ch = a ? (b - a) / a * 100 : 0;
      return `<tr><td>${l}</td>${ys.map(y => `<td>${fmt(f(S[y][k]), d)}</td>`).join('')}<td class="${ch > 0 ? 'up' : 'down'}">${ch > 0 ? '+' : ''}${fmt(ch, 1)}%</td></tr>`;
    }).join('') + '</table>';
  const top = [...new Set(ys.flatMap(y => S[y].top_exporters.slice(0, 8).map(e => e.name)))];
  draw('ov-chart', { type: 'bar', data: { labels: top, datasets: ys.map(y => ({ label: y, backgroundColor: yc(y),
    data: top.map(n => S[y].top_exporters.find(e => e.name === n)?.share ?? 0) })) },
    options: { scales: { y: { title: { display: true, text: '% of global flow' } } } } });
}

/* ---------- network ---------- */
const METRICS = { out_strength: 'Export volume', in_strength: 'Import volume', pr_out: 'PageRank as supplier', pr_in: 'PageRank as destination',
  betweenness: 'Betweenness (inverse-flow distance)', closeness: 'Closeness', out_degree: 'Number of importers', in_degree: 'Number of suppliers' };
$('#net-metric').innerHTML = Object.entries(METRICS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
$('#net-year').onchange = $('#net-metric').onchange = () => loadNetwork();
let NET;
async function loadNetwork() {
  const sel = $('#net-metric').value;
  if (!NET || NET.year != $('#net-year').value) NET = await api('network?year=' + $('#net-year').value);
  renderTopo(); renderRank(sel); renderGraph(sel); renderDeg();
}
function renderTopo() {
  const t = NET.topology, items = [['Countries', t.nodes], ['Links', t.edges], ['Density', fmt(t.density, 4)], ['Reciprocity', fmt(t.reciprocity, 3)],
    ['Clustering', fmt(t.clustering, 3)], ['Avg path length', fmt(t.avg_path, 2)], ['Diameter', t.diameter], ['Weak component', t.lwcc],
    ['Strong components', t.scc], ['Export HHI', fmt(t.hhi_exports, 3)], ['Import HHI', fmt(t.hhi_imports, 3)], [`Flow (${UNIT.label})`, fmt(t.volume / UNIT.div, 1)]];
  $('#topo').innerHTML = items.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
}
function renderRank(m) {
  const top = [...NET.nodes].sort((a, b) => b[m] - a[m]).slice(0, 15);
  const cols = ['out_strength', 'in_strength', 'pr_out', 'betweenness'];
  $('#rank').innerHTML = `<table><tr><th>Country</th>${cols.map(c => `<th>${METRICS[c].split(' (')[0]}</th>`).join('')}</tr>` +
    top.map(n => `<tr><td>${n.name}</td>${cols.map(c => `<td>${c.includes('strength') ? fmt(n[c] / UNIT.div, 1) : fmt(n[c], 4)}</td>`).join('')}</tr>`).join('') + '</table>';
}
function renderGraph(m) {
  const svg = d3.select('#graph'); svg.selectAll('*').remove();
  const nodes = [...NET.nodes].sort((a, b) => b[m] - a[m]).slice(0, 70).map(d => ({ ...d }));
  const ids = new Set(nodes.map(n => n.code));
  const links = NET.edges.filter(e => ids.has(e.s) && ids.has(e.t)).map(e => ({ source: e.s, target: e.t, w: e.w }));
  const r = d3.scaleSqrt().domain([0, d3.max(nodes, d => d[m]) || 1]).range([3, 26]);
  const lw = d3.scaleSqrt().domain([0, d3.max(links, d => d.w) || 1]).range([0.3, 5]);
  const col = d3.scaleLinear().domain([-1, 0, 1]).range(['#1e6f8c', '#9aa8b2', '#c2770e']);
  const bal = d => { const s = d.out_strength + d.in_strength; return s ? (d.out_strength - d.in_strength) / s : 0; };
  const sim = d3.forceSimulation(nodes).force('link', d3.forceLink(links).id(d => d.code).distance(70).strength(.25))
    .force('charge', d3.forceManyBody().strength(-120)).force('center', d3.forceCenter(380, 260)).force('collide', d3.forceCollide(d => r(d[m]) + 2));
  const L = svg.append('g').attr('stroke', '#7d8c97').attr('stroke-opacity', .3).selectAll('line').data(links).join('line').attr('stroke-width', d => lw(d.w));
  const N = svg.append('g').selectAll('g').data(nodes).join('g').call(d3.drag()
    .on('start', (e, d) => { if (!e.active) sim.alphaTarget(.3).restart(); d.fx = d.x; d.fy = d.y; })
    .on('drag', (e, d) => { d.fx = e.x; d.fy = e.y; }).on('end', (e, d) => { if (!e.active) sim.alphaTarget(0); d.fx = d.fy = null; }));
  N.append('circle').attr('r', d => r(d[m])).attr('fill', d => col(bal(d)))
    .attr('stroke', d => [643, 804].includes(d.code) ? '#17222b' : '#fff').attr('stroke-width', d => [643, 804].includes(d.code) ? 3 : 1)
    .append('title').text(d => `${d.name}\n${METRICS[m]}: ${fmt(d[m], 4)}`);
  N.filter((d, i) => i < 14).append('text').text(d => d.name).attr('font-size', 10).attr('dy', d => -r(d[m]) - 3).attr('text-anchor', 'middle').attr('fill', '#17222b');
  sim.on('tick', () => { L.attr('x1', d => d.source.x).attr('y1', d => d.source.y).attr('x2', d => d.target.x).attr('y2', d => d.target.y);
    N.attr('transform', d => `translate(${d.x = Math.max(20, Math.min(740, d.x))},${d.y = Math.max(20, Math.min(500, d.y))})`); });
}
function renderDeg() {
  const ccdf = k => { const v = NET.nodes.map(n => n[k]).filter(x => x > 0), u = [...new Set(v)].sort((a, b) => a - b);
    return u.map(x => ({ x, y: v.filter(z => z >= x).length / v.length })); };
  draw('deg-chart', { type: 'line', data: { datasets: [
    { label: 'Suppliers per importer (in-degree)', data: ccdf('in_degree'), borderColor: '#1e6f8c', pointRadius: 2 },
    { label: 'Importers per exporter (out-degree)', data: ccdf('out_degree'), borderColor: '#c2770e', pointRadius: 2 }] },
    options: { scales: { x: { type: 'logarithmic', title: { display: true, text: 'degree k' } }, y: { type: 'logarithmic', title: { display: true, text: 'P(K ≥ k)' } } } } });
}

/* ---------- robustness ---------- */
const NODE_S = [['random', 'Random'], ['out_strength', 'Largest exporters first'], ['in_strength', 'Largest importers first'], ['betweenness', 'Highest betweenness first'], ['pagerank_out', 'Highest supplier PageRank first']];
const EDGE_S = [['random', 'Random'], ['heaviest', 'Heaviest flows first'], ['lightest', 'Lightest flows first']];
const modeOf = () => document.querySelector('input[name=mode]:checked').value;
function setStrats() {
  const node = modeOf() === 'node';
  checks('#rob-strats', 'rs', node ? NODE_S : EDGE_S, (v, i) => i < 3);
  $('.adapt').style.display = node ? '' : 'none';
  $('#rob-max').value = node ? 20 : 50;
}
document.querySelectorAll('input[name=mode]').forEach(e => e.onchange = setStrats);
let ROB;
$('#rob-form').onsubmit = e => { e.preventDefault(); withBusy($('#rob-go'), async () => {
  const years = picked('ry').map(Number), strategies = picked('rs');
  if (!years.length || !strategies.length) throw new Error('Pick at least one year and one removal order.');
  ROB = await api('robustness', { mode: modeOf(), years, strategies, steps: +$('#rob-steps').value, max_frac: $('#rob-max').value / 100,
    runs: +$('#rob-runs').value, adaptive: $('#rob-adaptive').checked, surge: $('#rob-surge').value / 100, newlinks: $('#rob-new').checked });
  $('#rob-out').hidden = false; renderRob();
}); };
$('#rob-metric').onchange = () => ROB && renderRob();
function renderRob() {
  const m = $('#rob-metric').value, R = ROB.results, label = Object.fromEntries([...NODE_S, ...EDGE_S]);
  const ds = []; const strats = Object.keys(Object.values(R)[0]);
  for (const y of Object.keys(R).sort()) strats.forEach((s, i) => ds.push({ label: `${y} · ${label[s]}`, borderColor: yc(y), borderDash: DASH[i % 5],
    borderWidth: 2, pointRadius: 0, data: R[y][s].x.map((x, k) => ({ x, y: R[y][s][m][k] })) }));
  draw('rob-chart', { type: 'line', data: { datasets: ds }, options: { scales: { x: { type: 'linear', title: { display: true, text: `% of ${modeOf() === 'node' ? 'countries' : 'links'} removed` } },
    y: { min: 0, max: 100, title: { display: true, text: $('#rob-metric').selectedOptions[0].text } } }, plugins: { legend: { labels: { boxWidth: 24 } } } } });
  const trapz = (x, y) => y.reduce((a, v, i) => i ? a + (x[i] - x[i - 1]) * (v + y[i - 1]) / 2 : 0, 0);
  const rows = []; for (const y of Object.keys(R).sort()) for (const s of strats) {
    const c = R[y][s], served = c.unmet.map(u => 100 - u), xmax = c.x.at(-1), at = c.unmet.findIndex(u => u >= 10);
    rows.push(`<tr><td>${y}</td><td>${label[s]}</td><td>${fmt(trapz(c.x, served) / (xmax * 100), 3)}</td><td>${at < 0 ? 'not reached' : fmt(c.x[at], 1) + '%'}</td><td>${fmt(c.unmet.at(-1), 1)}%</td></tr>`); }
  $('#rob-table').innerHTML = `<table><tr><th>Year</th><th>Removal order</th><th>Robustness R (served demand)</th><th>Removed before 10% unmet</th><th>Unmet at end</th></tr>${rows.join('')}</table>`;
}

/* ---------- supply shock ---------- */
$('#sc-red').oninput = e => $('#sc-red-v').textContent = e.target.value;
let SC;
$('#sc-form').onsubmit = e => { e.preventDefault(); withBusy($('#sc-form .go'), async () => {
  const years = picked('sy').map(Number); if (!years.length) throw new Error('Pick at least one year.');
  SC = (await api('scenario', { years, countries: [{ code: +$('#sc-country').value, reduction: $('#sc-red').value / 100 }],
    surge: $('#sc-surge').value / 100, newlinks: $('#sc-new').checked })).results;
  $('#sc-out').hidden = false; $('#sc-year').value = Object.keys(SC).sort().at(-1); renderSc();
}); };
$('#sc-year').onchange = $('#sc-sort').onchange = () => SC && renderSc2();
function renderSc() {
  const ys = Object.keys(SC).sort();
  draw('sc-chart', { type: 'bar', data: { labels: ys, datasets: [
    { label: 'Before rerouting', backgroundColor: '#b83a2b', data: ys.map(y => SC[y].direct_unmet) },
    { label: 'After rerouting', backgroundColor: '#1e6f8c', data: ys.map(y => SC[y].residual_unmet) }] },
    options: { scales: { y: { title: { display: true, text: '% of global demand unmet' }, beginAtZero: true } } } });
  renderSc2();
}
function renderSc2() {
  const y = $('#sc-year').value, d = SC[y]; if (!d) return;
  const top = [...d.countries].sort((a, b) => b[$('#sc-sort').value] - a[$('#sc-sort').value]).slice(0, 15);
  draw('sc-chart2', { type: 'bar', data: { labels: top.map(c => c.name), datasets: [
    { label: 'Share of demand lost, before rerouting', backgroundColor: '#b83a2b', data: top.map(c => c.direct_pct) },
    { label: 'Share still unmet after rerouting', backgroundColor: '#1e6f8c', data: top.map(c => c.residual_pct) }] },
    options: { indexAxis: 'y', scales: { x: { max: 100, title: { display: true, text: '% of importer demand' } } } } });
  $('#sc-sup').innerHTML = `<table><tr><th>Exporter (${y})</th><th>Extra volume (${UNIT.label})</th><th>Increase over own exports</th></tr>` +
    d.suppliers.map(s => `<tr><td>${s.name}</td><td>${fmt(s.extra / UNIT.div, 2)}</td><td>${fmt(s.extra_pct, 1)}%</td></tr>`).join('') + '</table>';
}

boot();
