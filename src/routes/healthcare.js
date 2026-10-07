const { Router } = require('express');
const { db, publicHealthFacility } = require('../db');
const { km } = require('../cities');

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
  const emergency = String(req.query.emergency || '').trim();
  const limit = Math.min(Math.max(Number(req.query.limit) || defaults.limit || 80, 1), 400);
  const radius = Math.min(Math.max(Number(req.query.radiusKm) || 80, 1), 250);
  return { lat, lng, kind, q, city, emergency, limit, radius };
}

function nameRank(name, q) {
  const n = name.toLowerCase();
  if (n === q) return 0;
  if (n.startsWith(q)) return 1;
  if (n.includes(q)) return 2;
  return 3;
}

router.get('/emergency', (_req, res) => {
  const hotlines = db()
    .prepare('SELECT * FROM health_hotlines ORDER BY sort_order, label')
    .all()
    .map((row) => ({
      id: row.id,
      label: row.label,
      number: row.number,
      detail: row.detail || '',
    }));
  const steps = db()
    .prepare('SELECT * FROM health_steps ORDER BY sort_order, title')
    .all()
    .map((row) => ({
      id: row.id,
      title: row.title,
      detail: row.detail || '',
    }));
  res.json({ hotlines, steps });
});

router.get('/nearby', (req, res) => {
  const { lat, lng, kind, q, emergency, limit, radius } = nearbyQuery(req);
  const dlat = radius / 111;
  const cos = Math.cos((lat * Math.PI) / 180) || 0.3;
  const dlng = radius / (111 * Math.abs(cos));
  const rows = db()
    .prepare(
      `SELECT * FROM health_facilities
       WHERE lat BETWEEN ? AND ?
         AND lng BETWEEN ? AND ?`,
    )
    .    all(lat - dlat, lat + dlat, lng - dlng, lng + dlng);

  const scored = [];
  for (const row of rows) {
    if (kind !== 'nearby' && !q && row.kind !== kind) continue;
    if (emergency === '1' && !row.emergency) continue;
    if (q) {
      const blob = `${row.name} ${row.city} ${row.kind} ${row.services} ${row.phone}`.toLowerCase();
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
      return a.distance - b.distance;
    });

  const items = scored.slice(0, limit).map((item) =>
    publicHealthFacility(item.row, Number(item.distance.toFixed(2))),
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
      'SELECT kind, COUNT(*) AS n FROM health_facilities GROUP BY kind ORDER BY n DESC',
    )
    .all();
  res.json({ items: rows.map((row) => ({ kind: row.kind, count: row.n })) });
});

router.get('/:id', (req, res) => {
  const row = db()
    .prepare('SELECT * FROM health_facilities WHERE id = ?')
    .get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Facility not found' });
  res.json(publicHealthFacility(row));
});

module.exports = { router };
