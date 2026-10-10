#!/usr/bin/env node
/**
 * Export KSA Guide app data + knowledge-pack PDFs into AnythingLLM workspace.
 *
 * Usage:
 *   ALLM_KEY=... ALLM_BASE=http://127.0.0.1:3001 ALLM_WORKSPACE=my-workspace \
 *     node tools/feed_anythingllm.js
 */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const ROOT = path.join(__dirname, '..');
const DB_PATH = process.env.SQLITE_PATH || path.join(ROOT, 'data', 'ksa.sqlite');
const OUT_DIR = path.join(ROOT, 'data', 'llm_feed');
const BASE = (process.env.ALLM_BASE || 'http://127.0.0.1:3001').replace(/\/+$/, '');
const WORKSPACE = process.env.ALLM_WORKSPACE || 'my-workspace';
const KEY =
  process.env.ALLM_KEY ||
  (() => {
    try {
      const secret = fs.readFileSync(
        path.join(
          ROOT,
          '..',
          'KSAGUIDE',
          'lib',
          'data',
          'ksa_api_secret.dart',
        ),
        'utf8',
      );
      const m = secret.match(/static const key = '([^']+)'/);
      return m ? m[1] : '';
    } catch (_) {
      return '';
    }
  })();

const PDF_DIRS = [
  path.join(process.env.HOME || '', 'Downloads', 'KSA_Knowledge_Pack 2'),
  path.join(process.env.HOME || '', 'Downloads', 'KSA_Knowledge_Pack'),
].filter((dir) => fs.existsSync(dir));

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeDoc(name, body) {
  const file = path.join(OUT_DIR, name);
  fs.writeFileSync(file, body.trim() + '\n', 'utf8');
  return file;
}

async function api(pathname, { method = 'GET', json, form } = {}) {
  const headers = { Authorization: `Bearer ${KEY}` };
  let body;
  if (json) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(json);
  }
  if (form) body = form;
  const res = await fetch(`${BASE}${pathname}`, { method, headers, body });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (_) {
    data = { raw: text };
  }
  if (!res.ok) {
    throw new Error(`${method} ${pathname} -> ${res.status}: ${text.slice(0, 240)}`);
  }
  return data;
}

async function uploadFile(filePath) {
  const form = new FormData();
  const buf = fs.readFileSync(filePath);
  const blob = new Blob([buf]);
  form.append('file', blob, path.basename(filePath));
  const data = await api('/api/v1/document/upload', { method: 'POST', form });
  const docs = data.documents || [];
  return docs.map((d) => d.location).filter(Boolean);
}

async function uploadRaw(title, textContent) {
  const data = await api('/api/v1/document/raw-text', {
    method: 'POST',
    json: {
      textContent,
      metadata: {
        title,
        docAuthor: 'KSA Guide',
        description: title,
        docSource: 'ksa-guide-backend feed',
      },
    },
  });
  const docs = data.documents || [];
  return docs.map((d) => d.location).filter(Boolean);
}

function buildMarketplaceDoc(db) {
  const cats = db
    .prepare('SELECT id, name_en, name_ar FROM souq_categories ORDER BY sort_order, name_en')
    .all();
  const lines = [
    '# KSA Guide Marketplace (Souq)',
    '',
    'Users can buy and sell used goods in the KSA Guide app Marketplace (Souq).',
    'Ads require approval before they appear publicly. Sellers can chat in-app, call, or WhatsApp.',
    '',
    '## Categories and live approved ad counts',
  ];
  for (const cat of cats) {
    const n = db
      .prepare(
        `SELECT COUNT(*) AS n FROM souq_ads
         WHERE category_id = ? AND status = 'approved'`,
      )
      .get(cat.id).n;
    lines.push(`- ${cat.name_en} / ${cat.name_ar} (${cat.id}): ${n} approved ads`);
  }
  lines.push('', '## Sample recent approved ads (for answering “what is for sale”)');
  const samples = db
    .prepare(
      `SELECT title, category_id, city, price, currency, condition, created_at
       FROM souq_ads WHERE status = 'approved'
       ORDER BY created_at DESC LIMIT 120`,
    )
    .all();
  for (const ad of samples) {
    const price =
      ad.price == null ? 'price on request' : `${ad.price} ${ad.currency || 'SAR'}`;
    lines.push(
      `- [${ad.category_id}] ${ad.title} · ${ad.city || 'Saudi Arabia'} · ${price} · ${ad.condition || 'good'} · listed ${ad.created_at}`,
    );
  }
  lines.push(
    '',
    '## How to help users',
    '- To sell: open Marketplace → Sell / Post ad, pick category, add photos, price, city, contact options.',
    '- To buy: browse category, open ad details, chat or call seller.',
    '- Cars and classifieds also include Expat-sourced listings when imported.',
  );
  return lines.join('\n');
}

function buildJobsDoc(db) {
  const lines = [
    '# KSA Guide Jobs',
    '',
    'The Jobs tab lists roles in Saudi Arabia. User-posted jobs need approval; seeded jobs may already be published.',
    '',
    '## Categories',
  ];
  const cats = db
    .prepare(
      `SELECT category, COUNT(*) AS n FROM jobs
       WHERE status IN ('published','approved','awaiting_approval')
       GROUP BY category ORDER BY n DESC`,
    )
    .all();
  for (const row of cats) {
    lines.push(`- ${row.category || 'General'}: ${row.n} jobs`);
  }
  lines.push('', '## Sample jobs (answer city / salary / remote questions from these)');
  const jobs = db
    .prepare(
      `SELECT title, category, company_name, city, work_mode, employment_type,
              salary_display, salary_is_posted, summary, apply_url, status, date_posted
       FROM jobs
       WHERE status IN ('published','approved')
       ORDER BY date_posted DESC, created_at DESC
       LIMIT 150`,
    )
    .all();
  for (const job of jobs) {
    const salary = job.salary_is_posted
      ? job.salary_display || 'salary posted'
      : 'salary not posted';
    lines.push(
      `- ${job.title} @ ${job.company_name || 'Company'} · ${job.city || 'KSA'} · ${job.category} · ${job.work_mode || ''} · ${job.employment_type || ''} · ${salary} · status ${job.status}`,
    );
    if (job.summary) lines.push(`  Summary: ${String(job.summary).slice(0, 220)}`);
    if (job.apply_url) lines.push(`  Apply: ${job.apply_url}`);
  }
  return lines.join('\n');
}

function mapsLink(lat, lng) {
  if (lat == null || lng == null) return '';
  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) return '';
  if (Number(lat) === 0 && Number(lng) === 0) return '';
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

function buildClinicsDoc(db) {
  const lines = [
    '# KSA Guide Clinics & Healthcare',
    '',
    'The Clinics / Health section lists hospitals, clinics, pharmacies and emergency info.',
    'When a user asks for a hospital location, ALWAYS reply with city, latitude/longitude, and the Google Maps link from this pack.',
    '',
    '## Name aliases (common misspellings)',
    '- Hamadi / Hammadi / Al Hammadi / Al-Hammadi Hospital = مستشفى الحمادي (Riyadh) and also Hammadi suwadi / HAMC in Riyadh data.',
    '- Dr Hamid Suliman Al-Ahmadi Hospital is in Madinah (different facility).',
    '',
    '## Emergency hotlines',
  ];
  const hotlines = db
    .prepare('SELECT label, number, detail FROM health_hotlines ORDER BY sort_order, label')
    .all();
  for (const h of hotlines) {
    lines.push(`- ${h.label}: ${h.number}${h.detail ? ` — ${h.detail}` : ''}`);
  }
  lines.push('', '## Facility counts by city and kind');
  const counts = db
    .prepare(
      `SELECT city, kind, COUNT(*) AS n FROM health_facilities
       GROUP BY city, kind ORDER BY n DESC LIMIT 80`,
    )
    .all();
  for (const row of counts) {
    lines.push(`- ${row.city || 'Unknown'} / ${row.kind}: ${row.n}`);
  }

  lines.push('', '## All hospitals (with coordinates + maps links)');
  const hospitals = db
    .prepare(
      `SELECT name, kind, city, phone, hours, web, emergency, services, lat, lng
       FROM health_facilities
       WHERE kind = 'hospital' OR amenity = 'hospital' OR lower(name) LIKE '%hospital%'
          OR name LIKE '%مستشفى%'
       ORDER BY city, name`,
    )
    .all();
  for (const f of hospitals) {
    const map = mapsLink(f.lat, f.lng);
    lines.push(
      `- ${f.name} (${f.kind || 'hospital'}) · ${f.city || 'KSA'}${f.emergency ? ' · EMERGENCY' : ''}` +
        ` · phone: ${f.phone || 'n/a'}` +
        (f.lat != null && f.lng != null ? ` · lat ${f.lat}, lng ${f.lng}` : '') +
        (map ? ` · Maps: ${map}` : ''),
    );
    if (f.web) lines.push(`  Website: ${f.web}`);
    if (f.services) lines.push(`  Services: ${f.services}`);
    if (f.hours) lines.push(`  Hours: ${f.hours}`);
  }

  lines.push('', '## Clinics and other facilities (with coordinates)');
  const clinics = db
    .prepare(
      `SELECT name, kind, city, phone, hours, web, emergency, services, lat, lng
       FROM health_facilities
       WHERE NOT (kind = 'hospital' OR amenity = 'hospital' OR lower(name) LIKE '%hospital%' OR name LIKE '%مستشفى%')
       ORDER BY city, name`,
    )
    .all();
  for (const f of clinics) {
    const map = mapsLink(f.lat, f.lng);
    lines.push(
      `- ${f.name} (${f.kind || 'clinic'}) · ${f.city || 'KSA'}` +
        ` · phone: ${f.phone || 'n/a'}` +
        (f.lat != null && f.lng != null ? ` · lat ${f.lat}, lng ${f.lng}` : '') +
        (map ? ` · Maps: ${map}` : ''),
    );
    if (f.web) lines.push(`  Website: ${f.web}`);
  }
  return lines.join('\n');
}

function parsePayload(raw) {
  try {
    const parsed = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    return {};
  }
}

function buildSchoolAdmissionGuide(db) {
  const lines = [
    '# International school admission in Saudi Arabia (KSA Guide Study Here)',
    '',
    'Use this when users ask about school admission, enrollment, registration, required documents, placement tests, or how to apply to an international school.',
    '',
    '## Typical admission process (most international / private schools)',
    '1. Book a school tour or open day (optional but common).',
    '2. Submit an online or in-person application / enquiry form.',
    '3. Provide required documents (passports, Iqama/ID, birth certificate, vaccines, previous reports).',
    '4. Child takes a diagnostic / placement test and/or interview (KG often uses a readiness interview).',
    '5. School reviews previous records and seat availability.',
    '6. Offer is issued; family pays joining / registration / seat-reservation fee.',
    '7. Student is registered on the Ministry of Education Noor system; term fees are paid.',
    '',
    '## Documents usually required',
    '- Student and parents passport copies',
    '- Student and parents Iqama / National ID (Saudis: family card)',
    '- Birth certificate',
    '- Vaccination record',
    '- Previous school report cards (attested by MOE / Saudi embassy if from abroad)',
    '- Transfer / leaving certificate and Noor transfer (if moving from a Saudi school)',
    '- Financial clearance from previous private school (when applicable)',
    '- Passport-size photos',
    '- Sponsor letter for some non-Saudi applicants',
    '',
    '## Extra tips',
    '- Grade placement is often based on academic level, not age alone.',
    '- KG usually needs toilet training and ability to follow simple instructions.',
    '- Joining fees (often 2,000–3,000 SAR) may be required to start testing/admission.',
    '- Tuition is commonly quoted excluding 15% VAT for non-Saudis; confirm with the school.',
    '- Always confirm current seats, fees, and document lists with the school — data in the app may change.',
    '',
    '## School-specific admission notes from KSA Guide data',
  ];

  const schools = db
    .prepare(
      `SELECT name, city, district, curriculum, gender, grades, age_range,
              min_fee, max_fee, fees_published, phone, email, website, payload
       FROM schools
       ORDER BY city, name`,
    )
    .all();

  let withAdmission = 0;
  for (const s of schools) {
    const payload = parsePayload(s.payload);
    const admission = payload.admission || {};
    const steps = admission.steps || [];
    const docs = admission.documents_required || admission.documentsRequired || [];
    const notes = String(admission.notes || '').trim();
    if (!steps.length && !docs.length && !notes) continue;
    withAdmission += 1;
    const fee =
      s.fees_published && (s.min_fee != null || s.max_fee != null)
        ? `fees ${s.min_fee || '?'}–${s.max_fee || '?'} SAR/year`
        : 'fees not published';
    lines.push(`### ${s.name}`);
    lines.push(
      `${s.city}${s.district ? `, ${s.district}` : ''} · ${s.curriculum || 'curriculum n/a'} · ${s.gender || ''} · ${s.grades || s.age_range || ''} · ${fee}`,
    );
    if (s.phone || s.email || s.website) {
      lines.push(`Contact: ${[s.phone, s.email, s.website].filter(Boolean).join(' · ')}`);
    }
    if (steps.length) {
      lines.push('Admission steps:');
      for (const step of steps) lines.push(`- ${step}`);
    }
    if (docs.length) {
      lines.push('Documents required:');
      for (const doc of docs) lines.push(`- ${doc}`);
    }
    if (notes) {
      lines.push('School notes:');
      lines.push(notes.slice(0, 1200));
    }
    lines.push('');
  }
  lines.push(`Schools with admission detail in dataset: ${withAdmission} of ${schools.length}.`);
  return lines.join('\n');
}

function buildSchoolsDoc(db) {
  const lines = [
    '# KSA Guide Study Here (International Schools directory)',
    '',
    'The Study Here section lists international schools with curriculum, fees when published, contacts, and admission details (see the separate school admission guide document for steps/documents).',
    '',
    '## Counts by city',
  ];
  const cities = db
    .prepare(
      `SELECT city, COUNT(*) AS n FROM schools GROUP BY city ORDER BY n DESC LIMIT 40`,
    )
    .all();
  for (const row of cities) lines.push(`- ${row.city || 'Unknown'}: ${row.n} schools`);
  lines.push('', '## School directory (with admission summary)');
  const schools = db
    .prepare(
      `SELECT name, city, district, curriculum, gender, grades, age_range,
              min_fee, max_fee, fees_published, phone, email, website, payload
       FROM schools
       ORDER BY city, name`,
    )
    .all();
  for (const s of schools) {
    const payload = parsePayload(s.payload);
    const admission = payload.admission || {};
    const steps = admission.steps || [];
    const docs = admission.documents_required || admission.documentsRequired || [];
    const fee =
      s.fees_published && (s.min_fee != null || s.max_fee != null)
        ? `fees ${s.min_fee || '?'}–${s.max_fee || '?'} SAR/year`
        : 'fees not published';
    lines.push(
      `- ${s.name} · ${s.city}${s.district ? `, ${s.district}` : ''} · ${s.curriculum || 'curriculum n/a'} · ${s.gender || ''} · ${s.grades || s.age_range || ''} · ${fee}`,
    );
    if (s.phone || s.email || s.website) {
      lines.push(`  Contact: ${[s.phone, s.email, s.website].filter(Boolean).join(' · ')}`);
    }
    if (steps.length) {
      lines.push(`  Admission steps: ${steps.join(' → ')}`);
    }
    if (docs.length) {
      lines.push(`  Documents: ${docs.slice(0, 8).join('; ')}${docs.length > 8 ? '; …' : ''}`);
    }
  }
  return lines.join('\n');
}

function buildGuidesDoc(db) {
  const lines = [
    '# KSA Guide articles (daily life, income tips, legal rights)',
    '',
    'These are in-app guide posts. Prefer Saudi-relevant practical answers.',
    '',
  ];
  const posts = db
    .prepare(
      `SELECT id, title, excerpt, preview, body, created_at FROM posts
       WHERE status = 'published' OR status = '' OR status IS NULL
       ORDER BY created_at DESC LIMIT 80`,
    )
    .all();
  for (const p of posts) {
    lines.push(`## ${p.title}`);
    const blurb = p.excerpt || p.preview;
    if (blurb) lines.push(String(blurb).slice(0, 500));
    const body = String(p.body || '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (body) lines.push(body.slice(0, 1800));
    lines.push('');
  }
  return lines.join('\n');
}

function buildAppOverview() {
  return `
# KSA Guide app overview for the assistant

KSA Guide helps residents and expats in Saudi Arabia.

## Main sections in the app
- **Ask / Chat (LLM)**: answers about Iqama, Absher, Qiwa, Ejar, Balady, utilities, traffic, visas — from official knowledge PDFs AND from live app data below.
- **Marketplace (Souq)**: buy/sell goods; categories; in-app chat with sellers.
- **Jobs**: browse and post jobs in Saudi Arabia.
- **Clinics / Health**: hospitals, clinics, pharmacies, emergency hotlines.
- **Study Here**: international schools, curricula, fees when available.
- **Community**: Facebook-like pages and posts for local groups.
- **Eat / Play / Shops**: restaurants, activities, merchant coupons.

## Answering style
- Prefer facts from embedded documents and the app data packs.
- If asking about a specific school, clinic, job, or marketplace category, use the matching data pack.
- If a fee or regulation is uncertain, say to confirm on the official site.
- Mention that the user can open the matching tab in KSA Guide for the full list.
`.trim();
}

async function main() {
  if (!KEY) {
    console.error('Missing ALLM_KEY (or ksa_api_secret.dart).');
    process.exit(1);
  }
  ensureDir(OUT_DIR);
  const db = new Database(DB_PATH, { readonly: true });
  const locations = [];

  console.log('Building text packs…');
  const only = (process.env.FEED_ONLY || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const packs = [
    ['00_app_overview.txt', buildAppOverview()],
    ['app_marketplace_souq.txt', buildMarketplaceDoc(db)],
    ['app_jobs.txt', buildJobsDoc(db)],
    ['app_clinics_healthcare.txt', buildClinicsDoc(db)],
    ['app_study_schools.txt', buildSchoolsDoc(db)],
    ['app_school_admission_guide.txt', buildSchoolAdmissionGuide(db)],
    ['app_guides_daily_income.txt', buildGuidesDoc(db)],
  ].filter(([name]) => !only.length || only.some((token) => name.includes(token)));

  for (const [name, body] of packs) {
    writeDoc(name, body);
    console.log('  upload', name, `(${body.length} chars)`);
    // AnythingLLM raw-text has practical size limits — split huge packs.
    const maxChunk = 90000;
    if (body.length <= maxChunk) {
      locations.push(...(await uploadRaw(name.replace(/\.txt$/, ''), body)));
    } else {
      let part = 1;
      for (let i = 0; i < body.length; i += maxChunk) {
        const chunk = body.slice(i, i + maxChunk);
        const title = `${name.replace(/\.txt$/, '')}_part${part}`;
        locations.push(...(await uploadRaw(title, chunk)));
        part += 1;
      }
    }
  }

  const skipPdfs = process.env.SKIP_PDFS === '1' || only.length > 0;
  if (!skipPdfs) {
    console.log('Uploading knowledge-pack PDFs…');
    const seen = new Set();
    for (const dir of PDF_DIRS) {
      for (const file of fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.pdf'))) {
        if (seen.has(file)) continue;
        seen.add(file);
        const full = path.join(dir, file);
        console.log('  pdf', file);
        try {
          locations.push(...(await uploadFile(full)));
        } catch (err) {
          console.warn('  skip', file, err.message);
        }
      }
    }
  } else {
    console.log('Skipping PDFs (FEED_ONLY/SKIP_PDFS).');
  }
  const unique = [...new Set(locations)];
  console.log(`Embedding ${unique.length} documents into workspace ${WORKSPACE}…`);
  // Chunk adds to avoid huge payloads
  const chunkSize = 25;
  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize);
    await api(`/api/v1/workspace/${WORKSPACE}/update-embeddings`, {
      method: 'POST',
      json: { adds: chunk },
    });
    console.log(`  embedded ${Math.min(i + chunkSize, unique.length)}/${unique.length}`);
  }

  // Nudge the workspace system prompt to include app data domains.
  try {
    await api(`/api/v1/workspace/${WORKSPACE}/update`, {
      method: 'POST',
      json: {
        openAiPrompt:
          'You are KSA Guide. Date: {datetime}. Reply in the user\'s language.\n\n' +
          'You have official Saudi service PDFs PLUS live app data packs: Marketplace (Souq), Jobs, Clinics/Healthcare (with lat/lng and Maps links), Study Here schools, school admission guide, and in-app guide articles.\n\n' +
          'FORMAT:\n' +
          '- Start with a one-sentence direct answer.\n' +
          '- Then short **bold titles** and normal sentences.\n' +
          '- Use a bullet (•) only for a real list of options or steps.\n' +
          '- If the user asks about jobs, schools, clinics/hospitals, or marketplace items, use the matching app data pack.\n' +
          '- For hospital/clinic location questions, always include city, coordinates, and the full https://www.google.com/maps/search/?api=1&query=LAT,LNG link from the Clinics pack.\n' +
          '- Hamadi / Hammadi / Al Hammadi Hospital usually means مستشفى الحمادي (Riyadh).\n' +
          '- If a fee/regulation is not in the documents, say to confirm on the official site.\n' +
          '- Suggest the matching KSA Guide tab when helpful.',
      },
    });
    console.log('Updated workspace system prompt.');
  } catch (err) {
    console.warn('Could not update workspace prompt:', err.message);
  }

  db.close();
  console.log('Done. AnythingLLM workspace is fed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
