const crypto = require('crypto');
const jwt = require('jsonwebtoken');

function adminSecret() {
  return process.env.ADMIN_JWT_SECRET || process.env.JWT_SECRET || 'ksa-admin-local-dev';
}

function adminEmail() {
  return String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
}

function adminPassword() {
  return String(process.env.ADMIN_PASSWORD || '');
}

function signAdmin(email) {
  return jwt.sign({ sub: 'admin', role: 'admin', email }, adminSecret(), {
    expiresIn: '12h',
  });
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function checkAdminLogin(email, password) {
  const expectedEmail = adminEmail();
  const expectedPassword = adminPassword();
  if (!expectedEmail || !expectedPassword) {
    const err = new Error('Admin login is not configured');
    err.status = 503;
    throw err;
  }
  const ok =
    safeEqual(String(email || '').trim().toLowerCase(), expectedEmail) &&
    safeEqual(String(password || ''), expectedPassword);
  if (!ok) {
    const err = new Error('Wrong admin email or password');
    err.status = 401;
    throw err;
  }
  return { email: expectedEmail, role: 'admin' };
}

function requireAdmin(req, res, next) {
  const header = String(req.headers.authorization || '');
  if (!header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Admin sign-in required' });
  }
  try {
    const payload = jwt.verify(header.slice(7).trim(), adminSecret());
    if (payload.role !== 'admin') {
      return res.status(403).json({ error: 'Admin only' });
    }
    req.admin = { email: payload.email, role: 'admin' };
    next();
  } catch (_) {
    return res.status(401).json({ error: 'Admin session expired. Sign in again.' });
  }
}

module.exports = { signAdmin, checkAdminLogin, requireAdmin, adminEmail };
