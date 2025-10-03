// index.js — updated: map only in dashboard, search via Nominatim, visitor badge (local or server)
let map = null;
let s2Layer = null;
let velLayer = null;
let geoJsonLayer = null;
let searchMarker = null;

// ---------- MAP INITIALIZATION (only once) ----------
function initMapIfNeeded() {
  if (map) return;
  map = L.map('map', { attributionControl: false }).setView([46.38, 7.75], 13);

  // Base layer
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);

  // Example overlay placeholders (replace with your tile URLs if available)
  s2Layer = L.tileLayer('/web_tiles/s2_after/{z}/{x}/{y}.png', { opacity: 1.0 });
  velLayer = L.tileLayer('/web_tiles/velocity/{z}/{x}/{y}.png', { opacity: 0.9 });

  // Add initial overlays according to the checkboxes (checkbox listeners will toggle)
  const toggleS2 = document.getElementById('toggle-s2');
  const toggleVel = document.getElementById('toggle-vel');
  if (toggleS2 && toggleS2.checked) map.addLayer(s2Layer);
  if (toggleVel && toggleVel.checked) map.addLayer(velLayer);

  // Load simplified geojson polygon (non-blocking)
  fetch('/derived/grd_outputs/amplitude_change.geojson').then(r => {
    if (!r.ok) throw new Error('No geojson');
    return r.json();
  }).then(geojson => {
    geoJsonLayer = L.geoJSON(geojson, { style: { color: '#ff3b3b', weight: 2, fillOpacity: 0.12 } });
    if (document.getElementById('toggle-geo')?.checked) geoJsonLayer.addTo(map);
    try { map.fitBounds(geoJsonLayer.getBounds(), { padding: [30,30] }); } catch (e) {}
  }).catch(err => console.log('GeoJSON load:', err.message));

  // Map click: popup coords
  map.on('click', (e) => {
    const lat = e.latlng.lat.toFixed(6), lon = e.latlng.lng.toFixed(6);
    L.popup().setLatLng(e.latlng).setContent(`<b>Location</b><br>${lat}, ${lon}`).openOn(map);
  });

  // Setup layer checkbox listeners
  document.getElementById('toggle-s2')?.addEventListener('change', (ev) => {
    ev.target.checked ? map.addLayer(s2Layer) : map.removeLayer(s2Layer);
  });
  document.getElementById('toggle-vel')?.addEventListener('change', (ev) => {
    ev.target.checked ? map.addLayer(velLayer) : map.removeLayer(velLayer);
  });
  document.getElementById('toggle-geo')?.addEventListener('change', (ev) => {
    if (!geoJsonLayer) return;
    ev.target.checked ? map.addLayer(geoJsonLayer) : map.removeLayer(geoJsonLayer);
  });
}

// ---------- Geocoding (Nominatim) ----------
async function geocodeNominatim(query) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=6&addressdetails=1`;
  const resp = await fetch(url, { headers: { 'Accept-Language': 'en' }});
  if (!resp.ok) throw new Error('Geocoding failed');
  return resp.json();
}

function placeSearchMarker(lat, lon, label) {
  if (!map) return;
  if (searchMarker) map.removeLayer(searchMarker);
  searchMarker = L.marker([lat, lon]).addTo(map);
  if (label) searchMarker.bindPopup(label).openPopup();
  map.flyTo([lat, lon], 14, { animate: true, duration: 0.9 });
}

// ---------- UI: tabs, search, visitor counter ----------
function initUI() {
  // Tabs -> show/hide sections, keep map only in dashboard
  document.querySelectorAll('.tabs a').forEach(a => {
    a.addEventListener('click', function (ev) {
      ev.preventDefault();
      document.querySelectorAll('.tabs li').forEach(li => li.classList.remove('active'));
      this.parentElement.classList.add('active');

      document.querySelectorAll('.panel').forEach(p => p.style.display = 'none');
      const id = this.getAttribute('href').substring(1);
      const el = document.getElementById(id);
      if (!el) return;
      el.style.display = (id === 'dashboard') ? 'flex' : 'block';

      if (id === 'dashboard') {
        // ensure map is created and resized
        initMapIfNeeded();
        setTimeout(() => {
          try {
            map.invalidateSize(true);
            if (geoJsonLayer) try { map.fitBounds(geoJsonLayer.getBounds(), { padding:[30,30] }); } catch(e){}
          } catch(e){ console.warn('invalidate size', e); }
        }, 240);
      }
    });
  });

  // Search: enter key and click
  const searchInput = document.getElementById('mapSearchInput');
  const searchBtn = document.getElementById('mapSearchBtn');

  // Enter triggers search
  searchInput?.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); searchBtn.click(); }
  });

  searchBtn?.addEventListener('click', async () => {
    const q = searchInput.value.trim();
    if (!q) { alert("Type a place or lat,lon"); return; }

    // if input is coordinates "lat, lon"
    const coords = q.match(/^\s*([+-]?\d+(\.\d+)?)\s*[ ,;]\s*([+-]?\d+(\.\d+)?)\s*$/);
    if (coords) {
      const lat = parseFloat(coords[1]), lon = parseFloat(coords[3]);
      initMapIfNeeded();
      placeSearchMarker(lat, lon, `Coordinates: ${lat.toFixed(6)}, ${lon.toFixed(6)}`);
      return;
    }

    // otherwise geocode
    searchBtn.disabled = true; const saved = searchBtn.innerHTML; searchBtn.innerHTML = '...';
    try {
      const results = await geocodeNominatim(q);
      if (!results || results.length === 0) { alert(`No results for "${q}"`); return; }
      const r = results[0];
      initMapIfNeeded();
      placeSearchMarker(parseFloat(r.lat), parseFloat(r.lon), r.display_name);
    } catch (err) {
      alert('Search error: ' + err.message);
    } finally {
      searchBtn.disabled = false; searchBtn.innerHTML = saved;
    }
  });

  // Visitor counter (attempt server, fall back to localStorage)
  tryServerVisit(); // async try increment on server
  showLocalVisit();  // immediately show local count
}

// ---------- Visitor counting ----------
function showLocalVisit() {
  const key = 'localVisits_v1';
  let c = parseInt(localStorage.getItem(key) || '0', 10);
  c = c + 1;
  localStorage.setItem(key, String(c));
  const el = document.getElementById('visitCountBadge');
  if (el) el.textContent = c;
}

// If you want real global counts, run the optional server (Flask/Node) below.
// tryServerVisit will POST to /api/visit (if you host such an endpoint).
async function tryServerVisit() {
  const badge = document.getElementById('visitCountBadge');
  if (!badge) return;
  // try POST (increment) first
  try {
    const resp = await fetch('/api/visit', { method: 'POST' });
    if (resp.ok) {
      const j = await resp.json();
      if (j && j.count !== undefined) {
        badge.textContent = j.count;
        return;
      }
    }
  } catch (err) {
    // server not available — use localStorage (already set)
  }

  // fallback: GET /api/count if POST not allowed
  try {
    const resp2 = await fetch('/api/count');
    if (resp2.ok) {
      const j2 = await resp2.json();
      if (j2 && j2.count !== undefined) {
        badge.textContent = j2.count;
        return;
      }
    }
  } catch (err) {}
}

// ---------- DOM ready ----------
document.addEventListener('DOMContentLoaded', () => {
  initUI();
  // create map now because dashboard is visible by default
  initMapIfNeeded();
  setTimeout(()=>{ try { map.invalidateSize(true); } catch(e){} }, 300);
});
