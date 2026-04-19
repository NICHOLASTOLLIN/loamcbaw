'use strict';

const { collections }  = require('../config/firebase');
const { FieldValue }   = require('firebase-admin/firestore');

// ── helpers ──────────────────────────────────────────────────────────────────

function stripNotif(doc) {
  const d = doc.data();
  return {
    id:        doc.id,
    title:     d.title   || '',
    message:   d.message || '',
    type:      d.type    || 'info',   // info | warning | success
    createdAt: d.createdAt || null,
    createdBy: d.createdBy || null,
  };
}

// ── ADMIN endpoints (owner-only) ─────────────────────────────────────────────

/** GET /api/admin/notifications  – list all global notifications */
exports.adminList = async (req, res) => {
  try {
    const snap = await collections.notifications
      .orderBy('createdAt', 'desc')
      .limit(100)
      .get();

    const notifications = snap.docs.map(stripNotif);
    return res.json({ success: true, notifications });
  } catch (err) {
    console.error('notifications.adminList:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

/** POST /api/admin/notifications  – broadcast a new notification */
exports.adminCreate = async (req, res) => {
  const { title, message, type = 'info' } = req.body;
  if (!title   || !title.trim())   return res.status(400).json({ success: false, message: 'Title is required.' });
  if (!message || !message.trim()) return res.status(400).json({ success: false, message: 'Message is required.' });
  if (!['info','warning','success'].includes(type)) return res.status(400).json({ success: false, message: 'Invalid type.' });
  if (title.length   > 200)  return res.status(400).json({ success: false, message: 'Title too long (max 200).' });
  if (message.length > 2000) return res.status(400).json({ success: false, message: 'Message too long (max 2000).' });

  try {
    const ref = await collections.notifications.add({
      title:     title.trim(),
      message:   message.trim(),
      type,
      createdBy: req.user.uid,
      createdAt: FieldValue.serverTimestamp(),
    });

    return res.status(201).json({ success: true, id: ref.id });
  } catch (err) {
    console.error('notifications.adminCreate:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

/** DELETE /api/admin/notifications/:id */
exports.adminDelete = async (req, res) => {
  try {
    const ref  = collections.notifications.doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ success: false, message: 'Notification not found.' });

    await ref.delete();
    return res.json({ success: true });
  } catch (err) {
    console.error('notifications.adminDelete:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// ── USER endpoint ─────────────────────────────────────────────────────────────

/** GET /api/notifications  – fetch active notifications for the logged-in user */
exports.userList = async (req, res) => {
  try {
    // Return the latest 10 global notifications
    const snap = await collections.notifications
      .orderBy('createdAt', 'desc')
      .limit(10)
      .get();

    const notifications = snap.docs.map(stripNotif);

    // Per-user dismissed list (stored as array on the user doc)
    const userSnap   = await collections.users.doc(req.user.uid).get();
    const dismissed  = (userSnap.exists && userSnap.data().dismissedNotifs) || [];

    const visible = notifications.filter(n => !dismissed.includes(n.id));
    return res.json({ success: true, notifications: visible });
  } catch (err) {
    console.error('notifications.userList:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

/** POST /api/notifications/:id/dismiss  – mark a notification as dismissed */
exports.userDismiss = async (req, res) => {
  try {
    const notifRef  = collections.notifications.doc(req.params.id);
    const notifSnap = await notifRef.get();
    if (!notifSnap.exists) return res.status(404).json({ success: false, message: 'Notification not found.' });

    await collections.users.doc(req.user.uid).update({
      dismissedNotifs: FieldValue.arrayUnion(req.params.id),
    });

    return res.json({ success: true });
  } catch (err) {
    console.error('notifications.userDismiss:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};
