const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const { db, publicSouqAd } = require('../db');
const { requireUser } = require('../auth');
const { classifyCar, normalizeBodyType } = require('../souq_taxonomy');
const { registerChatRoutes } = require('./souq_chats');

const router = express.Router();
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'data', 'uploads', 'souq');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const STATUSES = new Set(['awaiting_approval', 'pending', 'approved', 'declined']);
const PUBLIC_STATUS = 'approved';

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase() || '.bin';
    cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
  },
});

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif', '.gif', '.bmp']);
const VIDEO_EXT = new Set(['.mp4', '.mov', '.m4v', '.webm']);

function isAllowedMedia(file) {
  const type = String(file.mimetype || '').toLowerCase();
  if (type.startsWith('image/') || type.startsWith('video/')) return true;
  const ext = path.extname(file.originalname || '').toLowerCase();
  if (IMAGE_EXT.has(ext) || VIDEO_EXT.has(ext)) return true;
  return type === 'application/octet-stream' && ext;
}

const upload = multer({
  storage,
  limits: { fileSize: 30 * 1024 * 1024, files: 11 },
  fileFilter: (_req, file, cb) => {
    if (isAllowedMedia(file)) return cb(null, true);
    cb(new Error('Only images and video can be attached'));
  },
});

function receiveAdMedia(req, res, next) {
  upload.fields([
    { name: 'images', maxCount: 10 },
    { name: 'video', maxCount: 1 },
  ])(req, res, (err) => {
    if (!err) return next();
    return res.status(400).json({ error: err.message || 'Could not upload the photo or video' });
  });
}

function mediaUrl(req, filename) {
  return `/uploads/souq/${filename}`;
}

function parseList(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return String(value)
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
  }
}

function parseObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    return {};
  }
}

function classifyOther(body) {
  const attributes = parseObject(body.attributes);
  delete attributes.bodyType;
  delete attributes.mileage;
  delete attributes.fuel;
  delete attributes.transmission;
  return {
    make: '',
    bodyType: '',
    subcategoryId: String(body.subcategoryId || body.subcategory || '').trim(),
    attributes,
  };
}

function sortSql(sort) {
  switch (String(sort || 'newest')) {
    case 'priceAsc':
      return 'price IS NULL, price ASC, created_at DESC';
    case 'priceDesc':
      return 'price IS NULL, price DESC, created_at DESC';
    case 'mileageDesc':
      return "CAST(json_extract(attributes, '$.mileage') AS INTEGER) DESC, created_at DESC";
    case 'yearDesc':
      return "CAST(json_extract(attributes, '$.year') AS INTEGER) DESC, created_at DESC";
    default:
      return 'created_at DESC';
  }
}

function listWhere(query, { mine = false, sellerId = '' } = {}) {
  const where = [];
  const params = {};
  if (mine) {
    where.push('seller_id = @sellerId');
    params.sellerId = sellerId;
    if (query.status && STATUSES.has(query.status)) {
      where.push('status = @status');
      params.status = query.status;
    }
  } else {
    where.push('status = @status');
    params.status = PUBLIC_STATUS;
  }
  const category = String(query.category || query.categoryId || '').trim();
  if (category) {
    where.push('category_id = @category');
    params.category = category;
  }
  const subcategory = normalizeBodyType(query.subcategory || query.subcategoryId || query.bodyType || query.body_type);
  if (subcategory) {
    where.push('(subcategory_id = @subcategory OR body_type = @subcategory)');
    params.subcategory = subcategory;
  }
  const make = String(query.make || query.brand || '').trim();
  if (make) {
    where.push('lower(make) = lower(@make)');
    params.make = make;
  }
  const seller = String(query.seller || query.sellerId || '').trim();
  if (seller) {
    where.push('seller_id = @seller');
    params.seller = seller;
  }
  const city = String(query.city || '').trim();
  if (city) {
    where.push('city LIKE @city');
    params.city = `%${city}%`;
  }
  const q = String(query.q || query.query || '').trim();
  if (q) {
    where.push('(title LIKE @q OR subtitle LIKE @q OR description LIKE @q OR city LIKE @q OR attributes LIKE @q)');
    params.q = `%${q}%`;
  }
  if (query.minPrice != null && query.minPrice !== '') {
    where.push('price >= @minPrice');
    params.minPrice = Number(query.minPrice);
  }
  if (query.maxPrice != null && query.maxPrice !== '') {
    where.push('price <= @maxPrice');
    params.maxPrice = Number(query.maxPrice);
  }
  if (query.photosOnly === '1' || query.photosOnly === 'true') {
    where.push("images != '[]' AND images != ''");
  }
  return { where: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

registerChatRoutes(router);

router.get('/categories', (_req, res) => {
  const rows = db()
    .prepare('SELECT id, name_en AS nameEn, name_ar AS nameAr, sort_order AS sortOrder FROM souq_categories ORDER BY sort_order')
    .all();
  res.json({ items: rows });
});

router.get('/makes', (_req, res) => {
  const rows = db()
    .prepare(
      `SELECT DISTINCT make
       FROM souq_ads
       WHERE status = ? AND category_id = 'cars' AND trim(make) != ''
       ORDER BY make`,
    )
    .all(PUBLIC_STATUS);
  res.json({
    items: rows.map((row) => String(row.make || '').trim()).filter(Boolean),
  });
});

router.get('/price-insight', (req, res) => {
  const make = String(req.query.make || '').trim();
  if (!make) return res.json({ insight: null });
  let sql = `SELECT price FROM souq_ads
    WHERE status = @status AND price IS NOT NULL
    AND lower(make) = lower(@make)`;
  const params = { status: PUBLIC_STATUS, make };
  if (req.query.model) {
    sql += ` AND lower(json_extract(attributes, '$.model')) LIKE lower(@model)`;
    params.model = `%${req.query.model}%`;
  }
  const rows = db().prepare(`${sql} ORDER BY price`).all(params);
  const prices = rows.map((row) => Number(row.price)).filter((n) => !Number.isNaN(n));
  if (prices.length < 2) return res.json({ insight: null });
  res.json({
    insight: {
      low: prices[0],
      high: prices[prices.length - 1],
      sample: prices.length,
    },
  });
});

router.get('/mine', requireUser, (req, res) => {
  const rows = db()
    .prepare('SELECT * FROM souq_ads WHERE seller_id = ? ORDER BY created_at DESC')
    .all(req.user.id);
  res.json({
    items: rows.map(publicSouqAd),
    views: rows.reduce((sum, row) => sum + Number(row.views || 0), 0),
  });
});

router.get('/favorites', requireUser, (req, res) => {
  const rows = db()
    .prepare(
      `SELECT a.* FROM souq_favorites f
       JOIN souq_ads a ON a.ad_id = f.ad_id
       WHERE f.user_id = ?
       ORDER BY f.created_at DESC`,
    )
    .all(req.user.id);
  res.json({
    ids: rows.map((row) => row.ad_id),
    items: rows.map(publicSouqAd),
  });
});

router.post('/favorites/:adId', requireUser, (req, res) => {
  const adId = String(req.params.adId || '').trim();
  const ad = db().prepare('SELECT ad_id FROM souq_ads WHERE ad_id = ?').get(adId);
  if (!ad) return res.status(404).json({ error: 'Ad not found' });
  const existing = db()
    .prepare('SELECT ad_id FROM souq_favorites WHERE user_id = ? AND ad_id = ?')
    .get(req.user.id, adId);
  if (existing) {
    db().prepare('DELETE FROM souq_favorites WHERE user_id = ? AND ad_id = ?').run(req.user.id, adId);
  } else {
    db()
      .prepare('INSERT INTO souq_favorites (user_id, ad_id) VALUES (?, ?)')
      .run(req.user.id, adId);
  }
  const ids = db()
    .prepare('SELECT ad_id FROM souq_favorites WHERE user_id = ? ORDER BY created_at DESC')
    .all(req.user.id)
    .map((row) => row.ad_id);
  res.json({
    ids,
    favorited: !existing,
    count: db().prepare('SELECT COUNT(*) AS n FROM souq_favorites WHERE ad_id = ?').get(adId).n,
  });
});

router.get('/ads', (req, res) => {
  const page = Math.max(0, Number(req.query.page || 0));
  const limit = Math.min(50, Math.max(1, Number(req.query.limit || req.query.pageSize || 20)));
  const offset = page * limit;
  const { where, params } = listWhere(req.query);
  const order = sortSql(req.query.sort);
  const total = db().prepare(`SELECT COUNT(*) AS n FROM souq_ads ${where}`).get(params).n;
  const rows = db()
    .prepare(`SELECT * FROM souq_ads ${where} ORDER BY ${order} LIMIT @limit OFFSET @offset`)
    .all({ ...params, limit, offset });
  res.json({
    items: rows.map(publicSouqAd),
    total,
    page,
    limit,
  });
});

router.get('/ads/:adId', (req, res) => {
  const row = db().prepare('SELECT * FROM souq_ads WHERE ad_id = ?').get(req.params.adId);
  if (!row) return res.status(404).json({ error: 'Ad not found' });
  const owner = req.user && req.user.id === row.seller_id;
  if (row.status !== PUBLIC_STATUS && !owner) {
    return res.status(404).json({ error: 'Ad not found' });
  }
  if (row.status === PUBLIC_STATUS && !owner && req.query.preview !== '1') {
    db().prepare('UPDATE souq_ads SET views = views + 1 WHERE ad_id = ?').run(row.ad_id);
    row.views = Number(row.views || 0) + 1;
  }
  res.json(publicSouqAd(row));
});

router.post(
  '/ads',
  requireUser,
  receiveAdMedia,
  (req, res) => {
    const title = String(req.body.title || '').trim();
    const categoryId = String(req.body.categoryId || req.body.category || '').trim();
    if (title.length < 4) {
      return res.status(400).json({ error: 'Title must be at least 4 characters' });
    }
    if (!categoryId) {
      return res.status(400).json({ error: 'Choose a category' });
    }
    const category = db().prepare('SELECT id FROM souq_categories WHERE id = ?').get(categoryId);
    if (!category) return res.status(400).json({ error: 'Unknown category' });

    const files = req.files || {};
    const imageFiles = files.images || [];
    const videoFile = (files.video || [])[0];
    const existingImages = parseList(req.body.images);
    const images = [
      ...existingImages.filter((url) => /^https?:\/\//.test(url) || url.startsWith('/uploads/')),
      ...imageFiles.map((file) => mediaUrl(req, file.filename)),
    ].slice(0, 10);
    const video = videoFile
      ? mediaUrl(req, videoFile.filename)
      : String(req.body.video || '').trim();

    let description = String(req.body.description || '').trim();
    const phone = String(req.body.phone || '').trim();
    if (phone && !description.includes(phone)) {
      description = description ? `${description}\n\n${phone}` : phone;
    }

    const adId = `souq_${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const priceRaw = req.body.price;
    const price =
      priceRaw === '' || priceRaw == null || priceRaw === 'null' ? null : Number(priceRaw);
    const classified =
      categoryId === 'cars'
        ? classifyCar({
            title,
            subtitle: String(req.body.subtitle || '').trim(),
            description,
            attributes: parseObject(req.body.attributes),
            subcategoryId: String(req.body.subcategoryId || req.body.subcategory || ''),
            make: String(req.body.make || req.body.brand || ''),
            bodyType: String(req.body.bodyType || req.body.body_type || ''),
          })
        : classifyOther(req.body);

    db()
      .prepare(
        `INSERT INTO souq_ads (
          ad_id, seller_id, seller_name, seller_avatar, category_id, subcategory_id,
          title, subtitle, description, price, currency, is_negotiable, city, district,
          phone, images, video, status, views, condition, attributes, contact,
          source, source_url, created_at, updated_at, expires_at, make, body_type
        ) VALUES (
          @ad_id, @seller_id, @seller_name, @seller_avatar, @category_id, @subcategory_id,
          @title, @subtitle, @description, @price, @currency, @is_negotiable, @city, @district,
          @phone, @images, @video, @status, 0, @condition, @attributes, @contact,
          'user', '', @created_at, @updated_at, NULL, @make, @body_type
        )`,
      )
      .run({
        ad_id: adId,
        seller_id: req.user.id,
        seller_name: req.user.name || req.user.email || 'Seller',
        seller_avatar: req.user.avatar || '',
        category_id: categoryId,
        subcategory_id: classified.subcategoryId,
        title,
        subtitle: String(req.body.subtitle || '').trim(),
        description,
        price: Number.isNaN(price) ? null : price,
        currency: 'SAR',
        is_negotiable: req.body.isNegotiable === 'true' || req.body.isNegotiable === true ? 1 : 0,
        city: String(req.body.city || '').trim(),
        district: String(req.body.district || '').trim(),
        phone,
        images: JSON.stringify(images),
        video,
        status: 'awaiting_approval',
        condition: String(req.body.condition || 'good'),
        attributes: JSON.stringify(classified.attributes),
        contact: JSON.stringify(parseObject(req.body.contact)),
        created_at: now,
        updated_at: now,
        make: classified.make,
        body_type: classified.bodyType,
      });

    const row = db().prepare('SELECT * FROM souq_ads WHERE ad_id = ?').get(adId);
    res.status(201).json(publicSouqAd(row));
  },
);

router.patch('/ads/:adId', requireUser, (req, res) => {
  const row = db().prepare('SELECT * FROM souq_ads WHERE ad_id = ?').get(req.params.adId);
  if (!row) return res.status(404).json({ error: 'Ad not found' });
  if (row.seller_id !== req.user.id) {
    return res.status(403).json({ error: 'You can only edit your own ads' });
  }
  const body = req.body || {};
  let status = row.status;
  if (body.status) {
    const wanted = String(body.status);
    const mapped = wanted === 'active' ? 'approved' : wanted;
    if (['sold', 'paused'].includes(mapped) && ['approved', 'paused', 'sold'].includes(row.status)) {
      status = mapped;
    } else if (mapped === 'approved' && ['paused', 'sold'].includes(row.status)) {
      status = 'approved';
    }
  }
  const next = {
    title: String(body.title ?? row.title).trim() || row.title,
    subtitle: String(body.subtitle ?? row.subtitle),
    description: String(body.description ?? row.description),
    city: String(body.city ?? row.city),
    district: String(body.district ?? row.district),
    price:
      body.price === '' || body.price == null
        ? row.price
        : Number(body.price),
    status,
    expires_at: body.expiresAt ?? row.expires_at,
  };
  db()
    .prepare(
      `UPDATE souq_ads SET title=@title, subtitle=@subtitle, description=@description,
       city=@city, district=@district, price=@price, status=@status, expires_at=@expires_at,
       updated_at=datetime('now') WHERE ad_id=@id`,
    )
    .run({ ...next, id: row.ad_id });
  res.json(publicSouqAd(db().prepare('SELECT * FROM souq_ads WHERE ad_id = ?').get(row.ad_id)));
});

router.delete('/ads/:adId', requireUser, (req, res) => {
  const row = db().prepare('SELECT * FROM souq_ads WHERE ad_id = ?').get(req.params.adId);
  if (!row) return res.status(404).json({ error: 'Ad not found' });
  if (row.seller_id !== req.user.id) {
    return res.status(403).json({ error: 'You can only delete your own ads' });
  }
  db().prepare('DELETE FROM souq_ads WHERE ad_id = ?').run(row.ad_id);
  res.json({ ok: true });
});

module.exports = { router };
