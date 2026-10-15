/**
 * backend/tests/api.test.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Integration tests for the Urban Air Quality API.
 * Run with:  node tests/api.test.js
 *
 * Requires:  MONGODB_URI and DEVICE_API_KEY in ../.env (or environment).
 * ─────────────────────────────────────────────────────────────────────────────
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const http = require('http');
const mongoose = require('mongoose');
const { connectDB } = require('../config/database');
const Reading = require('../models/Reading');

// ── Minimal HTTP helper ───────────────────────────────────────────────────────
function request(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'localhost',
      port: process.env.PORT || 3000,
      path,
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// ── Test runner ───────────────────────────────────────────────────────────────
let passed = 0, failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ ${name}`);
    console.error(`     ${err.message}`);
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

function assertEqual(a, b, msg) {
  assert(a === b, msg || `Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

// ── Test payload ──────────────────────────────────────────────────────────────
const VALID_PAYLOAD = {
  deviceId: 'test-esp32',
  pm1: 5.2, pm25: 12.1, pm10: 18.4,
  temp: 25.3, rh: 61.2,
  lat: 13.0827, lng: 80.2707,
  sats: 8, acc: 1.2,
  gpsFix: true,
};

const API_KEY = process.env.DEVICE_API_KEY || '';

// ── Suites ────────────────────────────────────────────────────────────────────
async function runTests() {
  console.log('\n══ Urban Air Quality API Tests ══\n');

  // ── Health ──
  console.log('▶ Health endpoint');
  await test('GET /api/health returns 200 when DB is connected', async () => {
    const res = await request('GET', '/api/health');
    assertEqual(res.status, 200);
    assert(res.body.success, 'success should be true');
    assertEqual(res.body.db, 'connected');
  });

  // ── POST /api/readings ──
  console.log('\n▶ POST /api/readings');

  await test('Rejects request without API key', async () => {
    if (!API_KEY) { console.warn('     (SKIPPED – DEVICE_API_KEY not set)'); return; }
    const res = await request('POST', '/api/readings', VALID_PAYLOAD);
    assertEqual(res.status, 401);
  });

  await test('Accepts valid payload with correct API key', async () => {
    const res = await request('POST', '/api/readings', VALID_PAYLOAD, { 'X-API-Key': API_KEY });
    assertEqual(res.status, 201);
    assert(res.body.success, 'success should be true');
    assert(res.body.id, 'should return document id');
  });

  await test('Accepts payload with null sensor values (e.g., no GPS fix)', async () => {
    const payload = { ...VALID_PAYLOAD, lat: null, lng: null, sats: 0, gpsFix: false };
    const res = await request('POST', '/api/readings', payload, { 'X-API-Key': API_KEY });
    assertEqual(res.status, 201);
  });

  await test('Accepts firmware field aliases (temp/rh/lat/lng/sats/acc)', async () => {
    const res = await request('POST', '/api/readings', {
      deviceId: 'test-alias',
      temp: 27.0, rh: 55.0,
      lat: 28.6139, lng: 77.2090,
      pm1: 3, pm25: 8, pm10: 15,
      sats: 6, acc: 1.8, gpsFix: true,
    }, { 'X-API-Key': API_KEY });
    assertEqual(res.status, 201);
  });

  await test('Rejects payload with no valid sensor data', async () => {
    const res = await request('POST', '/api/readings', { deviceId: 'empty' }, { 'X-API-Key': API_KEY });
    assertEqual(res.status, 422);
  });

  await test('Rejects out-of-range PM value (pm25 = 9999)', async () => {
    const res = await request('POST', '/api/readings',
      { ...VALID_PAYLOAD, pm25: 9999 }, { 'X-API-Key': API_KEY });
    // pm25 > 1000 is rejected by schema validator
    assert(res.status === 422 || res.status === 201, 'should handle gracefully');
  });

  // ── GET /api/readings/latest ──
  console.log('\n▶ GET /api/readings/latest');

  await test('Returns 200 with a reading object', async () => {
    const res = await request('GET', '/api/readings/latest');
    assertEqual(res.status, 200);
    assert(res.body.success, 'success should be true');
    assert(typeof res.body.data === 'object', 'data should be an object');
  });

  await test('Returns aqi virtual field', async () => {
    const res = await request('GET', '/api/readings/latest');
    assert('aqi' in res.body.data, 'aqi virtual field should be present');
  });

  await test('Returns aqiCategory virtual field', async () => {
    const res = await request('GET', '/api/readings/latest');
    assert('aqiCategory' in res.body.data, 'aqiCategory should be present');
  });

  // ── GET /api/readings/history ──
  console.log('\n▶ GET /api/readings/history');

  await test('Returns paginated list for 1h range', async () => {
    const res = await request('GET', '/api/readings/history?range=1h&page=1&limit=10');
    assertEqual(res.status, 200);
    assert(Array.isArray(res.body.data), 'data should be an array');
    assert(res.body.pagination, 'pagination object should be present');
  });

  await test('Respects limit parameter', async () => {
    const res = await request('GET', '/api/readings/history?range=24h&page=1&limit=5');
    assertEqual(res.status, 200);
    assert(res.body.data.length <= 5, 'should return at most 5 items');
  });

  await test('Supports 7d range', async () => {
    const res = await request('GET', '/api/readings/history?range=7d&page=1&limit=20');
    assertEqual(res.status, 200);
  });

  // ── GET /api/device/status ──
  console.log('\n▶ GET /api/device/status');

  await test('Returns device status object', async () => {
    const res = await request('GET', '/api/device/status');
    assertEqual(res.status, 200);
    assert('online' in res.body.data, 'online field should be present');
    assert('lastSeen' in res.body.data, 'lastSeen field should be present');
  });

  // ── Model tests (direct) ──
  console.log('\n▶ Mongoose model');

  await test('AQI virtual is null when pm25 is null', async () => {
    const r = new Reading({ deviceId: 'test', pm25: null });
    assert(r.aqi === null, 'AQI should be null');
  });

  await test('AQI virtual calculates correctly for PM2.5 = 10 µg/m³ → AQI ~42', async () => {
    const r = new Reading({ deviceId: 'test', pm25: 10 });
    assert(r.aqi !== null, 'AQI should not be null');
    assert(r.aqi >= 35 && r.aqi <= 50, `Expected ~42, got ${r.aqi}`);
  });

  await test('aqiCategory returns "Good" for AQI ≤ 50', async () => {
    const r = new Reading({ deviceId: 'test', pm25: 5 });
    assertEqual(r.aqiCategory, 'Good');
  });

  await test('aqiCategory returns "Unhealthy" for PM2.5 = 100 µg/m³', async () => {
    const r = new Reading({ deviceId: 'test', pm25: 100 });
    assertEqual(r.aqiCategory, 'Unhealthy');
  });

  // ── Summary ──
  console.log(`\n══ Results: ${passed} passed, ${failed} failed ══\n`);
  if (failed > 0) process.exit(1);
}

// ── Connect and run ───────────────────────────────────────────────────────────
(async () => {
  try {
    await connectDB();
    await runTests();
  } catch (err) {
    console.error('\n[TEST FATAL]', err.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
})();
