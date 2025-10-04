// api/counter.js
import fetch from 'node-fetch';

export default async function handler(req, res) {
  // 1️⃣ Get visitor IP
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';

  // 2️⃣ Build a unique slug for this IP (URL-safe)
  const ipSlug = ip.replace(/[:.]/g, '-'); // replace dots/colons

  try {
    // 3️⃣ Check if this IP has been counted in the last 24h
    const checkResp = await fetch(`https://api.counterapi.dev/v2/sarguardians/visit-${ipSlug}`, {
      headers: { 'Accept': 'application/json' }
    });

    const checkData = await checkResp.json();

    if (checkData && checkData.data && checkData.data.up_count > 0) {
      // ✅ Already counted today
      const mainResp = await fetch(`https://api.counterapi.dev/v2/sarguardians/sarguardians`, {
        headers: { 'Accept': 'application/json' }
      });
      const mainData = await mainResp.json();
      return res.status(200).json({
        message: 'Already counted today',
        up_count: mainData.data.up_count
      });
    }

    // 4️⃣ Increment main counter
    const incrementResp = await fetch('https://api.counterapi.dev/v2/sarguardians/sarguardians/up', {
      method: 'POST',
      headers: { 'Accept': 'application/json' }
    });
    const incrementData = await incrementResp.json();

    // 5️⃣ Mark this IP as counted (set up_count=1, will expire automatically in 24h)
    await fetch(`https://api.counterapi.dev/v2/sarguardians/visit-${ipSlug}/up`, {
      method: 'POST',
      headers: { 'Accept': 'application/json' }
    });

    // 6️⃣ Return updated total
    res.status(200).json({
      message: 'Visitor counted successfully',
      up_count: incrementData.data.up_count
    });

  } catch (err) {
    console.error('CounterAPI error:', err);
    res.status(500).json({ message: 'CounterAPI failed', error: err.toString() });
  }
}
