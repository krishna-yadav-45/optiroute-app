import express from 'express';
import cors from 'cors';
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));
// Geocode via Nominatim
app.get('/api/geocode', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q) return res.status(400).json({ error: 'Missing q' });
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(q)}`;
    const r = await fetch(url, {
      headers: { 'User-Agent': 'optiroute-app/1.0 (contact: example@example.com)' }
    });
    const data = await r.json();
    const results = data.map(d => ({
      display_name: d.display_name,
      lat: parseFloat(d.lat),
      lon: parseFloat(d.lon)
    }));
    res.json({ results });
  } catch (e) {
    res.status(500).json({ error: 'Geocode failed' });
  }
});
// Optimize route via OSRM Trip service
app.post('/api/optimize', async (req, res) => {
  try {
    const { waypoints = [], roundtrip = false, source = 'first' } = req.body || {};
    if (!Array.isArray(waypoints) || waypoints.length < 2) {
      return res.status(400).json({ error: 'Need at least 2 waypoints' });
    }
    const coords = waypoints.map(w => `${w.lon},${w.lat}`).join(';');
    const params = new URLSearchParams({
      roundtrip: String(roundtrip),
      source,
      overview: 'full',
      geometries: 'geojson',
      annotations: 'true'
    });
    const url = `https://router.project-osrm.org/trip/v1/driving/${coords}?${params.toString()}`;
    const r = await fetch(url);
    const data = await r.json();
    if (data.code !== 'Ok' || !data.trips?.length) {
      return res.status(500).json({ error: 'OSRM Trip failed', details: data.message || data.code });
    }
    const trip = data.trips[0];
    const ordered = data.waypoints
      .sort((a, b) => a.waypoint_index - b.waypoint_index)
      .map(wp => ({ lat: wp.location[1], lon: wp.location[0] }));
    res.json({
      distance: trip.distance,
      duration: trip.duration,
      geometry: trip.geometry,
      orderedWaypoints: ordered
    });
  } catch (e) {
    res.status(500).json({ error: 'Optimization failed' });
  }
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running: http://localhost:${PORT}`));
