const jwt = require('jsonwebtoken');
const { collections } = require('../config/firebase');

/**
 * Verifies the JWT access token from the Authorization header or cookie.
 * Attaches req.user = { uid, username, email } on success.
 */
async function requireAuth(req, res, next) {
  try {
    // Support both Bearer token and httpOnly cookie
    let token =
      req.cookies?.token ||
      (req.headers.authorization?.startsWith('Bearer ')
        ? req.headers.authorization.slice(7)
        : null);

    if (!token) {
      return res.status(401).json({ success: false, message: 'Not authenticated' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Quick existence check — deleted accounts can't use old tokens
    const userDoc = await collections.users.doc(decoded.uid).get();
    if (!userDoc.exists) {
      return res.status(401).json({ success: false, message: 'Account not found' });
    }

    req.user = { uid: decoded.uid, username: decoded.username, email: decoded.email };
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, message: 'Session expired. Please sign in again.' });
    }
    return res.status(401).json({ success: false, message: 'Invalid token' });
  }
}

/**
 * Optional auth — attaches req.user if token is valid, but doesn't block if missing.
 * Useful for public profile pages that show extra info when logged in.
 */
async function optionalAuth(req, res, next) {
  try {
    const token =
      req.cookies?.token ||
      (req.headers.authorization?.startsWith('Bearer ')
        ? req.headers.authorization.slice(7)
        : null);

    if (token) {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = { uid: decoded.uid, username: decoded.username, email: decoded.email };
    }
  } catch (_) {
    // silently ignore — user is just not authenticated
  }
  next();
}

module.exports = { requireAuth, optionalAuth };
