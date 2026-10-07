const fs = require('fs');
const path = require('path');
const { db } = require('./db');

const DATA = path.join(__dirname, '..', 'data');
const SEED = path.join(DATA, 'jobs.seed.json');
const DOWNLOADS = path.join(
  process.env.HOME || '',
  'Downloads',
  'saudi_jobs_last_14_days.json',
);

const SAUDI_HINT =
  /saudi|ksa|السعود|riyadh|jeddah|dammam|khobar|makkah|mecca|madinah|medina|abha|tabuk|neom|jubail|qatif|yanbu|hail|jizan|dhahran|taif|altaif/;

function isInSaudiArabia(job) {
  const loc = job.location || {};
  const country = String(loc.country || '').toLowerCase();
  if (country && !/saudi|ksa|السعود/.test(country)) return false;
  const blob = [
    loc.country,
    loc.city,
    loc.region,
    loc.full_text,
    loc.district_or_area,
    job.title,
  ]
    .map((value) => String(value || '').toLowerCase())
    .join(' ');
  return SAUDI_HINT.test(blob);
}

function cleanCity(value) {
  const city = String(value || '').trim();
  if (!city || /^saudi arabia$/i.test(city)) return 'Saudi Arabia';
  return city;
}

function jobRow(raw) {
  const loc = raw.location || {};
  const company = raw.company || {};
  const salary = raw.salary || {};
  const apply = raw.how_to_apply || {};
  const dates = raw.dates || {};
  const source = raw.source || {};
  const id = raw.id == null ? '' : String(raw.id);
  const posted = Boolean(salary.is_posted && (salary.display || salary.monthly_sar));
  return {
    id: id.startsWith('job-') || id.startsWith('bayt-') ? id : `bayt-${id}`,
    title: String(raw.title || '').trim(),
    category: String(raw.category || '').trim(),
    company_name: String(company.name || '').trim(),
    company_industry: String(company.industry || '').trim(),
    city: cleanCity(loc.city),
    region: String(loc.region || '').trim(),
    country: 'Saudi Arabia',
    location_text: String(loc.full_text || loc.city || 'Saudi Arabia').trim(),
    work_mode: String(raw.work_mode || '').trim(),
    employment_type: String(raw.employment_type || '').trim(),
    experience_required: String(raw.experience_required || raw.employment_details || '').trim(),
    education_required: String(raw.education_required || '').trim(),
    salary_display: posted ? String(salary.display || '').trim() : '',
    salary_monthly_sar: posted && salary.monthly_sar != null ? Number(salary.monthly_sar) : null,
    salary_is_posted: posted ? 1 : 0,
    summary: String(raw.summary || '').trim(),
    description: String(raw.description || raw.summary || '').trim(),
    apply_url: String(apply.apply_url || raw.link || '').trim(),
    apply_method: String(apply.method || '').trim(),
    listing_url: String(raw.link || '').trim(),
    date_posted: String(dates.date_posted || '').trim(),
    deadline: String(dates.application_deadline || '').trim(),
    source: 'bayt',
    source_platform: String(source.platform || 'Bayt.com').trim(),
    status: 'published',
    author_id: '',
    author_name: '',
    payload: JSON.stringify({
      employment_details: raw.employment_details || '',
      career_level: raw.career_level || '',
      nationality_requirement: raw.nationality_requirement || '',
      apply_steps: apply.steps || '',
      closes_text: dates.closes_text || '',
    }),
  };
}

function loadSeed() {
  if (fs.existsSync(SEED)) return JSON.parse(fs.readFileSync(SEED, 'utf8'));
  if (fs.existsSync(DOWNLOADS)) return JSON.parse(fs.readFileSync(DOWNLOADS, 'utf8'));
  return null;
}

function seedJobs() {
  const database = db();
  const existing = database.prepare("SELECT COUNT(*) AS n FROM jobs WHERE source = 'bayt'").get().n;
  if (existing > 0) return existing;
  const seed = loadSeed();
  if (!seed) {
    console.warn('Jobs seed skipped: no jobs.seed.json');
    return 0;
  }
  const jobs = Array.isArray(seed.jobs) ? seed.jobs : Array.isArray(seed) ? seed : [];
  const insert = database.prepare(`
    INSERT OR IGNORE INTO jobs (
      id, title, category, company_name, company_industry, city, region, country,
      location_text, work_mode, employment_type, experience_required, education_required,
      salary_display, salary_monthly_sar, salary_is_posted, summary, description,
      apply_url, apply_method, listing_url, date_posted, deadline, source,
      source_platform, status, author_id, author_name, payload
    ) VALUES (
      @id, @title, @category, @company_name, @company_industry, @city, @region, @country,
      @location_text, @work_mode, @employment_type, @experience_required, @education_required,
      @salary_display, @salary_monthly_sar, @salary_is_posted, @summary, @description,
      @apply_url, @apply_method, @listing_url, @date_posted, @deadline, @source,
      @source_platform, @status, @author_id, @author_name, @payload
    )
  `);
  let kept = 0;
  const tx = database.transaction((rows) => {
    for (const raw of rows) {
      if (!isInSaudiArabia(raw)) continue;
      const row = jobRow(raw);
      if (!row.title) continue;
      insert.run(row);
      kept += 1;
    }
  });
  tx(jobs);
  console.log(`Seeded ${kept} Saudi jobs`);
  return kept;
}

module.exports = { seedJobs, isInSaudiArabia };
