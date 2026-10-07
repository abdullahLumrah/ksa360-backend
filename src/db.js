const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { mapFuel, mapGear, bodyLabel } = require('./souq_taxonomy');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = process.env.SQLITE_PATH || path.join(DATA_DIR, 'ksa.sqlite');

function openDb() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS restaurants (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      kind TEXT NOT NULL DEFAULT 'arab',
      cuisine TEXT NOT NULL DEFAULT '',
      city TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      hours TEXT NOT NULL DEFAULT '',
      web TEXT NOT NULL DEFAULT '',
      amenity TEXT NOT NULL DEFAULT 'restaurant',
      image TEXT NOT NULL DEFAULT '',
      rating REAL NOT NULL DEFAULT 0,
      ratings INTEGER NOT NULL DEFAULT 0,
      youtube_id TEXT NOT NULL DEFAULT '',
      google_place_id TEXT,
      source TEXT NOT NULL DEFAULT 'seed',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS restaurants_city_idx ON restaurants(city);
    CREATE INDEX IF NOT EXISTS restaurants_kind_idx ON restaurants(kind);
    CREATE INDEX IF NOT EXISTS restaurants_geo_idx ON restaurants(lat, lng);

    CREATE TABLE IF NOT EXISTS place_videos (
      name_key TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      youtube_id TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS activities (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      city TEXT NOT NULL DEFAULT '',
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      price_from INTEGER NOT NULL DEFAULT 0,
      price_to INTEGER NOT NULL DEFAULT 0,
      unit TEXT NOT NULL DEFAULT 'ticket',
      image TEXT NOT NULL DEFAULT '',
      about TEXT NOT NULL DEFAULT '',
      hours TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      web TEXT NOT NULL DEFAULT '',
      area TEXT NOT NULL DEFAULT '',
      also TEXT NOT NULL DEFAULT '[]',
      featured INTEGER NOT NULL DEFAULT 0,
      family INTEGER NOT NULL DEFAULT 1,
      indoor INTEGER NOT NULL DEFAULT 1,
      youtube_id TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'seed',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS activities_city_idx ON activities(city);
    CREATE INDEX IF NOT EXISTS activities_kind_idx ON activities(kind);
    CREATE INDEX IF NOT EXISTS activities_geo_idx ON activities(lat, lng);

    CREATE TABLE IF NOT EXISTS reels (
      id TEXT PRIMARY KEY,
      youtube_id TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL DEFAULT '',
      hook TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL,
      place_id TEXT NOT NULL,
      city TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS reels_source_idx ON reels(source);
    CREATE INDEX IF NOT EXISTS reels_city_idx ON reels(city);
    CREATE INDEX IF NOT EXISTS reels_place_idx ON reels(place_id);

    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      parent_id TEXT NOT NULL DEFAULT '0',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS categories_parent_idx ON categories(parent_id);
    CREATE INDEX IF NOT EXISTS categories_slug_idx ON categories(slug);

    CREATE TABLE IF NOT EXISTS posts (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      slug TEXT NOT NULL DEFAULT '',
      date TEXT NOT NULL DEFAULT '',
      excerpt TEXT NOT NULL DEFAULT '',
      preview TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL DEFAULT '',
      image TEXT NOT NULL DEFAULT '',
      word_count INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'lisa',
      source_label TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS posts_date_idx ON posts(date);
    CREATE INDEX IF NOT EXISTS posts_slug_idx ON posts(slug);

    CREATE TABLE IF NOT EXISTS post_categories (
      post_id TEXT NOT NULL,
      category_id TEXT NOT NULL,
      PRIMARY KEY (post_id, category_id)
    );
    CREATE INDEX IF NOT EXISTS post_categories_category_idx ON post_categories(category_id);

    CREATE TABLE IF NOT EXISTS post_tags (
      post_id TEXT NOT NULL,
      tag TEXT NOT NULL,
      PRIMARY KEY (post_id, tag)
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT,
      google_id TEXT UNIQUE,
      date_of_birth TEXT NOT NULL DEFAULT '',
      gender TEXT NOT NULL DEFAULT '',
      avatar TEXT NOT NULL DEFAULT '',
      provider TEXT NOT NULL DEFAULT 'email',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS users_email_idx ON users(email);

    CREATE TABLE IF NOT EXISTS sessions (
      jti TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      revoked INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);

    CREATE TABLE IF NOT EXISTS souq_categories (
      id TEXT PRIMARY KEY,
      name_en TEXT NOT NULL,
      name_ar TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS souq_ads (
      ad_id TEXT PRIMARY KEY,
      seller_id TEXT NOT NULL DEFAULT '',
      seller_name TEXT NOT NULL DEFAULT '',
      seller_avatar TEXT NOT NULL DEFAULT '',
      category_id TEXT NOT NULL,
      subcategory_id TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL,
      subtitle TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      price REAL,
      currency TEXT NOT NULL DEFAULT 'SAR',
      is_negotiable INTEGER NOT NULL DEFAULT 0,
      city TEXT NOT NULL DEFAULT '',
      district TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      images TEXT NOT NULL DEFAULT '[]',
      video TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'awaiting_approval',
      views INTEGER NOT NULL DEFAULT 0,
      condition TEXT NOT NULL DEFAULT 'good',
      attributes TEXT NOT NULL DEFAULT '{}',
      contact TEXT NOT NULL DEFAULT '{}',
      source TEXT NOT NULL DEFAULT 'user',
      source_url TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT,
      make TEXT NOT NULL DEFAULT '',
      body_type TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS souq_ads_category_idx ON souq_ads(category_id, status);
    CREATE INDEX IF NOT EXISTS souq_ads_status_idx ON souq_ads(status, created_at);
    CREATE INDEX IF NOT EXISTS souq_ads_seller_idx ON souq_ads(seller_id);
    CREATE INDEX IF NOT EXISTS souq_ads_city_idx ON souq_ads(city);

    CREATE TABLE IF NOT EXISTS souq_conversations (
      conversation_id TEXT PRIMARY KEY,
      ad_id TEXT NOT NULL,
      buyer_id TEXT NOT NULL,
      seller_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (ad_id, buyer_id)
    );
    CREATE INDEX IF NOT EXISTS souq_conversations_ad_idx ON souq_conversations(ad_id);
    CREATE INDEX IF NOT EXISTS souq_conversations_buyer_idx ON souq_conversations(buyer_id);
    CREATE INDEX IF NOT EXISTS souq_conversations_seller_idx ON souq_conversations(seller_id);

    CREATE TABLE IF NOT EXISTS souq_messages (
      message_id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS souq_messages_convo_idx ON souq_messages(conversation_id, created_at);

    CREATE TABLE IF NOT EXISTS analytics_events (
      event_id TEXT PRIMARY KEY,
      event_name TEXT NOT NULL,
      section TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT '',
      target_id TEXT NOT NULL DEFAULT '',
      target_title TEXT NOT NULL DEFAULT '',
      user_id TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      device_id TEXT NOT NULL DEFAULT '',
      path TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS analytics_events_created_idx ON analytics_events(created_at);
    CREATE INDEX IF NOT EXISTS analytics_events_section_idx ON analytics_events(section, created_at);
    CREATE INDEX IF NOT EXISTS analytics_events_user_idx ON analytics_events(user_id, created_at);
    CREATE INDEX IF NOT EXISTS analytics_events_device_idx ON analytics_events(device_id, created_at);

    CREATE TABLE IF NOT EXISTS admin_actions (
      action_id TEXT PRIMARY KEY,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      entity TEXT NOT NULL DEFAULT '',
      entity_id TEXT NOT NULL DEFAULT '',
      detail TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS admin_actions_created_idx ON admin_actions(created_at);

    CREATE TABLE IF NOT EXISTS shop_categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      blurb TEXT NOT NULL DEFAULT '',
      image TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS shop_merchants (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      blurb TEXT NOT NULL DEFAULT '',
      website TEXT NOT NULL DEFAULT '',
      android_id TEXT NOT NULL DEFAULT '',
      ios_id TEXT NOT NULL DEFAULT '',
      image TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL DEFAULT 'app',
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS shop_merchant_categories (
      merchant_id TEXT NOT NULL,
      category_id TEXT NOT NULL,
      PRIMARY KEY (merchant_id, category_id)
    );
    CREATE INDEX IF NOT EXISTS shop_merchant_categories_cat_idx ON shop_merchant_categories(category_id);

    CREATE TABLE IF NOT EXISTS shop_coupons (
      id TEXT PRIMARY KEY,
      merchant_id TEXT NOT NULL,
      title TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      code TEXT NOT NULL DEFAULT '',
      url TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS shop_coupons_merchant_idx ON shop_coupons(merchant_id);

    CREATE TABLE IF NOT EXISTS health_facilities (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      kind TEXT NOT NULL DEFAULT 'clinic',
      city TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      hours TEXT NOT NULL DEFAULT '',
      web TEXT NOT NULL DEFAULT '',
      amenity TEXT NOT NULL DEFAULT 'clinic',
      emergency INTEGER NOT NULL DEFAULT 0,
      services TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'seed',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS health_facilities_city_idx ON health_facilities(city);
    CREATE INDEX IF NOT EXISTS health_facilities_kind_idx ON health_facilities(kind);
    CREATE INDEX IF NOT EXISTS health_facilities_geo_idx ON health_facilities(lat, lng);

    CREATE TABLE IF NOT EXISTS health_hotlines (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      number TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS health_steps (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS schools (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      city TEXT NOT NULL DEFAULT '',
      district TEXT NOT NULL DEFAULT '',
      address TEXT NOT NULL DEFAULT '',
      lat REAL,
      lng REAL,
      precision TEXT NOT NULL DEFAULT '',
      gender TEXT NOT NULL DEFAULT '',
      grades TEXT NOT NULL DEFAULT '',
      age_range TEXT NOT NULL DEFAULT '',
      established INTEGER,
      phone TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      website TEXT NOT NULL DEFAULT '',
      curriculum TEXT NOT NULL DEFAULT '',
      curriculum_tags TEXT NOT NULL DEFAULT '',
      stages TEXT NOT NULL DEFAULT '',
      min_fee REAL,
      max_fee REAL,
      fee_year TEXT NOT NULL DEFAULT '',
      fee_source_type TEXT NOT NULL DEFAULT '',
      fee_source_name TEXT NOT NULL DEFAULT '',
      fee_source_url TEXT NOT NULL DEFAULT '',
      fees_published INTEGER NOT NULL DEFAULT 0,
      payload TEXT NOT NULL DEFAULT '{}',
      source TEXT NOT NULL DEFAULT 'seed',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS schools_city_idx ON schools(city);
    CREATE INDEX IF NOT EXISTS schools_geo_idx ON schools(lat, lng);
    CREATE INDEX IF NOT EXISTS schools_curriculum_idx ON schools(curriculum_tags);
    CREATE INDEX IF NOT EXISTS schools_gender_idx ON schools(gender);

    CREATE TABLE IF NOT EXISTS restaurant_menu_items (
      id TEXT PRIMARY KEY,
      restaurant_id TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      price TEXT NOT NULL DEFAULT '',
      image TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'hungerstation',
      sort_order INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS restaurant_menu_restaurant_idx ON restaurant_menu_items(restaurant_id, sort_order);

    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT '',
      company_name TEXT NOT NULL DEFAULT '',
      company_industry TEXT NOT NULL DEFAULT '',
      city TEXT NOT NULL DEFAULT '',
      region TEXT NOT NULL DEFAULT '',
      country TEXT NOT NULL DEFAULT 'Saudi Arabia',
      location_text TEXT NOT NULL DEFAULT '',
      work_mode TEXT NOT NULL DEFAULT '',
      employment_type TEXT NOT NULL DEFAULT '',
      experience_required TEXT NOT NULL DEFAULT '',
      education_required TEXT NOT NULL DEFAULT '',
      salary_display TEXT NOT NULL DEFAULT '',
      salary_monthly_sar REAL,
      salary_is_posted INTEGER NOT NULL DEFAULT 0,
      summary TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      apply_url TEXT NOT NULL DEFAULT '',
      apply_method TEXT NOT NULL DEFAULT '',
      listing_url TEXT NOT NULL DEFAULT '',
      date_posted TEXT NOT NULL DEFAULT '',
      deadline TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'user',
      source_platform TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'awaiting_approval',
      author_id TEXT NOT NULL DEFAULT '',
      author_name TEXT NOT NULL DEFAULT '',
      payload TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS jobs_status_idx ON jobs(status, date_posted);
    CREATE INDEX IF NOT EXISTS jobs_category_idx ON jobs(category, status);
    CREATE INDEX IF NOT EXISTS jobs_city_idx ON jobs(city, status);
    CREATE INDEX IF NOT EXISTS jobs_author_idx ON jobs(author_id);
  `);
  migrateSouqAds(db);
  migratePosts(db);
  return db;
}

function migrateSouqAds(db) {
  const cols = new Set(
    db.prepare('PRAGMA table_info(souq_ads)').all().map((col) => col.name),
  );
  if (!cols.has('make')) {
    db.exec(`ALTER TABLE souq_ads ADD COLUMN make TEXT NOT NULL DEFAULT ''`);
  }
  if (!cols.has('body_type')) {
    db.exec(`ALTER TABLE souq_ads ADD COLUMN body_type TEXT NOT NULL DEFAULT ''`);
  }
  db.exec(`CREATE INDEX IF NOT EXISTS souq_ads_make_idx ON souq_ads(make)`);
  db.exec(`CREATE INDEX IF NOT EXISTS souq_ads_body_idx ON souq_ads(body_type)`);
  db.exec(`CREATE INDEX IF NOT EXISTS souq_ads_subcategory_idx ON souq_ads(subcategory_id)`);
  db.exec(`
    CREATE TABLE IF NOT EXISTS souq_favorites (
      user_id TEXT NOT NULL,
      ad_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, ad_id)
    );
    CREATE INDEX IF NOT EXISTS souq_favorites_ad_idx ON souq_favorites(ad_id);
    CREATE INDEX IF NOT EXISTS souq_favorites_user_idx ON souq_favorites(user_id);
  `);
  const shopCols = db.prepare('PRAGMA table_info(shop_merchants)').all().map((col) => col.name);
  if (!shopCols.includes('featured')) {
    db.exec('ALTER TABLE shop_merchants ADD COLUMN featured INTEGER NOT NULL DEFAULT 0');
  }
  if (!shopCols.includes('icon')) {
    db.exec("ALTER TABLE shop_merchants ADD COLUMN icon TEXT NOT NULL DEFAULT ''");
  }
  const shopCatCols = db.prepare('PRAGMA table_info(shop_categories)').all().map((col) => col.name);
  if (!shopCatCols.includes('icon')) {
    db.exec("ALTER TABLE shop_categories ADD COLUMN icon TEXT NOT NULL DEFAULT ''");
  }
  const schoolCols = db.prepare('PRAGMA table_info(schools)').all().map((col) => col.name);
  if (!schoolCols.includes('image')) {
    db.exec("ALTER TABLE schools ADD COLUMN image TEXT NOT NULL DEFAULT ''");
  }
  if (!schoolCols.includes('google_place_id')) {
    db.exec("ALTER TABLE schools ADD COLUMN google_place_id TEXT");
  }
  scrubNonCarVehicleFields(db);
}

function migratePosts(db) {
  const cols = db.prepare('PRAGMA table_info(posts)').all().map((col) => col.name);
  if (!cols.includes('status')) {
    db.exec("ALTER TABLE posts ADD COLUMN status TEXT NOT NULL DEFAULT 'published'");
  }
  if (!cols.includes('author_id')) {
    db.exec("ALTER TABLE posts ADD COLUMN author_id TEXT NOT NULL DEFAULT ''");
  }
  if (!cols.includes('author_name')) {
    db.exec("ALTER TABLE posts ADD COLUMN author_name TEXT NOT NULL DEFAULT ''");
  }
  db.exec('CREATE INDEX IF NOT EXISTS posts_status_idx ON posts(status, date)');
  const stale = db
    .prepare("SELECT COUNT(*) AS n FROM posts WHERE date != '' AND date < '2026-01-01'")
    .get().n;
  if (!stale) return;
  db.exec(`
    DELETE FROM post_tags WHERE post_id IN (
      SELECT id FROM posts WHERE date != '' AND date < '2026-01-01'
    );
    DELETE FROM post_categories WHERE post_id IN (
      SELECT id FROM posts WHERE date != '' AND date < '2026-01-01'
    );
    DELETE FROM posts WHERE date != '' AND date < '2026-01-01';
  `);
  console.log(`Removed ${stale} guide posts dated before 2026`);
}

function scrubNonCarVehicleFields(db) {
  db.prepare(
    `UPDATE souq_ads SET make = '', body_type = ''
     WHERE category_id != 'cars' AND (make != '' OR body_type != '')`,
  ).run();
  const dirty = db
    .prepare(
      `SELECT ad_id, attributes FROM souq_ads
       WHERE category_id != 'cars' AND attributes LIKE '%bodyType%'`,
    )
    .all();
  const update = db.prepare('UPDATE souq_ads SET attributes = ? WHERE ad_id = ?');
  for (const row of dirty) {
    let attrs = {};
    try {
      attrs = JSON.parse(row.attributes || '{}');
    } catch (_) {
      continue;
    }
    if (!attrs || typeof attrs !== 'object') continue;
    if (attrs.bodyType == null && attrs.mileage == null && attrs.fuel == null && attrs.transmission == null) {
      continue;
    }
    delete attrs.bodyType;
    delete attrs.mileage;
    delete attrs.fuel;
    delete attrs.transmission;
    update.run(JSON.stringify(attrs), row.ad_id);
  }
}

let _db;
function db() {
  if (!_db) _db = openDb();
  return _db;
}

function restaurantRow(input) {
  return {
    id: String(input.id || '').trim(),
    name: String(input.name || '').trim(),
    lat: Number(input.lat),
    lng: Number(input.lng),
    kind: String(input.kind || 'arab').trim() || 'arab',
    cuisine: String(input.cuisine || ''),
    city: String(input.city || ''),
    phone: String(input.phone || ''),
    hours: String(input.hours || ''),
    web: String(input.web || ''),
    amenity: String(input.amenity || 'restaurant'),
    image: String(input.image || ''),
    rating: Number(input.rating || 0),
    ratings: Number(input.ratings || 0),
    youtube_id: String(input.youtube_id || input.video || ''),
    google_place_id: input.google_place_id || null,
    source: String(input.source || 'seed'),
  };
}

function activityRow(input) {
  const also = Array.isArray(input.also) ? input.also : [];
  return {
    id: String(input.id || '').trim(),
    name: String(input.name || '').trim(),
    kind: String(input.kind || '').trim(),
    city: String(input.city || ''),
    lat: Number(input.lat),
    lng: Number(input.lng),
    price_from: Number(input.priceFrom ?? input.price_from ?? 0),
    price_to: Number(input.priceTo ?? input.price_to ?? 0),
    unit: String(input.unit || 'ticket'),
    image: String(input.image || ''),
    about: String(input.about || ''),
    hours: String(input.hours || ''),
    phone: String(input.phone || ''),
    web: String(input.web || ''),
    area: String(input.area || ''),
    also: JSON.stringify(also),
    featured: input.featured ? 1 : 0,
    family: input.family === false ? 0 : 1,
    indoor: input.indoor === false ? 0 : 1,
    youtube_id: String(input.youtube_id || input.video || ''),
    source: String(input.source || 'seed'),
  };
}

function publicShopCoupon(row) {
  return {
    id: row.id,
    merchantId: row.merchant_id,
    title: row.title,
    detail: row.detail || '',
    code: row.code || '',
    url: row.url || '',
  };
}

function playStoreUrl(androidId) {
  const id = String(androidId || '').trim();
  return id ? `https://play.google.com/store/apps/details?id=${encodeURIComponent(id)}` : '';
}

function appStoreUrl(iosId) {
  const id = String(iosId || '').trim();
  return id ? `https://apps.apple.com/sa/app/id${id}` : '';
}

function publicShopMerchant(row, { categories = [], coupons = [] } = {}) {
  const androidId = row.android_id || '';
  const iosId = row.ios_id || '';
  return {
    id: row.id,
    name: row.name,
    blurb: row.blurb || '',
    website: row.website || '',
    androidId,
    iosId,
    androidUrl: playStoreUrl(androidId),
    iosUrl: appStoreUrl(iosId),
    icon: row.icon || row.image || '',
    image: row.image || row.icon || '',
    kind: row.kind || 'app',
    featured: Boolean(row.featured),
    categories,
    coupons: coupons.map(publicShopCoupon),
  };
}

function publicShopCategory(row, extra = {}) {
  const icon = extra.icon || row.icon || row.image || '';
  return {
    id: row.id,
    name: row.name,
    blurb: row.blurb || '',
    icon,
    image: icon || row.image || '',
    merchantCount: Number(extra.merchantCount || 0),
    couponCount: Number(extra.couponCount || 0),
  };
}

function publicHealthFacility(row, distanceKm) {
  const services = String(row.services || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  return {
    id: row.id,
    name: row.name,
    lat: row.lat,
    lng: row.lng,
    kind: row.kind || 'clinic',
    city: row.city || '',
    phone: row.phone || '',
    hours: row.hours || '',
    web: row.web || '',
    amenity: row.amenity || row.kind || 'clinic',
    emergency: Boolean(row.emergency),
    services,
    km: distanceKm ?? 0,
  };
}

function publicRestaurant(row, distanceKm, extra = {}) {
  return {
    id: row.id,
    name: row.name,
    lat: row.lat,
    lng: row.lng,
    kind: row.kind,
    cuisine: row.cuisine,
    city: row.city,
    phone: row.phone,
    hours: row.hours,
    web: row.web,
    amenity: row.amenity,
    image: row.image,
    rating: row.rating,
    ratings: row.ratings,
    video: row.youtube_id || '',
    km: distanceKm ?? 0,
    reviewSource: extra.reviewSource || '',
    dishes: extra.dishes || [],
  };
}

function publicActivity(row, distanceKm) {
  let also = [];
  try {
    also = JSON.parse(row.also || '[]');
  } catch (_) {
    also = [];
  }
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    city: row.city,
    lat: row.lat,
    lng: row.lng,
    priceFrom: row.price_from,
    priceTo: row.price_to,
    unit: row.unit,
    image: row.image,
    about: row.about,
    hours: row.hours,
    phone: row.phone,
    web: row.web,
    area: row.area,
    also,
    featured: Boolean(row.featured),
    family: Boolean(row.family),
    indoor: Boolean(row.indoor),
    video: row.youtube_id || '',
    km: distanceKm ?? 0,
  };
}

function publicPost(row, { categories = [], tags = [], includeBody = false } = {}) {
  const item = {
    id: row.id,
    title: row.title,
    slug: row.slug,
    date: row.date,
    excerpt: row.excerpt,
    preview: row.preview,
    image: row.image || '',
    categories,
    tags,
    wordCount: row.word_count,
    source: row.source,
    sourceLabel: row.source_label,
    status: row.status || 'published',
    authorId: row.author_id || '',
    authorName: row.author_name || '',
  };
  if (includeBody) item.body = row.body || '';
  return item;
}

function parseJson(raw, fallback) {
  try {
    return JSON.parse(raw || '');
  } catch (_) {
    return fallback;
  }
}

function favoriteCount(adId) {
  try {
    return db().prepare('SELECT COUNT(*) AS n FROM souq_favorites WHERE ad_id = ?').get(adId).n;
  } catch (_) {
    return 0;
  }
}

function publicSouqAd(row) {
  const attributes = parseJson(row.attributes, {});
  const isCar = row.category_id === 'cars';
  if (isCar && row.make && !attributes.make) attributes.make = row.make;
  if (isCar && row.body_type) {
    attributes.bodyType = attributes.bodyType || bodyLabel(row.body_type);
  }
  if (!isCar) {
    delete attributes.bodyType;
    delete attributes.mileage;
    delete attributes.fuel;
    delete attributes.transmission;
  }
  if (attributes.fuel) attributes.fuel = mapFuel(attributes.fuel);
  if (attributes.transmission) attributes.transmission = mapGear(attributes.transmission);
  return {
    id: row.ad_id,
    source: row.source || 'user',
    categoryId: row.category_id,
    subcategoryId: row.subcategory_id || (isCar ? row.body_type : '') || null,
    title: row.title,
    subtitle: row.subtitle || '',
    description: row.description || '',
    price: row.price == null ? null : Number(row.price),
    isNegotiable: Boolean(row.is_negotiable),
    currency: row.currency || 'SAR',
    condition: row.condition || 'good',
    images: parseJson(row.images, []),
    video: row.video || '',
    city: row.city || '',
    district: row.district || null,
    make: isCar ? row.make || attributes.make || '' : '',
    bodyType: isCar ? row.body_type || '' : '',
    attributes,
    seller: {
      id: row.seller_id || 'unknown',
      name: row.seller_name || 'Seller',
      avatar: row.seller_avatar || '',
      phone: row.phone || '',
      whatsapp: row.phone || '',
      memberSince: row.created_at,
      isVerified: row.source === 'user',
    },
    contact: parseJson(row.contact, {
      call: true,
      whatsapp: true,
      chat: true,
      hidePhone: false,
    }),
    status: row.status,
    views: Number(row.views || 0),
    favoritesCount: Number(row.favorites_count ?? favoriteCount(row.ad_id) ?? 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    originalUrl: row.source_url || null,
    expiresAt: row.expires_at,
    isFeatured: row.source === 'haraj',
  };
}

function publicJob(row, { detail = false } = {}) {
  const item = {
    id: row.id,
    title: row.title,
    category: row.category || '',
    companyName: row.company_name || '',
    companyIndustry: row.company_industry || '',
    city: row.city || '',
    region: row.region || '',
    country: row.country || 'Saudi Arabia',
    locationText: row.location_text || row.city || 'Saudi Arabia',
    workMode: row.work_mode || '',
    employmentType: row.employment_type || '',
    experienceRequired: row.experience_required || '',
    educationRequired: row.education_required || '',
    salaryDisplay: row.salary_is_posted ? row.salary_display || '' : '',
    salaryMonthlySar: row.salary_is_posted ? row.salary_monthly_sar : null,
    salaryPosted: Boolean(row.salary_is_posted),
    summary: row.summary || '',
    applyUrl: row.apply_url || '',
    applyMethod: row.apply_method || '',
    listingUrl: row.listing_url || '',
    datePosted: row.date_posted || '',
    deadline: row.deadline || '',
    source: row.source || 'user',
    sourcePlatform: row.source_platform || '',
    status: row.status || 'published',
    authorName: row.author_name || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (!detail) return item;
  return {
    ...item,
    description: row.description || '',
  };
}

function publicReel(row, place) {
  const activity = row.source === 'activity' ? place : null;
  const restaurant = row.source === 'restaurant' ? place : null;
  return {
    id: row.id,
    youtubeId: row.youtube_id,
    title: row.title || row.hook || (place && place.name) || '',
    hook: row.hook || '',
    source: row.source,
    placeId: row.place_id,
    activityId: row.source === 'activity' ? row.place_id : '',
    city: row.city || (place && place.city) || '',
    activity,
    restaurant,
  };
}

module.exports = {
  db,
  DB_PATH,
  restaurantRow,
  activityRow,
  publicRestaurant,
  publicActivity,
  publicReel,
  publicPost,
  publicSouqAd,
  publicShopCoupon,
  publicShopMerchant,
  publicShopCategory,
  publicHealthFacility,
  publicJob,
};
