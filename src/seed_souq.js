const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { db } = require('./db');
const { classifyCar, listingSpecs } = require('./souq_taxonomy');

const DATA = path.join(__dirname, '..', 'data');
const APP_DATA = path.join(__dirname, '..', '..', 'KSAGUIDE', 'assets', 'data');

const CATEGORIES = [
  ['cars', 'Cars', 'سيارات', 0],
  ['mobiles', 'Mobiles', 'جوالات', 1],
  ['electronics', 'Electronics', 'إلكترونيات', 2],
  ['furniture', 'Furniture', 'أثاث', 3],
  ['appliances', 'Appliances', 'أجهزة منزلية', 4],
  ['fashion', 'Fashion', 'أزياء', 5],
  ['realestate', 'Real Estate', 'عقار', 6],
  ['sports', 'Sports', 'رياضة', 7],
  ['animals', 'Animals', 'حيوانات', 8],
  ['kids', 'Kids', 'أطفال', 9],
  ['books', 'Books', 'كتب', 10],
  ['tools', 'Tools', 'عدد', 11],
  ['motors', 'Motorcycles & Boats', 'دراجات وقوارب', 12],
  ['services', 'Services', 'خدمات', 13],
  ['other', 'Other', 'أخرى', 14],
];

function readGzipJson(file) {
  const local = path.join(DATA, file);
  const sibling = path.join(APP_DATA, file);
  const full = fs.existsSync(local) ? local : sibling;
  if (!fs.existsSync(full)) {
    console.warn(`Souq seed skipped missing ${file}`);
    return { listings: [] };
  }
  return JSON.parse(zlib.gunzipSync(fs.readFileSync(full)));
}

function parseWhen(value) {
  const n = Number(value);
  if (!n) return new Date().toISOString();
  const ms = n > 1e12 ? n : n * 1000;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function mapCondition(raw) {
  const value = String(raw || '').toLowerCase();
  if (value.includes('new') && !value.includes('used')) return 'brandNew';
  if (value.includes('like')) return 'likeNew';
  if (value.includes('fair') || value.includes('old')) return 'fair';
  if (value.includes('dam') || value.includes('part')) return 'forParts';
  return 'good';
}

function mapImported(source, item) {
  const id = `${source}-${item.id}`;
  const images = Array.isArray(item.images) ? item.images.filter(Boolean).map(String) : [];
  const title = String(item.title || '').trim() || 'Listing';
  const souqCat = String(item.souqCategory || item.categoryId || '').trim() || 'cars';
  const specs = listingSpecs(source, item);
  if (souqCat !== 'cars') {
    const subtitle = [item.district, item.city, item.category].filter(Boolean).join(' · ');
    const description = [item.description, title].filter(Boolean).join(' · ');
    return {
      ad_id: id,
      seller_id: `${source}:${item.author || 'seller'}`,
      seller_name: String(item.author || 'Expat seller'),
      seller_avatar: '',
      category_id: souqCat,
      subcategory_id: String(item.souqSubcategory || ''),
      make: '',
      body_type: '',
      title,
      subtitle,
      description,
      price: specs.price,
      currency: 'SAR',
      is_negotiable: specs.price == null ? 1 : 0,
      city: String(item.city || ''),
      district: String(item.district || ''),
      phone: '',
      images: JSON.stringify(images),
      video: '',
      status: 'approved',
      views: 0,
      condition: mapCondition(item.condition),
      attributes: JSON.stringify({ sellerType: source, origin: item.category || '' }),
      contact: JSON.stringify({
        call: false,
        whatsapp: false,
        chat: true,
        hidePhone: true,
      }),
      source,
      source_url: String(item.url || ''),
      created_at: parseWhen(item.postDate || item.date),
      updated_at: parseWhen(item.postDate || item.date),
      expires_at: null,
    };
  }
  const rawMake = String(item.Brand || item.brand || item.make || '').trim();
  const classified = classifyCar({
    title,
    make: rawMake,
    attributes: { model: specs.model },
  });
  const make = classified.make;
  const year = specs.year;
  const subtitle = [year, make, classified.attributes.model].filter(Boolean).join(' ');
  const attrs = {
    ...classified.attributes,
    year,
    mileage: specs.mileage,
    fuel: specs.fuel,
    transmission: specs.transmission,
    sellerType: source,
  };
  const bits = [title];
  if (make) bits.push(make);
  if (year) bits.push(String(year));
  if (specs.mileage) bits.push(`${specs.mileage} km`);
  if (specs.fuel) bits.push(specs.fuel);
  if (specs.transmission) bits.push(specs.transmission);
  if (item.city) bits.push(String(item.city));
  if (specs.description && specs.description !== title) bits.push(specs.description);
  return {
    ad_id: id,
    seller_id: `${source}:${item.author || 'seller'}`,
    seller_name: String(item.author || source),
    seller_avatar: '',
    category_id: 'cars',
    subcategory_id: classified.subcategoryId,
    make,
    body_type: classified.bodyType,
    title,
    subtitle,
    description: bits.join(' · '),
    price: specs.price,
    currency: 'SAR',
    is_negotiable: specs.price == null ? 1 : 0,
    city: String(item.city || ''),
    district: '',
    phone: '',
    images: JSON.stringify(images),
    video: '',
    status: 'approved',
    views: 0,
    condition: mapCondition(item.condition),
    attributes: JSON.stringify(attrs),
    contact: JSON.stringify({
      call: false,
      whatsapp: false,
      chat: true,
      hidePhone: true,
    }),
    source,
    source_url: String(item.url || ''),
    created_at: parseWhen(item.postDate || item.date),
    updated_at: parseWhen(item.postDate || item.date),
    expires_at: null,
  };
}

function seedSouqCategories() {
  const upsert = db().prepare(`
    INSERT INTO souq_categories (id, name_en, name_ar, sort_order)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name_en = excluded.name_en,
      name_ar = excluded.name_ar,
      sort_order = excluded.sort_order
  `);
  const run = db().transaction((rows) => {
    for (const row of rows) upsert.run(...row);
  });
  run(CATEGORIES);
  return CATEGORIES.length;
}

function seedImportedAds() {
  const existing = db().prepare('SELECT COUNT(*) AS n FROM souq_ads WHERE source != ?').get('user').n;
  if (existing > 0) {
    console.log(`Souq ads already seeded (${existing}).`);
    return existing;
  }
  const insert = db().prepare(`
    INSERT OR IGNORE INTO souq_ads (
      ad_id, seller_id, seller_name, seller_avatar, category_id, subcategory_id,
      title, subtitle, description, price, currency, is_negotiable, city, district,
      phone, images, video, status, views, condition, attributes, contact,
      source, source_url, created_at, updated_at, expires_at, make, body_type
    ) VALUES (
      @ad_id, @seller_id, @seller_name, @seller_avatar, @category_id, @subcategory_id,
      @title, @subtitle, @description, @price, @currency, @is_negotiable, @city, @district,
      @phone, @images, @video, @status, @views, @condition, @attributes, @contact,
      @source, @source_url, @created_at, @updated_at, @expires_at, @make, @body_type
    )
  `);
  const haraj = readGzipJson('haraj_cars.json.gz').listings || [];
  const expat = readGzipJson('expat_cars.json.gz').listings || [];
  const run = db().transaction((rows) => {
    let n = 0;
    for (const row of rows) {
      insert.run(row);
      n += 1;
    }
    return n;
  });
  const rows = [
    ...haraj.map((item) => mapImported('haraj', item)),
    ...expat.map((item) => mapImported('expatriates', item)),
  ];
  const count = run(rows);
  console.log(`Seeded ${count} Souq ads (${haraj.length} Haraj, ${expat.length} Expat).`);
  return count;
}

function insertAds(rows) {
  if (!rows.length) return 0;
  const insert = db().prepare(`
    INSERT INTO souq_ads (
      ad_id, seller_id, seller_name, seller_avatar, category_id, subcategory_id,
      title, subtitle, description, price, currency, is_negotiable, city, district,
      phone, images, video, status, views, condition, attributes, contact,
      source, source_url, created_at, updated_at, expires_at, make, body_type
    ) VALUES (
      @ad_id, @seller_id, @seller_name, @seller_avatar, @category_id, @subcategory_id,
      @title, @subtitle, @description, @price, @currency, @is_negotiable, @city, @district,
      @phone, @images, @video, @status, @views, @condition, @attributes, @contact,
      @source, @source_url, @created_at, @updated_at, @expires_at, @make, @body_type
    )
    ON CONFLICT(ad_id) DO UPDATE SET
      price = excluded.price,
      is_negotiable = excluded.is_negotiable,
      title = excluded.title,
      subtitle = excluded.subtitle,
      description = excluded.description,
      updated_at = datetime('now')
  `);
  const run = db().transaction((items) => {
    let n = 0;
    for (const row of items) {
      const info = insert.run(row);
      if (info.changes) n += 1;
    }
    return n;
  });
  return run(rows);
}

function seedExpatClassifieds() {
  const listings = readGzipJson('expat_classifieds.json.gz').listings || [];
  if (!listings.length) return 0;
  const count = insertAds(listings.map((item) => mapImported('expatriates', item)));
  console.log(`Seeded ${count} extra Expat classifieds (${listings.length} in dump).`);
  return count;
}

function backfillCarFilters() {
  const pending = db()
    .prepare(
      `SELECT COUNT(*) AS n FROM souq_ads
       WHERE category_id = 'cars' AND (body_type = '' OR make = '' OR subcategory_id = '')`,
    )
    .get().n;
  if (!pending) return 0;
  const rows = db()
    .prepare(
      `SELECT ad_id, title, subtitle, description, attributes, subcategory_id, make, body_type
       FROM souq_ads WHERE category_id = 'cars'`,
    )
    .all();
  const update = db().prepare(`
    UPDATE souq_ads
    SET make = @make, body_type = @body_type, subcategory_id = @subcategory_id, attributes = @attributes
    WHERE ad_id = @ad_id
  `);
  const run = db().transaction((items) => {
    let n = 0;
    for (const row of items) {
      let attributes = {};
      try {
        attributes = JSON.parse(row.attributes || '{}') || {};
      } catch (_) {
        attributes = {};
      }
      const classified = classifyCar({
        title: row.title,
        subtitle: row.subtitle,
        description: row.description,
        attributes,
        subcategoryId: row.subcategory_id,
        make: row.make,
        bodyType: row.body_type,
      });
      update.run({
        ad_id: row.ad_id,
        make: classified.make,
        body_type: classified.bodyType,
        subcategory_id: classified.subcategoryId,
        attributes: JSON.stringify(classified.attributes),
      });
      n += 1;
    }
    return n;
  });
  const count = run(rows);
  console.log(`Backfilled make/body type on ${count} car ads.`);
  return count;
}

function refreshImportedSpecs() {
  const haraj = new Map((readGzipJson('haraj_cars.json.gz').listings || []).map((item) => [`haraj-${item.id}`, item]));
  const expat = new Map((readGzipJson('expat_cars.json.gz').listings || []).map((item) => [`expatriates-${item.id}`, item]));
  const rows = db()
    .prepare(`SELECT ad_id, source FROM souq_ads WHERE source IN ('haraj', 'expatriates')`)
    .all();
  const update = db().prepare(`
    UPDATE souq_ads
    SET title = @title, subtitle = @subtitle, description = @description, price = @price,
        is_negotiable = @is_negotiable, make = @make, body_type = @body_type,
        subcategory_id = @subcategory_id, attributes = @attributes, condition = @condition
    WHERE ad_id = @ad_id
  `);
  const run = db().transaction((items) => {
    let n = 0;
    for (const row of items) {
      const raw = row.source === 'haraj' ? haraj.get(row.ad_id) : expat.get(row.ad_id);
      if (!raw) continue;
      const mapped = mapImported(row.source, raw);
      update.run({
        ad_id: row.ad_id,
        title: mapped.title,
        subtitle: mapped.subtitle,
        description: mapped.description,
        price: mapped.price,
        is_negotiable: mapped.is_negotiable,
        make: mapped.make,
        body_type: mapped.body_type,
        subcategory_id: mapped.subcategory_id,
        attributes: mapped.attributes,
        condition: mapped.condition,
      });
      n += 1;
    }
    return n;
  });
  const count = run(rows);
  console.log(`Refreshed specs on ${count} imported car ads.`);
  return count;
}

function seedSouq() {
  const cats = seedSouqCategories();
  const ads = seedImportedAds();
  const extra = seedExpatClassifieds();
  refreshImportedSpecs();
  backfillCarFilters();
  console.log(`Souq ready: ${cats} categories, ${ads} imported ads (+${extra} classifieds).`);
}

if (require.main === module) {
  seedSouq();
}

module.exports = { seedSouq };
