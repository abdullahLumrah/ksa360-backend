require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { db } = require('./db');
const { optionalUser, softUser } = require('./auth');
const { seedSouq } = require('./seed_souq');
const { seedShops, seedHealthcare, seedRestaurants, seedPlaceVideos } = require('./seed');
const { seedSchools } = require('./seed_schools');
const { seedJobs } = require('./seed_jobs');
const { router: restaurants } = require('./routes/restaurants');
const { router: activities } = require('./routes/activities');
const { router: reels } = require('./routes/reels');
const { router: guides } = require('./routes/guides');
const { router: auth } = require('./routes/auth');
const { router: souq } = require('./routes/souq');
const { router: admin } = require('./routes/admin');
const { router: analytics } = require('./routes/analytics');

const PORT = Number(process.env.PORT) || 4000;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_AUTH = new Set([
  '/auth/login',
  '/auth/register',
  '/auth/google',
  '/auth/google-config',
  '/admin/login',
]);

const app = express();
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({ origin: true, credentials: false }));
app.use(express.json({ limit: '200kb' }));

const generalLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 240,
  standardHeaders: true,
  legacyHeaders: false,
});
const authLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many sign-in attempts. Try again in a few minutes.' },
});

app.use(generalLimit);
app.use('/auth/login', authLimit);
app.use('/auth/register', authLimit);
app.use('/auth/google', authLimit);

app.use((req, res, next) => {
  if (req.path === '/health' || PUBLIC_AUTH.has(req.path) || req.path.startsWith('/admin')) {
    req.user = null;
    return next();
  }
  if (
    req.path.startsWith('/analytics') ||
    req.path.startsWith('/shops') ||
    req.path.startsWith('/healthcare') ||
    req.path.startsWith('/schools') ||
    req.path.startsWith('/restaurants') ||
    req.path.startsWith('/activities') ||
    req.path.startsWith('/reels') ||
    req.path.startsWith('/guides') ||
    req.path.startsWith('/jobs')
  ) {
    return softUser(req, res, next);
  }
  return optionalUser(req, res, next);
});

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'ksa-guide-backend',
    restaurants: db().prepare('SELECT COUNT(*) AS n FROM restaurants').get().n,
    activities: db().prepare('SELECT COUNT(*) AS n FROM activities').get().n,
    reels: db().prepare('SELECT COUNT(*) AS n FROM reels').get().n,
    categories: db().prepare('SELECT COUNT(*) AS n FROM categories').get().n,
    posts: db().prepare('SELECT COUNT(*) AS n FROM posts').get().n,
    souqCategories: db().prepare('SELECT COUNT(*) AS n FROM souq_categories').get().n,
    souqAds: db().prepare('SELECT COUNT(*) AS n FROM souq_ads').get().n,
    shopCategories: db().prepare('SELECT COUNT(*) AS n FROM shop_categories').get().n,
    healthFacilities: db().prepare('SELECT COUNT(*) AS n FROM health_facilities').get().n,
    schools: db().prepare('SELECT COUNT(*) AS n FROM schools').get().n,
    jobs: db().prepare("SELECT COUNT(*) AS n FROM jobs WHERE status = 'published'").get().n,
  });
});

app.use('/uploads', express.static(path.join(__dirname, '..', 'data', 'uploads')));
app.use('/restaurants', restaurants);
app.use('/shops', require('./routes/shops').router);
app.use('/healthcare', require('./routes/healthcare').router);
app.use('/schools', require('./routes/schools').router);
app.use('/jobs', require('./routes/jobs').router);
app.use('/activities', activities);
app.use('/reels', reels);
app.use('/guides', guides);
app.use('/auth', auth);
app.use('/souq', souq);
app.use('/admin', admin);
app.use('/analytics', analytics);
app.use('/admin/login', authLimit);

app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  res.status(status).json({
    error: status >= 500 ? 'Server error' : err.message || 'Request failed',
  });
});

try {
  seedSouq();
} catch (err) {
  console.error('Souq seed failed', err);
}
try {
  seedRestaurants(seedPlaceVideos());
  seedShops();
  seedHealthcare();
  seedSchools();
  seedJobs();
} catch (err) {
  console.error('Shops/healthcare/restaurants seed failed', err);
}

app.listen(PORT, HOST, () => {
  console.log(`KSA Guide backend on http://${HOST}:${PORT}`);
});
