const fs = require('fs');
const path = require('path');
const { db } = require('./db');
const { canonicalCity } = require('./cities');

const DATA = path.join(__dirname, '..', 'data');
const SEED = path.join(DATA, 'schools.seed.json');

function cleanNote(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (/^\$[0-9a-fA-F]{1,8}$/.test(text)) return '';
  return text;
}

function asList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (!value) return [];
  return String(value)
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function schoolRow(raw) {
  const loc = raw.location || {};
  const contact = raw.contact || {};
  const fees = raw.fees || {};
  const source = fees.source || {};
  const admission = { ...(raw.admission || {}) };
  admission.notes = cleanNote(admission.notes);
  const lat = Number(loc.lat);
  const lng = Number(loc.lng);
  const payload = {
    ...raw,
    admission,
    city: canonicalCity(raw.city, lat, lng),
  };
  return {
    id: String(raw.id || '').trim(),
    name: String(raw.name || '').trim(),
    city: canonicalCity(raw.city, lat, lng),
    district: String(raw.district || '').trim(),
    address: String(raw.address || '').trim(),
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
    precision: String(loc.precision || '').trim(),
    gender: String(raw.gender || '').trim(),
    grades: String(raw.grades || '').trim(),
    age_range: String(raw.age_range || '').trim(),
    established: Number(raw.established) || null,
    phone: String(contact.phone || '').trim(),
    email: String(contact.email || '').trim(),
    website: String(contact.website || '').trim(),
    curriculum: asList(raw.curriculum).join(', '),
    curriculum_tags: asList(raw.curriculum_tags).join(','),
    stages: asList(raw.stages).join(', '),
    min_fee: Number.isFinite(Number(fees.min_annual_sar)) ? Number(fees.min_annual_sar) : null,
    max_fee: Number.isFinite(Number(fees.max_annual_sar)) ? Number(fees.max_annual_sar) : null,
    fee_year: String(fees.academic_year || '').trim(),
    fee_source_type: String(source.type || '').trim(),
    fee_source_name: String(source.name || '').trim(),
    fee_source_url: String(source.url || '').trim(),
    fees_published: fees.published ? 1 : 0,
    payload: JSON.stringify(payload),
    source: 'seed',
  };
}

function seedSchools() {
  if (!fs.existsSync(SEED)) {
    console.warn('Schools seed missing.');
    return 0;
  }
  const raw = JSON.parse(fs.readFileSync(SEED, 'utf8'));
  const schools = raw.schools || raw;
  const upsert = db().prepare(`
    INSERT INTO schools (
      id, name, city, district, address, lat, lng, precision, gender, grades,
      age_range, established, phone, email, website, curriculum, curriculum_tags,
      stages, min_fee, max_fee, fee_year, fee_source_type, fee_source_name,
      fee_source_url, fees_published, payload, source, updated_at
    ) VALUES (
      @id, @name, @city, @district, @address, @lat, @lng, @precision, @gender, @grades,
      @age_range, @established, @phone, @email, @website, @curriculum, @curriculum_tags,
      @stages, @min_fee, @max_fee, @fee_year, @fee_source_type, @fee_source_name,
      @fee_source_url, @fees_published, @payload, @source, datetime('now')
    )
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      city = excluded.city,
      district = excluded.district,
      address = excluded.address,
      lat = excluded.lat,
      lng = excluded.lng,
      precision = excluded.precision,
      gender = excluded.gender,
      grades = excluded.grades,
      age_range = excluded.age_range,
      established = excluded.established,
      phone = excluded.phone,
      email = excluded.email,
      website = excluded.website,
      curriculum = excluded.curriculum,
      curriculum_tags = excluded.curriculum_tags,
      stages = excluded.stages,
      min_fee = excluded.min_fee,
      max_fee = excluded.max_fee,
      fee_year = excluded.fee_year,
      fee_source_type = excluded.fee_source_type,
      fee_source_name = excluded.fee_source_name,
      fee_source_url = excluded.fee_source_url,
      fees_published = excluded.fees_published,
      payload = excluded.payload,
      source = excluded.source,
      updated_at = datetime('now')
  `);
  const run = db().transaction((rows) => {
    let n = 0;
    for (const school of rows) {
      const row = schoolRow(school);
      if (!row.id || !row.name) continue;
      upsert.run(row);
      n += 1;
    }
    return n;
  });
  const count = run(schools);
  console.log(`Seeded ${count} international schools.`);
  return count;
}

if (require.main === module) {
  seedSchools();
}

module.exports = { seedSchools };
