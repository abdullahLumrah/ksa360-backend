const crypto = require('crypto');
const { Router } = require('express');
const { db, publicJob } = require('../db');
const { requireUser } = require('../auth');
const { isInSaudiArabia } = require('../seed_jobs');

const router = Router();

const JOB_CATEGORIES = [
  'Administration',
  'Banking & Insurance',
  'Construction & Real Estate',
  'Customer Service',
  'Cybersecurity',
  'Data & AI',
  'Design & Creative',
  'Drivers & Transport',
  'Education & Teaching',
  'Engineering',
  'Finance & Accounting',
  'Health, Safety & Environment',
  'Healthcare & Medical',
  'Hospitality & Food Service',
  'Human Resources',
  'IT & Software',
  'Legal',
  'Logistics & Supply Chain',
  'Marketing',
  'Oil, Gas & Energy',
  'Pharmacy',
  'Procurement',
  'Project Management',
  'Quality Assurance & Control',
  'Retail',
  'Sales',
  'Technicians & Skilled Trades',
  'Other',
];

function pageParams(query, max = 50) {
  const page = Math.max(0, Number(query.page || 0));
  const limit = Math.min(max, Math.max(1, Number(query.limit || 24)));
  return { page, limit, offset: page * limit };
}

function like(value) {
  return `%${String(value || '').trim()}%`;
}

function listWhere(query, { publishedOnly = true, authorId = '' } = {}) {
  const clauses = [];
  const params = {};
  if (publishedOnly) {
    clauses.push("status = 'published'");
  } else if (query.status) {
    clauses.push('status = @status');
    params.status = String(query.status);
  }
  if (authorId) {
    clauses.push('author_id = @authorId');
    params.authorId = authorId;
  }
  const q = String(query.q || '').trim();
  if (q) {
    clauses.push(
      '(title LIKE @q OR company_name LIKE @q OR city LIKE @q OR category LIKE @q OR summary LIKE @q)',
    );
    params.q = like(q);
  }
  if (query.category) {
    clauses.push('category = @category');
    params.category = String(query.category);
  }
  if (query.city) {
    clauses.push('city = @city');
    params.city = String(query.city);
  }
  if (query.employmentType) {
    clauses.push('employment_type = @employmentType');
    params.employmentType = String(query.employmentType);
  }
  if (query.workMode) {
    clauses.push('work_mode = @workMode');
    params.workMode = String(query.workMode);
  }
  return {
    where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '',
    params,
  };
}

function saudiLocation(body) {
  const city = String(body.city || '').trim();
  const country = String(body.country || 'Saudi Arabia').trim() || 'Saudi Arabia';
  return isInSaudiArabia({
    title: body.title,
    location: {
      country,
      city,
      region: body.region || city,
      full_text: `${city} ${country}`,
    },
  });
}

router.get('/filters', (_req, res) => {
  const categories = db()
    .prepare(
      "SELECT category AS name, COUNT(*) AS count FROM jobs WHERE status = 'published' AND category != '' GROUP BY category ORDER BY count DESC, name",
    )
    .all();
  const cities = db()
    .prepare(
      "SELECT city AS name, COUNT(*) AS count FROM jobs WHERE status = 'published' AND city != '' GROUP BY city ORDER BY count DESC, name",
    )
    .all();
  const employmentTypes = db()
    .prepare(
      "SELECT employment_type AS name, COUNT(*) AS count FROM jobs WHERE status = 'published' AND employment_type != '' GROUP BY employment_type ORDER BY count DESC",
    )
    .all();
  const workModes = db()
    .prepare(
      "SELECT work_mode AS name, COUNT(*) AS count FROM jobs WHERE status = 'published' AND work_mode != '' GROUP BY work_mode ORDER BY count DESC",
    )
    .all();
  res.json({
    categories: categories.length ? categories : JOB_CATEGORIES.map((name) => ({ name, count: 0 })),
    postCategories: JOB_CATEGORIES,
    cities,
    employmentTypes,
    workModes,
  });
});

router.get('/', (req, res) => {
  const { page, limit, offset } = pageParams(req.query);
  const { where, params } = listWhere(req.query);
  const total = db().prepare(`SELECT COUNT(*) AS n FROM jobs ${where}`).get(params).n;
  const rows = db()
    .prepare(
      `SELECT * FROM jobs ${where} ORDER BY date_posted DESC, created_at DESC LIMIT @limit OFFSET @offset`,
    )
    .all({ ...params, limit, offset });
  res.json({
    items: rows.map((row) => publicJob(row)),
    total,
    page,
    limit,
  });
});

router.get('/mine', requireUser, (req, res) => {
  const { page, limit, offset } = pageParams(req.query);
  const { where, params } = listWhere(req.query, {
    publishedOnly: false,
    authorId: req.user.id,
  });
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

router.get('/:id', (req, res) => {
  const row = db().prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Job not found' });
  const mine = req.user && row.author_id === req.user.id;
  if (row.status !== 'published' && !mine) {
    return res.status(404).json({ error: 'Job not found' });
  }
  res.json(publicJob(row, { detail: true }));
});

router.post('/', requireUser, (req, res) => {
  const body = req.body || {};
  const title = String(body.title || '').trim();
  const companyName = String(body.companyName || body.company_name || '').trim();
  const category = String(body.category || '').trim();
  const city = String(body.city || '').trim();
  const description = String(body.description || body.summary || '').trim();
  const applyUrl = String(body.applyUrl || body.apply_url || '').trim();
  const contactEmail = String(body.contactEmail || body.contact_email || '').trim();
  if (!title) return res.status(400).json({ error: 'title is required' });
  if (!companyName) return res.status(400).json({ error: 'companyName is required' });
  if (!category) return res.status(400).json({ error: 'category is required' });
  if (!city) return res.status(400).json({ error: 'city is required' });
  if (!description) return res.status(400).json({ error: 'description is required' });
  if (!applyUrl && !contactEmail) {
    return res.status(400).json({ error: 'Add an apply link or a contact email' });
  }
  if (!saudiLocation({ ...body, title, city })) {
    return res.status(400).json({ error: 'Only jobs in Saudi Arabia can be posted' });
  }
  const salaryDisplay = String(body.salaryDisplay || body.salary_display || '').trim();
  const id = `job-${crypto.randomUUID()}`;
  db()
    .prepare(
      `INSERT INTO jobs (
        id, title, category, company_name, company_industry, city, region, country,
        location_text, work_mode, employment_type, experience_required, education_required,
        salary_display, salary_monthly_sar, salary_is_posted, summary, description,
        apply_url, apply_method, listing_url, date_posted, deadline, source,
        source_platform, status, author_id, author_name, payload
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'Saudi Arabia', ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, '', ?, '', 'user', 'KSA 360', 'awaiting_approval', ?, ?, ?)`,
    )
    .run(
      id,
      title,
      category,
      companyName,
      String(body.companyIndustry || '').trim(),
      city,
      String(body.region || city).trim(),
      `${city}, Saudi Arabia`,
      String(body.workMode || body.work_mode || 'Not specified').trim(),
      String(body.employmentType || body.employment_type || 'Full Time').trim(),
      String(body.experienceRequired || '').trim(),
      String(body.educationRequired || '').trim(),
      salaryDisplay,
      salaryDisplay ? 1 : 0,
      String(body.summary || description).trim().slice(0, 420),
      description,
      applyUrl,
      applyUrl ? 'External apply link' : 'Contact employer',
      new Date().toISOString().slice(0, 10),
      req.user.id,
      req.user.name || '',
      JSON.stringify({ contact_email: contactEmail }),
    );
  const row = db().prepare('SELECT * FROM jobs WHERE id = ?').get(id);
  res.status(201).json({
    ...publicJob(row, { detail: true }),
    message: 'Sent for review. It appears after approval.',
  });
});

module.exports = { router, JOB_CATEGORIES };
