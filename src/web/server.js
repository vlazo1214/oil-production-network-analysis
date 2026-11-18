import express from 'express';
const app = express();
const API = process.env.API_URL || 'http://localhost:8081';

app.use('/api', express.json({ limit: '1mb' }), async (req, res) => {
  try {
    const hasBody = !['GET', 'HEAD'].includes(req.method);
    const r = await fetch(API + '/api' + req.url, {
      method: req.method,
      headers: { 'content-type': 'application/json' },
      body: hasBody ? JSON.stringify(req.body) : undefined,
    });
    res.status(r.status).type('json').send(await r.text());
  } catch (e) {
    res.status(502).json({ error: 'Julia API unreachable: ' + e.message });
  }
});
app.use('/vendor/d3', express.static('node_modules/d3/dist'));
app.use('/vendor/chart', express.static('node_modules/chart.js/dist'));
app.use(express.static('public'));
app.listen(3000, () => console.log('web on :3000 -> ' + API));
