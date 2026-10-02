const crypto = require('crypto');
const { db } = require('../db');
const { requireUser } = require('../auth');

function userName(id) {
  const row = db().prepare('SELECT name, avatar FROM users WHERE id = ?').get(id);
  return {
    id,
    name: row?.name || 'User',
    avatar: row?.avatar || '',
  };
}

function conversationRow(id) {
  return db()
    .prepare(
      `SELECT c.*, a.title AS ad_title, a.price AS ad_price, a.city AS ad_city,
              a.images AS ad_images, a.seller_name AS ad_seller_name, a.seller_avatar AS ad_seller_avatar
       FROM souq_conversations c
       JOIN souq_ads a ON a.ad_id = c.ad_id
       WHERE c.conversation_id = ?`,
    )
    .get(id);
}

function messagesFor(conversationId, meId) {
  return db()
    .prepare(
      `SELECT * FROM souq_messages WHERE conversation_id = ? ORDER BY created_at ASC`,
    )
    .all(conversationId)
    .map((row) => ({
      id: row.message_id,
      text: row.body,
      senderId: row.sender_id,
      fromMe: row.sender_id === meId,
      at: row.created_at,
    }));
}

function publicConversation(row, me) {
  const buyer = userName(row.buyer_id);
  const seller = {
    id: row.seller_id,
    name: row.ad_seller_name || userName(row.seller_id).name,
    avatar: row.ad_seller_avatar || '',
  };
  const isSeller = me.id === row.seller_id;
  const isBuyer = me.id === row.buyer_id;
  const images = (() => {
    try {
      return JSON.parse(row.ad_images || '[]');
    } catch (_) {
      return [];
    }
  })();
  return {
    id: row.conversation_id,
    adId: row.ad_id,
    ad: {
      id: row.ad_id,
      title: row.ad_title,
      price: row.ad_price == null ? null : Number(row.ad_price),
      city: row.ad_city,
      image: images[0] || '',
    },
    buyer,
    seller,
    peerName: isSeller ? buyer.name : seller.name,
    role: isSeller ? 'seller' : 'buyer',
    canSend: isSeller || isBuyer,
    canReply: isSeller,
    messages: messagesFor(row.conversation_id, me.id),
    updatedAt: row.updated_at,
  };
}

function assertParticipant(row, userId) {
  return row && (row.buyer_id === userId || row.seller_id === userId);
}

function registerChatRoutes(router) {
  router.get('/chats', requireUser, (req, res) => {
    const adId = String(req.query.adId || '').trim();
    const where = adId
      ? '(c.buyer_id = @user OR c.seller_id = @user) AND c.ad_id = @adId'
      : '(c.buyer_id = @user OR c.seller_id = @user)';
    const rows = db()
      .prepare(
        `SELECT c.*, a.title AS ad_title, a.price AS ad_price, a.city AS ad_city,
                a.images AS ad_images, a.seller_name AS ad_seller_name, a.seller_avatar AS ad_seller_avatar
         FROM souq_conversations c
         JOIN souq_ads a ON a.ad_id = c.ad_id
         WHERE ${where}
         ORDER BY c.updated_at DESC`,
      )
      .all({ user: req.user.id, adId });
    res.json({ items: rows.map((row) => publicConversation(row, req.user)) });
  });

  router.get('/ads/:adId/chats', requireUser, (req, res) => {
    const ad = db().prepare('SELECT * FROM souq_ads WHERE ad_id = ?').get(req.params.adId);
    if (!ad) return res.status(404).json({ error: 'Ad not found' });
    const rows = db()
      .prepare(
        `SELECT c.*, a.title AS ad_title, a.price AS ad_price, a.city AS ad_city,
                a.images AS ad_images, a.seller_name AS ad_seller_name, a.seller_avatar AS ad_seller_avatar
         FROM souq_conversations c
         JOIN souq_ads a ON a.ad_id = c.ad_id
         WHERE c.ad_id = ? AND (c.buyer_id = ? OR c.seller_id = ?)
         ORDER BY c.updated_at DESC`,
      )
      .all(ad.ad_id, req.user.id, req.user.id);
    res.json({
      adId: ad.ad_id,
      items: rows.map((row) => publicConversation(row, req.user)),
    });
  });

  router.get('/chats/:conversationId', requireUser, (req, res) => {
    const row = conversationRow(req.params.conversationId);
    if (!assertParticipant(row, req.user.id)) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    res.json(publicConversation(row, req.user));
  });

  router.post('/chats', requireUser, (req, res) => {
    const adId = String(req.body.adId || req.body.ad_id || '').trim();
    const text = String(req.body.message || req.body.text || '').trim();
    const ad = db().prepare('SELECT * FROM souq_ads WHERE ad_id = ?').get(adId);
    if (!ad) return res.status(404).json({ error: 'Ad not found' });
    if (ad.seller_id === req.user.id) {
      return res.status(400).json({ error: 'You cannot message your own ad' });
    }

    let row = db()
      .prepare('SELECT conversation_id FROM souq_conversations WHERE ad_id = ? AND buyer_id = ?')
      .get(ad.ad_id, req.user.id);
    const now = new Date().toISOString();
    if (!row) {
      const conversationId = `chat_${crypto.randomUUID()}`;
      db()
        .prepare(
          `INSERT INTO souq_conversations (conversation_id, ad_id, buyer_id, seller_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(conversationId, ad.ad_id, req.user.id, ad.seller_id, now, now);
      row = { conversation_id: conversationId };
    }
    if (text) {
      insertMessage(row.conversation_id, req.user.id, text, now);
    }
    res.status(201).json(publicConversation(conversationRow(row.conversation_id), req.user));
  });

  router.post('/chats/:conversationId/messages', requireUser, (req, res) => {
    const row = conversationRow(req.params.conversationId);
    if (!assertParticipant(row, req.user.id)) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    const text = String(req.body.text || req.body.message || '').trim();
    if (!text) return res.status(400).json({ error: 'Write a message' });

    const isSeller = req.user.id === row.seller_id;
    const isBuyer = req.user.id === row.buyer_id;
    if (!isBuyer && !isSeller) {
      return res.status(403).json({ error: 'You cannot send in this conversation' });
    }
    if (isSeller && req.user.id !== row.seller_id) {
      return res.status(403).json({ error: 'Only the ad owner can reply' });
    }

    insertMessage(row.conversation_id, req.user.id, text);
    res.status(201).json(publicConversation(conversationRow(row.conversation_id), req.user));
  });
}

function insertMessage(conversationId, senderId, text, at) {
  const now = at || new Date().toISOString();
  db()
    .prepare(
      `INSERT INTO souq_messages (message_id, conversation_id, sender_id, body, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(`msg_${crypto.randomUUID()}`, conversationId, senderId, text, now);
  db()
    .prepare('UPDATE souq_conversations SET updated_at = ? WHERE conversation_id = ?')
    .run(now, conversationId);
}

module.exports = { registerChatRoutes };
