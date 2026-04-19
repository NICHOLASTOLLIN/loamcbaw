require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');

const { apiLimiter } = require('./middleware/rateLimiter.middleware');

const authRoutes          = require('./routes/auth.routes');
const profileRoutes       = require('./routes/profile.routes');
const linksRoutes         = require('./routes/links.routes');
const adminRoutes         = require('./routes/admin.routes');
const supportRoutes       = require('./routes/support.routes');
const notificationsRoutes = require('./routes/notifications.routes');

const app = express();

/* ─────────────────────────────
   RENDER FIX
───────────────────────────── */
app.set('trust proxy', 1);

/* ─────────────────────────────
   SECURITY
───────────────────────────── */
app.use(helmet());

/* ─────────────────────────────
   CORS (ROBUST VERSION)
───────────────────────────── */
const allowedOrigins = [
  'https://wlc.lol',
  'https://www.wlc.lol',
  'http://localhost:3000',
  'http://127.0.0.1:3000'
];

app.use(cors({
  origin: function (origin, callback) {
    // allow server-to-server / curl / mobile apps
    if (!origin) return callback(null, true);

    // strict + fallback safe for Render / redirects
    if (
      allowedOrigins.includes(origin) ||
      origin.endsWith('wlc.lol')
    ) {
      return callback(null, true);
    }

    // fallback (non blocca tutto anche se origin strano)
    return callback(null, true);
  },
  credentials: true
}));

/* ─────────────────────────────
   BODY PARSERS
───────────────────────────── */
app.use(express.json({ limit: '16kb' }));
app.use(express.urlencoded({ extended: true, limit: '16kb' }));
app.use(cookieParser());

/* ─────────────────────────────
   RATE LIMITER
───────────────────────────── */
app.use('/api', apiLimiter);

/* ─────────────────────────────
   HEALTH CHECK
───────────────────────────── */
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    status: 'online',
    ts: new Date().toISOString()
  });
});

/* ─────────────────────────────
   PUBLIC STATS
───────────────────────────── */
app.get('/api/stats/public', async (req, res) => {
  try {
    const { collections } = require('./config/firebase');

    const usersSnap = await collections.users.count().get();
    const viewsSnap = await collections.users.select('viewCount').get();

    let totalViews = 0;

    viewsSnap.forEach(doc => {
      totalViews += doc.data().viewCount || 0;
    });

    return res.json({
      success: true,
      users: usersSnap.data()?.count || 0,
      views: totalViews || 0
    });

  } catch (err) {
    console.error('Stats error:', err);

    // IMPORTANT: never break CORS on error
    return res.status(200).json({
      success: false,
      users: 0,
      views: 0
    });
  }
});

/* ─────────────────────────────
   API ROUTES
───────────────────────────── */
app.use('/api/auth', authRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/links', linksRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/support', supportRoutes);
app.use('/api', notificationsRoutes);

/* ─────────────────────────────
   404 HANDLER (API ONLY)
───────────────────────────── */
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({
      success: false,
      message: 'API endpoint not found'
    });
  }

  return res.status(404).json({
    success: false,
    message: 'Not found'
  });
});

/* ─────────────────────────────
   GLOBAL ERROR HANDLER
───────────────────────────── */
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);

  res.status(500).json({
    success: false,
    message: process.env.NODE_ENV === 'production'
      ? 'Internal server error'
      : err.message
  });
});

/* ─────────────────────────────
   START SERVER
───────────────────────────── */
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🔥 Backend API running → port ${PORT}`);
});