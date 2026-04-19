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

/* ── Security ───────────────────────────────────────────── */
app.use(helmet());

/* ── CORS ───────────────────────────────────────────────── */
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

/* ── Parsers ───────────────────────────────────────────── */
app.use(express.json({ limit: '16kb' }));
app.use(express.urlencoded({ extended: true, limit: '16kb' }));
app.use(cookieParser());

/* ── Health check ───────────────────────────────────────── */
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    status: 'online',
    ts: new Date().toISOString()
  });
});

/* ── Public stats ───────────────────────────────────────── */
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
      users: usersSnap.data().count,
      views: totalViews
    });

  } catch (err) {
    return res.json({
      success: false,
      users: 0,
      views: 0
    });
  }
});

/* ── API routes ─────────────────────────────────────────── */
app.use('/api', apiLimiter);

app.use('/api/auth',          authRoutes);
app.use('/api/profile',       profileRoutes);
app.use('/api/links',         linksRoutes);
app.use('/api/admin',         adminRoutes);
app.use('/api/support',       supportRoutes);
app.use('/api',               notificationsRoutes);

/* ── 404 JSON fallback ──────────────────────────────────── */
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Endpoint not found'
  });
});

/* ── Error handler ──────────────────────────────────────── */
app.use((err, req, res, _next) => {
  console.error('Unhandled error:', err);

  res.status(500).json({
    success: false,
    message: process.env.NODE_ENV === 'production'
      ? 'Internal server error'
      : err.message,
  });
});

/* ── Process errors ─────────────────────────────────────── */
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Promise Rejection:', reason);
});

/* ── Start server ───────────────────────────────────────── */
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`\n🔥 Backend API running → http://localhost:${PORT}\n`);
});