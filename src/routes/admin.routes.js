'use strict';

const express  = require('express');
const router   = express.Router();
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const { collections, admin } = require('../config/firebase');
const { FieldValue } = require('firebase-admin/firestore');
const { requireAuth } = require('../middleware/auth.middleware');
const support = require('../controllers/support.controller');
const notifs  = require('../controllers/notifications.controller');

// ─── Middleware: require admin or owner ───────────────────────────────────────
async function requireAdmin(req, res, next) {
  try {
    const userDoc = await collections.users.doc(req.user.uid).get();
    if (!userDoc.exists) return res.status(403).json({ success: false, message: 'Forbidden.' });
    const role = userDoc.data().role;
    if (role !== 'admin' && role !== 'owner' && role !== 'staffer') {
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

// ─── Helper: check granular permission for non-owners ─────────────────────────
async function checkPermission(adminUid, adminRole, permId) {
  if (adminRole === 'owner') return true;
  try {
    const doc = await collections.adminPermissions.doc(adminUid).get();
    if (!doc.exists) return false;
    return !!doc.data()[permId];
  } catch {
    return false;
  }
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

    const proSnap = await collections.users.where('isPro', '==', true).count().get();
    const verSnap = await collections.users.where('isVerified', '==', true).count().get();

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

    const canSeeEmail = await checkPermission(req.user.uid, req.adminRole, 'see_email');
    const canSeeIp    = await checkPermission(req.user.uid, req.adminRole, 'see_ip');

    let users = snap.docs.map(doc => {
      const d = doc.data();
      return {
        uid:            d.uid,
        username:       d.username,
        email:          canSeeEmail ? d.email : undefined,
        displayName:    d.displayName,
        avatarUrl:      d.avatarUrl || '',
        isVerified:     d.isVerified,
        isPro:          d.isPro,
        role:           d.role || 'user',
        viewCount:      d.viewCount || 0,
        linkCount:      d.linkCount || 0,
        badges:         d.badges || [],
        activeBadges:   d.activeBadges || [],
        createdAt:      d.createdAt,
        lastLoginAt:    d.lastLoginAt || null,
        registrationIp: canSeeIp ? (d.registrationIp || null) : undefined,
      };
    });

    if (search) {
      const s = search.toLowerCase();
      users = users.filter(u =>
        u.username.toLowerCase().includes(s) ||
        (u.email || '').toLowerCase().includes(s) ||
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
        batch.set(collections.usernames.doc(newU), {
          uid: req.params.uid,
          username: newU,
          claimedAt: FieldValue.serverTimestamp(),
        });
        if (target.usernameLower && target.usernameLower !== newU) {
          batch.delete(collections.usernames.doc(target.usernameLower));
        }
        await batch.commit();
        updates.username      = newU;
        updates.usernameLower = newU;
      }
    }

    // ── Email change (requires change_email permission) ───────────────────────
    if (req.body.email !== undefined) {
      const canChangeEmail = await checkPermission(req.user.uid, req.adminRole, 'change_email');
      if (!canChangeEmail) {
        return res.status(403).json({ success: false, message: 'You do not have permission to change emails.' });
      }
      const newEmail = req.body.email.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
        return res.status(400).json({ success: false, message: 'Invalid email address.' });
      }
      // Check email not already taken by someone else
      const emailSnap = await collections.users.where('email', '==', newEmail).limit(1).get();
      if (!emailSnap.empty && emailSnap.docs[0].id !== req.params.uid) {
        return res.status(409).json({ success: false, message: 'Email already in use by another account.' });
      }
      updates.email = newEmail;
    }

    if (req.body.viewCount !== undefined) {
      const v = parseInt(req.body.viewCount);
      if (!isNaN(v) && v >= 0) updates.viewCount = v;
    }

    // ── Password change (requires change_password permission) ─────────────────
    if (req.body.newPassword !== undefined && req.body.newPassword.length >= 8) {
      const canChangePw = await checkPermission(req.user.uid, req.adminRole, 'change_password');
      if (!canChangePw) {
        return res.status(403).json({ success: false, message: 'You do not have permission to change passwords.' });
      }
      updates.passwordHash = await bcrypt.hash(req.body.newPassword, 12);
    }

    if (req.body.isPro      !== undefined) updates.isPro      = Boolean(req.body.isPro);
    if (req.body.isVerified !== undefined) updates.isVerified = Boolean(req.body.isVerified);

    if (req.body.role !== undefined && req.adminRole === 'owner') {
      const validRoles = ['user', 'admin', 'owner', 'staffer'];
      if (validRoles.includes(req.body.role)) updates.role = req.body.role;
    }

    if (req.body.badges !== undefined && Array.isArray(req.body.badges)) {
      updates.badges = req.body.badges.filter(b => VALID_BADGES.includes(b));
      const currentActive = target.activeBadges || [];
      updates.activeBadges = currentActive.filter(b => updates.badges.includes(b));
    }

    // ── Medals management (owner only) ───────────────────────────────────────
    const CUSTOM_MEDALS = ['noticed','known','contributor','egirl','eboy','rich','first_10'];
    if (req.body.medals !== undefined && req.adminRole === 'owner') {
      if (!Array.isArray(req.body.medals)) {
        return res.status(400).json({ success: false, message: 'medals must be an array.' });
      }
      const validMedals = req.body.medals.filter(m => {
        const id = typeof m === 'string' ? m : m.id;
        return CUSTOM_MEDALS.includes(id);
      }).map(m => {
        const id = typeof m === 'string' ? m : m.id;
        const MEDAL_LABELS = {
          noticed:'Noticed by owners.', known:'Known.', contributor:'Contributor.',
          egirl:'Gorgeus egirl.', eboy:'Gorgeus eboy.', rich:'Rich asf.', first_10:'Among the first 10.'
        };
        return { id, label: MEDAL_LABELS[id] || id };
      });
      updates.medals = validMedals;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ success: false, message: 'No valid fields to update.' });
    }

    updates.updatedAt = FieldValue.serverTimestamp();
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
    const canDelete = await checkPermission(req.user.uid, req.adminRole, 'delete_account');
    if (!canDelete) {
      return res.status(403).json({ success: false, message: 'You do not have permission to delete accounts.' });
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

// ─── PERMISSIONS (owner only) ─────────────────────────────────────────────────
// Collection: adminPermissions / {uid} → { permId: bool, ... }

/**
 * GET /api/admin/permissions
 * Returns all permissions for all staff users as an object: { uid: { permId: bool } }
 */
router.get('/permissions', requireAuth, requireAdmin, requireOwner, async (req, res) => {
  try {
    const snap = await collections.adminPermissions.get();
    const permissions = {};
    snap.forEach(doc => {
      permissions[doc.id] = doc.data();
    });
    return res.json({ success: true, permissions });
  } catch (err) {
    console.error('admin permissions GET error:', err.message);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});

/**
 * PUT /api/admin/permissions/:uid
 * Body: { permId: string, value: boolean }
 * Sets a single permission toggle for a given user.
 */
router.put('/permissions/:uid', requireAuth, requireAdmin, requireOwner, async (req, res) => {
  try {
    const { permId, value } = req.body;

    const VALID_PERMS = [
      'give_badges', 'delete_account', 'change_password',
      'see_email', 'see_ip', 'change_email',
      'direct_login', 'send_notifications',
    ];

    if (!permId || !VALID_PERMS.includes(permId)) {
      return res.status(400).json({ success: false, message: `Invalid permission id: ${permId}` });
    }
    if (typeof value !== 'boolean') {
      return res.status(400).json({ success: false, message: 'value must be a boolean.' });
    }

    // Make sure target user is a real staff account
    const targetDoc = await collections.users.doc(req.params.uid).get();
    if (!targetDoc.exists) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }
    const targetRole = targetDoc.data().role;
    if (!['admin', 'staffer'].includes(targetRole)) {
      return res.status(400).json({ success: false, message: 'Permissions can only be set for admin/staffer accounts.' });
    }

    const permRef = collections.adminPermissions.doc(req.params.uid);
    await permRef.set({ [permId]: value }, { merge: true });

    return res.json({ success: true, permId, value });
  } catch (err) {
    console.error('admin permissions PUT error:', err.message);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ─── REQUESTS — login & register audit log (admin + owner) ───────────────────
// Collection: authLogs / auto-id → { type, email, success, reason, ip, createdAt }
// NOTE: you must write to this collection from auth.routes.js (see below)

/**
 * GET /api/admin/requests
 * Returns up to 500 recent login/register attempts, newest first.
 * Query params: ?type=login|register  ?status=success|fail  ?limit=N
 */
router.get('/requests', requireAuth, requireAdmin, async (req, res) => {
  try {
    const limitN = Math.min(parseInt(req.query.limit) || 200, 500);

    let query = collections.authLogs.orderBy('createdAt', 'desc').limit(limitN);

    // Optional server-side filter by type
    if (req.query.type && ['login', 'register'].includes(req.query.type)) {
      query = collections.authLogs
        .where('type', '==', req.query.type)
        .orderBy('createdAt', 'desc')
        .limit(limitN);
    }

    const snap = await query.get();

    const canSeeIp = await checkPermission(req.user.uid, req.adminRole, 'see_ip');

    const requests = snap.docs.map(doc => {
      const d = doc.data();
      return {
        id:        doc.id,
        type:      d.type      || 'login',
        email:     d.email     || d.username || null,
        username:  d.username  || null,
        success:   d.success   ?? false,
        status:    d.success ? 'success' : 'fail',
        reason:    d.reason    || null,
        ip:        canSeeIp ? (d.ip || null) : null,
        createdAt: d.createdAt || null,
      };
    });

    return res.json({ success: true, requests });
  } catch (err) {
    console.error('admin requests GET error:', err.message);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ─── DIRECT LOGIN (owner only) ────────────────────────────────────────────────
/**
 * POST /api/admin/login-as/:uid
 * Issues a short-lived JWT for the target user and sets it as a cookie,
 * so the owner gets redirected to /dashboard as that user.
 */
router.post('/login-as/:uid', requireAuth, requireAdmin, requireOwner, async (req, res) => {
  try {
    // Extra safety: owner cannot login-as themselves
    if (req.params.uid === req.user.uid) {
      return res.status(400).json({ success: false, message: 'Cannot login as yourself.' });
    }

    const targetDoc = await collections.users.doc(req.params.uid).get();
    if (!targetDoc.exists) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }
    const target = targetDoc.data();

    // Issue a token for the target user (1 hour, short-lived)
    const token = jwt.sign(
      { uid: target.uid, username: target.username, email: target.email },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    res.cookie('token', token, {
      httpOnly: true,
      secure:   true,
      sameSite: 'None',
      domain:   '.wlc.lol',
      maxAge:   60 * 60 * 1000, // 1 hour
    });

    // Log the impersonation
    console.warn(`[ADMIN] Owner ${req.user.uid} logged in as ${target.uid} (${target.username})`);

    return res.json({
      success: true,
      message: `Logged in as @${target.username}`,
      user: { uid: target.uid, username: target.username },
    });
  } catch (err) {
    console.error('admin login-as error:', err.message);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});

module.exports = router;