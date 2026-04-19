const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const { collections, admin } = require('../config/firebase');
const { requireAuth } = require('../middleware/auth.middleware');
const { loginLimiter, usernameLimiter } = require('../middleware/rateLimiter.middleware');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function issueToken(res, payload) {
  const token = jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
  res.cookie('token', token, {
    httpOnly: true,
    secure: true,
    sameSite: 'None',
    domain: '.wlc.lol',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
  return token;
}

const RESERVED_USERNAMES = new Set([
  'admin', 'root', 'api', 'www', 'mail', 'support', 'help',
  'login', 'register', 'dashboard', 'settings', 'billing',
  'pricing', 'leaderboard', 'docs', 'legal', 'status',
  'wlc', 'wlclol', 'about', 'contact', 'blog',
]);

function isValidUsername(username) {
  return (
    /^[a-zA-Z0-9_]{3,20}$/.test(username) &&
    !RESERVED_USERNAMES.has(username.toLowerCase())
  );
}

// ─── VPN / Proxy check via IPHub ──────────────────────────────────────────────
// block: 0 = IP pulito, 1 = VPN/proxy, 2 = datacenter/hosting
async function isVpnOrProxy(ip) {
  try {
    const apiKey = process.env.IPHUB_API_KEY;
    if (!apiKey) return false; // chiave non configurata → non bloccare

    const res = await fetch(`https://v2.api.iphub.info/ip/${ip}`, {
      headers: { 'X-Key': apiKey },
    });

    if (!res.ok) return false; // IPHub irraggiungibile → fail-open

    const data = await res.json();
    return data.block === 1 || data.block === 2;
  } catch (err) {
    console.error('IPHub check error:', err.message);
    return false; // fail-open: se IPHub è giù non bloccare la registrazione
  }
}

// ─── POST /api/auth/register/check-username ───────────────────────────────────
router.post(
  '/register/check-username',
  usernameLimiter,
  [body('username').trim().notEmpty()],
  async (req, res) => {
    try {
      const { username } = req.body;

      if (!isValidUsername(username)) {
        return res.json({
          success: false,
          available: false,
          message: RESERVED_USERNAMES.has(username.toLowerCase())
            ? 'This username is reserved.'
            : 'Username must be 3–20 chars: letters, numbers, underscore only.',
        });
      }

      const doc = await collections.usernames.doc(username.toLowerCase()).get();
      if (doc.exists) {
        return res.json({ success: false, available: false, message: 'Username is already taken.' });
      }

      return res.json({ success: true, available: true, message: 'Username is available!' });
    } catch (err) {
      console.error('check-username error:', err.message);
      return res.status(500).json({ success: false, message: 'Server error. Please try again.' });
    }
  }
);

// ─── POST /api/auth/register ──────────────────────────────────────────────────
router.post(
  '/register',
  [
    body('username').trim().notEmpty(),
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 8 }),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, message: 'Invalid input. Check all fields.' });
      }

      const { username, email, password } = req.body;

      if (!isValidUsername(username)) {
        return res.status(400).json({ success: false, message: 'Invalid username.' });
      }

      const clientIp = req.ip;

      // ── VPN / Proxy check ─────────────────────────────────────────────────────
      if (clientIp) {
        const vpn = await isVpnOrProxy(clientIp);
        if (vpn) {
          return res.status(403).json({
            success: false,
            message: 'Registrations via VPN or proxy are not allowed. Please disable your VPN and try again.',
          });
        }
      }

      // ── IP check: max 1 account per IP ───────────────────────────────────────
      if (clientIp) {
        const ipSnap = await collections.users
          .where('registrationIp', '==', clientIp)
          .limit(1)
          .get();
        if (!ipSnap.empty) {
          return res.status(403).json({
            success: false,
            message: 'An account already exists from this network. Only one account per IP is allowed.',
          });
        }
      }

      // ── Duplicate username / email check ─────────────────────────────────────
      const [usernameSnap, emailSnap] = await Promise.all([
        collections.usernames.doc(username.toLowerCase()).get(),
        collections.users.where('email', '==', email).limit(1).get(),
      ]);

      if (usernameSnap.exists) {
        return res.status(409).json({ success: false, message: 'Username is already taken.' });
      }
      if (!emailSnap.empty) {
        return res.status(409).json({ success: false, message: 'An account with this email already exists.' });
      }

      // ── Hash password ─────────────────────────────────────────────────────────
      const passwordHash = await bcrypt.hash(password, 12);

      // ── Create user + claim username atomically ───────────────────────────────
      const uid = collections.users.doc().id;
      const now = admin.firestore.FieldValue.serverTimestamp();
      const batch = collections.users.firestore.batch();

      batch.set(collections.users.doc(uid), {
        uid,
        username,
        usernameLower: username.toLowerCase(),
        email,
        passwordHash,
        displayName: username,
        bio: '',
        avatarUrl: '',
        theme: 'dark',
        isVerified: false,
        isPro: false,
        linkCount: 0,
        viewCount: 0,
        profileFont: 'inter',
        registrationIp: clientIp || null,
        createdAt: now,
        updatedAt: now,
      });

      batch.set(collections.usernames.doc(username.toLowerCase()), {
        uid,
        username,
        claimedAt: now,
      });

      await batch.commit();

      const token = issueToken(res, { uid, username, email });

      return res.status(201).json({
        success: true,
        message: 'Account created successfully!',
        token,
        user: { uid, username, email, displayName: username },
      });
    } catch (err) {
      console.error('register error:', err.message);
      return res.status(500).json({ success: false, message: 'Registration failed. Please try again.' });
    }
  }
);

// ─── POST /api/auth/login ─────────────────────────────────────────────────────
router.post(
  '/login',
  loginLimiter,
  [
    body('email').isEmail().normalizeEmail(),
    body('password').notEmpty(),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, message: 'Invalid email or password.' });
      }

      const { email, password } = req.body;

      const userQuery = await collections.users.where('email', '==', email).limit(1).get();
      if (userQuery.empty) {
        return res.status(401).json({ success: false, message: 'Invalid email or password.' });
      }

      const user = userQuery.docs[0].data();
      const isMatch = await bcrypt.compare(password, user.passwordHash);
      if (!isMatch) {
        return res.status(401).json({ success: false, message: 'Invalid email or password.' });
      }

      await collections.users.doc(user.uid).update({
        lastLoginAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      const token = issueToken(res, { uid: user.uid, username: user.username, email: user.email });

      return res.json({
        success: true,
        message: 'Signed in successfully.',
        token,
        user: {
          uid: user.uid,
          username: user.username,
          email: user.email,
          displayName: user.displayName,
          avatarUrl: user.avatarUrl,
        },
      });
    } catch (err) {
      console.error('login error:', err.message);
      return res.status(500).json({ success: false, message: 'Login failed. Please try again.' });
    }
  }
);

// ─── POST /api/auth/logout ────────────────────────────────────────────────────
router.post('/logout', (req, res) => {
  res.clearCookie('token', {
    httpOnly: true,
    secure: true,
    sameSite: 'None',
    domain: '.wlc.lol',
  });
  return res.json({ success: true, message: 'Logged out.' });
});

// ─── GET /api/auth/me ─────────────────────────────────────────────────────────
router.get('/me', requireAuth, async (req, res) => {
  try {
    const userDoc = await collections.users.doc(req.user.uid).get();
    if (!userDoc.exists) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }
    const { passwordHash: _, ...safeUser } = userDoc.data();
    return res.json({ success: true, user: safeUser });
  } catch (err) {
    console.error('me error:', err.message);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});

module.exports = router;