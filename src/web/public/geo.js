/* Matches the country names/codes in the user's data to world-atlas features.
   Pure functions, no DOM or d3, so it can be tested in Node. */
(function (root) {
  const STOP = new Set(['the', 'of', 'and', 'de', 'la']);
  const EXPAND = { rep: 'republic', dem: 'democratic', is: 'islands', isds: 'islands', isl: 'islands', herz: 'herzegovina', eq: 'equatorial',
    fr: 'french', n: 'north', s: 'south', st: 'saint', ter: 'territory', terr: 'territory', barb: 'barbuda', gren: 'grenadines', vin: 'vincent', br: 'british' };

  function norm(s) {
    return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\(.*?\)/g, ' ').replace(/['’]/g, '')
      .replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean).map(t => EXPAND[t] || t).filter(t => !STOP.has(t)).join(' ');
  }

  // [name as it commonly appears in trade data, name used by the atlas]
  const PAIRS = [['USA', 'United States of America'], ['United States', 'United States of America'], ['Russian Federation', 'Russia'],
    ['Rep. of Korea', 'South Korea'], ['Korea, Rep.', 'South Korea'], ['Republic of Korea', 'South Korea'],
    ["Dem. People's Rep. of Korea", 'North Korea'], ["Korea, Dem. People's Rep.", 'North Korea'], ["Lao People's Dem. Rep.", 'Laos'],
    ['Viet Nam', 'Vietnam'], ['Türkiye', 'Turkey'], ['United Rep. of Tanzania', 'Tanzania'], ['Rep. of Moldova', 'Moldova'],
    ['Syrian Arab Republic', 'Syria'], ['Iran (Islamic Republic of)', 'Iran'], ['Iran, Islamic Rep.', 'Iran'],
    ['Venezuela (Bolivarian Republic of)', 'Venezuela'], ['Brunei Darussalam', 'Brunei'],
    ['China, Hong Kong SAR', 'Hong Kong'], ['Hong Kong SAR, China', 'Hong Kong'], ['China, Macao SAR', 'Macao'], ['Macao SAR, China', 'Macao'],
    ['State of Palestine', 'Palestine'], ['Palestine, State of', 'Palestine'], ['TFYR of Macedonia', 'Macedonia'], ['North Macedonia', 'Macedonia'],
    ['Czech Republic', 'Czechia'], ['Swaziland', 'eSwatini'], ['Eswatini', 'eSwatini'], ['Cape Verde', 'Cabo Verde'], ['Ivory Coast', "Côte d'Ivoire"],
    ['East Timor', 'Timor-Leste'], ['Faroe Islands', 'Faeroe Is.'], ['Faroe Isds', 'Faeroe Is.'], ['Other Asia, nes', 'Taiwan'], ['Taiwan, Province of China', 'Taiwan'],
    ['Chinese Taipei', 'Taiwan'], ['Congo, Dem. Rep.', 'Dem. Rep. Congo'], ['Congo, Rep.', 'Congo'], ['Bahamas, The', 'Bahamas'], ['Egypt, Arab Rep.', 'Egypt'],
    ['Yemen, Rep.', 'Yemen'], ['Slovak Republic', 'Slovakia'], ['Kyrgyz Republic', 'Kyrgyzstan'], ['Western Sahara', 'W. Sahara'], ['Saint Maarten', 'Sint Maarten'],
    ['US Virgin Isds', 'U.S. Virgin Is.'], ['Burma', 'Myanmar'], ['Gambia, The', 'Gambia'], ['Saint Lucia', 'Saint Lucia'], ['Br. Indian Ocean Terr.', 'Br. Indian Ocean Ter.']];
  const ALIAS = Object.fromEntries(PAIRS.map(([a, b]) => [norm(a), norm(b)]));

  // CEPII/Comtrade numeric codes that differ from ISO 3166-1 numeric (used only when the name did not match)
  const CODE_TO_ISO = { 251: '250', 381: '380', 579: '578', 757: '756', 842: '840', 699: '356', 490: '158' };

  /* features: [{id, name}]; countries: [{code, name}] -> {place: {code: featureIndex}, unplaced: [{code, name}]} */
  function match(features, countries, numeric) {
    const byId = new Map(), byName = new Map();
    features.forEach((f, i) => { if (f.id != null) byId.set(String(f.id).padStart(3, '0'), i); byName.set(norm(f.name), i); });
    const place = {}, unplaced = [];
    for (const c of countries) {
      const n = norm(c.name);
      let idx = byName.get(ALIAS[n]);
      if (idx == null) idx = byName.get(n);
      if (idx == null && numeric) {
        const iso = CODE_TO_ISO[c.code] ?? String(c.code).padStart(3, '0');
        idx = byId.get(iso);
      }
      idx == null ? unplaced.push(c) : (place[c.code] = idx);
    }
    return { place, unplaced };
  }
  root.Geo = { norm, match };
  if (typeof module !== 'undefined') module.exports = root.Geo;
})(typeof window !== 'undefined' ? window : globalThis);
