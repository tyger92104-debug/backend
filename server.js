require('dotenv').config();
const express = require('express');
const dns = require("node:dns");

dns.setServers(["1.1.1.1", "8.8.8.8"]);
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { connectDB, getConnectionStatus } = require('./config/database');
const readingsRouter = require('./routes/readings');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Security middleware ─────────────────────────────────────────────────────
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

// CORS – allow the frontend origin (configure via FRONTEND_URL env var)
const allowedOrigins = (process.env.FRONTEND_URL || '*').split(',').map(s => s.trim());
app.use(cors({
  origin: allowedOrigins.includes('*') ? '*' : allowedOrigins,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-API-Key'],
}));

// Rate limiting for device submissions (tighter) and general API (looser)
const deviceLimiter = rateLimit({
  windowMs: 60 * 1000,   // 1 minute
  max: 60,               // max 1 POST/sec per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests, slow down' },
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(express.json({ limit: '10kb' }));
app.use('/api/readings', apiLimiter);
app.use('/api/readings', readingsRouter);

// ─── GET /api/device/status ──────────────────────────────────────────────────
app.get('/api/device/status', apiLimiter, async (req, res) => {
  try {
    const Reading = require('./models/Reading');
    const { deviceId } = req.query;
    const filter = deviceId ? { deviceId } : {};
    const latest = await Reading.findOne(filter).sort({ timestamp: -1 }).select('deviceId timestamp').lean();

    const OFFLINE_THRESHOLD_MS = (parseInt(process.env.OFFLINE_THRESHOLD_SECONDS, 10) || 30) * 1000;
    const isOnline = latest && (Date.now() - new Date(latest.timestamp).getTime()) < OFFLINE_THRESHOLD_MS;

    return res.json({
      success: true,
      data: {
        deviceId: latest?.deviceId || null,
        online: Boolean(isOnline),
        lastSeen: latest?.timestamp || null,
        offlineThresholdSeconds: OFFLINE_THRESHOLD_MS / 1000,
      },
    });
  } catch (err) {
    console.error('[GET /device/status]', err);
    return res.status(500).json({ success: false, error: 'Database error' });
  }
});

// ─── GET /api/health ─────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  const db = getConnectionStatus();
  const healthy = db.isConnected;
  return res.status(healthy ? 200 : 503).json({
    success: healthy,
    status: healthy ? 'ok' : 'degraded',
    db: db.stateLabel,
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

// ─── 404 handler ─────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ success: false, error: 'Route not found' });
});

// ─── Global error handler ─────────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error('[UNHANDLED]', err);
  res.status(500).json({ success: false, error: 'Internal server error' });
});

// ─── Start ────────────────────────────────────────────────────────────────────

if (process.env.VERCEL) {
  // Vercel handles the HTTP server.
  // Connect to MongoDB without calling app.listen().
  connectDB().catch((err) => {
    console.error('[SERVER] MongoDB startup failed:', err.message);
  });
} else {
  // Start a regular server when running locally.
  async function start() {
    try {
      await connectDB();
      app.listen(PORT, () => {
        console.log(`[SERVER] Urban Air Quality API running on http://localhost:${PORT}`);
        console.log(`[SERVER] Health: http://localhost:${PORT}/api/health`);
      });
    } catch (err) {
      console.error('[SERVER] Startup failed:', err.message);
      process.exit(1);
    }
  }

  start();
}

module.exports = app;
