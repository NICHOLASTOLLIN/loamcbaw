const express  = require('express');
const router   = express.Router();
const bcrypt   = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const { collections, admin } = require('../config/firebase');
const { requireAuth } = require('../middleware/auth.middleware');
const support = require('../controllers/support.controller');
const notifs  = require('../controllers/notifications.controller');

// ─── Middleware: require admin or owner ───────────────────────────────────────
async function requireAdmin(req, res, next) {
  try {
    const userDoc = await collections.users.doc(req.user.uid).get();
    if (!userDoc.exists) return res.status(403).json({ success: false, message: 'Forbidden.' });
    const role = userDoc.data().role;
    if (role !== 'admin' && role !== 'owner') {
      return res.status(403).json({ success: false, message: 'Admin access required.' });
    }
    req.adminRole = role;
    next();
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
}

// ─── Middleware: require owner only ──────────────────────────────────────────
function requireOwner(req, res, next) {
  if (req.adminRole !== 'owner') {
    return res.status(403).json({ success: false, message: 'Owner access required.' });
  }
  next();
}

// ─── GET /api/admin/stats ─────────────────────────────────────────────────────
router.get('/stats', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [usersSnap, linksSnap] = await Promise.all([
      collections.users.count().get(),
      collections.links.count().get(),
    ]);

    const viewsSnap = await collections.users.select('viewCount').get();
    let totalViews = 0;
    viewsSnap.forEach(doc => { totalViews += doc.data().viewCount || 0; });

    const proSnap  = await collections.users.where('isPro',  '==', true).count().get();
    const verSnap  = await collections.users.where('isVerified', '==', true).count().get();

    return res.json({
      success: true,
      stats: {
        totalUsers:    usersSnap.data().count,
        totalLinks:    linksSnap.data().count,
        totalViews,
        proUsers:      proSnap.data().count,
        verifiedUsers: verSnap.data().count,
      },
    });
  } catch (err) {
    console.error('admin stats error:', err.message);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ─── GET /api/admin/users ─────────────────────────────────────────────────────
router.get('/users', requireAuth, requireAdmin, async (req, res) => {
  try {
    const limit  = Math.min(parseInt(req.query.limit) || 50, 200);
    const search = req.query.search || '';

    const snap = await collections.users.orderBy('createdAt', 'desc').limit(limit).get();

    let users = snap.docs.map(doc => {
      const d = doc.data();
      return {
        uid:          d.uid,
        username:     d.username,
        email:        d.email,
        displayName:  d.displayName,
        avatarUrl:    d.avatarUrl || '',
        isVerified:   d.isVerified,
        isPro:        d.isPro,
        role:         d.role || 'user',
        viewCount:    d.viewCount || 0,
        linkCount:    d.linkCount || 0,
        badges:       d.badges || [],
        activeBadges: d.activeBadges || [],
        createdAt:    d.createdAt,
        lastLoginAt:  d.lastLoginAt || null,
      };
    });

    if (search) {
      const s = search.toLowerCase();
      users = users.filter(u =>
        u.username.toLowerCase().includes(s) ||
        u.email.toLowerCase().includes(s) ||
        (u.displayName || '').toLowerCase().includes(s)
      );
    }

    return res.json({ success: true, users });
  } catch (err) {
    console.error('admin users error:', err.message);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ─── GET /api/admin/users/:uid ────────────────────────────────────────────────
router.get('/users/:uid', requireAuth, requireAdmin, async (req, res) => {
  try {
    const doc = await collections.users.doc(req.params.uid).get();
    if (!doc.exists) return res.status(404).json({ success: false, message: 'User not found.' });
    const { passwordHash: _, ...safe } = doc.data();
    return res.json({ success: true, user: safe });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ─── PUT /api/admin/users/:uid ────────────────────────────────────────────────
router.put('/users/:uid', requireAuth, requireAdmin, async (req, res) => {
  try {
    const targetDoc = await collections.users.doc(req.params.uid).get();
    if (!targetDoc.exists) return res.status(404).json({ success: false, message: 'User not found.' });
    const target = targetDoc.data();

    if ((target.role === 'admin' || target.role === 'owner') && req.adminRole !== 'owner') {
      return res.status(403).json({ success: false, message: 'Only owner can edit admin accounts.' });
    }

    const VALID_BADGES = ['booster','bug hunter','creator','famous','friend','gifter','og','owner','premium','staff','verified'];
    const updates = {};

    if (req.body.username !== undefined) {
      const newU = req.body.username.toLowerCase().trim();
      if (!/^[a-zA-Z0-9_]{3,20}$/.test(newU)) {
        return res.status(400).json({ success: false, message: 'Invalid username.' });
      }
      if (newU !== target.usernameLower) {
        const existing = await collections.usernames.doc(newU).get();
        if (existing.exists && existing.data().uid !== req.params.uid) {
          return res.status(409).json({ success: false, message: 'Username already taken.' });
        }
        const batch = collections.users.firestore.batch();
        batch.set(collections.usernames.doc(newU), { uid: req.params.uid, username: newU, claimedAt: admin.firestore.FieldValue.serverTimestamp() });
        if (target.usernameLower && target.usernameLower !== newU) {
          batch.delete(collections.usernames.doc(target.usernameLower));
        }
        await batch.commit();
        updates.username      = newU;
        updates.usernameLower = newU;
      }
    }

    if (req.body.viewCount !== undefined) {
      const v = parseInt(req.body.viewCount);
      if (!isNaN(v) && v >= 0) updates.viewCount = v;
    }

    if (req.body.newPassword !== undefined && req.body.newPassword.length >= 8) {
      updates.passwordHash = await bcrypt.hash(req.body.newPassword, 12);
    }

    if (req.body.isPro      !== undefined) updates.isPro      = Boolean(req.body.isPro);
    if (req.body.isVerified !== undefined) updates.isVerified = Boolean(req.body.isVerified);

    if (req.body.role !== undefined && req.adminRole === 'owner') {
      const validRoles = ['user', 'admin', 'owner'];
      if (validRoles.includes(req.body.role)) updates.role = req.body.role;
    }

    if (req.body.badges !== undefined && Array.isArray(req.body.badges)) {
      updates.badges = req.body.badges.filter(b => VALID_BADGES.includes(b));
      const currentActive = target.activeBadges || [];
      updates.activeBadges = currentActive.filter(b => updates.badges.includes(b));
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ success: false, message: 'No valid fields to update.' });
    }

    updates.updatedAt = admin.firestore.FieldValue.serverTimestamp();
    await collections.users.doc(req.params.uid).update(updates);

    return res.json({ success: true, message: 'User updated successfully.', updates });
  } catch (err) {
    console.error('admin edit user error:', err.message);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ─── DELETE /api/admin/users/:uid ─────────────────────────────────────────────
router.delete('/users/:uid', requireAuth, requireAdmin, async (req, res) => {
  try {
    if (req.adminRole !== 'owner') {
      return res.status(403).json({ success: false, message: 'Only owner can delete accounts.' });
    }
    if (req.params.uid === req.user.uid) {
      return res.status(400).json({ success: false, message: 'Cannot delete your own account.' });
    }

    const doc = await collections.users.doc(req.params.uid).get();
    if (!doc.exists) return res.status(404).json({ success: false, message: 'User not found.' });
    const userData = doc.data();

    const batch = collections.users.firestore.batch();
    batch.delete(collections.users.doc(req.params.uid));
    if (userData.usernameLower) batch.delete(collections.usernames.doc(userData.usernameLower));

    const linksSnap = await collections.links.where('uid', '==', req.params.uid).get();
    linksSnap.forEach(d => batch.delete(d.ref));

    await batch.commit();
    return res.json({ success: true, message: 'Account deleted.' });
  } catch (err) {
    console.error('admin delete user error:', err.message);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ─── Support tickets ──────────────────────────────────────────────────────────
router.get   ('/tickets',            requireAuth, requireAdmin, support.adminListTickets);
router.get   ('/tickets/:id',        requireAuth, requireAdmin, support.adminGetTicket);
router.put   ('/tickets/:id/status', requireAuth, requireAdmin, support.adminSetStatus);
router.post  ('/tickets/:id/reply',  requireAuth, requireAdmin, support.adminReply);

// ─── Notifications (owner only) ───────────────────────────────────────────────
router.get   ('/notifications',      requireAuth, requireAdmin, requireOwner, notifs.adminList);
router.post  ('/notifications',      requireAuth, requireAdmin, requireOwner, notifs.adminCreate);
router.delete('/notifications/:id',  requireAuth, requireAdmin, requireOwner, notifs.adminDelete);

module.exports = router;