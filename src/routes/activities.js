const { Router } = require('express');
const { db, activityRow, publicActivity } = require('../db');
const { km, canonicalCity } = require('../cities');

const router = Router();
const MALL_KINDS = new Set([
  'cinema',
  'bowl',
  'arcade',
  'ice',
  'trampoline',
  'vr',
  'escape',
]);

function matchesKind(row, kind) {
  if (!kind || kind === 'all' || kind === 'nearby') return true;
  if (row.kind === kind) return true;
  let also = [];
  try {
    also = JSON.parse(row.also || '[]');
  } catch (_) {
    also = [];
  }
  if (also.includes(kind)) return true;
  if (kind === 'mall') {
    const blob = `${row.name} ${row.area}`.toLowerCase();
    if (blob.includes('mall')) return true;
    if (MALL_KINDS.has(row.kind)) return true;
  }
  return false;
}

function nearbyQuery(req) {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    const err = new Error('lat and lng are required numbers');
    err.status = 400;
    throw err;
  }
  return {
    lat,
    lng,
    kind: String(req.query.kind || 'all').trim(),
    q: String(req.query.q || req.query.query || '').trim().toLowerCase(),
    city: String(req.query.city || '').trim(),
    limit: Math.min(Math.max(Number(req.query.limit) || 200, 1), 400),
    radius: Math.min(Math.max(Number(req.query.radiusKm) || 400, 1), 2000),
  };
}

router.get('/nearby', (req, res) => {
  const { lat, lng, kind, q, city, limit, radius } = nearbyQuery(req);
  const rows = db().prepare('SELECT * FROM activities').all();
  const prefer = city.toLowerCase();
  const scored = [];
  for (const row of rows) {
    if (!matchesKind(row, kind)) continue;
    if (q) {
      const blob = `${row.name} ${row.city} ${row.kind} ${row.about} ${row.area}`.toLowerCase();
      if (!blob.includes(q)) continue;
    }
    const distance = km(lat, lng, row.lat, row.lng);
    if (distance > radius) continue;
    scored.push({ row, distance });
  }
  scored.sort((a, b) => {
    if (prefer) {
      const ap = a.row.city.toLowerCase() === prefer;
      const bp = b.row.city.toLowerCase() === prefer;
      if (ap !== bp) return ap ? -1 : 1;
    }
    return a.distance - b.distance;
  });
  const items = scored.slice(0, limit).map((item) =>
    publicActivity(item.row, Number(item.distance.toFixed(2))),
  );
  res.json({ count: items.length, totalMatched: scored.length, items });
});

router.get('/kinds', (_req, res) => {
  const rows = db()
    .prepare('SELECT kind, COUNT(*) AS n FROM activities GROUP BY kind ORDER BY n DESC')
    .all();
  res.json({ items: rows.map((row) => ({ kind: row.kind, count: row.n })) });
});

router.get('/:id', (req, res) => {
  const row = db().prepare('SELECT * FROM activities WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Activity not found' });
  res.json(publicActivity(row));
});

router.post('/', (req, res) => {
  const body = req.body || {};
  const lat = Number(body.lat);
  const lng = Number(body.lng);
  const name = String(body.name || '').trim();
  const kind = String(body.kind || '').trim();
  if (!name || !kind || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ error: 'name, kind, lat, and lng are required' });
  }
  const id =
    String(body.id || '').trim() ||
    `play-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const row = activityRow({
    ...body,
    id,
    name,
    kind,
    lat,
    lng,
    city: body.city || canonicalCity(body.city, lat, lng),
    source: body.source || 'admin',
  });
  db()
    .prepare(
      `INSERT INTO activities (
        id, name, kind, city, lat, lng, price_from, price_to, unit, image,
        about, hours, phone, web, area, also, featured, family, indoor,
        youtube_id, source
      ) VALUES (
        @id, @name, @kind, @city, @lat, @lng, @price_from, @price_to, @unit, @image,
        @about, @hours, @phone, @web, @area, @also, @featured, @family, @indoor,
        @youtube_id, @source
      )`,
    )
    .run(row);
  const saved = db().prepare('SELECT * FROM activities WHERE id = ?').get(id);
  res.status(201).json(publicActivity(saved));
});

module.exports = { router };
