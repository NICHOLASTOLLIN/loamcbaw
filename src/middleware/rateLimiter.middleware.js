const rateLimit = require('express-rate-limit');

// Generic API limiter — 100 req / 15 min per IP
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests. Please wait a moment.' },
});

// Login attempts — 10 per 15 min per IP (prevents brute force)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many login attempts. Try again in 15 minutes.' },
});

// OTP send — 3 per hour per IP (prevents email spam)
const otpLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many code requests. Wait 1 hour.' },
});

// Username check — 20 per minute (autocomplete-friendly)
const usernameLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests.' },
});

module.exports = { apiLimiter, loginLimiter, otpLimiter, usernameLimiter };
