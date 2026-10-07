const { Router } = require('express');
const { db } = require('../db');
const { km } = require('../cities');

const router = Router();

const DISCLAIMER =
  'Fees change every academic year and many schools publish them only on request. Confirm with the school website or admissions office before you apply.';

function parseJson(raw, fallback) {
  try {
    const value = JSON.parse(raw || '');
    return value == null ? fallback : value;
  } catch (_) {
    return fallback;
  }
}

function asList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (!value) return [];
  return String(value)
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function publicSchool(row, { detail = false, distanceKm } = {}) {
  const payload = parseJson(row.payload, {});
  const fees = payload.fees || {};
  const admission = payload.admission || {};
  const contact = payload.contact || {};
  const loc = payload.location || {};
  const item = {
    id: row.id,
    name: row.name,
    city: row.city || '',
    district: row.district || '',
    address: row.address || '',
    lat: row.lat,
    lng: row.lng,
    precision: row.precision || loc.precision || '',
    gender: row.gender || '',
    genderDetail: payload.gender_detail || '',
    grades: row.grades || '',
    ageRange: row.age_range || '',
    established: row.established || null,
    phone: row.phone || contact.phone || '',
    email: row.email || contact.email || '',
    website: row.website || contact.website || '',
    curriculum: asList(row.curriculum || payload.curriculum),
    curriculumTags: asList(row.curriculum_tags || payload.curriculum_tags),
    stages: asList(row.stages || payload.stages),
    accreditations: asList(payload.accreditations),
    minAnnualSar: row.min_fee,
    maxAnnualSar: row.max_fee,
    feeYear: row.fee_year || fees.academic_year || '',
    feeSourceType: row.fee_source_type || (fees.source && fees.source.type) || '',
    feeSourceName: row.fee_source_name || (fees.source && fees.source.name) || '',
    feeSourceUrl: row.fee_source_url || (fees.source && fees.source.url) || '',
    feesPublished: Boolean(row.fees_published),
    vatNote: fees.vat_note || '',
    image: row.image || '',
    googlePlaceId: row.google_place_id || '',
    km: distanceKm ?? 0,
  };
  if (!detail) return item;
  return {
    ...item,
    fees: {
      currency: fees.currency || 'SAR',
      academicYear: fees.academic_year || '',
      lastUpdated: fees.last_updated || null,
      vatNote: fees.vat_note || '',
      byGrade: Array.isArray(fees.by_grade) ? fees.by_grade : [],
      oneTimeFees: Array.isArray(fees.one_time_fees) ? fees.one_time_fees : [],
      discounts: asList(fees.discounts),
      notes: fees.notes || '',
      source: fees.source || null,
      isRangeOnly: Boolean(fees.is_range_only),
      minAnnualSar: fees.min_annual_sar ?? row.min_fee,
      maxAnnualSar: fees.max_annual_sar ?? row.max_fee,
      published: Boolean(fees.published),
      needsVerification: Boolean(fees.needs_verification),
    },
    admission: {
      steps: asList(admission.steps),
      documentsRequired: asList(admission.documents_required),
      schoolSpecific: Boolean(admission.school_specific),
      notes: admission.notes || '',
      source: admission.source || '',
    },
    sources: Array.isArray(payload.sources) ? payload.sources : [],
    disclaimer: DISCLAIMER,
  };
}

function nameRank(name, q) {
  const n = name.toLowerCase();
  if (n === q) return 0;
  if (n.startsWith(q)) return 1;
  if (n.includes(q)) return 2;
  return 3;
}

function listQuery(req, { requireGeo = false } = {}) {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  const hasGeo = Number.isFinite(lat) && Number.isFinite(lng);
  if (requireGeo && !hasGeo) {
    const err = new Error('lat and lng are required numbers');
    err.status = 400;
    throw err;
  }
  const q = String(req.query.q || req.query.query || '').trim().toLowerCase();
  const city = String(req.query.city || '').trim();
  const curriculum = String(req.query.curriculum || req.query.tag || '').trim().toLowerCase();
  const gender = String(req.query.gender || '').trim().toLowerCase();
  const limit = Math.min(Math.max(Number(req.query.limit) || 80, 1), 600);
  const radius = Math.min(Math.max(Number(req.query.radiusKm) || 80, 1), 400);
  return { lat, lng, hasGeo, q, city, curriculum, gender, limit, radius };
}

function filterRows(req, { requireGeo = false } = {}) {
  const query = listQuery(req, { requireGeo });
  let sql = 'SELECT * FROM schools';
  const params = [];
  if (query.hasGeo) {
    const dlat = query.radius / 111;
    const cos = Math.cos((query.lat * Math.PI) / 180) || 0.3;
    const dlng = query.radius / (111 * Math.abs(cos));
    sql += ' WHERE lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?';
    params.push(query.lat - dlat, query.lat + dlat, query.lng - dlng, query.lng + dlng);
  }
  const rows = db().prepare(sql).all(...params);
  const scored = [];
  for (const row of rows) {
    if (query.city && String(row.city || '').toLowerCase() !== query.city.toLowerCase()) {
      continue;
    }
    if (query.curriculum) {
      const tags = `,${String(row.curriculum_tags || '').toLowerCase()},`;
      if (!tags.includes(`,${query.curriculum},`)) continue;
    }
    if (query.gender) {
      const g = String(row.gender || '').toLowerCase();
      if (g !== query.gender && !g.includes(query.gender)) continue;
    }
    if (query.q) {
      const blob = `${row.name} ${row.city} ${row.district} ${row.address} ${row.curriculum} ${row.grades}`.toLowerCase();
      if (!blob.includes(query.q) && !row.name.toLowerCase().includes(query.q)) continue;
    }
    let distance = 0;
    if (query.hasGeo && row.lat != null && row.lng != null) {
      distance = km(query.lat, query.lng, row.lat, row.lng);
      if (distance > query.radius) continue;
    }
    scored.push({ row, distance });
  }
  scored.sort((a, b) => {
    if (query.q) {
      const rank = nameRank(a.row.name, query.q) - nameRank(b.row.name, query.q);
      if (rank !== 0) return rank;
    }
    if (query.hasGeo) return a.distance - b.distance;
    const city = a.row.city.localeCompare(b.row.city);
    if (city !== 0) return city;
    return a.row.name.localeCompare(b.row.name);
  });
  const items = scored.slice(0, query.limit).map((item) =>
    publicSchool(item.row, {
      distanceKm: query.hasGeo ? Number(item.distance.toFixed(2)) : 0,
    }),
  );
  return { items, totalMatched: scored.length, query };
}

router.get('/filters', (_req, res) => {
  const rows = db().prepare('SELECT city, curriculum_tags, gender FROM schools').all();
  const cities = new Map();
  const tags = new Map();
  const genders = new Map();
  for (const row of rows) {
    if (row.city) cities.set(row.city, (cities.get(row.city) || 0) + 1);
    if (row.gender) genders.set(row.gender, (genders.get(row.gender) || 0) + 1);
    for (const tag of asList(row.curriculum_tags)) {
      tags.set(tag, (tags.get(tag) || 0) + 1);
    }
  }
  res.json({
    disclaimer: DISCLAIMER,
    cities: [...cities.entries()].map(([id, count]) => ({ id, count })).sort((a, b) => b.count - a.count),
    curriculums: [...tags.entries()]
      .map(([id, count]) => ({ id, count }))
      .sort((a, b) => b.count - a.count),
    genders: [...genders.entries()].map(([id, count]) => ({ id, count })),
  });
});

router.post('/photos', (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  const update = db().prepare(`
    UPDATE schools SET
      image = CASE
        WHEN @image != '' AND (image = '' OR image NOT LIKE '%googleapis%') THEN @image
        WHEN @image LIKE '%googleapis%' THEN @image
        ELSE image
      END,
      google_place_id = COALESCE(NULLIF(@google_place_id, ''), google_place_id),
      updated_at = datetime('now')
    WHERE id = @id
  `);
  let updated = 0;
  const run = db().transaction(() => {
    for (const raw of items) {
      const id = String(raw.id || '').trim();
      const image = String(raw.image || '').trim();
      if (!id || !image) continue;
      const result = update.run({
        id,
        image,
        google_place_id: String(raw.googlePlaceId || raw.google_place_id || '').trim(),
      });
      if (result.changes) updated += 1;
    }
  });
  run();
  res.json({ updated });
});

router.get('/nearby', (req, res) => {
  const { items, totalMatched } = filterRows(req, { requireGeo: true });
  res.json({ count: items.length, totalMatched, items });
});

router.get('/', (req, res) => {
  const { items, totalMatched } = filterRows(req);
  res.json({ count: items.length, totalMatched, items, disclaimer: DISCLAIMER });
});

router.get('/:id', (req, res) => {
  const row = db().prepare('SELECT * FROM schools WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'School not found' });
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  let distance = 0;
  if (Number.isFinite(lat) && Number.isFinite(lng) && row.lat != null && row.lng != null) {
    distance = Number(km(lat, lng, row.lat, row.lng).toFixed(2));
  }
  res.json(publicSchool(row, { detail: true, distanceKm: distance }));
});

module.exports = { router };
