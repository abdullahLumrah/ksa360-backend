const fs = require('fs');
const path = require('path');
const { db, restaurantRow, activityRow } = require('./db');
const { seedSouq } = require('./seed_souq');
const { canonicalCity } = require('./cities');
const { nameKey, lookupVideo } = require('./videos');

const DATA = path.join(__dirname, '..', 'data');

function readJson(file) {
  const full = path.join(DATA, file);
  if (!fs.existsSync(full)) {
    throw new Error(`Missing seed file: ${full}`);
  }
  return JSON.parse(fs.readFileSync(full, 'utf8'));
}

function seedPlaceVideos() {
  const raw = readJson('place_videos.seed.json');
  const entries = raw.items || raw;
  const upsert = db().prepare(`
    INSERT INTO place_videos (name_key, name, youtube_id)
    VALUES (@name_key, @name, @youtube_id)
    ON CONFLICT(name_key) DO UPDATE SET
      name = excluded.name,
      youtube_id = excluded.youtube_id
  `);
  const map = new Map();
  const run = db().transaction((pairs) => {
    let n = 0;
    for (const [name, youtubeId] of pairs) {
      const key = nameKey(name);
      const id = String(youtubeId || '').trim();
      if (!key || !id) continue;
      upsert.run({ name_key: key, name: String(name), youtube_id: id });
      map.set(key, id);
      n += 1;
    }
    return n;
  });
  const count = run(Object.entries(entries));
  console.log(`Seeded ${count} restaurant videos.`);
  return map;
}

function seedRestaurants(videoMap) {
  const raw = readJson('restaurants.seed.json');
  const places = raw.places || raw;
  const upsert = db().prepare(`
    INSERT INTO restaurants (
      id, name, lat, lng, kind, cuisine, city, phone, hours, web,
      amenity, image, rating, ratings, youtube_id, google_place_id, source, updated_at
    ) VALUES (
      @id, @name, @lat, @lng, @kind, @cuisine, @city, @phone, @hours, @web,
      @amenity, @image, @rating, @ratings, @youtube_id, @google_place_id, @source, datetime('now')
    )
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      lat = excluded.lat,
      lng = excluded.lng,
      kind = excluded.kind,
      cuisine = excluded.cuisine,
      city = excluded.city,
      phone = excluded.phone,
      hours = excluded.hours,
      web = excluded.web,
      amenity = excluded.amenity,
      rating = excluded.rating,
      ratings = excluded.ratings,
      youtube_id = CASE WHEN excluded.youtube_id != '' THEN excluded.youtube_id ELSE restaurants.youtube_id END,
      google_place_id = COALESCE(excluded.google_place_id, restaurants.google_place_id),
      image = CASE
        WHEN excluded.image LIKE '%googleusercontent.com%'
          OR excluded.image LIKE '%places.googleapis.com%'
          OR excluded.image LIKE '%maps.googleapis.com/maps/api/place/photo%'
          OR excluded.image LIKE '%deliveryhero.io%'
          OR excluded.image LIKE '%hungerstation%'
          OR excluded.image LIKE '%dhmedia.io%' THEN excluded.image
        WHEN restaurants.image LIKE '%googleusercontent.com%'
          OR restaurants.image LIKE '%places.googleapis.com%'
          OR restaurants.image LIKE '%maps.googleapis.com/maps/api/place/photo%'
          OR restaurants.image LIKE '%deliveryhero.io%'
          OR restaurants.image LIKE '%hungerstation%'
          OR restaurants.image LIKE '%dhmedia.io%' THEN restaurants.image
        WHEN excluded.image != '' AND (restaurants.image = '' OR restaurants.image LIKE '%unsplash.com%') THEN excluded.image
        ELSE restaurants.image
      END,
      updated_at = datetime('now')
  `);

  const run = db().transaction((rows) => {
    let n = 0;
    for (const place of rows) {
      const lat = Number(place.lat);
      const lng = Number(place.lng);
      if (!place.id || !place.name || !Number.isFinite(lat) || !Number.isFinite(lng)) {
        continue;
      }
      upsert.run(
        restaurantRow({
          ...place,
          lat,
          lng,
          city: canonicalCity(place.city, lat, lng),
          youtube_id: lookupVideo(videoMap, place.name),
          source: 'seed',
        }),
      );
      n += 1;
    }
    return n;
  });

  const count = run(places);
  const withVideo = db()
    .prepare("SELECT COUNT(*) AS n FROM restaurants WHERE youtube_id != ''")
    .get().n;
  console.log(`Seeded ${count} restaurants (${withVideo} with videos).`);
}

function seedActivities() {
  const raw = readJson('activities.seed.json');
  const places = raw.places || raw;
  const upsert = db().prepare(`
    INSERT INTO activities (
      id, name, kind, city, lat, lng, price_from, price_to, unit, image,
      about, hours, phone, web, area, also, featured, family, indoor,
      youtube_id, source, updated_at
    ) VALUES (
      @id, @name, @kind, @city, @lat, @lng, @price_from, @price_to, @unit, @image,
      @about, @hours, @phone, @web, @area, @also, @featured, @family, @indoor,
      @youtube_id, @source, datetime('now')
    )
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      kind = excluded.kind,
      city = excluded.city,
      lat = excluded.lat,
      lng = excluded.lng,
      price_from = excluded.price_from,
      price_to = excluded.price_to,
      unit = excluded.unit,
      image = excluded.image,
      about = excluded.about,
      hours = excluded.hours,
      phone = excluded.phone,
      web = excluded.web,
      area = excluded.area,
      also = excluded.also,
      featured = excluded.featured,
      family = excluded.family,
      indoor = excluded.indoor,
      youtube_id = CASE WHEN excluded.youtube_id != '' THEN excluded.youtube_id ELSE activities.youtube_id END,
      updated_at = datetime('now')
  `);

  const run = db().transaction((rows) => {
    let n = 0;
    for (const place of rows) {
      const lat = Number(place.lat);
      const lng = Number(place.lng);
      if (!place.id || !place.name || !Number.isFinite(lat) || !Number.isFinite(lng)) {
        continue;
      }
      upsert.run(activityRow({ ...place, source: 'seed' }));
      n += 1;
    }
    return n;
  });

  const count = run(places);
  console.log(`Seeded ${count} activities.`);
}

function seedReels() {
  const raw = readJson('play_reels.seed.json');
  const items = raw.items || raw;
  const upsert = db().prepare(`
    INSERT INTO reels (id, youtube_id, title, hook, source, place_id, city, sort_order)
    VALUES (@id, @youtube_id, @title, @hook, @source, @place_id, @city, @sort_order)
    ON CONFLICT(id) DO UPDATE SET
      youtube_id = excluded.youtube_id,
      title = excluded.title,
      hook = excluded.hook,
      source = excluded.source,
      place_id = excluded.place_id,
      city = excluded.city,
      sort_order = excluded.sort_order
  `);
  const byYoutube = db().prepare('SELECT id FROM reels WHERE youtube_id = ?');

  const activities = new Map(
    db()
      .prepare('SELECT * FROM activities')
      .all()
      .map((row) => [row.id, row]),
  );

  let order = 0;
  const runActivities = db().transaction((rows) => {
    let n = 0;
    for (const item of rows) {
      const youtubeId = String(item.youtubeId || item.youtube_id || '').trim();
      const activityId = String(item.activityId || item.activity_id || '').trim();
      if (!youtubeId || !activityId || byYoutube.get(youtubeId)) continue;
      const activity = activities.get(activityId);
      const hook = String(item.hook || '');
      upsert.run({
        id: `activity:${activityId}`,
        youtube_id: youtubeId,
        title: hook || (activity && activity.name) || activityId,
        hook,
        source: 'activity',
        place_id: activityId,
        city: (activity && activity.city) || '',
        sort_order: Number(item.sortOrder ?? item.sort_order ?? order),
      });
      order += 1;
      n += 1;
    }
    return n;
  });
  const fromPlay = runActivities(items);

  const restaurants = db()
    .prepare("SELECT * FROM restaurants WHERE youtube_id != '' ORDER BY name")
    .all();
  let fromEat = 0;
  const runRestaurants = db().transaction((rows) => {
    let n = 0;
    for (const row of rows) {
      if (byYoutube.get(row.youtube_id)) continue;
      upsert.run({
        id: `restaurant:${row.id}`,
        youtube_id: row.youtube_id,
        title: `${row.name}${row.city ? ` · ${row.city}` : ''}`,
        hook: `${row.name} · ${row.kind}`,
        source: 'restaurant',
        place_id: row.id,
        city: row.city || '',
        sort_order: order,
      });
      order += 1;
      n += 1;
    }
    return n;
  });
  fromEat = runRestaurants(restaurants);

  const total = db().prepare('SELECT COUNT(*) AS n FROM reels').get().n;
  console.log(`Seeded ${fromPlay} activity reels and ${fromEat} restaurant reels. Store has ${total}.`);
}

function seedGuides() {
  const catalog = readJson('catalog.seed.json');
  const bodies = readJson('bodies.seed.json');
  const categories = catalog.categories || [];
  const posts = catalog.posts || [];

  const upsertCategory = db().prepare(`
    INSERT INTO categories (id, name, slug, parent_id, sort_order, updated_at)
    VALUES (@id, @name, @slug, @parent_id, @sort_order, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      slug = excluded.slug,
      parent_id = excluded.parent_id,
      sort_order = excluded.sort_order,
      updated_at = datetime('now')
  `);
  const upsertPost = db().prepare(`
    INSERT INTO posts (
      id, title, slug, date, excerpt, preview, body, image,
      word_count, source, source_label, updated_at
    ) VALUES (
      @id, @title, @slug, @date, @excerpt, @preview, @body, @image,
      @word_count, @source, @source_label, datetime('now')
    )
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      slug = excluded.slug,
      date = excluded.date,
      excerpt = excluded.excerpt,
      preview = excluded.preview,
      body = CASE WHEN excluded.body != '' THEN excluded.body ELSE posts.body END,
      image = excluded.image,
      word_count = excluded.word_count,
      source = excluded.source,
      source_label = excluded.source_label,
      updated_at = datetime('now')
  `);
  const clearLinks = db().prepare('DELETE FROM post_categories WHERE post_id = ?');
  const clearTags = db().prepare('DELETE FROM post_tags WHERE post_id = ?');
  const insertLink = db().prepare(
    'INSERT OR IGNORE INTO post_categories (post_id, category_id) VALUES (?, ?)',
  );
  const insertTag = db().prepare(
    'INSERT OR IGNORE INTO post_tags (post_id, tag) VALUES (?, ?)',
  );

  const byName = new Map();
  const runCats = db().transaction((rows) => {
    let n = 0;
    rows.forEach((item, index) => {
      const id = String(item.id || '').trim();
      const name = String(item.name || '').trim();
      if (!id || !name) return;
      upsertCategory.run({
        id,
        name,
        slug: String(item.slug || ''),
        parent_id: String(item.parentId ?? item.parent_id ?? '0'),
        sort_order: index,
      });
      byName.set(name.toLowerCase(), id);
      n += 1;
    });
    return n;
  });
  const catCount = runCats(categories);

  const runPosts = db().transaction((rows) => {
    let n = 0;
    for (const item of rows) {
      const id = String(item.id || '').trim();
      const title = String(item.title || '').trim();
      if (!id || !title) continue;
      upsertPost.run({
        id,
        title,
        slug: String(item.slug || ''),
        date: String(item.date || ''),
        excerpt: String(item.excerpt || ''),
        preview: String(item.preview || ''),
        body: String(bodies[id] || item.body || ''),
        image: String(item.image || ''),
        word_count: Number(item.wordCount ?? item.word_count ?? 0),
        source: String(item.source || 'lisa'),
        source_label: String(item.sourceLabel || item.source_label || ''),
      });
      clearLinks.run(id);
      clearTags.run(id);
      for (const raw of item.categories || []) {
        const name = String(raw || '').trim();
        const categoryId = byName.get(name.toLowerCase());
        if (categoryId) insertLink.run(id, categoryId);
      }
      for (const raw of item.tags || []) {
        const tag = String(raw || '').trim();
        if (tag) insertTag.run(id, tag);
      }
      n += 1;
    }
    return n;
  });
  const postCount = runPosts(posts);
  console.log(`Seeded ${catCount} categories and ${postCount} posts.`);
}

function seedShops() {
  const raw = readJson('shops.seed.json');
  const upsertCat = db().prepare(`
    INSERT INTO shop_categories (id, name, blurb, image, icon, sort_order)
    VALUES (@id, @name, @blurb, @image, @icon, @sort_order)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      blurb = excluded.blurb,
      image = excluded.image,
      icon = excluded.icon,
      sort_order = excluded.sort_order
  `);
  const upsertMerchant = db().prepare(`
    INSERT INTO shop_merchants (id, name, blurb, website, android_id, ios_id, image, icon, kind, featured, sort_order)
    VALUES (@id, @name, @blurb, @website, @android_id, @ios_id, @image, @icon, @kind, @featured, @sort_order)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      blurb = excluded.blurb,
      website = excluded.website,
      android_id = excluded.android_id,
      ios_id = excluded.ios_id,
      image = excluded.image,
      icon = excluded.icon,
      kind = excluded.kind,
      featured = excluded.featured,
      sort_order = excluded.sort_order
  `);
  const clearLinks = db().prepare('DELETE FROM shop_merchant_categories WHERE merchant_id = ?');
  const insertLink = db().prepare(
    'INSERT OR IGNORE INTO shop_merchant_categories (merchant_id, category_id) VALUES (?, ?)',
  );
  const upsertCoupon = db().prepare(`
    INSERT INTO shop_coupons (id, merchant_id, title, detail, code, url, sort_order)
    VALUES (@id, @merchant_id, @title, @detail, @code, @url, @sort_order)
    ON CONFLICT(id) DO UPDATE SET
      merchant_id = excluded.merchant_id,
      title = excluded.title,
      detail = excluded.detail,
      code = excluded.code,
      url = excluded.url,
      sort_order = excluded.sort_order
  `);

  const run = db().transaction(() => {
    let cats = 0;
    let merchants = 0;
    let coupons = 0;
    for (const item of raw.categories || []) {
      const id = String(item.id || '').trim();
      if (!id) continue;
      upsertCat.run({
        id,
        name: String(item.name || '').trim(),
        blurb: String(item.blurb || ''),
        image: String(item.image || item.icon || ''),
        icon: String(item.icon || item.image || ''),
        sort_order: Number(item.sort || 0),
      });
      cats += 1;
    }
    (raw.merchants || []).forEach((item, index) => {
      const id = String(item.id || '').trim();
      if (!id) return;
      upsertMerchant.run({
        id,
        name: String(item.name || '').trim(),
        blurb: String(item.blurb || ''),
        website: String(item.website || ''),
        android_id: String(item.androidId || item.android_id || ''),
        ios_id: String(item.iosId || item.ios_id || ''),
        image: String(item.image || item.icon || ''),
        icon: String(item.icon || item.image || ''),
        kind: String(item.kind || 'app'),
        featured: item.featured ? 1 : 0,
        sort_order: Number(item.sort || index),
      });
      clearLinks.run(id);
      for (const rawCat of item.categories || []) {
        const categoryId = String(rawCat || '').trim();
        if (categoryId) insertLink.run(id, categoryId);
      }
      merchants += 1;
    });
    (raw.coupons || []).forEach((item, index) => {
      const id = String(item.id || '').trim();
      const merchantId = String(item.merchantId || item.merchant_id || '').trim();
      if (!id || !merchantId) return;
      upsertCoupon.run({
        id,
        merchant_id: merchantId,
        title: String(item.title || '').trim(),
        detail: String(item.detail || ''),
        code: String(item.code || ''),
        url: String(item.url || ''),
        sort_order: Number(item.sort || index),
      });
      coupons += 1;
    });
    return { cats, merchants, coupons };
  });
  const counts = run();
  const keepCats = (raw.categories || []).map((item) => String(item.id || '').trim()).filter(Boolean);
  const keepMerchants = (raw.merchants || []).map((item) => String(item.id || '').trim()).filter(Boolean);
  const keepCoupons = (raw.coupons || []).map((item) => String(item.id || '').trim()).filter(Boolean);
  if (keepCoupons.length) {
    db().prepare(
      `DELETE FROM shop_coupons WHERE id NOT IN (${keepCoupons.map(() => '?').join(',')})`,
    ).run(...keepCoupons);
  }
  if (keepMerchants.length) {
    db().prepare(
      `DELETE FROM shop_merchant_categories WHERE merchant_id NOT IN (${keepMerchants.map(() => '?').join(',')})`,
    ).run(...keepMerchants);
    db().prepare(
      `DELETE FROM shop_merchants WHERE id NOT IN (${keepMerchants.map(() => '?').join(',')})`,
    ).run(...keepMerchants);
  }
  if (keepCats.length) {
    db().prepare(
      `DELETE FROM shop_merchant_categories WHERE category_id NOT IN (${keepCats.map(() => '?').join(',')})`,
    ).run(...keepCats);
    db().prepare(
      `DELETE FROM shop_categories WHERE id NOT IN (${keepCats.map(() => '?').join(',')})`,
    ).run(...keepCats);
  }
  console.log(
    `Seeded ${counts.cats} shop categories, ${counts.merchants} merchants, ${counts.coupons} coupons.`,
  );
}

function upsertFacility(stmt, place) {
  const lat = Number(place.lat);
  const lng = Number(place.lng);
  if (!place.id || !place.name || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return false;
  }
  stmt.run({
    id: String(place.id),
    name: String(place.name),
    lat,
    lng,
    kind: String(place.kind || 'clinic'),
    city: canonicalCity(place.city, lat, lng),
    phone: String(place.phone || ''),
    hours: String(place.hours || ''),
    web: String(place.web || ''),
    amenity: String(place.amenity || place.kind || 'clinic'),
    emergency: place.emergency ? 1 : 0,
    services: String(place.services || ''),
    source: String(place.source || 'seed'),
  });
  return true;
}

function seedHealthcare() {
  const upsert = db().prepare(`
    INSERT INTO health_facilities (
      id, name, lat, lng, kind, city, phone, hours, web,
      amenity, emergency, services, source, updated_at
    ) VALUES (
      @id, @name, @lat, @lng, @kind, @city, @phone, @hours, @web,
      @amenity, @emergency, @services, @source, datetime('now')
    )
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      lat = excluded.lat,
      lng = excluded.lng,
      kind = excluded.kind,
      city = excluded.city,
      phone = CASE WHEN excluded.phone != '' THEN excluded.phone ELSE health_facilities.phone END,
      hours = CASE WHEN excluded.hours != '' THEN excluded.hours ELSE health_facilities.hours END,
      web = CASE WHEN excluded.web != '' THEN excluded.web ELSE health_facilities.web END,
      amenity = excluded.amenity,
      emergency = CASE WHEN excluded.emergency = 1 THEN 1 ELSE health_facilities.emergency END,
      services = CASE WHEN excluded.services != '' THEN excluded.services ELSE health_facilities.services END,
      source = excluded.source,
      updated_at = datetime('now')
    WHERE health_facilities.source != 'admin'
  `);
  const updatePhone = db().prepare(
    `UPDATE health_facilities
     SET phone = CASE WHEN phone = '' THEN @phone ELSE phone END,
         emergency = CASE WHEN @emergency = 1 THEN 1 ELSE emergency END,
         services = CASE WHEN services = '' THEN @services ELSE services END
     WHERE lower(name) = lower(@name) AND lower(city) = lower(@city)
       AND source != 'admin'`,
  );

  let osmCount = 0;
  const osmPath = path.join(DATA, 'healthcare.seed.json');
  if (fs.existsSync(osmPath)) {
    const osm = JSON.parse(fs.readFileSync(osmPath, 'utf8'));
    const places = osm.places || osm;
    const runOsm = db().transaction((rows) => {
      let n = 0;
      for (const place of rows) {
        if (upsertFacility(upsert, { ...place, source: place.source || 'osm' })) n += 1;
      }
      return n;
    });
    osmCount = runOsm(places);
  }

  const curated = readJson('healthcare_curated.seed.json');
  const runCurated = db().transaction((rows) => {
    let n = 0;
    for (const place of rows) {
      if (upsertFacility(upsert, place)) n += 1;
      if (place.phone) {
        updatePhone.run({
          phone: String(place.phone),
          emergency: place.emergency ? 1 : 0,
          services: String(place.services || ''),
          name: String(place.name),
          city: canonicalCity(place.city, Number(place.lat), Number(place.lng)),
        });
      }
    }
    return n;
  });
  const curatedCount = runCurated(curated.places || curated);

  const emergency = readJson('healthcare_emergency.seed.json');
  const upsertLine = db().prepare(`
    INSERT INTO health_hotlines (id, label, number, detail, sort_order)
    VALUES (@id, @label, @number, @detail, @sort_order)
    ON CONFLICT(id) DO UPDATE SET
      label = excluded.label,
      number = excluded.number,
      detail = excluded.detail,
      sort_order = excluded.sort_order
  `);
  const upsertStep = db().prepare(`
    INSERT INTO health_steps (id, title, detail, sort_order)
    VALUES (@id, @title, @detail, @sort_order)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      detail = excluded.detail,
      sort_order = excluded.sort_order
  `);
  (emergency.hotlines || []).forEach((item, index) => {
    upsertLine.run({
      id: String(item.id || item.number),
      label: String(item.label || item.number),
      number: String(item.number || ''),
      detail: String(item.detail || ''),
      sort_order: Number(item.sort || index),
    });
  });
  (emergency.steps || []).forEach((item, index) => {
    upsertStep.run({
      id: String(item.id || `step-${index}`),
      title: String(item.title || ''),
      detail: String(item.detail || ''),
      sort_order: Number(item.sort || index),
    });
  });
  console.log(
    `Seeded ${osmCount} OSM health places, ${curatedCount} curated hospitals, ${
      (emergency.hotlines || []).length
    } hotlines.`,
  );
}

function seed() {
  const videos = seedPlaceVideos();
  seedRestaurants(videos);
  seedActivities();
  seedReels();
  seedGuides();
  seedSouq();
  seedShops();
  seedHealthcare();
}

if (require.main === module) {
  seed();
}

module.exports = { seed, seedShops, seedHealthcare, seedRestaurants, seedPlaceVideos };
