const crypto = require('crypto');
const express = require('express');
const { db, publicRestaurant, publicActivity, publicPost, publicSouqAd, publicHealthFacility, publicJob } = require('../db');
const { checkAdminLogin, signAdmin, requireAdmin } = require('../admin_auth');
const { canonicalCity } = require('../cities');

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
    healthFacilities: count('SELECT COUNT(*) AS n FROM health_facilities'),
    posts: count('SELECT COUNT(*) AS n FROM posts'),
    users: count('SELECT COUNT(*) AS n FROM users'),
    souqAds: count('SELECT COUNT(*) AS n FROM souq_ads'),
    awaiting: count("SELECT COUNT(*) AS n FROM souq_ads WHERE status = 'awaiting_approval'"),
    awaitingPosts: count("SELECT COUNT(*) AS n FROM posts WHERE status = 'awaiting_approval'"),
    jobs: count('SELECT COUNT(*) AS n FROM jobs'),
    publishedJobs: count("SELECT COUNT(*) AS n FROM jobs WHERE status = 'published'"),
    awaitingJobs: count("SELECT COUNT(*) AS n FROM jobs WHERE status = 'awaiting_approval'"),
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

function asBoolInt(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback ? 1 : 0;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number') return value ? 1 : 0;
  const s = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on', 'er'].includes(s)) return 1;
  if (['0', 'false', 'no', 'off'].includes(s)) return 0;
  return fallback ? 1 : 0;
}

function asServices(value, fallback = '') {
  if (value === undefined || value === null) return fallback;
  const parts = Array.isArray(value) ? value : String(value).split(',');
  return parts.map((part) => String(part).trim()).filter(Boolean).join(',');
}

function adminFacility(row) {
  return { ...publicHealthFacility(row), source: row.source || '' };
}

function facilityFromBody(body, row = {}) {
  const lat = Number(body.lat ?? row.lat);
  const lng = Number(body.lng ?? row.lng);
  const name = String(body.name ?? row.name ?? '').trim();
  if (!name || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    const err = new Error('name, lat, and lng are required');
    err.status = 400;
    throw err;
  }
  const kind = String(body.kind ?? row.kind ?? 'hospital').trim() || 'hospital';
  return {
    name,
    lat,
    lng,
    kind,
    city: String(body.city ?? row.city ?? '').trim() || canonicalCity('', lat, lng),
    phone: String(body.phone ?? row.phone ?? ''),
    hours: String(body.hours ?? row.hours ?? ''),
    web: String(body.web ?? row.web ?? ''),
    amenity: String(body.amenity ?? row.amenity ?? kind).trim() || kind,
    emergency: asBoolInt(body.emergency, Boolean(row.emergency)),
    services: asServices(body.services, row.services || ''),
    source: 'admin',
  };
}

router.get('/healthcare', (req, res) => {
  const { page, limit, offset } = pageParams(req.query);
  const q = String(req.query.q || '').trim();
  const kind = String(req.query.kind || '').trim();
  const where = [];
  const params = {};
  if (q) {
    where.push('(name LIKE @q OR city LIKE @q OR kind LIKE @q OR phone LIKE @q)');
    params.q = like(q);
  }
  if (kind && kind !== 'nearby') {
    where.push('kind = @kind');
    params.kind = kind;
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = db().prepare(`SELECT COUNT(*) AS n FROM health_facilities ${clause}`).get(params).n;
  const rows = db()
    .prepare(`SELECT * FROM health_facilities ${clause} ORDER BY name LIMIT @limit OFFSET @offset`)
    .all({ ...params, limit, offset });
  res.json({ items: rows.map(adminFacility), total, page, limit });
});

router.post('/healthcare', (req, res) => {
  const next = facilityFromBody(req.body);
  const id = String(req.body.id || '').trim() || `hf_${crypto.randomUUID()}`;
  if (db().prepare('SELECT id FROM health_facilities WHERE id = ?').get(id)) {
    return res.status(409).json({ error: 'Facility already exists' });
  }
  db()
    .prepare(
      `INSERT INTO health_facilities (
         id, name, lat, lng, kind, city, phone, hours, web, amenity, emergency, services, source, updated_at
       ) VALUES (
         @id, @name, @lat, @lng, @kind, @city, @phone, @hours, @web, @amenity, @emergency, @services, @source, datetime('now')
       )`,
    )
    .run({ ...next, id });
  recordAction(req.admin, 'create', 'healthcare', id, next.name);
  res.json(adminFacility(db().prepare('SELECT * FROM health_facilities WHERE id = ?').get(id)));
});

router.get('/healthcare/:id', (req, res) => {
  const row = db().prepare('SELECT * FROM health_facilities WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Facility not found' });
  res.json(adminFacility(row));
});

router.patch('/healthcare/:id', (req, res) => {
  const row = db().prepare('SELECT * FROM health_facilities WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Facility not found' });
  const next = facilityFromBody(req.body, row);
  db()
    .prepare(
      `UPDATE health_facilities SET name=@name, lat=@lat, lng=@lng, kind=@kind, city=@city,
       phone=@phone, hours=@hours, web=@web, amenity=@amenity, emergency=@emergency,
       services=@services, source=@source, updated_at=datetime('now') WHERE id=@id`,
    )
    .run({ ...next, id: row.id });
  recordAction(req.admin, 'update', 'healthcare', row.id, next.name);
  res.json(adminFacility(db().prepare('SELECT * FROM health_facilities WHERE id = ?').get(row.id)));
});

router.delete('/healthcare/:id', (req, res) => {
  const row = db().prepare('SELECT * FROM health_facilities WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Facility not found' });
  db().prepare('DELETE FROM health_facilities WHERE id = ?').run(row.id);
  recordAction(req.admin, 'delete', 'healthcare', row.id, row.name);
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

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

router.get('/posts', (req, res) => {
  const { page, limit, offset } = pageParams(req.query);
  const where = ['1=1'];
  const params = {};
  if (req.query.status) {
    where.push('status = @status');
    params.status = String(req.query.status);
  }
  if (req.query.q) {
    where.push('(title LIKE @q OR excerpt LIKE @q OR source LIKE @q OR author_name LIKE @q)');
    params.q = like(req.query.q);
  }
  const clause = `WHERE ${where.join(' AND ')}`;
  const total = db().prepare(`SELECT COUNT(*) AS n FROM posts ${clause}`).get(params).n;
  const rows = db()
    .prepare(`SELECT * FROM posts ${clause} ORDER BY date DESC LIMIT @limit OFFSET @offset`)
    .all({ ...params, limit, offset });
  res.json({ items: rows.map((row) => publicPost(row, { includeBody: true })), total, page, limit });
});

router.get('/posts/:id', (req, res) => {
  const row = db().prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Post not found' });
  res.json(publicPost(row, { includeBody: true }));
});

router.post('/posts', (req, res) => {
  const title = String(req.body.title || '').trim();
  if (!title) return res.status(400).json({ error: 'title is required' });
  const description = String(req.body.description || req.body.excerpt || req.body.body || '').trim();
  const id = String(req.body.id || `post-${crypto.randomUUID()}`).trim();
  const words = description.split(/\s+/).filter(Boolean).length;
  db()
    .prepare(
      `INSERT INTO posts (
        id, title, slug, date, excerpt, preview, body, image,
        word_count, source, source_label, status, author_id, author_name
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      title,
      String(req.body.slug || slugify(title)),
      String(req.body.date || new Date().toISOString()),
      description,
      description,
      String(req.body.body || description),
      String(req.body.image || ''),
      Number(req.body.wordCount ?? words),
      String(req.body.source || 'admin'),
      String(req.body.sourceLabel || 'KSA 360'),
      String(req.body.status || 'published'),
      'admin',
      req.admin.email,
    );
  recordAction(req.admin, 'create', 'post', id, title);
  res.status(201).json(publicPost(db().prepare('SELECT * FROM posts WHERE id = ?').get(id), { includeBody: true }));
});

router.patch('/posts/:id', (req, res) => {
  const row = db().prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Post not found' });
  const next = {
    title: String(req.body.title ?? row.title).trim() || row.title,
    excerpt: String(req.body.excerpt ?? req.body.description ?? row.excerpt),
    preview: String(req.body.preview ?? req.body.description ?? row.preview),
    body: String(req.body.body ?? req.body.description ?? row.body),
    image: String(req.body.image ?? row.image),
    slug: String(req.body.slug ?? row.slug ?? slugify(req.body.title ?? row.title)),
  };
  db()
    .prepare(
      `UPDATE posts SET title=@title, excerpt=@excerpt, preview=@preview, body=@body,
       image=@image, slug=@slug, updated_at=datetime('now') WHERE id=@id`,
    )
    .run({ ...next, id: row.id });
  recordAction(req.admin, 'update', 'post', row.id, next.title);
  res.json(publicPost(db().prepare('SELECT * FROM posts WHERE id = ?').get(row.id), { includeBody: true }));
});

router.post('/posts/:id/approve', (req, res) => {
  const row = db().prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Post not found' });
  db().prepare("UPDATE posts SET status = 'published', updated_at = datetime('now') WHERE id = ?").run(row.id);
  recordAction(req.admin, 'approve', 'post', row.id, row.title);
  res.json(publicPost(db().prepare('SELECT * FROM posts WHERE id = ?').get(row.id), { includeBody: true }));
});

router.post('/posts/:id/decline', (req, res) => {
  const row = db().prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Post not found' });
  db().prepare('DELETE FROM post_tags WHERE post_id = ?').run(row.id);
  db().prepare('DELETE FROM post_categories WHERE post_id = ?').run(row.id);
  db().prepare('DELETE FROM posts WHERE id = ?').run(row.id);
  recordAction(req.admin, 'decline', 'post', row.id, row.title);
  res.json({ ok: true, removed: true });
});

router.post('/posts/:id/pending', (req, res) => {
  const row = db().prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Post not found' });
  db().prepare("UPDATE posts SET status = 'awaiting_approval', updated_at = datetime('now') WHERE id = ?").run(row.id);
  recordAction(req.admin, 'pending', 'post', row.id, row.title);
  res.json(publicPost(db().prepare('SELECT * FROM posts WHERE id = ?').get(row.id), { includeBody: true }));
});

router.delete('/posts/:id', (req, res) => {
  const row = db().prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Post not found' });
  db().prepare('DELETE FROM post_tags WHERE post_id = ?').run(row.id);
  db().prepare('DELETE FROM post_categories WHERE post_id = ?').run(row.id);
  db().prepare('DELETE FROM posts WHERE id = ?').run(row.id);
  recordAction(req.admin, 'delete', 'post', row.id, row.title);
  res.json({ ok: true });
});

router.get('/jobs', (req, res) => {
  const { page, limit, offset } = pageParams(req.query);
  const q = String(req.query.q || '').trim();
  const status = String(req.query.status || '').trim();
  const clauses = [];
  const params = {};
  if (q) {
    clauses.push('(title LIKE @q OR company_name LIKE @q OR city LIKE @q OR category LIKE @q)');
    params.q = like(q);
  }
  if (status) {
    clauses.push('status = @status');
    params.status = status;
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const total = db().prepare(`SELECT COUNT(*) AS n FROM jobs ${where}`).get(params).n;
  const rows = db()
    .prepare(
      `SELECT * FROM jobs ${where} ORDER BY created_at DESC LIMIT @limit OFFSET @offset`,
    )
    .all({ ...params, limit, offset });
  res.json({
    items: rows.map((row) => publicJob(row, { detail: true })),
    total,
    page,
    limit,
  });
});

router.get('/jobs/:id', (req, res) => {
  const row = db().prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Job not found' });
  res.json(publicJob(row, { detail: true }));
});

router.post('/jobs/:id/approve', (req, res) => {
  const row = db().prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Job not found' });
  db().prepare("UPDATE jobs SET status = 'published', updated_at = datetime('now') WHERE id = ?").run(row.id);
  recordAction(req.admin, 'approve', 'job', row.id, row.title);
  res.json(publicJob(db().prepare('SELECT * FROM jobs WHERE id = ?').get(row.id), { detail: true }));
});

router.post('/jobs/:id/decline', (req, res) => {
  const row = db().prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Job not found' });
  db().prepare("UPDATE jobs SET status = 'declined', updated_at = datetime('now') WHERE id = ?").run(row.id);
  recordAction(req.admin, 'decline', 'job', row.id, row.title);
  res.json(publicJob(db().prepare('SELECT * FROM jobs WHERE id = ?').get(row.id), { detail: true }));
});

router.post('/jobs/:id/pending', (req, res) => {
  const row = db().prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Job not found' });
  db()
    .prepare("UPDATE jobs SET status = 'awaiting_approval', updated_at = datetime('now') WHERE id = ?")
    .run(row.id);
  recordAction(req.admin, 'pending', 'job', row.id, row.title);
  res.json(publicJob(db().prepare('SELECT * FROM jobs WHERE id = ?').get(row.id), { detail: true }));
});

router.delete('/jobs/:id', (req, res) => {
  const row = db().prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Job not found' });
  db().prepare('DELETE FROM jobs WHERE id = ?').run(row.id);
  recordAction(req.admin, 'delete', 'job', row.id, row.title);
  res.json({ ok: true });
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
