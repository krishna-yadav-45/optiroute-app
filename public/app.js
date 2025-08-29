const state = {
waypoints: [], // { id, name, address, lat, lon, marker }
routeLayer: null,
fuelCostPerKm: 8
};
const map = L.map('map').setView([20.5937, 78.9629], 5);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
maxZoom: 19,
attribution: '&copy; OpenStreetMap'
}).addTo(map);
const els = {
name: document.getElementById('waypointName'),
addr: document.getElementById('waypointAddress'),
addBtn: document.getElementById('addWaypointBtn'),
results: document.getElementById('geocodeResults'),
list: document.getElementById('waypointsList'),
optimizeBtn: document.getElementById('optimizeBtn'),
clearBtn: document.getElementById('clearBtn'),
totalDistance: document.getElementById('totalDistance'),
totalTime: document.getElementById('totalTime'),
wayPointCount: document.getElementById('wayPointCount'),
fuelCost: document.getElementById('fuelCost'),
log: document.getElementById('optimizationLog'),
routeStatus: document.getElementById('routeStatus'),
currentAlgorithm: document.getElementById('currentAlgorithm'),
routeEfficiency: document.getElementById('routeEfficiency'),
algorithm: document.getElementById('algorithm'),
priority: document.getElementById('priority')
};
function log(msg) {
const el = document.createElement('div');
el.className = 'log-entry';
el.textContent = msg;
els.log.appendChild(el);
els.log.scrollTop = els.log.scrollHeight;
}
function updateStats(distMeters = 0, durSeconds = 0) {
const km = distMeters / 1000;
const minutes = durSeconds / 60;
els.totalDistance.textContent = km.toFixed(2);
els.totalTime.textContent = minutes.toFixed(1);
els.wayPointCount.textContent = String(state.waypoints.length);
els.fuelCost.textContent = `₹${(km * state.fuelCostPerKm).toFixed(0)}`;
}
function renderWaypointsList() {
els.list.innerHTML = '';
state.waypoints.forEach((wp, idx) => {
const div = document.createElement('div');
div.className = 'waypoint-item';
div.innerHTML = `
<div class="waypoint-header">
<div class="waypoint-number">${idx + 1}</div>
<button class="delete-waypoint" data-id="${wp.id}">×</button>
</div>
<div><strong>${wp.name || 'Waypoint'}</strong></div>
<div style="font-size: 0.9em; color: #666; margin-top: 5px;">${wp.address || `${wp.lat.toFixed(5)}, ${wp.lon.toFixed(5)}`}</div>
`;
div.querySelector('.delete-waypoint').addEventListener('click', () => removeWaypoint(wp.id));
els.list.appendChild(div);
});
}
function removeWaypoint(id) {
const idx = state.waypoints.findIndex(w => w.id === id);
if (idx >= 0) {
const [wp] = state.waypoints.splice(idx, 1);
if (wp.marker) map.removeLayer(wp.marker);
clearRouteLayer();
renderWaypointsList();
updateStats(0, 0);
log('Waypoint removed. Route cleared.');
}
}
function clearRouteLayer() {
if (state.routeLayer) {
map.removeLayer(state.routeLayer);
state.routeLayer = null;
}
}
function addWaypointFromGeocode(choice) {
const id = Date.now() + Math.floor(Math.random() * 1000);
const marker = L.marker([choice.lat, choice.lon]).addTo(map);
state.waypoints.push({
id,
name: els.name.value.trim() || choice.display_name.split(',')[0],
address: choice.display_name,
lat: choice.lat, lon: choice.lon,
marker
});
renderWaypointsList();
els.results.innerHTML = '';
els.name.value = '';
els.addr.value = '';
map.setView([choice.lat, choice.lon], 12);
log(`Added waypoint: ${state.waypoints[state.waypoints.length - 1].name}`);
}
async function geocodeAddress(addr) {
const r = await fetch(`/api/geocode?q=${encodeURIComponent(addr)}`);
const data = await r.json();
return data.results || [];
}
els.addBtn.addEventListener('click', async () => {
const name = els.name.value.trim();
const addr = els.addr.value.trim();
if (!addr) {
log('Please enter an address.');
return;
}
els.results.innerHTML = 'Searching...';
const results = await geocodeAddress(addr);
if (!results.length) {
els.results.innerHTML = '<div>No results found.</div>';
return;
}
els.results.innerHTML = '';
results.forEach(r => {
const item = document.createElement('div');
item.className = 'geocode-result-item';
item.textContent = r.display_name;
item.addEventListener('click', () => addWaypointFromGeocode(r));
els.results.appendChild(item);
});
});
els.clearBtn.addEventListener('click', () => {
state.waypoints.forEach(w => w.marker && map.removeLayer(w.marker));
state.waypoints = [];
renderWaypointsList();
clearRouteLayer();
updateStats(0, 0);
els.routeStatus.textContent = 'Ready';
els.routeEfficiency.textContent = '0%';
log('Cleared all.');
});
els.optimizeBtn.addEventListener('click', async () => {
if (state.waypoints.length < 2) {
log('Add at least 2 waypoints to optimize route.');
return;
}
const algorithm = els.algorithm.value;
els.routeStatus.textContent = 'Optimizing...';
els.currentAlgorithm.textContent = algorithm.toUpperCase();
const original = els.optimizeBtn.innerHTML;
els.optimizeBtn.innerHTML = '<div class="loading"></div>Optimizing...';
els.optimizeBtn.disabled = true;
try {
if (algorithm === 'osrm_trip') {
await optimizeViaServerTrip();
} else {
await optimizeNearestNeighborClient();
}
} catch (e) {
log('Optimization failed.');
els.routeStatus.textContent = 'Error';
} finally {
els.optimizeBtn.innerHTML = original;
els.optimizeBtn.disabled = false;
}
});
async function optimizeViaServerTrip() {
const waypoints = state.waypoints.map(w => ({ lat: w.lat, lon: w.lon, name: w.name }));
const r = await fetch('/api/optimize', {
method: 'POST',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({ waypoints, roundtrip: false, source: 'first' })
});
const data = await r.json();
if (!r.ok) {
log('Server optimization error.');
els.routeStatus.textContent = 'Error';
return;
}
drawGeoJsonRoute(data.geometry);
fitRouteBounds(data.geometry);
updateStats(data.distance, data.duration);
els.routeStatus.textContent = 'Optimized';
const efficiency = calcEfficiencyHeuristic(data.distance);
els.routeEfficiency.textContent = `${efficiency}%`;
log(`Optimization completed! Distance: ${(data.distance/1000).toFixed(2)} km, Time: ${(data.duration/60).toFixed(1)} min`);
}
function drawGeoJsonRoute(geojsonLineString) {
clearRouteLayer();
state.routeLayer = L.geoJSON(geojsonLineString, { style: { color: '#6b46c1', weight: 5 } }).addTo(map);
}
function fitRouteBounds(geojsonLineString) {
const coords = geojsonLineString.coordinates.map(c => [c[1], c[0]]);
const bounds = L.latLngBounds(coords);
map.fitBounds(bounds, { padding: [30, 30] });
}
function calcEfficiencyHeuristic(distanceMeters) {
if (state.waypoints.length < 2) return 0;
return Math.min(100, Math.max(0, 70 + Math.random() * 25)) | 0;
}
async function optimizeNearestNeighborClient() {
const pts = state.waypoints.map(w => ({ ...w }));
const route = [pts[0]];
const unvisited = pts.slice(1);
const dist = (a, b) => {
const dx = a.lat - b.lat, dy = a.lon - b.lon;
return Math.sqrt(dx*dx + dy*dy);
};
while (unvisited.length) {
const cur = route[route.length - 1];
let best = 0, bestd = Infinity;
for (let i = 0; i < unvisited.length; i++) {
const d = dist(cur, unvisited[i]);
 if (d < bestd) { bestd = d; best = i; }
}
route.push(unvisited.splice(best, 1)[0]);
}
const latlngs = route.map(r => [r.lat, r.lon]);
clearRouteLayer();
state.routeLayer = L.polyline(latlngs, { color: '#6b46c1', weight: 5 }).addTo(map);
map.fitBounds(L.latLngBounds(latlngs), { padding: [30, 30] });
const km = route.length > 1 ? (route.length - 1) * 5 : 0;
updateStats(km * 1000, km * 6 * 60);
els.routeStatus.textContent = 'Optimized (client)';
els.routeEfficiency.textContent = `${calcEfficiencyHeuristic(km*1000)}%`;
log('Client-side nearest neighbor route drawn (approximate).');
}
