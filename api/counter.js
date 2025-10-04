// api/counter.js
// Vercel-compatible serverless handler which proxies to CounterAPI
// Behavior: count each IP once per HOUR. Returns JSON { message, up_count }.

import fetch from 'node-fetch';

function safeGetCountFromResponse(obj) {
  if (!obj) return null;
  if (obj.data && typeof obj.data.up_count === 'number') return obj.data.up_count;
  if (obj.data && typeof obj.data.value === 'number') return obj.data.value;
  if (typeof obj.value === 'number') return obj.value;
  if (typeof obj.count === 'number') return obj.count;
  if (obj.data && typeof obj.data.count === 'number') return obj.data.count;
  return null;
}

function parseUpdatedAt(obj) {
  if (!obj) return null;
  const candidate =
    (obj.data && (obj.data.updated_at || obj.data.created_at)) ||
    obj.updated_at ||
    obj.created_at ||
    null;
  if (!candidate) return null;
  const t = Date.parse(candidate);
  return isNaN(t) ? null : t;
}

export default async function handler(req, res) {
  // Get client IP (prefer first value in x-forwarded-for)
  let ip = 'unknown';
  try {
    const xff = req.headers['x-forwarded-for'] || req.headers['x-real-ip'];
    if (xff && typeof xff === 'string') ip = xff.split(',')[0].trim();
    else if (req.socket && req.socket.remoteAddress) ip = req.socket.remoteAddress;
  } catch (e) {
    ip = 'unknown';
  }

  // slugify IP
  const rawSlug = String(ip).replace(/[:.]/g, '-').replace(/[^\w-]/g, '-');
  const ipSlug = encodeURIComponent(rawSlug);

  const NAMESPACE = 'sarguardians';
  const VISIT_KEY = `visit-${ipSlug}`;
  const MAIN_COUNTER = 'sarguardians';
  const COUNTERAPI_BASE = 'https://api.counterapi.dev/v2';

  try {
    // 1) Check visit key
    const checkResp = await fetch(`${COUNTERAPI_BASE}/${NAMESPACE}/${VISIT_KEY}`, {
      headers: { 'Accept': 'application/json' }
    });

    let alreadyCounted = false;

    if (checkResp.ok) {
      const checkData = await checkResp.json();
      const lastTs = parseUpdatedAt(checkData);
      if (lastTs !== null) {
        const ageMs = Date.now() - lastTs;
        if (ageMs < 1000 * 60 * 60) { // < 1 hour
          alreadyCounted = true;
        }
      } else {
        const up = safeGetCountFromResponse(checkData);
        if (up && up > 0) alreadyCounted = true;
      }
    } else {
      // Not found or non-OK -> treat as not counted so flow increments counter
      alreadyCounted = false;
    }

    if (alreadyCounted) {
      // fetch main counter value and return
      const mainResp = await fetch(`${COUNTERAPI_BASE}/${NAMESPACE}/${MAIN_COUNTER}`, {
        headers: { 'Accept': 'application/json' }
      });
      if (mainResp.ok) {
        const mainData = await mainResp.json();
        const upCount = safeGetCountFromResponse(mainData);
        return res.status(200).json({
          message: 'Already counted within last hour',
          up_count: typeof upCount === 'number' ? upCount : 0
        });
      } else {
        return res.status(200).json({
          message: 'Already counted within last hour (main counter unreachable)',
          up_count: 0
        });
      }
    }

    // 2) Increment main counter
    const incrementResp = await fetch(`${COUNTERAPI_BASE}/${NAMESPACE}/${MAIN_COUNTER}/up`, {
      method: 'POST',
      headers: { 'Accept': 'application/json' }
    });

    if (!incrementResp.ok) {
      console.error('Failed to increment main counter:', incrementResp.status);
      return res.status(502).json({ message: 'Failed to increment main counter', status: incrementResp.status });
    }

    const incrementData = await incrementResp.json();
    const newCount = safeGetCountFromResponse(incrementData);

    // 3) Mark this IP as counted (create/update the visit key)
    try {
      await fetch(`${COUNTERAPI_BASE}/${NAMESPACE}/${VISIT_KEY}/up`, {
        method: 'POST',
        headers: { 'Accept': 'application/json' }
      });
    } catch (err) {
      // Non-fatal; we already incremented main counter. Log and continue.
      console.warn('Warning: failed to mark visit key:', err && err.toString ? err.toString() : err);
    }

    return res.status(200).json({
      message: 'Visitor counted successfully',
      up_count: typeof newCount === 'number' ? newCount : 0
    });

  } catch (err) {
    console.error('CounterAPI proxy error:', err);
    return res.status(500).json({ message: 'CounterAPI proxy failed', error: err && err.toString ? err.toString() : String(err) });
  }
}
