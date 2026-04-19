const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { collections, admin } = require('../config/firebase');
const { requireAuth, optionalAuth } = require('../middleware/auth.middleware');

// ─── GET /api/profile/:username ───────────────────────────────────────────────
// Public profile page data (no auth required)
router.get('/:username', optionalAuth, async (req, res) => {
  try {
    const username = req.params.username.toLowerCase();

    const usernameDoc = await collections.usernames.doc(username).get();
    if (!usernameDoc.exists) {
      return res.status(404).json({ success: false, message: 'Profile not found.' });
    }

    const { uid } = usernameDoc.data();
    const userDoc = await collections.users.doc(uid).get();
    if (!userDoc.exists) {
      return res.status(404).json({ success: false, message: 'Profile not found.' });
    }

    const user = userDoc.data();

    // Fetch active links, ordered by position
    const linksSnap = await collections.links
      .where('uid', '==', uid)
      .where('isActive', '==', true)
      .orderBy('position', 'asc')
      .get();

    const links = linksSnap.docs.map(doc => {
      const { uid: _uid, ...link } = doc.data();
      return { id: doc.id, ...link };
    });

    return res.json({
      success: true,
      profile: {
        username: user.username,
        displayName: user.displayName,
        bio: user.bio,
        avatarUrl: user.avatarUrl,
        bgUrl: user.bgUrl || '',
        theme: user.theme,
        isVerified: user.isVerified,
        isPro: user.isPro,
        createdAt: user.createdAt,
        nameEffect: user.nameEffect || 'none',
        twSpeed: user.twSpeed || 80,
        gradColor1: user.gradColor1 || '#ff6a1a',
        gradColor2: user.gradColor2 || '#ffb060',
        layoutSettings: user.layoutSettings || {},
        profileFont: user.profileFont || 'inter',
        activeBadges: user.activeBadges || [],
      },
      links,
      isOwner: req.user?.uid === uid,
    });
  } catch (err) {
    console.error('profile get error:', err.message);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ─── PUT /api/profile ─────────────────────────────────────────────────────────
// Update own profile (auth required)
router.put('/', requireAuth, async (req, res) => {
  try {
    const allowedFields = [
      'displayName', 'bio', 'theme', 'avatarUrl', 'bgUrl',
      'nameEffect', 'twSpeed', 'gradColor1', 'gradColor2',
      'layoutSettings', 'lastUsernameChange', 'profileFont',
    ];
    const updates = {};

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

    // Handle username change
    if (req.body.username !== undefined) {
      const newUsername = req.body.username.toLowerCase().trim();
      const validPattern = /^[a-zA-Z0-9_]{3,20}$/;
      if (!validPattern.test(newUsername)) {
        return res.status(400).json({ success: false, message: 'Invalid username format.' });
      }

      // Check cooldown
      const userDoc = await collections.users.doc(req.user.uid).get();
      const userData = userDoc.data();
      if (userData.lastUsernameChange) {
        const lastChange = new Date(userData.lastUsernameChange);
        const diff = Date.now() - lastChange.getTime();
        const threeDays = 3 * 24 * 60 * 60 * 1000;
        if (diff < threeDays) {
          const hoursLeft = Math.ceil((threeDays - diff) / (1000 * 60 * 60));
          return res.status(429).json({
            success: false,
            message: `Username on cooldown. Try again in ${hoursLeft} hours.`,
          });
        }
      }

      // Check availability
      const existing = await collections.usernames.doc(newUsername).get();
      if (existing.exists && existing.data().uid !== req.user.uid) {
        return res.status(409).json({ success: false, message: 'Username already taken.' });
      }

      const oldUsername = userData.usernameLower;
      const batch = collections.users.firestore.batch();
      batch.set(collections.usernames.doc(newUsername), {
        uid: req.user.uid,
        username: newUsername,
        claimedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      if (oldUsername && oldUsername !== newUsername) {
        batch.delete(collections.usernames.doc(oldUsername));
      }
      updates.username = newUsername;
      updates.usernameLower = newUsername;
      updates.lastUsernameChange = req.body.lastUsernameChange || new Date().toISOString();
      await batch.commit();
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ success: false, message: 'No fields to update.' });
    }

    updates.updatedAt = admin.firestore.FieldValue.serverTimestamp();
    await collections.users.doc(req.user.uid).update(updates);

    return res.json({ success: true, message: 'Profile updated.', updates });
  } catch (err) {
    console.error('profile put error:', err.message);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ─── POST /api/profile/:username/view ────────────────────────────────────────
// Increment view count (client-side dedup via localStorage)
router.post('/:username/view', async (req, res) => {
  try {
    const username = req.params.username.toLowerCase();
    const usernameDoc = await collections.usernames.doc(username).get();
    if (!usernameDoc.exists) return res.status(404).json({ success: false });
    const { uid } = usernameDoc.data();
    await collections.users.doc(uid).update({
      viewCount: admin.firestore.FieldValue.increment(1),
    });
    return res.json({ success: true });
  } catch (err) {
    console.error('view increment error:', err.message);
    return res.status(500).json({ success: false });
  }
});

// ─── GET /api/profile/:username/views ────────────────────────────────────────
// Fetch current view count (public)
router.get('/:username/views', async (req, res) => {
  try {
    const username = req.params.username.toLowerCase();
    const usernameDoc = await collections.usernames.doc(username).get();
    if (!usernameDoc.exists) return res.status(404).json({ success: false, views: 0 });
    const { uid } = usernameDoc.data();
    const userDoc = await collections.users.doc(uid).get();
    const views = userDoc.data()?.viewCount || 0;
    return res.json({ success: true, views });
  } catch (err) {
    console.error('views fetch error:', err.message);
    return res.status(500).json({ success: false, views: 0 });
  }
});

// ─── PUT /api/profile/badges ──────────────────────────────────────────────────
// Update which badges the user wants to display (max 6 active at once)
router.put('/badges', requireAuth, async (req, res) => {
  try {
    const { activeBadges } = req.body;
    if (!Array.isArray(activeBadges)) {
      return res.status(400).json({ success: false, message: 'activeBadges must be an array.' });
    }

    const VALID_BADGES = ['booster','bug hunter','creator','famous','friend','gifter','og','owner','premium','staff','verified'];
    const filtered = activeBadges.filter(b => VALID_BADGES.includes(b)).slice(0, 6);

    // Verify user actually owns these badges
    const userDoc = await collections.users.doc(req.user.uid).get();
    const ownedBadges = userDoc.data()?.badges || [];
    const allowed = filtered.filter(b => ownedBadges.includes(b));

    await collections.users.doc(req.user.uid).update({
      activeBadges: allowed,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return res.json({ success: true, activeBadges: allowed });
  } catch (err) {
    console.error('badges put error:', err.message);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});

module.exports = router;