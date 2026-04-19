const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { collections, admin } = require('../config/firebase');
const { requireAuth } = require('../middleware/auth.middleware');

const MAX_LINKS_FREE = 10;
const MAX_LINKS_PRO  = 50;

// ─── GET /api/links ───────────────────────────────────────────────────────────
// Get all links for the authenticated user (including inactive)
router.get('/', requireAuth, async (req, res) => {
  const linksSnap = await collections.links
    .where('uid', '==', req.user.uid)
    .orderBy('position', 'asc')
    .get();

  const links = linksSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  return res.json({ success: true, links });
});

// ─── POST /api/links ──────────────────────────────────────────────────────────
// Add a new link
router.post(
  '/',
  requireAuth,
  [
    body('title').trim().notEmpty().isLength({ max: 100 }),
    body('url').isURL({ protocols: ['http', 'https'] }),
    body('icon').optional().trim().isLength({ max: 50 }),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Invalid link data. Check title and URL.' });
    }

    const { title, url, icon } = req.body;

    // Check link limit
    const userDoc = await collections.users.doc(req.user.uid).get();
    const user = userDoc.data();
    const limit = user.isPro ? MAX_LINKS_PRO : MAX_LINKS_FREE;

    const countSnap = await collections.links.where('uid', '==', req.user.uid).count().get();
    const count = countSnap.data().count;

    if (count >= limit) {
      return res.status(403).json({
        success: false,
        message: `You've reached the ${limit}-link limit.${!user.isPro ? ' Upgrade to Pro for up to 50 links.' : ''}`,
      });
    }

    const newLink = {
      uid: req.user.uid,
      title,
      url,
      icon: icon || '',
      position: count, // append at end
      isActive: true,
      clickCount: 0,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    const docRef = await collections.links.add(newLink);

    // Increment link count on user
    await collections.users.doc(req.user.uid).update({
      linkCount: admin.firestore.FieldValue.increment(1),
    });

    return res.status(201).json({ success: true, link: { id: docRef.id, ...newLink } });
  }
);

// ─── PUT /api/links/:id ───────────────────────────────────────────────────────
// Update a link
router.put(
  '/:id',
  requireAuth,
  [
    body('title').optional().trim().notEmpty().isLength({ max: 100 }),
    body('url').optional().isURL({ protocols: ['http', 'https'] }),
    body('icon').optional().trim().isLength({ max: 50 }),
    body('isActive').optional().isBoolean(),
  ],
  async (req, res) => {
    const linkDoc = await collections.links.doc(req.params.id).get();
    if (!linkDoc.exists) {
      return res.status(404).json({ success: false, message: 'Link not found.' });
    }

    if (linkDoc.data().uid !== req.user.uid) {
      return res.status(403).json({ success: false, message: 'Forbidden.' });
    }

    const allowedFields = ['title', 'url', 'icon', 'isActive'];
    const updates = {};

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) updates[field] = req.body[field];
    }

    updates.updatedAt = admin.firestore.FieldValue.serverTimestamp();
    await collections.links.doc(req.params.id).update(updates);

    return res.json({ success: true, message: 'Link updated.' });
  }
);

// ─── DELETE /api/links/:id ────────────────────────────────────────────────────
router.delete('/:id', requireAuth, async (req, res) => {
  const linkDoc = await collections.links.doc(req.params.id).get();
  if (!linkDoc.exists) {
    return res.status(404).json({ success: false, message: 'Link not found.' });
  }

  if (linkDoc.data().uid !== req.user.uid) {
    return res.status(403).json({ success: false, message: 'Forbidden.' });
  }

  await collections.links.doc(req.params.id).delete();
  await collections.users.doc(req.user.uid).update({
    linkCount: admin.firestore.FieldValue.increment(-1),
  });

  return res.json({ success: true, message: 'Link deleted.' });
});

// ─── POST /api/links/:id/reorder ──────────────────────────────────────────────
// Reorder links — expects body: { orderedIds: ['id1','id2',...] }
router.post('/reorder', requireAuth, async (req, res) => {
  const { orderedIds } = req.body;

  if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
    return res.status(400).json({ success: false, message: 'orderedIds must be a non-empty array.' });
  }

  const batch = collections.links.firestore.batch();

  orderedIds.forEach((id, index) => {
    batch.update(collections.links.doc(id), { position: index });
  });

  await batch.commit();
  return res.json({ success: true, message: 'Links reordered.' });
});

// ─── POST /api/links/:id/click ────────────────────────────────────────────────
// Track a link click (called by the public profile page)
router.post('/:id/click', async (req, res) => {
  const linkDoc = await collections.links.doc(req.params.id).get();
  if (!linkDoc.exists) {
    return res.status(404).json({ success: false, message: 'Link not found.' });
  }

  await collections.links.doc(req.params.id).update({
    clickCount: admin.firestore.FieldValue.increment(1),
  });

  return res.json({ success: true });
});

module.exports = router;
