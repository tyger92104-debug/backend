const express = require('express');
const router = express.Router();
const Reading = require('../models/Reading');
const deviceAuth = require('../middleware/auth');

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Safely parse a numeric value; returns null if not a finite number. */
function safeNum(value, min, max) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!isFinite(n)) return null;
  if (min !== undefined && n < min) return null;
  if (max !== undefined && n > max) return null;
  return n;
}

/** Map ESP32 JSON keys → database field names. */
function mapPayload(body) {
  return {
    deviceId: body.deviceId || body.device_id || 'esp32-default',
    pm1:        safeNum(body.pm1,   0, 1000),
    pm25:       safeNum(body.pm25,  0, 1000),
    pm10:       safeNum(body.pm10,  0, 1000),
    temperature: safeNum(body.temp !== undefined ? body.temp : body.temperature, -40, 85),
    humidity:   safeNum(body.rh   !== undefined ? body.rh   : body.humidity,    0, 100),
    latitude:   safeNum(body.lat  !== undefined ? body.lat  : body.latitude,   -90, 90),
    longitude:  safeNum(body.lng  !== undefined ? body.lng  : body.longitude, -180, 180),
    satellites: safeNum(body.sats !== undefined ? body.sats : body.satellites,  0, 50),
    accuracy:   safeNum(body.acc  !== undefined ? body.acc  : body.accuracy,    0),
    gpsFix:     Boolean(body.gpsFix || body.gps_fix),
  };
}

// ─── POST /api/readings ──────────────────────────────────────────────────────
/**
 * Accept readings from the ESP32.
 * Requires X-API-Key header.
 * Body: { deviceId, pm1, pm25, pm10, temp, rh, lat, lng, sats, acc, ... }
 */
router.post('/', deviceAuth, async (req, res) => {
  try {
    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({ success: false, error: 'Request body must be JSON' });
    }

    const data = mapPayload(req.body);

    // Require at least one sensor value to be present
    const hasSensorData =
      data.pm1 != null ||
      data.pm25 != null ||
      data.pm10 != null ||
      data.temperature != null ||
      data.humidity != null;

    if (!hasSensorData) {
      return res.status(422).json({
        success: false,
        error: 'Payload must contain at least one valid sensor reading',
      });
    }

    const reading = new Reading(data);
    const saved = await reading.save();

    return res.status(201).json({
      success: true,
      id: saved._id,
      timestamp: saved.timestamp,
    });
  } catch (err) {
    if (err.name === 'ValidationError') {
      return res.status(422).json({ success: false, error: err.message });
    }
    console.error('[POST /readings]', err);
    return res.status(500).json({ success: false, error: 'Database error' });
  }
});

// ─── GET /api/readings/latest ────────────────────────────────────────────────
router.get('/latest', async (req, res) => {
  try {
    const { deviceId } = req.query;
    const filter = deviceId ? { deviceId } : {};

    const reading = await Reading.findOne(filter).sort({ timestamp: -1 }).lean({ virtuals: true });

    if (!reading) {
      return res.status(404).json({ success: false, error: 'No readings found' });
    }

    return res.json({ success: true, data: reading });
  } catch (err) {
    console.error('[GET /readings/latest]', err);
    return res.status(500).json({ success: false, error: 'Database error' });
  }
});

// ─── GET /api/readings/history ───────────────────────────────────────────────
/**
 * Query params:
 *   range   - '1h' | '24h' | '7d' (default: '24h')
 *   deviceId - optional filter
 *   page    - page number (default: 1)
 *   limit   - results per page (default: 100, max: 500)
 */
router.get('/history', async (req, res) => {
  try {
    const { range = '24h', deviceId, page = 1, limit = 100 } = req.query;

    const rangeMap = { '1h': 1, '24h': 24, '7d': 24 * 7 };
    const hours = rangeMap[range] || 24;
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    const filter = { timestamp: { $gte: since } };
    if (deviceId) filter.deviceId = deviceId;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(500, Math.max(1, parseInt(limit, 10) || 100));
    const skip = (pageNum - 1) * limitNum;

    const [total, readings] = await Promise.all([
      Reading.countDocuments(filter),
      Reading.find(filter)
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean({ virtuals: true }),
    ]);

    return res.json({
      success: true,
      data: readings,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        pages: Math.ceil(total / limitNum),
      },
      range,
      since,
    });
  } catch (err) {
    console.error('[GET /readings/history]', err);
    return res.status(500).json({ success: false, error: 'Database error' });
  }
});

router.mapPayload = mapPayload;
module.exports = router;
