const { Router } = require('express');
const {
  db,
  publicShopCategory,
  publicShopMerchant,
  publicShopCoupon,
} = require('../db');

const router = Router();

function categoryCounts() {
  const merchants = db()
    .prepare(
      `SELECT category_id AS id, COUNT(*) AS n
       FROM shop_merchant_categories
       GROUP BY category_id`,
    )
    .all();
  const coupons = db()
    .prepare(
      `SELECT smc.category_id AS id, COUNT(DISTINCT c.id) AS n
       FROM shop_coupons c
       JOIN shop_merchant_categories smc ON smc.merchant_id = c.merchant_id
       GROUP BY smc.category_id`,
    )
    .all();
  const merchantMap = Object.fromEntries(merchants.map((row) => [row.id, row.n]));
  const couponMap = Object.fromEntries(coupons.map((row) => [row.id, row.n]));
  return { merchantMap, couponMap };
}

function merchantCategories(merchantId) {
  return db()
    .prepare(
      `SELECT c.id FROM shop_categories c
       JOIN shop_merchant_categories smc ON smc.category_id = c.id
       WHERE smc.merchant_id = ?
       ORDER BY c.sort_order`,
    )
    .all(merchantId)
    .map((row) => row.id);
}

function merchantCoupons(merchantId) {
  return db()
    .prepare(
      `SELECT * FROM shop_coupons WHERE merchant_id = ? ORDER BY sort_order, title`,
    )
    .all(merchantId);
}

function merchantsForCategory(categoryId) {
  const rows = db()
    .prepare(
      `SELECT m.* FROM shop_merchants m
       JOIN shop_merchant_categories smc ON smc.merchant_id = m.id
       WHERE smc.category_id = ?
       ORDER BY m.featured DESC,
         (SELECT COUNT(*) FROM shop_coupons c WHERE c.merchant_id = m.id) DESC,
         m.sort_order, m.name`,
    )
    .all(categoryId);
  return rows.map((row) =>
    publicShopMerchant(row, {
      categories: merchantCategories(row.id),
      coupons: merchantCoupons(row.id),
    }),
  );
}

router.get('/categories', (_req, res) => {
  const { merchantMap, couponMap } = categoryCounts();
  const rows = db()
    .prepare('SELECT * FROM shop_categories ORDER BY sort_order, name')
    .all();
  res.json({
    items: rows.map((row) =>
      publicShopCategory(row, {
        merchantCount: merchantMap[row.id] || 0,
        couponCount: couponMap[row.id] || 0,
      }),
    ),
  });
});

router.get('/categories/:id', (req, res) => {
  const row = db()
    .prepare('SELECT * FROM shop_categories WHERE id = ?')
    .get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Category not found' });
  const { merchantMap, couponMap } = categoryCounts();
  res.json({
    category: publicShopCategory(row, {
      merchantCount: merchantMap[row.id] || 0,
      couponCount: couponMap[row.id] || 0,
    }),
    merchants: merchantsForCategory(row.id),
  });
});

router.get('/coupons', (req, res) => {
  const categoryId = String(req.query.category || '').trim();
  const merchantId = String(req.query.merchant || '').trim();
  let rows;
  if (merchantId) {
    rows = db()
      .prepare(
        `SELECT c.*, m.name AS merchant_name
         FROM shop_coupons c
         JOIN shop_merchants m ON m.id = c.merchant_id
         WHERE c.merchant_id = ?
         ORDER BY c.sort_order, c.title`,
      )
      .all(merchantId);
  } else if (categoryId) {
    rows = db()
      .prepare(
        `SELECT DISTINCT c.*, m.name AS merchant_name
         FROM shop_coupons c
         JOIN shop_merchants m ON m.id = c.merchant_id
         JOIN shop_merchant_categories smc ON smc.merchant_id = c.merchant_id
         WHERE smc.category_id = ?
         ORDER BY c.sort_order, c.title`,
      )
      .all(categoryId);
  } else {
    rows = db()
      .prepare(
        `SELECT c.*, m.name AS merchant_name
         FROM shop_coupons c
         JOIN shop_merchants m ON m.id = c.merchant_id
         ORDER BY c.sort_order, c.title`,
      )
      .all();
  }
  res.json({
    items: rows.map((row) => ({
      ...publicShopCoupon(row),
      merchantName: row.merchant_name || '',
    })),
  });
});

function hydrateMerchant(row) {
  return publicShopMerchant(row, {
    categories: merchantCategories(row.id),
    coupons: merchantCoupons(row.id),
  });
}

router.get('/search', (req, res) => {
  const q = String(req.query.q || '').trim();
  const categoryId = String(req.query.category || '').trim();
  const filter = String(req.query.filter || '').trim();
  const params = [];
  let sql = 'SELECT DISTINCT m.* FROM shop_merchants m';
  if (categoryId) {
    sql +=
      ' JOIN shop_merchant_categories scope ON scope.merchant_id = m.id AND scope.category_id = ?';
    params.push(categoryId);
  }
  if (q) {
    sql += ` LEFT JOIN shop_coupons cq ON cq.merchant_id = m.id
             WHERE (m.name LIKE ? COLLATE NOCASE
                OR m.blurb LIKE ? COLLATE NOCASE
                OR IFNULL(cq.code, '') LIKE ? COLLATE NOCASE
                OR IFNULL(cq.title, '') LIKE ? COLLATE NOCASE)`;
    const like = `%${q.replace(/[%_]/g, '')}%`;
    params.push(like, like, like, like);
  }
  sql += ` ORDER BY m.featured DESC,
    (SELECT COUNT(*) FROM shop_coupons c WHERE c.merchant_id = m.id) DESC,
    m.sort_order, m.name`;
  const matched = db()
    .prepare(sql)
    .all(...params)
    .map(hydrateMerchant);

  const couponCount = matched.filter((item) => item.coupons.length).length;
  const appCount = matched.filter((item) => item.androidId || item.iosId).length;
  const filters = [
    { id: '', label: 'All', count: matched.length, selected: !filter },
    { id: 'coupon', label: 'Has coupon', count: couponCount, selected: filter === 'coupon' },
    { id: 'app', label: 'Has app', count: appCount, selected: filter === 'app' },
  ];
  if (!categoryId) {
    const catRows = db()
      .prepare('SELECT * FROM shop_categories ORDER BY sort_order, name')
      .all();
    const catCounts = {};
    for (const merchant of matched) {
      for (const id of merchant.categories || []) {
        catCounts[id] = (catCounts[id] || 0) + 1;
      }
    }
    for (const row of catRows) {
      const count = catCounts[row.id] || 0;
      if (!count) continue;
      filters.push({
        id: `cat:${row.id}`,
        label: row.name,
        count,
        selected: filter === `cat:${row.id}`,
      });
    }
  }

  let merchants = matched;
  if (filter === 'coupon') {
    merchants = matched.filter((item) => item.coupons.length);
  } else if (filter === 'app') {
    merchants = matched.filter((item) => item.androidId || item.iosId);
  } else if (filter.startsWith('cat:')) {
    const id = filter.slice(4);
    merchants = matched.filter((item) => (item.categories || []).includes(id));
  }

  res.json({
    query: q,
    category: categoryId,
    filter,
    total: merchants.length,
    filters,
    merchants,
  });
});

router.get('/', (req, res) => {
  const categoryId = String(req.query.category || '').trim();
  if (categoryId) {
    const row = db()
      .prepare('SELECT * FROM shop_categories WHERE id = ?')
      .get(categoryId);
    if (!row) return res.status(404).json({ error: 'Category not found' });
    return res.json({ merchants: merchantsForCategory(categoryId) });
  }
  const { merchantMap, couponMap } = categoryCounts();
  const categories = db()
    .prepare('SELECT * FROM shop_categories ORDER BY sort_order, name')
    .all()
    .map((row) =>
      publicShopCategory(row, {
        merchantCount: merchantMap[row.id] || 0,
        couponCount: couponMap[row.id] || 0,
      }),
    );
  const merchants = db()
    .prepare(
      `SELECT * FROM shop_merchants
       ORDER BY featured DESC,
         (SELECT COUNT(*) FROM shop_coupons c WHERE c.merchant_id = shop_merchants.id) DESC,
         sort_order, name`,
    )
    .all()
    .map((row) =>
      publicShopMerchant(row, {
        categories: merchantCategories(row.id),
        coupons: merchantCoupons(row.id),
      }),
    );
  res.json({ categories, merchants });
});

module.exports = { router };
