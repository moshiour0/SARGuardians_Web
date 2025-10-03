// js/app.js
document.addEventListener('DOMContentLoaded', function () {
  // --- Simple Leaflet map initialization ---
  const map = L.map('map', {attributionControl: false}).setView([46.38, 7.75], 13); // center near Blatten

  // Base layer (OpenStreetMap)
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19
  }).addTo(map);

  // Optional: overlay tile layers (replace with your generated tiles or a tile server)
  // Example local tile folder produced by gdal2tiles -> /web_tiles/<layer>/{z}/{x}/{y}.png
  const s2Layer = L.tileLayer('/web_tiles/s2_after/{z}/{x}/{y}.png', {opacity:1.0});
  const velLayer = L.tileLayer('/web_tiles/velocity/{z}/{x}/{y}.png', {opacity:0.9});

  // Add toggles from DOM
  const toggleS2 = document.getElementById('toggle-s2');
  const toggleVel = document.getElementById('toggle-vel');
  const toggleGeo = document.getElementById('toggle-geo');

  function toggleLayer(checkbox, layer) {
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) map.addLayer(layer);
      else map.removeLayer(layer);
    });
    // initial
    if (checkbox.checked) map.addLayer(layer);
  }
  toggleLayer(toggleS2, s2Layer);
  toggleLayer(toggleVel, velLayer);

  // Load simplified GeoJSON polygon (change polygon) and style it
  fetch('/derived/grd_outputs/amplitude_change.geojson').then(r => {
    if (!r.ok) throw new Error('No geojson');
    return r.json();
  }).then(geojson => {
    const styleGlow = {
      color: '#ff3b3b',
      weight: 2,
      fillOpacity: 0.12
    };
    const polygon = L.geoJSON(geojson, {style: styleGlow}).addTo(map);
    if (toggleGeo.checked) polygon.addTo(map);
    // fit bounds
    try { map.fitBounds(polygon.getBounds(), {padding:[30,30]}); } catch(e){}
  }).catch(err => {
    console.log('No geojson available:', err.message);
  });

  // Map click: show lat/lon and optionally request pixel value from your value API (if you have one)
  map.on('click', function(e){
    const lat = e.latlng.lat.toFixed(6), lon = e.latlng.lng.toFixed(6);
    const popup = L.popup().setLatLng(e.latlng).setContent(`<b>Location</b><br>${lat}, ${lon}`).openOn(map);

    // If you run the Flask pixel-value API (scripts/value_api.py), you can fetch:
    // fetch(`/value?lat=${lat}&lon=${lon}`).then(r => r.json()).then(d => console.log(d));
  });

  // Simple tabs behavior (switch panel)
  document.querySelectorAll('.tabs a').forEach(a=>{
    a.addEventListener('click', function(ev){
      ev.preventDefault();
      document.querySelectorAll('.tabs li').forEach(li=>li.classList.remove('active'));
      this.parentElement.classList.add('active');
      // reveal the section
      document.querySelectorAll('.panel').forEach(p=>p.style.display='none');
      const id = this.getAttribute('href').substring(1);
      const el = document.getElementById(id);
      if (el) el.style.display='block';
      window.scrollTo({top:120,behavior:'smooth'});
    });
  });

  // initialize visible panels (show dashboard)
  document.querySelectorAll('.panel').forEach(p=>p.style.display='none');
  document.getElementById('dashboard').style.display = 'flex';
});
