// api/counter.js
export default async function handler(req, res) {
  // Allow CORS so your GitHub Pages site can call this endpoint successfully.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  try {
    // Call the CounterAPI on the server side (not blocked by browser extensions)
    const upstream = await fetch('https://api.counterapi.dev/v2/sarguardians/sarguardians/up', {
      method: 'GET'
    });

    const data = await upstream.json();

    // Mirror the upstream status and body
    res.status(upstream.status).json(data);
  } catch (err) {
    console.error('Proxy fetch failed:', err && err.stack ? err.stack : err);
    res.status(502).json({ error: 'proxy_failed', message: String(err) });
  }
}
