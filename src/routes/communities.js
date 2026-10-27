const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Router } = require('express');
const multer = require('multer');
const {
  db,
  publicCommunity,
  publicCommunityPost,
  publicCommunityComment,
  publicCommunityReport,
  isAppUserId,
  blockedIdsFor,
  blockedAdIdsFor,
  isBlockedBy,
  syncUserActivityStats,
  recordCommunityView,
  markFeedSeen,
} = require('../db');
const { requireUser } = require('../auth');

function viewerKey(req) {
  if (req.user?.id) return `u:${req.user.id}`;
  const forwarded = String(req.headers['x-forwarded-for'] || '')
    .split(',')[0]
    .trim();
  const ip = forwarded || req.ip || req.socket?.remoteAddress || 'anon';
  return `ip:${ip}`;
}

const router = Router();
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'data', 'uploads', 'community');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif', '.gif', '.bmp']);
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase() || '.jpg';
      cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const type = String(file.mimetype || '').toLowerCase();
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (type.startsWith('image/') || IMAGE_EXT.has(ext)) return cb(null, true);
    cb(new Error('Only an image can be attached'));
  },
});

function receivePostImage(req, res, next) {
  upload.single('image')(req, res, (err) => {
    if (!err) return next();
    return res.status(400).json({ error: err.message || 'Could not upload the image' });
  });
}

function safeImageRef(value) {
  const raw = String(value || '').trim();
  if (/^https?:\/\//i.test(raw)) return raw.slice(0, 500);
  if (raw.startsWith('/uploads/community/') && !raw.includes('..')) return raw;
  return '';
}

const TOPICS = [
  'General',
  'Food',
  'Culture',
  'Expats',
  'Sports',
  'Business',
  'Family',
  'Education',
  'Faith',
  'Neighbourhood',
  'Other',
];

const REPORT_REASONS = [
  'Spam',
  'Harassment',
  'Hate speech',
  'Misinformation',
  'Inappropriate content',
  'Impersonation',
  'Scam / fraud',
  'Other',
];

function pageParams(query, max = 40) {
  const page = Math.max(0, Number(query.page || 0));
  const limit = Math.min(max, Math.max(1, Number(query.limit || 24)));
  return { page, limit, offset: page * limit };
}

function like(value) {
  return `%${String(value || '').trim()}%`;
}

function slugify(name) {
  const base = String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06FF]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return base || `page-${crypto.randomUUID().slice(0, 8)}`;
}

function uniqueSlug(name) {
  let slug = slugify(name);
  let n = 0;
  while (db().prepare('SELECT 1 FROM communities WHERE slug = ?').get(slug)) {
    n += 1;
    slug = `${slugify(name)}-${n}`;
  }
  return slug;
}

function memberRow(communityId, userId) {
  if (!userId) return null;
  return db()
    .prepare('SELECT * FROM community_members WHERE community_id = ? AND user_id = ?')
    .get(communityId, userId);
}

function isPageAdmin(community, userId) {
  if (!userId || !community) return false;
  if (community.creator_id === userId) return true;
  const m = memberRow(community.id, userId);
  return Boolean(m && (m.role === 'owner' || m.role === 'admin'));
}

function likedSet(userId, targetType, ids) {
  if (!userId || !ids.length) return new Set();
  const placeholders = ids.map(() => '?').join(',');
  const rows = db()
    .prepare(
      `SELECT target_id FROM community_likes
       WHERE user_id = ? AND target_type = ? AND target_id IN (${placeholders})`,
    )
    .all(userId, targetType, ...ids);
  return new Set(rows.map((r) => r.target_id));
}

function communityForViewer(row, userId) {
  const m = memberRow(row.id, userId);
  return publicCommunity(row, {
    viewerId: userId || '',
    role: m?.role || '',
    joined: Boolean(m),
  });
}

router.get('/topics', (_req, res) => {
  res.json({ topics: TOPICS, reportReasons: REPORT_REASONS });
});

function commentThread(postId) {
  const rows = db()
    .prepare(
      `SELECT * FROM community_comments
       WHERE post_id = ? AND status = 'active'
       ORDER BY created_at ASC`,
    )
    .all(postId);
  const tops = rows.filter((r) => !r.parent_id);
  const replies = rows.filter((r) => r.parent_id);
  return tops.map((top) => ({
    ...publicCommunityComment(top),
    replies: replies
      .filter((r) => r.parent_id === top.id)
      .map((r) => publicCommunityComment(r)),
  }));
}

function buildReportSnapshot({ targetType, targetId, communityId }) {
  const page = communityId
    ? db().prepare('SELECT id, name FROM communities WHERE id = ?').get(communityId)
    : null;
  const snapshot = {
    communityId: communityId || '',
    communityName: page?.name || '',
  };

  let postId = '';
  if (targetType === 'post') postId = targetId;
  if (targetType === 'comment') {
    const comment = db().prepare('SELECT * FROM community_comments WHERE id = ?').get(targetId);
    if (comment) {
      postId = comment.post_id;
      snapshot.comment = publicCommunityComment(comment);
    }
  }
  if (postId) {
    const post = db()
      .prepare(
        `SELECT p.*, c.name AS community_name FROM community_posts p
         LEFT JOIN communities c ON c.id = p.community_id
         WHERE p.id = ?`,
      )
      .get(postId);
    if (post) {
      snapshot.post = publicCommunityPost(post);
      snapshot.comments = commentThread(post.id);
    }
  }
  if (targetType === 'souq_ad' && targetId) {
    const ad = db().prepare('SELECT * FROM souq_ads WHERE ad_id = ?').get(targetId);
    if (ad) {
      snapshot.ad = {
        id: ad.ad_id,
        title: ad.title,
        city: ad.city || '',
        sellerId: ad.seller_id || '',
        sellerName: ad.seller_name || '',
        price: ad.price,
      };
    }
  }
  return snapshot;
}

function trendingScoreSql() {
  return `(
    (p.like_count * 2.0)
    + (p.comment_count * 3.0)
    + MIN(p.view_count / 20.0, 12)
    - ((julianday('now') - julianday(p.created_at)) * 0.4)
  )`;
}

function feedRankSql() {
  return `CAST((
    (p.like_count * 200)
    + (p.comment_count * 300)
    + MIN(CAST(p.view_count / 2 AS INTEGER), 120)
    - CAST((julianday('now') - julianday(p.created_at)) * 40 AS INTEGER)
    + CASE WHEN @personalized = 1 AND m.user_id IS NOT NULL THEN 4800 ELSE 0 END
  ) AS INTEGER)`;
}

function encodeFeedCursor(row, { replay = false } = {}) {
  return Buffer.from(
    JSON.stringify({
      s: Number(row.rank_score),
      t: row.created_at,
      id: row.id,
      r: replay ? 1 : 0,
    }),
    'utf8',
  ).toString('base64url');
}

function decodeFeedCursor(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(String(raw), 'base64url').toString('utf8'));
    if (!parsed?.id || !parsed?.t) return null;
    return {
      s: Number(parsed.s) || 0,
      t: String(parsed.t),
      id: String(parsed.id),
      r: Number(parsed.r) || 0,
    };
  } catch (_) {
    return null;
  }
}

function queryCommunityFeed({
  clauses,
  filter,
  personalized,
  cursor,
  limit,
  hideSeen,
  excludeIds = [],
}) {
  const extra = [...clauses];
  const params = {
    ...filter,
    personalized: personalized ? 1 : 0,
    useCursor: cursor ? 1 : 0,
    cursorScore: cursor?.s ?? 0,
    cursorCreated: cursor?.t ?? '',
    cursorId: cursor?.id ?? '',
    fetchLimit: limit + 1,
  };
  if (hideSeen) {
    extra.push(`NOT EXISTS (
      SELECT 1 FROM community_feed_seen s
      WHERE s.post_id = p.id AND s.user_id = @userId
    )`);
  }
  if (excludeIds.length) {
    extra.push(`p.id NOT IN (${excludeIds.map((_, i) => `@ex${i}`).join(', ')})`);
    excludeIds.forEach((id, i) => {
      params[`ex${i}`] = id;
    });
  }
  const where = `WHERE ${extra.join(' AND ')}`;
  const rows = db()
    .prepare(
      `SELECT * FROM (
         SELECT p.*, c.name AS community_name, c.creator_id,
                CASE WHEN m.user_id IS NULL THEN 0 ELSE 1 END AS joined,
                CASE WHEN c.creator_id = @userId THEN 1 ELSE 0 END AS is_owner,
                ${feedRankSql()} AS rank_score
         FROM community_posts p
         INNER JOIN communities c ON c.id = p.community_id
         LEFT JOIN community_members m
           ON m.community_id = c.id AND m.user_id = @userId
         ${where}
       ) x
       WHERE @useCursor = 0
          OR x.rank_score < @cursorScore
          OR (x.rank_score = @cursorScore AND x.created_at < @cursorCreated)
          OR (x.rank_score = @cursorScore AND x.created_at = @cursorCreated AND x.id < @cursorId)
       ORDER BY x.rank_score DESC, x.created_at DESC, x.id DESC
       LIMIT @fetchLimit`,
    )
    .all(params);
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  return { pageRows, hasMore, last: pageRows[pageRows.length - 1] || null };
}

router.get('/feed', (req, res) => {
  const topic = String(req.query.topic || '').trim();
  const q = String(req.query.q || '').trim();
  const userId = req.user?.id || '';
  const limit = Math.min(Number(req.query.limit) || 20, 40);
  const page = Math.max(Number(req.query.page) || 0, 0);
  const cursor = decodeFeedCursor(req.query.cursor);
  const replay = Boolean(cursor?.r);
  const preferUnseen = Boolean(userId && !q && !replay);
  const clauses = [
    "p.status = 'approved'",
    "c.status = 'active'",
    `p.author_id NOT IN (SELECT blocked_id FROM blocked_users WHERE blocker_id = @userId)`,
  ];
  const filter = { userId: userId || '' };
  if (topic) {
    clauses.push('c.topic = @topic');
    filter.topic = topic;
  }
  if (q) {
    clauses.push('(p.body LIKE @q OR c.name LIKE @q OR p.author_name LIKE @q)');
    filter.q = like(q);
  }
  const memberCount = userId
    ? db()
        .prepare('SELECT COUNT(*) AS n FROM community_members WHERE user_id = ?')
        .get(userId).n
    : 0;
  const personalized = Boolean(userId && memberCount > 0);
  let total;
  if (!cursor) {
    total = db()
      .prepare(
        `SELECT COUNT(*) AS n FROM community_posts p
         INNER JOIN communities c ON c.id = p.community_id
         WHERE ${clauses.join(' AND ')}`,
      )
      .get(filter).n;
  }
  let { pageRows, hasMore, last } = queryCommunityFeed({
    clauses,
    filter,
    personalized,
    cursor,
    limit,
    hideSeen: preferUnseen,
  });
  const unseenCount = pageRows.length;
  let usedReplay = replay;
  if (preferUnseen && pageRows.length < limit) {
    const fill = queryCommunityFeed({
      clauses,
      filter,
      personalized,
      cursor: pageRows.length ? null : cursor,
      limit: limit - pageRows.length,
      hideSeen: false,
      excludeIds: pageRows.map((row) => row.id),
    });
    pageRows = [...pageRows, ...fill.pageRows];
    hasMore = fill.hasMore;
    last = pageRows[pageRows.length - 1] || last;
    usedReplay = true;
  }
  if (userId && pageRows.length) {
    markFeedSeen(userId, pageRows.map((row) => row.id));
  }
  const likes = likedSet(
    userId,
    'post',
    pageRows.map((r) => r.id),
  );
  res.json({
    items: pageRows.map((row) =>
      publicCommunityPost(row, { liked: likes.has(row.id) }),
    ),
    nextCursor: hasMore && last ? encodeFeedCursor(last, { replay: usedReplay }) : null,
    hasMore,
    total: total ?? null,
    page,
    limit,
    feedMode: personalized ? 'home' : 'trending',
    hideSeen: preferUnseen,
    caughtUp: preferUnseen && unseenCount === 0,
  });
});

router.post('/feed/seen', requireUser, (req, res) => {
  const raw = req.body?.ids ?? req.body?.postIds ?? [];
  const ids = Array.isArray(raw) ? raw.slice(0, 50) : [];
  const marked = markFeedSeen(req.user.id, ids);
  res.json({ ok: true, marked });
});

router.get('/discover', (req, res) => {
  const topic = String(req.query.topic || '').trim();
  const q = String(req.query.q || '').trim();
  const userId = req.user?.id || '';
  const groupClauses = ["c.status = 'active'"];
  const groupParams = {};
  if (topic) {
    groupClauses.push('c.topic = @topic');
    groupParams.topic = topic;
  }
  if (q) {
    groupClauses.push('(c.name LIKE @q OR c.description LIKE @q OR c.city LIKE @q)');
    groupParams.q = like(q);
  }
  const groupWhere = `WHERE ${groupClauses.join(' AND ')}`;
  const groups = db()
    .prepare(
      `SELECT c.* FROM communities c ${groupWhere}
       ORDER BY c.member_count DESC, c.post_count DESC, c.created_at DESC
       LIMIT 24`,
    )
    .all(groupParams);

  const postClauses = [
    "p.status = 'approved'",
    "c.status = 'active'",
    `p.author_id NOT IN (SELECT blocked_id FROM blocked_users WHERE blocker_id = @userId)`,
  ];
  const postParams = { userId: userId || '' };
  if (topic) {
    postClauses.push('c.topic = @topic');
    postParams.topic = topic;
  }
  if (q) {
    postClauses.push('(p.body LIKE @q OR c.name LIKE @q)');
    postParams.q = like(q);
  }
  const trending = db()
    .prepare(
      `SELECT p.*, c.name AS community_name FROM community_posts p
       INNER JOIN communities c ON c.id = p.community_id
       WHERE ${postClauses.join(' AND ')}
       ORDER BY ${trendingScoreSql()} DESC, p.created_at DESC
       LIMIT 20`,
    )
    .all(postParams);

  const likes = likedSet(
    userId,
    'post',
    trending.map((r) => r.id),
  );

  const previewStmt = db().prepare(
    `SELECT p.*, c.name AS community_name FROM community_posts p
     INNER JOIN communities c ON c.id = p.community_id
     WHERE p.community_id = ? AND p.status = 'approved'
     ORDER BY p.created_at DESC LIMIT 6`,
  );

  res.json({
    trending: trending.map((row) => publicCommunityPost(row, { liked: likes.has(row.id) })),
    groups: groups.map((row) => {
      const previews = previewStmt.all(row.id);
      const previewLikes = likedSet(
        userId,
        'post',
        previews.map((p) => p.id),
      );
      return {
        ...communityForViewer(row, userId),
        previewPosts: previews.map((p) =>
          publicCommunityPost(p, { liked: previewLikes.has(p.id) }),
        ),
      };
    }),
  });
});

router.get('/', (req, res) => {
  const { page, limit, offset } = pageParams(req.query);
  const q = String(req.query.q || '').trim();
  const topic = String(req.query.topic || '').trim();
  const clauses = ["status = 'active'"];
  const params = {};
  if (q) {
    clauses.push('(name LIKE @q OR description LIKE @q OR city LIKE @q)');
    params.q = like(q);
  }
  if (topic) {
    clauses.push('topic = @topic');
    params.topic = topic;
  }
  const where = `WHERE ${clauses.join(' AND ')}`;
  const total = db().prepare(`SELECT COUNT(*) AS n FROM communities ${where}`).get(params).n;
  const rows = db()
    .prepare(
      `SELECT * FROM communities ${where}
       ORDER BY member_count DESC, created_at DESC
       LIMIT @limit OFFSET @offset`,
    )
    .all({ ...params, limit, offset });
  const userId = req.user?.id || '';
  res.json({
    items: rows.map((row) => communityForViewer(row, userId)),
    total,
    page,
    limit,
  });
});

router.get('/mine', requireUser, (req, res) => {
  const rows = db()
    .prepare(
      `SELECT c.* FROM communities c
       INNER JOIN community_members m ON m.community_id = c.id
       WHERE m.user_id = ? AND c.status = 'active'
       ORDER BY m.joined_at DESC`,
    )
    .all(req.user.id);
  res.json({ items: rows.map((row) => communityForViewer(row, req.user.id)) });
});

router.get('/pending-inbox', requireUser, (req, res) => {
  const rows = db()
    .prepare(
      `SELECT p.*, c.name AS community_name FROM community_posts p
       INNER JOIN communities c ON c.id = p.community_id
       INNER JOIN community_members m ON m.community_id = c.id
       WHERE p.status = 'pending'
         AND m.user_id = ?
         AND m.role IN ('owner', 'admin')
       ORDER BY p.created_at ASC`,
    )
    .all(req.user.id);
  res.json({
    items: rows.map((row) => publicCommunityPost(row)),
    total: rows.length,
  });
});

router.get('/blocks', requireUser, (req, res) => {
  res.json({
    ids: blockedIdsFor(req.user.id),
    adIds: blockedAdIdsFor(req.user.id),
  });
});

router.post('/blocks', requireUser, (req, res) => {
  const body = req.body || {};
  const blockedId = String(body.userId || body.blockedId || body.blocked_id || '').trim();
  const adId = String(body.adId || body.ad_id || '').trim();
  const reason = String(body.reason || 'Block user').trim() || 'Block user';
  const details = String(body.details || '').trim().slice(0, 2000);
  let targetType = String(body.targetType || body.target_type || '').trim();
  const catalogSeller = Boolean(blockedId) && !isAppUserId(blockedId);
  let listingId = adId || (targetType === 'souq_ad' ? String(body.targetId || body.target_id || '').trim() : '');
  if (!listingId && catalogSeller) {
    const adRow = db().prepare('SELECT ad_id FROM souq_ads WHERE ad_id = ?').get(blockedId);
    if (adRow) listingId = blockedId;
  }
  if (catalogSeller || (listingId && !isAppUserId(blockedId))) targetType = 'souq_ad';
  if (!targetType) targetType = 'user';
  const targetId = String(body.targetId || body.target_id || listingId || blockedId).trim();
  let communityId = String(body.communityId || body.community_id || '').trim();
  if (!blockedId && !listingId) {
    return res.status(400).json({ error: 'userId is required' });
  }
  if (isAppUserId(blockedId) && blockedId === req.user.id) {
    return res.status(400).json({ error: 'You cannot block yourself' });
  }
  const target = isAppUserId(blockedId)
    ? db().prepare('SELECT id, name FROM users WHERE id = ?').get(blockedId)
    : null;
  let reportedUserName = target?.name || '';
  if (['post', 'comment'].includes(targetType) && targetId) {
    if (targetType === 'post') {
      const post = db().prepare('SELECT community_id FROM community_posts WHERE id = ?').get(targetId);
      if (post) communityId = communityId || post.community_id;
    } else {
      const comment = db().prepare('SELECT community_id FROM community_comments WHERE id = ?').get(targetId);
      if (comment) communityId = communityId || comment.community_id;
    }
  }
  const allowedTypes = ['user', 'post', 'comment', 'community', 'souq_ad'];
  const reportType = allowedTypes.includes(targetType) ? targetType : 'user';
  const snapshot = buildReportSnapshot({
    targetType: reportType,
    targetId: targetId || listingId || blockedId,
    communityId,
  });
  if (reportType === 'souq_ad' && snapshot.ad?.sellerName) {
    reportedUserName = reportedUserName || snapshot.ad.sellerName;
  }
  const tx = db().transaction(() => {
    if (isAppUserId(blockedId)) {
      db()
        .prepare(
          `INSERT INTO blocked_users (blocker_id, blocked_id, reason, created_at)
           VALUES (?, ?, ?, datetime('now'))
           ON CONFLICT(blocker_id, blocked_id) DO UPDATE SET reason = excluded.reason`,
        )
        .run(req.user.id, blockedId, reason);
    }
    if (listingId) {
      db()
        .prepare(
          `INSERT INTO blocked_ads (blocker_id, ad_id, reason, created_at)
           VALUES (?, ?, ?, datetime('now'))
           ON CONFLICT(blocker_id, ad_id) DO UPDATE SET reason = excluded.reason`,
        )
        .run(req.user.id, listingId, reason);
    }
    const reportId = `crep_${crypto.randomUUID()}`;
    db()
      .prepare(
        `INSERT INTO community_reports
         (id, reporter_id, reporter_name, target_type, target_id, reported_user_id,
          reported_user_name, community_id, reason, details, snapshot)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        reportId,
        req.user.id,
        req.user.name || '',
        reportType,
        targetId || listingId || blockedId,
        isAppUserId(blockedId) ? blockedId : (snapshot.ad?.sellerId || ''),
        reportedUserName,
        communityId,
        reason,
        details,
        JSON.stringify(snapshot),
      );
  });
  tx();
  res.status(201).json({
    ok: true,
    ids: blockedIdsFor(req.user.id),
    adIds: blockedAdIdsFor(req.user.id),
  });
});

router.post('/reports', requireUser, (req, res) => {
  const body = req.body || {};
  const targetType = String(body.targetType || body.target_type || '').trim();
  const targetId = String(body.targetId || body.target_id || '').trim();
  const reason = String(body.reason || '').trim();
  const details = String(body.details || '').trim().slice(0, 2000);
  if (!['user', 'post', 'comment', 'community'].includes(targetType)) {
    return res.status(400).json({ error: 'Invalid report target' });
  }
  if (!targetId) return res.status(400).json({ error: 'targetId is required' });
  if (!reason) return res.status(400).json({ error: 'Please choose a reason' });

  let reportedUserId = String(body.reportedUserId || body.reported_user_id || '').trim();
  let reportedUserName = String(body.reportedUserName || body.reported_user_name || '').trim();
  let communityId = String(body.communityId || body.community_id || '').trim();

  if (targetType === 'user') {
    reportedUserId = reportedUserId || targetId;
    const u = db().prepare('SELECT id, name FROM users WHERE id = ?').get(reportedUserId);
    if (!u) return res.status(404).json({ error: 'User not found' });
    reportedUserName = u.name;
  } else if (targetType === 'post') {
    const post = db().prepare('SELECT * FROM community_posts WHERE id = ?').get(targetId);
    if (!post) return res.status(404).json({ error: 'Post not found' });
    reportedUserId = post.author_id;
    reportedUserName = post.author_name;
    communityId = post.community_id;
  } else if (targetType === 'comment') {
    const comment = db().prepare('SELECT * FROM community_comments WHERE id = ?').get(targetId);
    if (!comment) return res.status(404).json({ error: 'Comment not found' });
    reportedUserId = comment.author_id;
    reportedUserName = comment.author_name;
    communityId = comment.community_id;
  } else if (targetType === 'community') {
    communityId = targetId;
    const page = db().prepare('SELECT * FROM communities WHERE id = ?').get(targetId);
    if (!page) return res.status(404).json({ error: 'Page not found' });
    reportedUserId = page.creator_id;
    reportedUserName = page.creator_name;
  }

  if (reportedUserId && reportedUserId === req.user.id) {
    return res.status(400).json({ error: 'You cannot report yourself' });
  }

  const snapshot = buildReportSnapshot({ targetType, targetId, communityId });
  const id = `crep_${crypto.randomUUID()}`;
  db()
    .prepare(
      `INSERT INTO community_reports
       (id, reporter_id, reporter_name, target_type, target_id, reported_user_id,
        reported_user_name, community_id, reason, details, snapshot)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      req.user.id,
      req.user.name || '',
      targetType,
      targetId,
      reportedUserId,
      reportedUserName,
      communityId,
      reason,
      details,
      JSON.stringify(snapshot),
    );
  res.status(201).json(
    publicCommunityReport(db().prepare('SELECT * FROM community_reports WHERE id = ?').get(id)),
  );
});

router.post('/', requireUser, (req, res) => {
  const body = req.body || {};
  const name = String(body.name || '').trim();
  const description = String(body.description || '').trim().slice(0, 2000);
  const topic = String(body.topic || 'General').trim() || 'General';
  const city = String(body.city || '').trim().slice(0, 80);
  const coverImage = String(body.coverImage || body.cover_image || '').trim();
  if (!name || name.length < 3) {
    return res.status(400).json({ error: 'Give the page a clear name (at least 3 characters)' });
  }
  if (!TOPICS.includes(topic)) {
    return res.status(400).json({ error: 'Pick a valid topic' });
  }
  const id = `comm_${crypto.randomUUID()}`;
  const slug = uniqueSlug(name);
  const tx = db().transaction(() => {
    db()
      .prepare(
        `INSERT INTO communities
         (id, name, slug, description, cover_image, topic, city, creator_id, creator_name)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        name,
        slug,
        description,
        coverImage,
        topic,
        city,
        req.user.id,
        req.user.name || '',
      );
    db()
      .prepare(
        `INSERT INTO community_members (community_id, user_id, role)
         VALUES (?, ?, 'owner')`,
      )
      .run(id, req.user.id);
  });
  tx();
  syncUserActivityStats(req.user.id);
  const row = db().prepare('SELECT * FROM communities WHERE id = ?').get(id);
  res.status(201).json(communityForViewer(row, req.user.id));
});

router.get('/posts/:postId', (req, res) => {
  const row = db()
    .prepare(
      `SELECT p.*, c.name AS community_name, c.creator_id AS community_creator_id
       FROM community_posts p
       INNER JOIN communities c ON c.id = p.community_id
       WHERE p.id = ?`,
    )
    .get(req.params.postId);
  if (!row) return res.status(404).json({ error: 'Post not found' });
  const userId = req.user?.id || '';
  const admin = isPageAdmin(
    { id: row.community_id, creator_id: row.community_creator_id },
    userId,
  );
  if (row.status !== 'approved' && row.author_id !== userId && !admin) {
    return res.status(404).json({ error: 'Post not found' });
  }
  if (userId && isBlockedBy(userId, row.author_id)) {
    return res.status(404).json({ error: 'Post not found' });
  }
  const viewCount = recordCommunityView({
    targetType: 'post',
    targetId: row.id,
    viewerKey: viewerKey(req),
  });
  if (userId && row.status === 'approved') {
    markFeedSeen(userId, [row.id]);
  }
  const liked = userId
    ? Boolean(
        db()
          .prepare(
            `SELECT 1 FROM community_likes
             WHERE user_id = ? AND target_type = 'post' AND target_id = ?`,
          )
          .get(userId, row.id),
      )
    : false;
  const member = userId
    ? db()
        .prepare(
          'SELECT role FROM community_members WHERE community_id = ? AND user_id = ?',
        )
        .get(row.community_id, userId)
    : null;
  res.json(
    publicCommunityPost(
      {
        ...row,
        view_count: viewCount || row.view_count,
        joined: member ? 1 : 0,
        is_owner: userId && row.community_creator_id === userId ? 1 : 0,
      },
      { liked, detail: true },
    ),
  );
});

router.post('/posts/:postId/like', requireUser, (req, res) => {
  const post = db().prepare('SELECT * FROM community_posts WHERE id = ?').get(req.params.postId);
  if (!post || post.status !== 'approved') {
    return res.status(404).json({ error: 'Post not found' });
  }
  const existing = db()
    .prepare(
      `SELECT 1 FROM community_likes
       WHERE user_id = ? AND target_type = 'post' AND target_id = ?`,
    )
    .get(req.user.id, post.id);
  const tx = db().transaction(() => {
    if (existing) {
      db()
        .prepare(
          `DELETE FROM community_likes
           WHERE user_id = ? AND target_type = 'post' AND target_id = ?`,
        )
        .run(req.user.id, post.id);
      db()
        .prepare(
          `UPDATE community_posts SET like_count = MAX(like_count - 1, 0),
           updated_at = datetime('now') WHERE id = ?`,
        )
        .run(post.id);
    } else {
      db()
        .prepare(
          `INSERT INTO community_likes (user_id, target_type, target_id)
           VALUES (?, 'post', ?)`,
        )
        .run(req.user.id, post.id);
      db()
        .prepare(
          `UPDATE community_posts SET like_count = like_count + 1,
           updated_at = datetime('now') WHERE id = ?`,
        )
        .run(post.id);
    }
  });
  tx();
  const next = db().prepare('SELECT * FROM community_posts WHERE id = ?').get(post.id);
  res.json(publicCommunityPost(next, { liked: !existing }));
});

router.get('/posts/:postId/comments', (req, res) => {
  const post = db().prepare('SELECT * FROM community_posts WHERE id = ?').get(req.params.postId);
  if (!post) return res.status(404).json({ error: 'Post not found' });
  const userId = req.user?.id || '';
  const blocked = new Set(blockedIdsFor(userId));
  const rows = db()
    .prepare(
      `SELECT * FROM community_comments
       WHERE post_id = ? AND status = 'active'
       ORDER BY created_at ASC`,
    )
    .all(post.id)
    .filter((row) => !blocked.has(row.author_id));
  const likes = likedSet(
    userId,
    'comment',
    rows.map((r) => r.id),
  );
  const tops = rows.filter((r) => !r.parent_id);
  const replies = rows.filter((r) => r.parent_id);
  const items = tops.map((top) => ({
    ...publicCommunityComment(top, { liked: likes.has(top.id) }),
    replies: replies
      .filter((r) => r.parent_id === top.id)
      .map((r) => publicCommunityComment(r, { liked: likes.has(r.id) })),
  }));
  res.json({ items });
});

router.post('/posts/:postId/comments', requireUser, (req, res) => {
  const post = db().prepare('SELECT * FROM community_posts WHERE id = ?').get(req.params.postId);
  if (!post || post.status !== 'approved') {
    return res.status(404).json({ error: 'Post not found' });
  }
  const body = String(req.body?.body || '').trim();
  if (!body) return res.status(400).json({ error: 'Write a comment' });
  if (body.length > 2000) return res.status(400).json({ error: 'Comment is too long' });
  const id = `ccom_${crypto.randomUUID()}`;
  const tx = db().transaction(() => {
    db()
      .prepare(
        `INSERT INTO community_comments
         (id, post_id, community_id, author_id, author_name, author_avatar, body)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        post.id,
        post.community_id,
        req.user.id,
        req.user.name || '',
        req.user.avatar || '',
        body,
      );
    db()
      .prepare(
        `UPDATE community_posts SET comment_count = comment_count + 1,
         updated_at = datetime('now') WHERE id = ?`,
      )
      .run(post.id);
  });
  tx();
  const row = db().prepare('SELECT * FROM community_comments WHERE id = ?').get(id);
  res.status(201).json(publicCommunityComment(row));
});

router.post('/comments/:commentId/like', requireUser, (req, res) => {
  const comment = db()
    .prepare('SELECT * FROM community_comments WHERE id = ?')
    .get(req.params.commentId);
  if (!comment || comment.status !== 'active') {
    return res.status(404).json({ error: 'Comment not found' });
  }
  const existing = db()
    .prepare(
      `SELECT 1 FROM community_likes
       WHERE user_id = ? AND target_type = 'comment' AND target_id = ?`,
    )
    .get(req.user.id, comment.id);
  const tx = db().transaction(() => {
    if (existing) {
      db()
        .prepare(
          `DELETE FROM community_likes
           WHERE user_id = ? AND target_type = 'comment' AND target_id = ?`,
        )
        .run(req.user.id, comment.id);
      db()
        .prepare(
          `UPDATE community_comments SET like_count = MAX(like_count - 1, 0),
           updated_at = datetime('now') WHERE id = ?`,
        )
        .run(comment.id);
    } else {
      db()
        .prepare(
          `INSERT INTO community_likes (user_id, target_type, target_id)
           VALUES (?, 'comment', ?)`,
        )
        .run(req.user.id, comment.id);
      db()
        .prepare(
          `UPDATE community_comments SET like_count = like_count + 1,
           updated_at = datetime('now') WHERE id = ?`,
        )
        .run(comment.id);
    }
  });
  tx();
  const next = db().prepare('SELECT * FROM community_comments WHERE id = ?').get(comment.id);
  res.json(publicCommunityComment(next, { liked: !existing }));
});

router.post('/comments/:commentId/replies', requireUser, (req, res) => {
  const parent = db()
    .prepare('SELECT * FROM community_comments WHERE id = ?')
    .get(req.params.commentId);
  if (!parent || parent.status !== 'active') {
    return res.status(404).json({ error: 'Comment not found' });
  }
  if (parent.parent_id) {
    return res.status(400).json({ error: 'Reply only to top-level comments' });
  }
  const post = db().prepare('SELECT * FROM community_posts WHERE id = ?').get(parent.post_id);
  if (!post || post.status !== 'approved') {
    return res.status(404).json({ error: 'Post not found' });
  }
  const body = String(req.body?.body || '').trim();
  if (!body) return res.status(400).json({ error: 'Write a reply' });
  if (body.length > 2000) return res.status(400).json({ error: 'Reply is too long' });
  const id = `ccom_${crypto.randomUUID()}`;
  const tx = db().transaction(() => {
    db()
      .prepare(
        `INSERT INTO community_comments
         (id, post_id, community_id, author_id, author_name, author_avatar, parent_id, body)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        parent.post_id,
        parent.community_id,
        req.user.id,
        req.user.name || '',
        req.user.avatar || '',
        parent.id,
        body,
      );
    db()
      .prepare(
        `UPDATE community_posts SET comment_count = comment_count + 1,
         updated_at = datetime('now') WHERE id = ?`,
      )
      .run(parent.post_id);
  });
  tx();
  const row = db().prepare('SELECT * FROM community_comments WHERE id = ?').get(id);
  res.status(201).json(publicCommunityComment(row));
});

router.get('/:id', (req, res) => {
  const row = db().prepare('SELECT * FROM communities WHERE id = ?').get(req.params.id);
  if (!row || row.status !== 'active') {
    return res.status(404).json({ error: 'Page not found' });
  }
  const viewCount = recordCommunityView({
    targetType: 'page',
    targetId: row.id,
    viewerKey: viewerKey(req),
  });
  res.json(
    communityForViewer(
      { ...row, view_count: viewCount || row.view_count },
      req.user?.id || '',
    ),
  );
});

router.post('/:id/view', (req, res) => {
  const row = db().prepare('SELECT * FROM communities WHERE id = ?').get(req.params.id);
  if (!row || row.status !== 'active') {
    return res.status(404).json({ error: 'Page not found' });
  }
  const viewCount = recordCommunityView({
    targetType: 'page',
    targetId: row.id,
    viewerKey: viewerKey(req),
  });
  res.json({ id: row.id, viewCount });
});

router.post('/:id/join', requireUser, (req, res) => {
  const row = db().prepare('SELECT * FROM communities WHERE id = ?').get(req.params.id);
  if (!row || row.status !== 'active') {
    return res.status(404).json({ error: 'Page not found' });
  }
  const existing = memberRow(row.id, req.user.id);
  if (!existing) {
    const tx = db().transaction(() => {
      db()
        .prepare(
          `INSERT INTO community_members (community_id, user_id, role)
           VALUES (?, ?, 'member')`,
        )
        .run(row.id, req.user.id);
      db()
        .prepare(
          `UPDATE communities SET member_count = member_count + 1,
           updated_at = datetime('now') WHERE id = ?`,
        )
        .run(row.id);
    });
    tx();
    syncUserActivityStats(req.user.id);
  }
  const next = db().prepare('SELECT * FROM communities WHERE id = ?').get(row.id);
  res.json(communityForViewer(next, req.user.id));
});

router.delete('/:id/leave', requireUser, (req, res) => {
  const row = db().prepare('SELECT * FROM communities WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Page not found' });
  if (row.creator_id === req.user.id) {
    return res.status(400).json({ error: 'Page owners cannot leave their own page' });
  }
  const existing = memberRow(row.id, req.user.id);
  if (existing) {
    const tx = db().transaction(() => {
      db()
        .prepare('DELETE FROM community_members WHERE community_id = ? AND user_id = ?')
        .run(row.id, req.user.id);
      db()
        .prepare(
          `UPDATE communities SET member_count = MAX(member_count - 1, 0),
           updated_at = datetime('now') WHERE id = ?`,
        )
        .run(row.id);
    });
    tx();
    syncUserActivityStats(req.user.id);
  }
  const next = db().prepare('SELECT * FROM communities WHERE id = ?').get(row.id);
  res.json(communityForViewer(next, req.user.id));
});

router.get('/:id/posts', (req, res) => {
  const community = db().prepare('SELECT * FROM communities WHERE id = ?').get(req.params.id);
  if (!community || community.status !== 'active') {
    return res.status(404).json({ error: 'Page not found' });
  }
  const { page, limit, offset } = pageParams(req.query);
  const userId = req.user?.id || '';
  const admin = isPageAdmin(community, userId);
  const status = String(req.query.status || 'approved').trim();
  // Qualify with p. — communities also has a status column (join would be ambiguous).
  let whereStatus = "p.status = 'approved'";
  if (admin && status === 'pending') whereStatus = "p.status = 'pending'";
  else if (admin && status === 'all') whereStatus = "p.status IN ('approved','pending')";
  const blockedSql = userId
    ? ' AND p.author_id NOT IN (SELECT blocked_id FROM blocked_users WHERE blocker_id = ?)'
    : '';
  const total = db()
    .prepare(
      `SELECT COUNT(*) AS n FROM community_posts p
       WHERE p.community_id = ? AND ${whereStatus}${blockedSql}`,
    )
    .get(...(userId ? [community.id, userId] : [community.id])).n;
  const rows = db()
    .prepare(
      `SELECT p.*, c.name AS community_name FROM community_posts p
       INNER JOIN communities c ON c.id = p.community_id
       WHERE p.community_id = ? AND ${whereStatus}${blockedSql}
       ORDER BY p.created_at DESC LIMIT ? OFFSET ?`,
    )
    .all(
      ...(userId
        ? [community.id, userId, limit, offset]
        : [community.id, limit, offset]),
    );
  const likes = likedSet(
    userId,
    'post',
    rows.map((r) => r.id),
  );
  res.json({
    items: rows.map((row) => publicCommunityPost(row, { liked: likes.has(row.id) })),
    total,
    page,
    limit,
  });
});

router.get('/:id/pending', requireUser, (req, res) => {
  const page = db().prepare('SELECT * FROM communities WHERE id = ?').get(req.params.id);
  if (!page) return res.status(404).json({ error: 'Page not found' });
  if (!isPageAdmin(page, req.user.id)) {
    return res.status(403).json({ error: 'Only the page owner can review posts' });
  }
  const rows = db()
    .prepare(
      `SELECT p.*, c.name AS community_name FROM community_posts p
       INNER JOIN communities c ON c.id = p.community_id
       WHERE p.community_id = ? AND p.status = 'pending'
       ORDER BY p.created_at ASC`,
    )
    .all(page.id);
  res.json({ items: rows.map((row) => publicCommunityPost(row)), total: rows.length });
});

router.post('/:id/posts', requireUser, receivePostImage, (req, res) => {
  const page = db().prepare('SELECT * FROM communities WHERE id = ?').get(req.params.id);
  if (!page || page.status !== 'active') {
    return res.status(404).json({ error: 'Page not found' });
  }
  let membership = memberRow(page.id, req.user.id);
  if (!membership) {
    db()
      .prepare(
        `INSERT INTO community_members (community_id, user_id, role)
         VALUES (?, ?, 'member')`,
      )
      .run(page.id, req.user.id);
    db()
      .prepare(
        `UPDATE communities SET member_count = member_count + 1,
         updated_at = datetime('now') WHERE id = ?`,
      )
      .run(page.id);
    membership = memberRow(page.id, req.user.id);
  }
  const body = String(req.body?.body || '').trim();
  const image = req.file
    ? `/uploads/community/${req.file.filename}`
    : safeImageRef(req.body?.image);
  if (!body && !image) return res.status(400).json({ error: 'Write something or attach a photo' });
  if (body.length > 5000) return res.status(400).json({ error: 'Post is too long' });
  const autoApprove = isPageAdmin(page, req.user.id);
  const id = `cpost_${crypto.randomUUID()}`;
  const status = autoApprove ? 'approved' : 'pending';
  const tx = db().transaction(() => {
    db()
      .prepare(
        `INSERT INTO community_posts
         (id, community_id, author_id, author_name, author_avatar, body, image, status,
          approved_at, approved_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        page.id,
        req.user.id,
        req.user.name || '',
        req.user.avatar || '',
        body,
        image,
        status,
        autoApprove ? new Date().toISOString() : '',
        autoApprove ? req.user.id : '',
      );
    if (autoApprove) {
      db()
        .prepare(
          `UPDATE communities SET post_count = post_count + 1,
           updated_at = datetime('now') WHERE id = ?`,
        )
        .run(page.id);
    }
  });
  tx();
  syncUserActivityStats(req.user.id);
  const row = db()
    .prepare(
      `SELECT p.*, c.name AS community_name FROM community_posts p
       INNER JOIN communities c ON c.id = p.community_id WHERE p.id = ?`,
    )
    .get(id);
  res.status(201).json(publicCommunityPost(row));
});

router.post('/:id/posts/:postId/approve', requireUser, (req, res) => {
  const page = db().prepare('SELECT * FROM communities WHERE id = ?').get(req.params.id);
  if (!page) return res.status(404).json({ error: 'Page not found' });
  if (!isPageAdmin(page, req.user.id)) {
    return res.status(403).json({ error: 'Only the page owner can approve posts' });
  }
  const post = db()
    .prepare('SELECT * FROM community_posts WHERE id = ? AND community_id = ?')
    .get(req.params.postId, page.id);
  if (!post) return res.status(404).json({ error: 'Post not found' });
  if (post.status === 'approved') {
    return res.json(publicCommunityPost(post));
  }
  const tx = db().transaction(() => {
    db()
      .prepare(
        `UPDATE community_posts SET status = 'approved', approved_at = datetime('now'),
         approved_by = ?, updated_at = datetime('now') WHERE id = ?`,
      )
      .run(req.user.id, post.id);
    if (post.status === 'pending') {
      db()
        .prepare(
          `UPDATE communities SET post_count = post_count + 1,
           updated_at = datetime('now') WHERE id = ?`,
        )
        .run(page.id);
    }
  });
  tx();
  const row = db()
    .prepare(
      `SELECT p.*, c.name AS community_name FROM community_posts p
       INNER JOIN communities c ON c.id = p.community_id WHERE p.id = ?`,
    )
    .get(post.id);
  res.json(publicCommunityPost(row));
});

router.post('/:id/posts/:postId/decline', requireUser, (req, res) => {
  const page = db().prepare('SELECT * FROM communities WHERE id = ?').get(req.params.id);
  if (!page) return res.status(404).json({ error: 'Page not found' });
  if (!isPageAdmin(page, req.user.id)) {
    return res.status(403).json({ error: 'Only the page owner can decline posts' });
  }
  const post = db()
    .prepare('SELECT * FROM community_posts WHERE id = ? AND community_id = ?')
    .get(req.params.postId, page.id);
  if (!post) return res.status(404).json({ error: 'Post not found' });
  db()
    .prepare(
      `UPDATE community_posts SET status = 'declined', updated_at = datetime('now')
       WHERE id = ?`,
    )
    .run(post.id);
  const row = db().prepare('SELECT * FROM community_posts WHERE id = ?').get(post.id);
  res.json(publicCommunityPost(row));
});

module.exports = { router, TOPICS, REPORT_REASONS };
