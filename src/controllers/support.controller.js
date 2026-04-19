'use strict';

const { db, collections } = require('../config/firebase');
const { FieldValue }       = require('firebase-admin/firestore');

// ── helpers ──────────────────────────────────────────────────────────────────

function stripTicket(doc) {
  const d = doc.data();
  return {
    id:        doc.id,
    uid:       d.uid,
    username:  d.username  || null,
    subject:   d.subject   || 'Support Ticket',
    status:    d.status    || 'open',
    messages:  d.messages  || [],
    createdAt: d.createdAt || null,
    updatedAt: d.updatedAt || null,
  };
}

// ── USER endpoints ────────────────────────────────────────────────────────────

/** GET /api/support/tickets  – list own tickets */
exports.listTickets = async (req, res) => {
  try {
    const snap = await collections.tickets
      .where('uid', '==', req.user.uid)
      .orderBy('createdAt', 'desc')
      .get();

    const tickets = snap.docs.map(stripTicket);
    return res.json({ success: true, tickets });
  } catch (err) {
    console.error('support.listTickets:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

/** POST /api/support/tickets  – open a new ticket */
exports.createTicket = async (req, res) => {
  const { subject, message } = req.body;
  if (!subject || !subject.trim())  return res.status(400).json({ success: false, message: 'Subject is required.' });
  if (!message || !message.trim())  return res.status(400).json({ success: false, message: 'Message is required.' });
  if (subject.length > 200)         return res.status(400).json({ success: false, message: 'Subject too long (max 200 chars).' });
  if (message.length > 4000)        return res.status(400).json({ success: false, message: 'Message too long (max 4000 chars).' });

  try {
    const firstMsg = {
      role:       'user',
      senderName: req.user.username || req.user.email,
      text:       message.trim(),
      createdAt:  new Date().toISOString(),
    };

    const ref = await collections.tickets.add({
      uid:       req.user.uid,
      username:  req.user.username || null,
      email:     req.user.email    || null,
      subject:   subject.trim(),
      status:    'open',
      messages:  [firstMsg],
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    return res.status(201).json({ success: true, ticketId: ref.id });
  } catch (err) {
    console.error('support.createTicket:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

/** POST /api/support/tickets/:id/message  – user reply */
exports.addMessage = async (req, res) => {
  const { text } = req.body;
  if (!text || !text.trim())   return res.status(400).json({ success: false, message: 'Message text is required.' });
  if (text.length > 4000)      return res.status(400).json({ success: false, message: 'Message too long (max 4000 chars).' });

  try {
    const ref  = collections.tickets.doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ success: false, message: 'Ticket not found.' });

    const ticket = snap.data();
    if (ticket.uid !== req.user.uid) return res.status(403).json({ success: false, message: 'Forbidden.' });
    if (ticket.status === 'closed')  return res.status(400).json({ success: false, message: 'This ticket is closed.' });

    const msg = {
      role:       'user',
      senderName: req.user.username || req.user.email,
      text:       text.trim(),
      createdAt:  new Date().toISOString(),
    };

    const updatedMessages = [...(ticket.messages || []), msg];
    await ref.update({ messages: updatedMessages, updatedAt: FieldValue.serverTimestamp() });

    return res.json({ success: true, messages: updatedMessages });
  } catch (err) {
    console.error('support.addMessage:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// ── ADMIN endpoints ───────────────────────────────────────────────────────────

/** GET /api/admin/tickets  – list all tickets */
exports.adminListTickets = async (req, res) => {
  try {
    const snap = await collections.tickets
      .orderBy('createdAt', 'desc')
      .limit(200)
      .get();

    const tickets = snap.docs.map(stripTicket);
    return res.json({ success: true, tickets });
  } catch (err) {
    console.error('support.adminListTickets:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

/** GET /api/admin/tickets/:id  – single ticket */
exports.adminGetTicket = async (req, res) => {
  try {
    const snap = await collections.tickets.doc(req.params.id).get();
    if (!snap.exists) return res.status(404).json({ success: false, message: 'Ticket not found.' });
    return res.json({ success: true, ticket: stripTicket(snap) });
  } catch (err) {
    console.error('support.adminGetTicket:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

/** PUT /api/admin/tickets/:id/status  – open / close */
exports.adminSetStatus = async (req, res) => {
  const { status } = req.body;
  if (!['open', 'closed'].includes(status)) return res.status(400).json({ success: false, message: 'Status must be "open" or "closed".' });

  try {
    const ref  = collections.tickets.doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ success: false, message: 'Ticket not found.' });

    await ref.update({ status, updatedAt: FieldValue.serverTimestamp() });
    return res.json({ success: true });
  } catch (err) {
    console.error('support.adminSetStatus:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

/** POST /api/admin/tickets/:id/reply  – admin reply */
exports.adminReply = async (req, res) => {
  const { text } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ success: false, message: 'Text is required.' });
  if (text.length > 4000)    return res.status(400).json({ success: false, message: 'Message too long.' });

  try {
    const ref  = collections.tickets.doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ success: false, message: 'Ticket not found.' });

    const ticket = snap.data();
    if (ticket.status === 'closed') return res.status(400).json({ success: false, message: 'Ticket is closed.' });

    const msg = {
      role:       'admin',
      senderName: req.user.username || 'Support',
      text:       text.trim(),
      createdAt:  new Date().toISOString(),
    };

    const updatedMessages = [...(ticket.messages || []), msg];
    await ref.update({ messages: updatedMessages, updatedAt: FieldValue.serverTimestamp() });

    return res.json({ success: true, messages: updatedMessages });
  } catch (err) {
    console.error('support.adminReply:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};
