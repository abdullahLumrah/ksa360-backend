const crypto = require('crypto');
const express = require('express');
const { db, publicRestaurant, publicActivity, publicPost, publicSouqAd } = require('../db');
const { checkAdminLogin, signAdmin, requireAdmin } = require('../admin_auth');

const router = express.Router();

function pageParams(query, max = 50) {
  const page = Math.max(0, Number(query.page || 0));
  const limit = Math.min(max, Math.max(1, Number(query.limit || 24)));
  return { page, limit, offset: page * limit };
}

function like(value) {
  return `%${String(value || '').trim()}%`;
}

function recordAction(admin, action, entity, entityId, detail = '') {
  db()
    .prepare(
      `INSERT INTO admin_actions (action_id, actor, action, entity, entity_id, detail)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(`act_${crypto.randomUUID()}`, admin.email, action, entity, entityId, detail);
}

router.post('/login', (req, res) => {
  const admin = checkAdminLogin(req.body.email, req.body.password);
  res.json({ token: signAdmin(admin.email), admin });
});

router.use(requireAdmin);

router.get('/me', (req, res) => {
  res.json({ admin: req.admin });
});

router.get('/overview', (_req, res) => {
  const count = (sql) => db().prepare(sql).get().n;
  res.json({
    restaurants: count('SELECT COUNT(*) AS n FROM restaurants'),
    activities: count('SELECT COUNT(*) AS n FROM activities'),
    posts: count('SELECT COUNT(*) AS n FROM posts'),
    users: count('SELECT COUNT(*) AS n FROM users'),
    souqAds: count('SELECT COUNT(*) AS n FROM souq_ads'),
    awaiting: count("SELECT COUNT(*) AS n FROM souq_ads WHERE status = 'awaiting_approval'"),
    pending: count("SELECT COUNT(*) AS n FROM souq_ads WHERE status = 'pending'"),
    events: count('SELECT COUNT(*) AS n FROM analytics_events'),
    eventsToday: count("SELECT COUNT(*) AS n FROM analytics_events WHERE created_at >= date('now')"),
  });
});

router.get('/restaurants', (req, res) => {
  const { page, limit, offset } = pageParams(req.query);
  const q = String(req.query.q || '').trim();
  const where = q ? 'WHERE name LIKE @q OR city LIKE @q OR cuisine LIKE @q OR kind LIKE @q' : '';
  const params = q ? { q: like(q) } : {};
  const total = db().prepare(`SELECT COUNT(*) AS n FROM restaurants ${where}`).get(params).n;
  const rows = db()
    .prepare(`SELECT * FROM restaurants ${where} ORDER BY name LIMIT @limit OFFSET @offset`)
    .all({ ...params, limit, offset });
  res.json({ items: rows.map((row) => publicRestaurant(row)), total, page, limit });
});

router.patch('/restaurants/:id', (req, res) => {
  const row = db().prepare('SELECT * FROM restaurants WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Restaurant not found' });
  const next = {
    name: String(req.body.name ?? row.name).trim() || row.name,
    city: String(req.body.city ?? row.city),
    cuisine: String(req.body.cuisine ?? row.cuisine),
    kind: String(req.body.kind ?? row.kind),
    phone: String(req.body.phone ?? row.phone),
    hours: String(req.body.hours ?? row.hours),
    web: String(req.body.web ?? row.web),
    image: String(req.body.image ?? row.image),
    youtube_id: String(req.body.video ?? req.body.youtube_id ?? row.youtube_id),
  };
  db()
    .prepare(
      `UPDATE restaurants SET name=@name, city=@city, cuisine=@cuisine, kind=@kind,
       phone=@phone, hours=@hours, web=@web, image=@image, youtube_id=@youtube_id,
       updated_at=datetime('now') WHERE id=@id`,
    )
    .run({ ...next, id: row.id });
  recordAction(req.admin, 'update', 'restaurant', row.id, next.name);
  res.json(publicRestaurant(db().prepare('SELECT * FROM restaurants WHERE id = ?').get(row.id)));
});

router.delete('/restaurants/:id', (req, res) => {
  const row = db().prepare('SELECT * FROM restaurants WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Restaurant not found' });
  db().prepare('DELETE FROM restaurants WHERE id = ?').run(row.id);
  recordAction(req.admin, 'delete', 'restaurant', row.id, row.name);
  res.json({ ok: true });
});

router.get('/activities', (req, res) => {
  const { page, limit, offset } = pageParams(req.query);
  const q = String(req.query.q || '').trim();
  const where = q ? 'WHERE name LIKE @q OR city LIKE @q OR kind LIKE @q' : '';
  const params = q ? { q: like(q) } : {};
  const total = db().prepare(`SELECT COUNT(*) AS n FROM activities ${where}`).get(params).n;
  const rows = db()
    .prepare(`SELECT * FROM activities ${where} ORDER BY name LIMIT @limit OFFSET @offset`)
    .all({ ...params, limit, offset });
  res.json({ items: rows.map((row) => publicActivity(row)), total, page, limit });
});

router.patch('/activities/:id', (req, res) => {
  const row = db().prepare('SELECT * FROM activities WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Activity not found' });
  const next = {
    name: String(req.body.name ?? row.name).trim() || row.name,
    city: String(req.body.city ?? row.city),
    kind: String(req.body.kind ?? row.kind),
    about: String(req.body.about ?? row.about),
    image: String(req.body.image ?? row.image),
    youtube_id: String(req.body.video ?? req.body.youtube_id ?? row.youtube_id),
    phone: String(req.body.phone ?? row.phone),
    hours: String(req.body.hours ?? row.hours),
    web: String(req.body.web ?? row.web),
  };
  db()
    .prepare(
      `UPDATE activities SET name=@name, city=@city, kind=@kind, about=@about, image=@image,
       youtube_id=@youtube_id, phone=@phone, hours=@hours, web=@web, updated_at=datetime('now')
       WHERE id=@id`,
    )
    .run({ ...next, id: row.id });
  recordAction(req.admin, 'update', 'activity', row.id, next.name);
  res.json(publicActivity(db().prepare('SELECT * FROM activities WHERE id = ?').get(row.id)));
});

router.delete('/activities/:id', (req, res) => {
  const row = db().prepare('SELECT * FROM activities WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Activity not found' });
  db().prepare('DELETE FROM activities WHERE id = ?').run(row.id);
  recordAction(req.admin, 'delete', 'activity', row.id, row.name);
  res.json({ ok: true });
});

router.get('/posts', (req, res) => {
  const { page, limit, offset } = pageParams(req.query);
  const q = String(req.query.q || '').trim();
  const where = q ? 'WHERE title LIKE @q OR excerpt LIKE @q OR source LIKE @q' : '';
  const params = q ? { q: like(q) } : {};
  const total = db().prepare(`SELECT COUNT(*) AS n FROM posts ${where}`).get(params).n;
  const rows = db()
    .prepare(`SELECT * FROM posts ${where} ORDER BY date DESC LIMIT @limit OFFSET @offset`)
    .all({ ...params, limit, offset });
  res.json({ items: rows.map((row) => publicPost(row, { includeBody: false })), total, page, limit });
});

router.get('/posts/:id', (req, res) => {
  const row = db().prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Post not found' });
  res.json(publicPost(row, { includeBody: true }));
});

router.patch('/posts/:id', (req, res) => {
  const row = db().prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Post not found' });
  const next = {
    title: String(req.body.title ?? row.title).trim() || row.title,
    excerpt: String(req.body.excerpt ?? row.excerpt),
    image: String(req.body.image ?? row.image),
  };
  db().prepare(`UPDATE posts SET title=@title, excerpt=@excerpt, image=@image, updated_at=datetime('now') WHERE id=@id`)
    .run({ ...next, id: row.id });
  recordAction(req.admin, 'update', 'post', row.id, next.title);
  res.json(publicPost(db().prepare('SELECT * FROM posts WHERE id = ?').get(row.id)));
});

router.delete('/posts/:id', (req, res) => {
  const row = db().prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Post not found' });
  db().prepare('DELETE FROM post_categories WHERE post_id = ?').run(row.id);
  db().prepare('DELETE FROM post_tags WHERE post_id = ?').run(row.id);
  db().prepare('DELETE FROM posts WHERE id = ?').run(row.id);
  recordAction(req.admin, 'delete', 'post', row.id, row.title);
  res.json({ ok: true });
});

router.get('/users', (req, res) => {
  const { page, limit, offset } = pageParams(req.query);
  const q = String(req.query.q || '').trim();
  const where = q ? 'WHERE name LIKE @q OR email LIKE @q OR id LIKE @q' : '';
  const params = q ? { q: like(q) } : {};
  const total = db().prepare(`SELECT COUNT(*) AS n FROM users ${where}`).get(params).n;
  const rows = db()
    .prepare(`SELECT * FROM users ${where} ORDER BY created_at DESC LIMIT @limit OFFSET @offset`)
    .all({ ...params, limit, offset });
  res.json({
    items: rows.map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      dateOfBirth: row.date_of_birth || '',
      gender: row.gender || '',
      avatar: row.avatar || '',
      provider: row.provider || 'email',
      googleId: row.google_id || '',
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
    total,
    page,
    limit,
  });
});

router.get('/users/:id', (req, res) => {
  const row = db().prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'User not found' });
  const sessions = db()
    .prepare('SELECT jti, expires_at, revoked, created_at FROM sessions WHERE user_id = ? ORDER BY created_at DESC')
    .all(row.id);
  const ads = db()
    .prepare('SELECT ad_id, title, status, views, created_at FROM souq_ads WHERE seller_id = ? ORDER BY created_at DESC')
    .all(row.id);
  res.json({
    user: {
      id: row.id,
      name: row.name,
      email: row.email,
      dateOfBirth: row.date_of_birth,
      gender: row.gender,
      avatar: row.avatar,
      provider: row.provider,
      googleId: row.google_id || '',
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    },
    sessions: sessions.map((item) => ({
      jti: item.jti,
      expiresAt: item.expires_at,
      revoked: Boolean(item.revoked),
      createdAt: item.created_at,
    })),
    ads,
  });
});

function parseJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch (_) {
    return fallback;
  }
}

router.get('/souq/categories', (_req, res) => {
  const items = db()
    .prepare('SELECT id, name_en AS name, name_ar AS nameAr, sort_order AS sortOrder FROM souq_categories ORDER BY sort_order, name_en')
    .all();
  res.json({ items });
});

router.get('/souq/ads', (req, res) => {
  const { page, limit, offset } = pageParams(req.query);
  const where = ['1=1'];
  const params = {};
  if (req.query.status) {
    where.push('status = @status');
    params.status = String(req.query.status);
  }
  if (req.query.category) {
    where.push('category_id = @category');
    params.category = String(req.query.category);
  }
  if (req.query.q) {
    where.push('(title LIKE @q OR make LIKE @q OR city LIKE @q OR seller_name LIKE @q)');
    params.q = like(req.query.q);
  }
  const clause = `WHERE ${where.join(' AND ')}`;
  const total = db().prepare(`SELECT COUNT(*) AS n FROM souq_ads ${clause}`).get(params).n;
  const rows = db()
    .prepare(`SELECT * FROM souq_ads ${clause} ORDER BY created_at DESC LIMIT @limit OFFSET @offset`)
    .all({ ...params, limit, offset });
  res.json({ items: rows.map(publicSouqAd), total, page, limit });
});

router.get('/souq/ads/:id', (req, res) => {
  const row = db().prepare('SELECT * FROM souq_ads WHERE ad_id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Ad not found' });
  res.json(publicSouqAd(row));
});

router.patch('/souq/ads/:id', (req, res) => {
  const row = db().prepare('SELECT * FROM souq_ads WHERE ad_id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Ad not found' });
  let images = parseJson(row.images, []);
  if (Array.isArray(req.body.images)) {
    images = req.body.images.map(String).filter(Boolean);
  } else if (req.body.image) {
    const first = String(req.body.image).trim();
    images = [first, ...images.filter((item) => item !== first)];
  }
  const next = {
    title: String(req.body.title ?? row.title).trim() || row.title,
    subtitle: String(req.body.subtitle ?? row.subtitle),
    description: String(req.body.description ?? row.description),
    city: String(req.body.city ?? row.city),
    video: String(req.body.video ?? row.video),
    images: JSON.stringify(images),
    price:
      req.body.price === '' || req.body.price == null
        ? row.price
        : Number(req.body.price),
  };
  db()
    .prepare(
      `UPDATE souq_ads SET title=@title, subtitle=@subtitle, description=@description,
       city=@city, video=@video, images=@images, price=@price, updated_at=datetime('now')
       WHERE ad_id=@id`,
    )
    .run({ ...next, id: row.ad_id });
  recordAction(req.admin, 'update', 'souq_ad', row.ad_id, next.title);
  res.json(publicSouqAd(db().prepare('SELECT * FROM souq_ads WHERE ad_id = ?').get(row.ad_id)));
});

router.post('/souq/ads/:id/approve', (req, res) => {
  const row = db().prepare('SELECT * FROM souq_ads WHERE ad_id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Ad not found' });
  db().prepare("UPDATE souq_ads SET status = 'approved', updated_at = datetime('now') WHERE ad_id = ?").run(row.ad_id);
  recordAction(req.admin, 'approve', 'souq_ad', row.ad_id, row.title);
  res.json(publicSouqAd(db().prepare('SELECT * FROM souq_ads WHERE ad_id = ?').get(row.ad_id)));
});

router.post('/souq/ads/:id/decline', (req, res) => {
  const row = db().prepare('SELECT * FROM souq_ads WHERE ad_id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Ad not found' });
  db().prepare("UPDATE souq_ads SET status = 'declined', updated_at = datetime('now') WHERE ad_id = ?").run(row.ad_id);
  recordAction(req.admin, 'decline', 'souq_ad', row.ad_id, row.title);
  res.json(publicSouqAd(db().prepare('SELECT * FROM souq_ads WHERE ad_id = ?').get(row.ad_id)));
});

router.post('/souq/ads/:id/pending', (req, res) => {
  const row = db().prepare('SELECT * FROM souq_ads WHERE ad_id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Ad not found' });
  db().prepare("UPDATE souq_ads SET status = 'pending', updated_at = datetime('now') WHERE ad_id = ?").run(row.ad_id);
  recordAction(req.admin, 'pending', 'souq_ad', row.ad_id, row.title);
  res.json(publicSouqAd(db().prepare('SELECT * FROM souq_ads WHERE ad_id = ?').get(row.ad_id)));
});

router.delete('/souq/ads/:id', (req, res) => {
  const row = db().prepare('SELECT * FROM souq_ads WHERE ad_id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Ad not found' });
  db().prepare('DELETE FROM souq_ads WHERE ad_id = ?').run(row.ad_id);
  recordAction(req.admin, 'delete', 'souq_ad', row.ad_id, row.title);
  res.json({ ok: true });
});

router.get('/analytics/summary', (_req, res) => {
  const bySection = db()
    .prepare(
      `SELECT section, COUNT(*) AS n FROM analytics_events
       WHERE created_at >= datetime('now', '-7 days')
       GROUP BY section ORDER BY n DESC`,
    )
    .all();
  const byEvent = db()
    .prepare(
      `SELECT event_name AS name, COUNT(*) AS n FROM analytics_events
       WHERE created_at >= datetime('now', '-7 days')
       GROUP BY event_name ORDER BY n DESC`,
    )
    .all();
  const byDay = db()
    .prepare(
      `SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS n FROM analytics_events
       WHERE created_at >= datetime('now', '-14 days')
       GROUP BY day ORDER BY day`,
    )
    .all();
  const topTargets = db()
    .prepare(
      `SELECT target_id AS id, target_title AS title, section, COUNT(*) AS n
       FROM analytics_events
       WHERE target_id != '' AND created_at >= datetime('now', '-7 days')
       GROUP BY target_id, target_title, section
       ORDER BY n DESC LIMIT 12`,
    )
    .all();
  res.json({ bySection, byEvent, byDay, topTargets });
});

router.get('/analytics/events', (req, res) => {
  const { page, limit, offset } = pageParams(req.query, 80);
  const where = ['1=1'];
  const params = {};
  if (req.query.section) {
    where.push('section = @section');
    params.section = String(req.query.section);
  }
  if (req.query.q) {
    where.push('(event_name LIKE @q OR category LIKE @q OR target_title LIKE @q OR email LIKE @q OR device_id LIKE @q)');
    params.q = like(req.query.q);
  }
  const clause = `WHERE ${where.join(' AND ')}`;
  const total = db().prepare(`SELECT COUNT(*) AS n FROM analytics_events ${clause}`).get(params).n;
  const items = db()
    .prepare(`SELECT * FROM analytics_events ${clause} ORDER BY created_at DESC LIMIT @limit OFFSET @offset`)
    .all({ ...params, limit, offset });
  res.json({ items, total, page, limit });
});

router.get('/analytics/journey', (req, res) => {
  const userId = String(req.query.userId || '').trim();
  const deviceId = String(req.query.deviceId || '').trim();
  if (!userId && !deviceId) return res.status(400).json({ error: 'userId or deviceId is required' });
  const items = userId
    ? db().prepare('SELECT * FROM analytics_events WHERE user_id = ? ORDER BY created_at DESC LIMIT 200').all(userId)
    : db().prepare('SELECT * FROM analytics_events WHERE device_id = ? ORDER BY created_at DESC LIMIT 200').all(deviceId);
  res.json({ items });
});

router.get('/actions', (req, res) => {
  const { page, limit, offset } = pageParams(req.query);
  const total = db().prepare('SELECT COUNT(*) AS n FROM admin_actions').get().n;
  const items = db()
    .prepare('SELECT * FROM admin_actions ORDER BY created_at DESC LIMIT ? OFFSET ?')
    .all(limit, offset);
  res.json({ items, total, page, limit });
});

module.exports = { router };
