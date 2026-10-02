const { Router } = require('express');
const { db, publicActivity, publicRestaurant, publicReel } = require('../db');

const router = Router();

function placeFor(row) {
  if (row.source === 'activity') {
    const found = db().prepare('SELECT * FROM activities WHERE id = ?').get(row.place_id);
    return found ? publicActivity(found) : null;
  }
  if (row.source === 'restaurant') {
    const found = db().prepare('SELECT * FROM restaurants WHERE id = ?').get(row.place_id);
    return found ? publicRestaurant(found) : null;
  }
  return null;
}

function toReel(row) {
  return publicReel(row, placeFor(row));
}

router.get('/', (req, res) => {
  const source = String(req.query.source || '').trim();
  const city = String(req.query.city || '').trim().toLowerCase();
  const rows = db()
    .prepare(
      `SELECT * FROM reels
       WHERE (? = '' OR source = ?)
       ORDER BY sort_order ASC`,
    )
    .all(source, source);
  const items = [];
  for (const row of rows) {
    if (city && row.city.toLowerCase() !== city) {
      // Return every reel; the app can sort by city.
    }
    items.push(toReel(row));
  }
  res.json({ count: items.length, items });
});

router.get('/:id', (req, res) => {
  const row =
    db().prepare('SELECT * FROM reels WHERE id = ?').get(req.params.id) ||
    db().prepare('SELECT * FROM reels WHERE youtube_id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Reel not found' });
  res.json(toReel(row));
});

router.post('/', (req, res) => {
  const body = req.body || {};
  const youtubeId = String(body.youtubeId || body.youtube_id || '').trim();
  const source = String(body.source || 'activity').trim();
  const placeId = String(body.placeId || body.place_id || body.activityId || '').trim();
  if (!youtubeId || !placeId) {
    return res.status(400).json({ error: 'youtubeId and placeId are required' });
  }
  if (source !== 'activity' && source !== 'restaurant') {
    return res.status(400).json({ error: 'source must be activity or restaurant' });
  }
  const max = db().prepare('SELECT MAX(sort_order) AS n FROM reels').get().n || 0;
  const place = placeFor({ source, place_id: placeId });
  const id = String(body.id || `${source}:${placeId}`).trim();
  db()
    .prepare(
      `INSERT INTO reels (id, youtube_id, title, hook, source, place_id, city, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      youtubeId,
      String(body.title || body.hook || (place && place.name) || ''),
      String(body.hook || ''),
      source,
      placeId,
      String(body.city || (place && place.city) || ''),
      Number(body.sortOrder ?? max + 1),
    );
  const row = db().prepare('SELECT * FROM reels WHERE id = ?').get(id);
  res.status(201).json(toReel(row));
});

module.exports = { router };
