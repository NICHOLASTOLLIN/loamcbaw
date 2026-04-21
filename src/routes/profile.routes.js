const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { collections, admin } = require('../config/firebase');
const { requireAuth, optionalAuth } = require('../middleware/auth.middleware');

// ─── Medal computation helper ─────────────────────────────────────────────────
// Merges custom medals (set by admin) with auto-earned medals based on activity.
// first_10 is determined by checking if user is among earliest 10 created accounts.

let _first10Cache = null;  // simple in-memory cache (resets on deploy — acceptable)
let _first10CacheTime = 0;

async function computeMedals(user, uid, cols) {
  const medals = [];
  const MEDAL_LABELS = {
    noticed: 'Noticed by owners.', known: 'Known.', contributor: 'Contributor.',
    egirl: 'Gorgeus egirl.', eboy: 'Gorgeus eboy.', rich: 'Rich asf.',
    first_10: 'Among the first 10.',
    views_100: '100 Views', views_500: '500 Views',
    views_1000: '1,000 Views', views_10000: '10,000 Views',
  };

  // 1. Custom medals assigned by owner
  const customMedals = Array.isArray(user.medals) ? user.medals : [];
  customMedals.forEach(m => {
    const id = m.id || m;
    medals.push({ id, label: MEDAL_LABELS[id] || id });
  });

  const existingIds = medals.map(m => m.id);

  // 2. View-based medals (auto)
  const views = user.viewCount || 0;
  [
    { id: 'views_100',   threshold: 100   },
    { id: 'views_500',   threshold: 500   },
    { id: 'views_1000',  threshold: 1000  },
    { id: 'views_10000', threshold: 10000 },
  ].forEach(({ id, threshold }) => {
    if (views >= threshold && !existingIds.includes(id)) {
      medals.push({ id, label: MEDAL_LABELS[id] });
      existingIds.push(id);
    }
  });

  // 3. first_10 — cache for 10 minutes to avoid repeated Firestore queries
  if (!existingIds.includes('first_10')) {
    const now = Date.now();
    if (!_first10Cache || now - _first10CacheTime > 10 * 60 * 1000) {
      try {
        const snap = await cols.users
          .orderBy('createdAt', 'asc')
          .limit(10)
          .select('uid')
          .get();
        _first10Cache = snap.docs.map(d => d.id);
        _first10CacheTime = now;
      } catch (_) {
        _first10Cache = [];
      }
    }
    if (_first10Cache.includes(uid)) {
      medals.push({ id: 'first_10', label: MEDAL_LABELS['first_10'] });
    }
  }

  return medals;
}

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
        medals: await computeMedals(user, uid, collections),
        showMedals: user.showMedals !== false,
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
      'layoutSettings', 'lastUsernameChange', 'profileFont', 'showMedals',
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

module.exports = router;