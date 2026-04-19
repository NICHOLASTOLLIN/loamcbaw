require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const path = require('path');

const { apiLimiter } = require('./middleware/rateLimiter.middleware');
const authRoutes          = require('./routes/auth.routes');
const profileRoutes       = require('./routes/profile.routes');
const linksRoutes         = require('./routes/links.routes');
const adminRoutes         = require('./routes/admin.routes');
const supportRoutes       = require('./routes/support.routes');
const notificationsRoutes = require('./routes/notifications.routes');

const app = express();

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:    ["'self'"],
      scriptSrc:     ["'self'", "'unsafe-inline'", 'fonts.googleapis.com'],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc:      ["'self'", "'unsafe-inline'", 'fonts.googleapis.com', 'fonts.gstatic.com'],
      fontSrc:       ["'self'", 'fonts.gstatic.com', 'fonts.googleapis.com'],
      imgSrc:        ["'self'", 'data:', 'i.imgur.com', '*'],
      mediaSrc:      ["'self'", '*'],
      connectSrc:    ["'self'", '*'],
    },
  },
}));

app.use(cors({
  origin: function(origin, callback) {
    if (!origin) return callback(null, true);
    const allowed = [
      process.env.FRONTEND_URL || 'http://localhost:3000',
      'http://localhost:3000',
      'http://127.0.0.1:3000',
    ];
    if (allowed.includes(origin) || process.env.NODE_ENV !== 'production') {
      return callback(null, true);
    }
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));

app.use(express.json({ limit: '16kb' }));
app.use(express.urlencoded({ extended: true, limit: '16kb' }));
app.use(cookieParser());

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
app.use(express.static(PUBLIC_DIR));

// ── Health check (prima del rate limiter) ────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ success: true, status: 'online', ts: new Date().toISOString() });
});

// ── Public stats (prima del rate limiter) ─────────────────────────────────────
app.get('/api/stats/public', async (req, res) => {
  try {
    const { collections } = require('./config/firebase');
    const usersSnap = await collections.users.count().get();
    const viewsSnap = await collections.users.select('viewCount').get();
    let totalViews = 0;
    viewsSnap.forEach(doc => { totalViews += doc.data().viewCount || 0; });
    return res.json({ success: true, users: usersSnap.data().count, views: totalViews });
  } catch (err) {
    return res.json({ success: false, users: 0, views: 0 });
  }
});

// ── API routes ────────────────────────────────────────────────────────────────
app.use('/api', apiLimiter);
app.use('/api/auth',          authRoutes);
app.use('/api/profile',       profileRoutes);
app.use('/api/links',         linksRoutes);
app.use('/api/admin',         adminRoutes);
app.use('/api/support',       supportRoutes);
app.use('/api',               notificationsRoutes);   // → /api/notifications

// ── Static pages ──────────────────────────────────────────────────────────────
app.get('/',          (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));
app.get('/login',     (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'login.html')));
app.get('/register',  (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'register.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'dashboard.html')));
app.get('/admin',     (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin.html')));
app.get('/support',   (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'support.html')));

// ── User profile pages: /:username ───────────────────────────────────────────
const RESERVED = new Set([
  'login','register','dashboard','api','pricing','leaderboard','docs','legal',
  'status','settings','admin','root','www','mail','support','help',
]);
app.get('/:username', (req, res, next) => {
  const username = req.params.username;
  if (RESERVED.has(username.toLowerCase()) || username.includes('.')) return next();
  res.sendFile(path.join(PUBLIC_DIR, 'profile.html'));
});

// ── 404 handler ───────────────────────────────────────────────────────────────
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ success: false, message: 'Endpoint not found.' });
  }
  res.status(404).sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// ── Global error handler ──────────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    success: false,
    message: process.env.NODE_ENV === 'production' ? 'An unexpected error occurred.' : err.message,
  });
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Promise Rejection:', reason?.message || reason);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🔥 wlc.lol backend running → http://localhost:${PORT}\n`);
});