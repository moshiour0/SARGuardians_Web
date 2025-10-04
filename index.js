// index.js - Full robust replacement
// Features:
// - Map in #dashboard only
// - Nominatim search (text or "lat,lon")
// - Layer toggles: #toggle-s2, #toggle-vel, #toggle-geo
// - Loads geojson from multiple paths
// - Visitor badge with CounterAPI + fallback
// - Tab handling with map.invalidateSize()
// - Fully resilient

(function () {
  'use strict';

  // --- Utilities ---
  const $ = (sel, scope = document) => scope.querySelector(sel);
  const $$ = (sel, scope = document) => Array.from(scope.querySelectorAll(sel));
  const safe = (fn) => { try { return fn(); } catch (e) { console.warn(e); } };

  // --- State ---
  let map = null;
  let s2Layer = null;
  let velLayer = null;
  let geoJsonLayer = null;
  let searchMarker = null;

  function getMapContainer() {
    const dashboardMap = document.querySelector('#dashboard #map');
    if (dashboardMap) return dashboardMap;
    return document.getElementById('map');
  }

  // --- Map initialization ---
  function initMapIfNeeded() {
    if (map) return map;
    const container = getMapContainer();
    if (!container) { console.warn('No #map container found. Map initialization skipped.'); return null; }

    map = L.map(container, { attributionControl: false }).setView([46.38, 7.75], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, crossOrigin: true }).addTo(map);

    try { s2Layer = L.tileLayer('/web_tiles/s2_after/{z}/{x}/{y}.png', { opacity: 1.0 }); } catch (e) { s2Layer = null; }
    try { velLayer = L.tileLayer('/web_tiles/velocity/{z}/{x}/{y}.png', { opacity: 0.9 }); } catch (e) { velLayer = null; }

    const tS2 = $('#toggle-s2'); if (tS2 && s2Layer && tS2.checked) safe(() => map.addLayer(s2Layer));
    const tVel = $('#toggle-vel'); if (tVel && velLayer && tVel.checked) safe(() => map.addLayer(velLayer));

    if (tS2) tS2.addEventListener('change', (ev) => { if (!s2Layer) return; ev.target.checked ? safe(() => map.addLayer(s2Layer)) : safe(() => map.removeLayer(s2Layer)); });
    if (tVel) tVel.addEventListener('change', (ev) => { if (!velLayer) return; ev.target.checked ? safe(() => map.addLayer(velLayer)) : safe(() => map.removeLayer(velLayer)); });

    loadGeoJson();

    map.on('click', (e) => {
      const lat = e.latlng.lat.toFixed(6), lon = e.latlng.lng.toFixed(6);
      L.popup().setLatLng(e.latlng).setContent(`<b>Location</b><br>${lat}, ${lon}`).openOn(map);
    });

    return map;
  }

  // --- Load GeoJSON ---
  async function loadGeoJson() {
    const candidates = [
      '/derived/grd_outputs/amplitude_change.geojson',
      '/derived/grd_outputs/amplitude_change.json',
      'derived/grd_outputs/amplitude_change.geojson',
      'assets/amplitude_change.geojson'
    ];
    for (const url of candidates) {
      try {
        const resp = await fetch(url);
        if (!resp.ok) continue;
        const gj = await resp.json();
        geoJsonLayer = L.geoJSON(gj, { style: { color: '#ff3b3b', weight: 2, fillOpacity: 0.12 } });
        const tGeo = $('#toggle-geo'); 
        if (tGeo && tGeo.checked) geoJsonLayer.addTo(map);
        if (tGeo && !tGeo._geoToggled) {
          tGeo._geoToggled = true;
          tGeo.addEventListener('change', (ev) => {
            if (!geoJsonLayer) return;
            ev.target.checked ? map.addLayer(geoJsonLayer) : map.removeLayer(geoJsonLayer);
          });
        }
        try { map.fitBounds(geoJsonLayer.getBounds(), { padding: [30,30] }); } catch(e) {}
        console.log('Loaded GeoJSON from', url);
        return;
      } catch(err) {}
    }
    console.info('No GeoJSON found in candidate paths.');
  }

  // --- Nominatim geocode ---
  async function geocodeNominatim(q) {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=6&addressdetails=1`;
    const resp = await fetch(url, { headers: { 'Accept-Language':'en' } });
    if (!resp.ok) throw new Error('Geocoding failed');
    return resp.json();
  }

  // --- Place search marker ---
  function placeSearchMarker(lat, lon, label) {
    if (!map) initMapIfNeeded();
    if (!map) { alert('Map not available'); return; }
    if (searchMarker) map.removeLayer(searchMarker);
    searchMarker = L.marker([lat, lon]).addTo(map);
    if (label) searchMarker.bindPopup(label).openPopup();
    map.flyTo([lat, lon], 14, { animate: true, duration: 0.9 });
  }

  // --- Tabs / panels ---
  function showPanelById(id) {
    $$('.panel').forEach(p => p.style.display = 'none');
    const el = document.getElementById(id);
    if (!el) return;
    el.style.display = (id === 'dashboard') ? 'flex' : 'block';
    if (id === 'dashboard') {
      initMapIfNeeded();
      setTimeout(() => {
        try { map.invalidateSize(true); } catch(e) {}
        if (geoJsonLayer) try { map.fitBounds(geoJsonLayer.getBounds(), { padding:[30,30] }); } catch(e) {}
      }, 240);
    }
  }

  function initTabs() {
    const tabAnchors = $$('.tabs a');
    if (!tabAnchors.length) return;
    tabAnchors.forEach(a => {
      a.addEventListener('click', (ev) => {
        ev.preventDefault();
        $$('.tabs li').forEach(li => li.classList.remove('active'));
        const li = a.closest('li'); if (li) li.classList.add('active');
        const id = (a.getAttribute('href')||'').replace('#','');
        if (id) showPanelById(id);
      });
    });
    const active = document.querySelector('.tabs li.active a');
    const initial = active ? (active.getAttribute('href')||'').replace('#','') : 'dashboard';
    showPanelById(initial || 'dashboard');
  }
// --- CounterAPI / visitor badge ---
async function incrementVisitorCounter() {
  const badge = document.getElementById('visitCountBadge');
  if (!badge) return;

  // ✅ USE YOUR VERCEL API:
  const proxyEndpoint = 'https://sar-guardians-web.vercel.app/api/counter';
  const fallbackKey = 'saveblatten_visits_v1';

  const setBadge = (n, { local = false, note = '' } = {}) => {
    badge.textContent = n;
    if (local) {
      badge.dataset.local = '1';
      badge.title = note || 'Local last-known value (remote unreachable)';
    } else {
      delete badge.dataset.local;
      badge.title = '';
    }
  };

  try {
    const resp = await fetch(proxyEndpoint, {
      method: 'GET',
      cache: 'no-store'
    });

    if (!resp.ok) {
      console.warn('Proxy returned non-OK status', resp.status);
      const prev = parseInt(localStorage.getItem(fallbackKey) || '0', 10);
      if (prev)
        setBadge(prev, { local: true, note: 'Remote returned non-OK status' });
      return;
    }

    const data = await resp.json();

    // ✅ NEW: read up_count directly from our Vercel proxy
    const up = data.up_count;

    if (up !== undefined && up !== null) {
      setBadge(Number(up), { local: false });
      try {
        localStorage.setItem(fallbackKey, String(up));
      } catch (_) {}
      return;
    }

    console.warn('Proxy: unexpected JSON shape', data);
    const prev = parseInt(localStorage.getItem(fallbackKey) || '0', 10);
    if (prev)
      setBadge(prev, { local: true, note: 'Unexpected JSON shape' });
  } catch (err) {
    console.warn('Proxy fetch failed:', err);
    const prev = parseInt(localStorage.getItem(fallbackKey) || '0', 10);
    if (prev) {
      setBadge(prev, {
        local: true,
        note: 'Request blocked or network error — value is local last-known'
      });
    } else {
      setBadge(0, {
        local: true,
        note: 'Request blocked or network error — no last-known value'
      });
    }
  }
}

  // --- UI init ---
  function initUI() {
    initTabs();

    const searchInput = document.getElementById('mapSearchInput');
    const searchBtn = document.getElementById('mapSearchBtn');
    if (searchInput) searchInput.addEventListener('keydown', (ev)=>{if(ev.key==='Enter'){ev.preventDefault(); searchBtn && searchBtn.click();}});
    if (searchBtn) searchBtn.addEventListener('click', async () => {
      const q = searchInput ? searchInput.value.trim() : '';
      if (!q) { alert('Type a place or coordinates (lat,lon)'); return; }
      const coords = q.match(/^\s*([+-]?\d+(\.\d+)?)\s*[ ,;]\s*([+-]?\d+(\.\d+)?)\s*$/);
      if (coords) { 
        const lat=parseFloat(coords[1]), lon=parseFloat(coords[3]);
        initMapIfNeeded(); placeSearchMarker(lat,lon,`Coordinates: ${lat.toFixed(6)}, ${lon.toFixed(6)}`);
        return; 
      }
      searchBtn.disabled = true; const saved=searchBtn.innerHTML; searchBtn.innerHTML='...';
      try { 
        const results = await geocodeNominatim(q);
        if(!results||!results.length){ alert(`No results for "${q}"`); return; }
        const r=results[0]; initMapIfNeeded();
        placeSearchMarker(parseFloat(r.lat),parseFloat(r.lon),r.display_name);
      } catch(err){ console.error(err); alert('Search error: could not contact geocoding service.'); } 
      finally { searchBtn.disabled=false; searchBtn.innerHTML=saved; }
    });

    incrementVisitorCounter();
  }

  document.addEventListener('DOMContentLoaded', () => {
    initUI();
    const dashboardEl = document.getElementById('dashboard');
    const isVisible = dashboardEl && (dashboardEl.style.display!=='none');
    if (isVisible) { initMapIfNeeded(); setTimeout(()=>{try{map.invalidateSize(true);}catch(e){}},300); }
  });

  // --- expose map for debug ---
  window.appMap = { getMap: ()=>map, placeSearchMarker: placeSearchMarker };
})();
