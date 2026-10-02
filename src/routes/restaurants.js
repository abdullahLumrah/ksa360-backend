const { Router } = require('express');
const { db, restaurantRow, publicRestaurant } = require('../db');
const { km, canonicalCity } = require('../cities');
const { nameKey, lookupVideo } = require('../videos');

const router = Router();

function nearbyQuery(req, defaults = {}) {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    const err = new Error('lat and lng are required numbers');
    err.status = 400;
    throw err;
  }
  const kind = String(req.query.kind || defaults.kind || 'nearby').trim();
  const q = String(req.query.q || req.query.query || '').trim().toLowerCase();
  const city = String(req.query.city || '').trim();
  const limit = Math.min(Math.max(Number(req.query.limit) || defaults.limit || 80, 1), 400);
  const radius = Math.min(Math.max(Number(req.query.radiusKm) || 80, 1), 250);
  return { lat, lng, kind, q, city, limit, radius };
}

function nameRank(name, q) {
  const n = name.toLowerCase();
  if (n === q) return 0;
  if (n.startsWith(q)) return 1;
  if (n.includes(q)) return 2;
  return 3;
}

function videoMap() {
  const map = new Map();
  for (const row of db().prepare('SELECT name_key, youtube_id FROM place_videos').all()) {
    map.set(row.name_key, row.youtube_id);
  }
  return map;
}

router.get('/nearby', (req, res) => {
  const { lat, lng, kind, q, city, limit, radius } = nearbyQuery(req);
  const dlat = radius / 111;
  const cos = Math.cos((lat * Math.PI) / 180) || 0.3;
  const dlng = radius / (111 * Math.abs(cos));
  const rows = db()
    .prepare(
      `SELECT * FROM restaurants
       WHERE lat BETWEEN ? AND ?
         AND lng BETWEEN ? AND ?`,
    )
    .all(lat - dlat, lat + dlat, lng - dlng, lng + dlng);

  const prefer = city.toLowerCase();
  const scored = [];
  for (const row of rows) {
    if (kind !== 'nearby' && !q && row.kind !== kind) continue;
    if (q) {
      const blob = `${row.name} ${row.city} ${row.cuisine} ${row.kind}`.toLowerCase();
      if (!blob.includes(q) && !row.name.toLowerCase().includes(q)) continue;
    }
    const distance = km(lat, lng, row.lat, row.lng);
    if (distance > radius) continue;
    scored.push({ row, distance });
  }

  scored.sort((a, b) => {
    if (q) {
      const rank = nameRank(a.row.name, q) - nameRank(b.row.name, q);
      if (rank !== 0) return rank;
    }
    if (prefer) {
      const ap = a.row.city.toLowerCase() === prefer;
      const bp = b.row.city.toLowerCase() === prefer;
      if (ap !== bp) return ap ? -1 : 1;
    }
    return a.distance - b.distance;
  });

  const items = scored.slice(0, limit).map((item) =>
    publicRestaurant(item.row, Number(item.distance.toFixed(2))),
  );
  res.json({
    count: items.length,
    totalMatched: scored.length,
    items,
  });
});

router.get('/kinds', (_req, res) => {
  const rows = db()
    .prepare(
      'SELECT kind, COUNT(*) AS n FROM restaurants GROUP BY kind ORDER BY n DESC',
    )
    .all();
  res.json({ items: rows.map((row) => ({ kind: row.kind, count: row.n })) });
});

router.get('/video', (req, res) => {
  const name = String(req.query.name || '').trim();
  if (!name) return res.status(400).json({ error: 'name is required' });
  const video = lookupVideo(videoMap(), name);
  if (!video) return res.json({ name, video: '' });
  res.json({ name, video });
});

router.get('/:id', (req, res) => {
  const row = db()
    .prepare('SELECT * FROM restaurants WHERE id = ?')
    .get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Restaurant not found' });
  res.json(publicRestaurant(row));
});

router.post('/', (req, res) => {
  const body = req.body || {};
  const lat = Number(body.lat);
  const lng = Number(body.lng);
  const name = String(body.name || '').trim();
  if (!name || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ error: 'name, lat, and lng are required' });
  }
  const id =
    String(body.id || '').trim() ||
    `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const row = restaurantRow({
    ...body,
    id,
    name,
    lat,
    lng,
    city: canonicalCity(body.city, lat, lng),
    youtube_id: body.video || body.youtube_id || lookupVideo(videoMap(), name),
    source: body.source || 'admin',
  });
  db()
    .prepare(
      `INSERT INTO restaurants (
        id, name, lat, lng, kind, cuisine, city, phone, hours, web,
        amenity, image, rating, ratings, youtube_id, google_place_id, source
      ) VALUES (
        @id, @name, @lat, @lng, @kind, @cuisine, @city, @phone, @hours, @web,
        @amenity, @image, @rating, @ratings, @youtube_id, @google_place_id, @source
      )`,
    )
    .run(row);
  const saved = db().prepare('SELECT * FROM restaurants WHERE id = ?').get(id);
  res.status(201).json(publicRestaurant(saved));
});

module.exports = { router, nameKey };
