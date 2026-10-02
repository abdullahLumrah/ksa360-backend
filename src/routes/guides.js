const { Router } = require('express');
const { db, publicPost } = require('../db');

const router = Router();

function allCategories() {
  return db().prepare('SELECT * FROM categories ORDER BY sort_order ASC, name ASC').all();
}

function childrenByParent(rows) {
  const map = new Map();
  for (const row of rows) {
    const list = map.get(row.parent_id) || [];
    list.push(row.id);
    map.set(row.parent_id, list);
  }
  return map;
}

function descendantIds(id, byParent) {
  const out = [id];
  for (const child of byParent.get(id) || []) {
    out.push(...descendantIds(child, byParent));
  }
  return out;
}

function countMap() {
  const rows = db()
    .prepare('SELECT category_id, COUNT(*) AS n FROM post_categories GROUP BY category_id')
    .all();
  return new Map(rows.map((row) => [row.category_id, row.n]));
}

function publicCategory(row, { childIds = [], directCount = 0, totalCount = 0 } = {}) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    parentId: row.parent_id,
    childIds,
    directCount,
    totalCount,
  };
}

function decorateCategories(rows) {
  const byParent = childrenByParent(rows);
  const directs = countMap();
  const totals = new Map();

  function totalFor(id) {
    if (totals.has(id)) return totals.get(id);
    let sum = directs.get(id) || 0;
    for (const child of byParent.get(id) || []) sum += totalFor(child);
    totals.set(id, sum);
    return sum;
  }

  return rows.map((row) =>
    publicCategory(row, {
      childIds: byParent.get(row.id) || [],
      directCount: directs.get(row.id) || 0,
      totalCount: totalFor(row.id),
    }),
  );
}

function categoryNamesForPosts(postIds) {
  if (postIds.length === 0) return new Map();
  const placeholders = postIds.map(() => '?').join(',');
  const rows = db()
    .prepare(
      `SELECT pc.post_id, c.name
       FROM post_categories pc
       JOIN categories c ON c.id = pc.category_id
       WHERE pc.post_id IN (${placeholders})`,
    )
    .all(...postIds);
  const map = new Map();
  for (const row of rows) {
    const list = map.get(row.post_id) || [];
    list.push(row.name);
    map.set(row.post_id, list);
  }
  return map;
}

function tagsForPosts(postIds) {
  if (postIds.length === 0) return new Map();
  const placeholders = postIds.map(() => '?').join(',');
  const rows = db()
    .prepare(`SELECT post_id, tag FROM post_tags WHERE post_id IN (${placeholders})`)
    .all(...postIds);
  const map = new Map();
  for (const row of rows) {
    const list = map.get(row.post_id) || [];
    list.push(row.tag);
    map.set(row.post_id, list);
  }
  return map;
}

function decoratePosts(rows, includeBody = false) {
  const ids = rows.map((row) => row.id);
  const cats = categoryNamesForPosts(ids);
  const tags = tagsForPosts(ids);
  return rows.map((row) =>
    publicPost(row, {
      categories: cats.get(row.id) || [],
      tags: tags.get(row.id) || [],
      includeBody,
    }),
  );
}

router.get('/', (_req, res) => {
  const categories = decorateCategories(allCategories());
  const posts = decoratePosts(
    db().prepare('SELECT * FROM posts ORDER BY date DESC').all(),
    false,
  );
  res.json({
    categoryCount: categories.length,
    postCount: posts.length,
    categories,
    posts,
  });
});

router.get('/categories', (_req, res) => {
  const items = decorateCategories(allCategories());
  res.json({ count: items.length, items });
});

router.get('/categories/:id', (req, res) => {
  const row =
    db().prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id) ||
    db().prepare('SELECT * FROM categories WHERE slug = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Category not found' });
  const decorated = decorateCategories(allCategories()).find((item) => item.id === row.id);
  const ids = descendantIds(row.id, childrenByParent(allCategories()));
  const placeholders = ids.map(() => '?').join(',');
  const posts = decoratePosts(
    db()
      .prepare(
        `SELECT DISTINCT p.*
         FROM posts p
         JOIN post_categories pc ON pc.post_id = p.id
         WHERE pc.category_id IN (${placeholders})
         ORDER BY p.date DESC`,
      )
      .all(...ids),
    false,
  );
  res.json({ ...decorated, posts });
});

router.get('/posts', (req, res) => {
  const q = String(req.query.q || req.query.query || '').trim().toLowerCase();
  const category = String(req.query.category || '').trim();
  const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 4000);
  let rows;
  if (category) {
    const cat =
      db().prepare('SELECT * FROM categories WHERE id = ?').get(category) ||
      db().prepare('SELECT * FROM categories WHERE slug = ?').get(category);
    if (!cat) return res.json({ count: 0, items: [] });
    const ids = descendantIds(cat.id, childrenByParent(allCategories()));
    const placeholders = ids.map(() => '?').join(',');
    rows = db()
      .prepare(
        `SELECT DISTINCT p.*
         FROM posts p
         JOIN post_categories pc ON pc.post_id = p.id
         WHERE pc.category_id IN (${placeholders})
         ORDER BY p.date DESC`,
      )
      .all(...ids);
  } else {
    rows = db().prepare('SELECT * FROM posts ORDER BY date DESC').all();
  }
  if (q) {
    rows = rows.filter((row) => {
      const blob = `${row.title} ${row.excerpt} ${row.preview}`.toLowerCase();
      return blob.includes(q);
    });
  }
  const items = decoratePosts(rows.slice(0, limit), false);
  res.json({ count: items.length, totalMatched: rows.length, items });
});

router.get('/posts/:id', (req, res) => {
  const row =
    db().prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id) ||
    db().prepare('SELECT * FROM posts WHERE slug = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Post not found' });
  res.json(decoratePosts([row], true)[0]);
});

router.post('/categories', (req, res) => {
  const body = req.body || {};
  const name = String(body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'name is required' });
  const id = String(body.id || `cat-${Date.now()}`).trim();
  db()
    .prepare(
      `INSERT INTO categories (id, name, slug, parent_id, sort_order)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      name,
      String(body.slug || name.toLowerCase().replace(/\s+/g, '-')),
      String(body.parentId || body.parent_id || '0'),
      Number(body.sortOrder ?? 0),
    );
  const row = db().prepare('SELECT * FROM categories WHERE id = ?').get(id);
  res.status(201).json(publicCategory(row, { childIds: [], directCount: 0, totalCount: 0 }));
});

router.post('/posts', (req, res) => {
  const body = req.body || {};
  const title = String(body.title || '').trim();
  if (!title) return res.status(400).json({ error: 'title is required' });
  const id = String(body.id || `post-${Date.now()}`).trim();
  db()
    .prepare(
      `INSERT INTO posts (
        id, title, slug, date, excerpt, preview, body, image,
        word_count, source, source_label
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      title,
      String(body.slug || ''),
      String(body.date || new Date().toISOString()),
      String(body.excerpt || ''),
      String(body.preview || ''),
      String(body.body || ''),
      String(body.image || ''),
      Number(body.wordCount ?? 0),
      String(body.source || 'admin'),
      String(body.sourceLabel || 'KSA 360'),
    );
  const categoryIds = body.categoryIds || [];
  const names = body.categories || [];
  const insertLink = db().prepare(
    'INSERT OR IGNORE INTO post_categories (post_id, category_id) VALUES (?, ?)',
  );
  for (const categoryId of categoryIds) insertLink.run(id, String(categoryId));
  for (const name of names) {
    const cat = db().prepare('SELECT id FROM categories WHERE lower(name) = lower(?)').get(String(name));
    if (cat) insertLink.run(id, cat.id);
  }
  for (const tag of body.tags || []) {
    db().prepare('INSERT OR IGNORE INTO post_tags (post_id, tag) VALUES (?, ?)').run(id, String(tag));
  }
  const row = db().prepare('SELECT * FROM posts WHERE id = ?').get(id);
  res.status(201).json(decoratePosts([row], true)[0]);
});

module.exports = { router };
