/**
 * Seed public-style KSA expat community pages, fictional members, posts, and comments.
 *
 * Content is written from publicly discussed 2025–2026 themes (Premium Residency,
 * Ejar, Qiwa, Absher, Riyadh rent freeze, housing, food). It does not scrape
 * private Facebook groups or copy real people's accounts.
 *
 * First run inserts pages. Later runs refresh copy and remove sample pages
 * that are not part of this seed.
 */
const bcrypt = require('bcryptjs');
const { db, syncUserActivityStats } = require('./db');
const { BANKS, COUNTS, assertCounts } = require('./seed_community_content');
const { REPLIES, assertReplies } = require('./seed_community_replies');

const SEED_MARKER = 'comm_seed_askksa';

const USERS = [
  { id: 'cuser_seed_01', name: 'Amina Rahman', email: 'amina.seed@ksaguide.local', gender: 'female', dob: '1992-04-11' },
  { id: 'cuser_seed_02', name: 'Karthik Menon', email: 'karthik.seed@ksaguide.local', gender: 'male', dob: '1988-09-02' },
  { id: 'cuser_seed_03', name: 'Maria Santos', email: 'maria.seed@ksaguide.local', gender: 'female', dob: '1994-01-19' },
  { id: 'cuser_seed_04', name: 'Omar El-Sayed', email: 'omar.seed@ksaguide.local', gender: 'male', dob: '1986-07-23' },
  { id: 'cuser_seed_05', name: 'Priya Nair', email: 'priya.seed@ksaguide.local', gender: 'female', dob: '1990-12-05' },
  { id: 'cuser_seed_06', name: 'James Whitaker', email: 'james.seed@ksaguide.local', gender: 'male', dob: '1983-03-14' },
  { id: 'cuser_seed_07', name: 'Fatima Alvi', email: 'fatima.seed@ksaguide.local', gender: 'female', dob: '1991-06-28' },
  { id: 'cuser_seed_08', name: 'Daniel Okonkwo', email: 'daniel.seed@ksaguide.local', gender: 'male', dob: '1989-11-08' },
  { id: 'cuser_seed_09', name: 'Mei Lin Chen', email: 'meilin.seed@ksaguide.local', gender: 'female', dob: '1993-02-17' },
  { id: 'cuser_seed_10', name: 'Hassan Qureshi', email: 'hassan.seed@ksaguide.local', gender: 'male', dob: '1987-08-30' },
  { id: 'cuser_seed_11', name: 'Sofia Alvarez', email: 'sofia.seed@ksaguide.local', gender: 'female', dob: '1995-05-21' },
  { id: 'cuser_seed_12', name: 'Youssef Haddad', email: 'youssef.seed@ksaguide.local', gender: 'male', dob: '1984-10-09' },
];

const PAGES = [
  {
    id: SEED_MARKER,
    slug: 'ask-ksa',
    name: 'Ask KSA',
    topic: 'Expats',
    city: 'Riyadh',
    owner: 0,
    description:
      'First-stop questions for people living in Saudi Arabia: Absher, Tawakkalna, SIM cards, weekends, and how things actually work.',
  },
  {
    id: 'comm_seed_premium',
    slug: 'premium-residency-ksa',
    name: 'Premium Residency KSA',
    topic: 'Business',
    city: 'Riyadh',
    owner: 5,
    description:
      'Special Talent, investor, real-estate and limited-duration Premium Residency. Processing times, documents, CHI insurance.',
  },
  {
    id: 'comm_seed_housing',
    slug: 'riyadh-housing-ejar',
    name: 'Riyadh Housing & Ejar',
    topic: 'Neighbourhood',
    city: 'Riyadh',
    owner: 1,
    description:
      'Compounds vs apartments, Ejar, SADAD rent payments, the Riyadh rent freeze, deposits, and which districts people actually like.',
  },
  {
    id: 'comm_seed_food',
    slug: 'eat-in-riyadh',
    name: 'Eat in Riyadh',
    topic: 'Food',
    city: 'Riyadh',
    owner: 2,
    description:
      'Where to eat this week: Najd, Levant, Filipino, Indian, coffee, family spots, and “is this place still good in 2026?”',
  },
  {
    id: 'comm_seed_family',
    slug: 'families-in-ksa',
    name: 'Families in KSA',
    topic: 'Family',
    city: 'Riyadh',
    owner: 4,
    description:
      'Dependent iqama, schools, CHI, kids’ activities, and arriving before the family has border numbers.',
  },
  {
    id: 'comm_seed_jobs',
    slug: 'jobs-qiwa-transfers',
    name: 'Jobs, Qiwa & Transfers',
    topic: 'Business',
    city: 'Riyadh',
    owner: 9,
    description:
      'Job offers, Qiwa transfers, Nitaqat, notice periods, and what happens if a contract ends in 2026.',
  },
  {
    id: 'comm_seed_daily',
    slug: 'new-in-ksa-daily',
    name: 'New in KSA — Daily life',
    topic: 'General',
    city: '',
    owner: 3,
    description:
      'STC fiber, driving, Muroor, banks, weekends (Fri–Sat), Jeddah and Dammam tips, and the small things nobody emails you.',
  },
];

const TAG = {
  [SEED_MARKER]: 'ask',
  comm_seed_premium: 'premium',
  comm_seed_housing: 'housing',
  comm_seed_food: 'food',
  comm_seed_family: 'family',
  comm_seed_jobs: 'jobs',
  comm_seed_daily: 'daily',
};

function mulberry(seed) {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(rng, list) {
  return list[Math.floor(rng() * list.length)];
}

function pad(n, w = 4) {
  return String(n).padStart(w, '0');
}

function stamp(rng) {
  const start = Date.UTC(2026, 0, 18, 8, 0, 0);
  const end = Date.UTC(2026, 9, 8, 20, 0, 0);
  const ms = start + Math.floor(rng() * (end - start));
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
}

function later(iso, hours, rng) {
  const t = new Date(iso.replace(' ', 'T') + 'Z').getTime();
  const add = (hours + rng() * 10) * 3600 * 1000;
  return new Date(t + add).toISOString().replace('T', ' ').slice(0, 19);
}

function buildPosts() {
  assertCounts();
  assertReplies(COUNTS);
  const rng = mulberry(20261008);
  const posts = [];
  let n = 0;
  const weights = [
    [SEED_MARKER, COUNTS.ask],
    ['comm_seed_premium', COUNTS.premium],
    ['comm_seed_housing', COUNTS.housing],
    ['comm_seed_food', COUNTS.food],
    ['comm_seed_family', COUNTS.family],
    ['comm_seed_jobs', COUNTS.jobs],
    ['comm_seed_daily', COUNTS.daily],
  ];
  const engage = mulberry(20261011);
  for (const [pageId, count] of weights) {
    const tag = TAG[pageId];
    const bank = BANKS[tag];
    for (let i = 0; i < count; i += 1) {
      n += 1;
      const author = USERS[Math.floor(rng() * USERS.length)];
      const pack = REPLIES[tag][i];
      const heat = engage();
      let likes = 0;
      let views = 8;
      let commentTake = 0;
      let includeReply = false;
      const followUps = [
        'That matches what I ran into this year.',
        'Good to know — I will try that.',
        'Same on my side, just a bit slower.',
        'Thanks. That is the bit I needed.',
      ];
      if (heat < 0.22) {
        likes = engage() < 0.6 ? 0 : 1;
        views = 5 + Math.floor(engage() * 14);
      } else if (heat < 0.5) {
        likes = Math.floor(engage() * 3);
        views = 8 + Math.floor(engage() * 20);
        commentTake = 1;
        includeReply = engage() < 0.12;
      } else if (heat < 0.72) {
        likes = 1 + Math.floor(engage() * 3);
        views = 12 + Math.floor(engage() * 28);
        commentTake = Math.min(2, pack.comments.length);
        includeReply = engage() < 0.48 && commentTake > 0;
      } else if (heat < 0.9) {
        likes = 3 + Math.floor(engage() * 3);
        views = 18 + Math.floor(engage() * 36);
        commentTake = Math.min(2, pack.comments.length);
        includeReply = engage() < 0.78 && commentTake > 0;
      } else {
        likes = 5 + Math.floor(engage() * 3);
        views = 28 + Math.floor(engage() * 42);
        commentTake = Math.min(2, pack.comments.length);
        includeReply = Boolean(pack.reply) && commentTake > 0;
      }
      posts.push({
        id: `cpost_seed_${pad(n)}`,
        community_id: pageId,
        author,
        body: bank[i],
        created: stamp(rng),
        likes,
        views,
        comments: (pack.comments || []).slice(0, commentTake),
        reply: includeReply
          ? pack.reply || followUps[Math.floor(engage() * followUps.length)]
          : '',
      });
    }
  }
  return posts;
}

function purgeSampleCommunities() {
  const extras = db()
    .prepare("SELECT id FROM communities WHERE id NOT LIKE 'comm_seed_%'")
    .all();
  if (!extras.length) return 0;
  const tx = db().transaction(() => {
    for (const row of extras) {
      const posts = db()
        .prepare('SELECT id FROM community_posts WHERE community_id = ?')
        .all(row.id)
        .map((p) => p.id);
      for (const postId of posts) {
        db().prepare(
          "DELETE FROM community_likes WHERE target_type = 'post' AND target_id = ?",
        ).run(postId);
        db().prepare(
          "DELETE FROM community_views WHERE target_type = 'post' AND target_id = ?",
        ).run(postId);
      }
      db().prepare('DELETE FROM community_comments WHERE community_id = ?').run(row.id);
      db().prepare('DELETE FROM community_posts WHERE community_id = ?').run(row.id);
      db().prepare('DELETE FROM community_members WHERE community_id = ?').run(row.id);
      db().prepare('DELETE FROM community_reports WHERE community_id = ?').run(row.id);
      db().prepare(
        "DELETE FROM community_views WHERE target_type = 'community' AND target_id = ?",
      ).run(row.id);
      db().prepare('DELETE FROM communities WHERE id = ?').run(row.id);
    }
  });
  tx();
  return extras.length;
}

function markDummyFlags() {
  db()
    .prepare(
      `UPDATE users SET is_dummy = 1
       WHERE id LIKE 'cuser_seed_%' OR email LIKE '%.seed@ksaguide.local'`,
    )
    .run();
  db().prepare("UPDATE communities SET is_dummy = 1 WHERE id LIKE 'comm_seed_%'").run();
  db().prepare("UPDATE community_posts SET is_dummy = 1 WHERE id LIKE 'cpost_seed_%'").run();
  db()
    .prepare("UPDATE community_comments SET is_dummy = 1 WHERE id LIKE 'ccom_seed_%'")
    .run();
}

function rebuildSeedComments() {
  const posts = buildPosts();
  const rng = mulberry(20261010);
  const insertComment = db().prepare(
    `INSERT INTO community_comments (
      id, post_id, community_id, author_id, author_name, author_avatar, parent_id, body,
      like_count, status, created_at, updated_at, is_dummy
    ) VALUES (?, ?, ?, ?, ?, '', ?, ?, ?, 'active', ?, ?, 1)`,
  );
  const updCount = db().prepare('UPDATE community_posts SET comment_count = ? WHERE id = ?');
  const tx = db().transaction(() => {
    db()
      .prepare(
        `DELETE FROM community_likes
         WHERE target_type = 'comment' AND target_id LIKE 'ccom_seed_%'`,
      )
      .run();
    db().prepare("DELETE FROM community_comments WHERE id LIKE 'ccom_seed_%'").run();
    let c = 0;
    const authorOf = db().prepare('SELECT author_id FROM community_posts WHERE id = ?');
    for (const post of posts) {
      const seenBodies = new Set();
      const liveAuthor = authorOf.get(post.id)?.author_id || post.author.id;
      const used = new Set([liveAuthor]);
      const tops = [];
      for (const raw of post.comments || []) {
        const body = String(raw || '').trim();
        if (!body || seenBodies.has(body)) continue;
        seenBodies.add(body);
        const pool = USERS.filter((u) => !used.has(u.id));
        if (!pool.length) break;
        const commenter = pick(rng, pool);
        used.add(commenter.id);
        c += 1;
        const id = `ccom_seed_${pad(c, 5)}`;
        const created = later(post.created, 4 + tops.length * 6, rng);
        insertComment.run(
          id,
          post.id,
          post.community_id,
          commenter.id,
          commenter.name,
          '',
          body,
          Math.floor(rng() * 3),
          created,
          created,
        );
        tops.push({ id, commenter });
      }
      if (post.reply && tops[0]) {
        const replyPool = USERS.filter(
          (u) => u.id !== tops[0].commenter.id && u.id !== liveAuthor,
        );
        if (replyPool.length && !seenBodies.has(post.reply)) {
          const replier = pick(rng, replyPool);
          c += 1;
          const rid = `ccom_seed_${pad(c, 5)}`;
          const rAt = later(post.created, 14, rng);
          insertComment.run(
            rid,
            post.id,
            post.community_id,
            replier.id,
            replier.name,
            tops[0].id,
            post.reply,
            Math.floor(rng() * 2),
            rAt,
            rAt,
          );
        }
      }
      updCount.run(
        db()
          .prepare(
            `SELECT COUNT(*) AS n FROM community_comments
             WHERE post_id = ? AND status = 'active'`,
          )
          .get(post.id).n,
        post.id,
      );
    }
  });
  tx();
}

function rebuildSeedLikes(posts) {
  const rng = mulberry(20261012);
  const insertLike = db().prepare(
    `INSERT OR IGNORE INTO community_likes (user_id, target_type, target_id, created_at)
     VALUES (?, ?, ?, ?)`,
  );
  const authorOf = db().prepare('SELECT author_id FROM community_posts WHERE id = ?');
  const tx = db().transaction(() => {
    db()
      .prepare(
        `DELETE FROM community_likes
         WHERE target_type = 'post' AND target_id LIKE 'cpost_seed_%'`,
      )
      .run();
    for (const post of posts) {
      const liveAuthor = authorOf.get(post.id)?.author_id || post.author.id;
      let n = 0;
      for (const user of USERS) {
        if (user.id === liveAuthor) continue;
        if (n >= post.likes) break;
        insertLike.run(user.id, 'post', post.id, later(post.created, 2, rng));
        n += 1;
      }
    }
  });
  tx();
}

function refreshSeedCopy() {
  const posts = buildPosts();
  const updPost = db().prepare(
    `UPDATE community_posts
     SET body = ?, like_count = ?, view_count = ?, updated_at = datetime('now')
     WHERE id = ?`,
  );
  const tx = db().transaction(() => {
    for (const post of posts) {
      updPost.run(post.body, post.likes, post.views, post.id);
    }
  });
  tx();
  rebuildSeedLikes(posts);
  rebuildSeedComments();
}

function seedCommunities() {
  const existing = db().prepare('SELECT id FROM communities WHERE id = ?').get(SEED_MARKER);
  if (existing) {
    const removed = purgeSampleCommunities();
    refreshSeedCopy();
    markDummyFlags();
    console.log(
      `Community seed copy refreshed${removed ? `, removed ${removed} sample page(s)` : ''}.`,
    );
    return;
  }

  const passwordHash = bcrypt.hashSync('SeedKsa360!', 8);
  const insertUser = db().prepare(
    `INSERT INTO users (
      id, name, email, password_hash, google_id, date_of_birth, gender, avatar, provider, is_dummy
    ) VALUES (?, ?, ?, ?, ?, ?, ?, '', 'email', 1)
    ON CONFLICT(id) DO NOTHING`,
  );
  const insertPage = db().prepare(
    `INSERT INTO communities (
      id, name, slug, description, cover_image, topic, city, creator_id, creator_name,
      member_count, post_count, view_count, status, created_at, updated_at, is_dummy
    ) VALUES (?, ?, ?, ?, '', ?, ?, ?, ?, ?, 0, ?, 'active', ?, ?, 1)`,
  );
  const insertMember = db().prepare(
    `INSERT OR IGNORE INTO community_members (community_id, user_id, role, joined_at)
     VALUES (?, ?, ?, ?)`,
  );
  const insertPost = db().prepare(
    `INSERT INTO community_posts (
      id, community_id, author_id, author_name, author_avatar, body, image, status,
      like_count, comment_count, view_count, created_at, updated_at, approved_at, approved_by, is_dummy
    ) VALUES (?, ?, ?, ?, '', ?, '', 'approved', ?, ?, ?, ?, ?, ?, ?, 1)`,
  );
  const insertLike = db().prepare(
    `INSERT OR IGNORE INTO community_likes (user_id, target_type, target_id, created_at)
     VALUES (?, ?, ?, ?)`,
  );

  const posts = buildPosts();
  const rng = mulberry(99);
  const pageStart = '2026-01-10 09:00:00';

  const tx = db().transaction(() => {
    for (const user of USERS) {
      insertUser.run(
        user.id,
        user.name,
        user.email,
        passwordHash,
        null,
        user.dob,
        user.gender,
      );
    }

    for (const page of PAGES) {
      const owner = USERS[page.owner];
      insertPage.run(
        page.id,
        page.name,
        page.slug,
        page.description,
        page.topic,
        page.city,
        owner.id,
        owner.name,
        USERS.length,
        40 + Math.floor(rng() * 80),
        pageStart,
        pageStart,
      );
      for (let i = 0; i < USERS.length; i += 1) {
        const role = i === page.owner ? 'owner' : 'member';
        insertMember.run(page.id, USERS[i].id, role, pageStart);
      }
    }

    for (const post of posts) {
      insertPost.run(
        post.id,
        post.community_id,
        post.author.id,
        post.author.name,
        post.body,
        post.likes,
        0,
        post.views,
        post.created,
        post.created,
        post.created,
        post.author.id,
      );
      const likeN = Math.min(post.likes, USERS.length);
      for (let i = 0; i < likeN; i += 1) {
        const u = USERS[(i + post.body.length) % USERS.length];
        if (u.id === post.author.id) continue;
        insertLike.run(u.id, 'post', post.id, later(post.created, 2, rng));
      }
    }

    const recount = db().prepare(
      `UPDATE communities SET post_count = (
         SELECT COUNT(*) FROM community_posts
         WHERE community_id = communities.id AND status = 'approved'
       ), member_count = (
         SELECT COUNT(*) FROM community_members WHERE community_id = communities.id
       ), updated_at = datetime('now')
       WHERE id LIKE 'comm_seed_%' OR id = ?`,
    );
    recount.run(SEED_MARKER);
  });

  tx();
  rebuildSeedComments();
  markDummyFlags();
  for (const user of USERS) syncUserActivityStats(user.id);
  const nPosts = db()
    .prepare("SELECT COUNT(*) AS n FROM community_posts WHERE id LIKE 'cpost_seed_%'")
    .get().n;
  const nComments = db()
    .prepare("SELECT COUNT(*) AS n FROM community_comments WHERE id LIKE 'ccom_seed_%'")
    .get().n;
  console.log(
    `Seeded expat community: ${USERS.length} users, ${PAGES.length} pages, ${nPosts} posts, ${nComments} comments.`,
  );
}

module.exports = { seedCommunities };
