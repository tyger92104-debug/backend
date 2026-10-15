const assert = require('assert');
const { mapPayload } = require('../routes/readings');
const Reading = require('../models/Reading');

console.log('🧪 Starting Payload & Schema Unit Tests...\n');

// Test 1: Full ESP32 payload mapping
{
  const espPayload = {
    deviceId: 'esp32-aqm-001',
    pm1: 8.5,
    pm25: 14.2,
    pm10: 22.8,
    temp: 24.5,
    rh: 55.2,
    gpsFix: true,
    sats: 8,
    lat: 12.9716,
    lng: 77.5946,
    acc: 1.2
  };

  const mapped = mapPayload(espPayload);
  assert.strictEqual(mapped.deviceId, 'esp32-aqm-001');
  assert.strictEqual(mapped.pm1, 8.5);
  assert.strictEqual(mapped.pm25, 14.2);
  assert.strictEqual(mapped.pm10, 22.8);
  assert.strictEqual(mapped.temperature, 24.5);
  assert.strictEqual(mapped.humidity, 55.2);
  assert.strictEqual(mapped.gpsFix, true);
  assert.strictEqual(mapped.satellites, 8);
  assert.strictEqual(mapped.latitude, 12.9716);
  assert.strictEqual(mapped.longitude, 77.5946);
  assert.strictEqual(mapped.accuracy, 1.2);
  console.log('✅ Test 1: Full ESP32 payload correctly mapped to DB schema fields');
}

// Test 2: Safe handling of nulls when GPS fix is lost and PM sensor reading fails
{
  const partialPayload = {
    deviceId: 'esp32-aqm-001',
    pm1: null,
    pm25: null,
    pm10: null,
    temp: 22.1,
    rh: 60.5,
    gpsFix: false,
    sats: 0,
    lat: null,
    lng: null,
    acc: null
  };

  const mapped = mapPayload(partialPayload);
  assert.strictEqual(mapped.pm1, null);
  assert.strictEqual(mapped.pm25, null);
  assert.strictEqual(mapped.pm10, null);
  assert.strictEqual(mapped.temperature, 22.1);
  assert.strictEqual(mapped.humidity, 60.5);
  assert.strictEqual(mapped.gpsFix, false);
  assert.strictEqual(mapped.satellites, 0);
  assert.strictEqual(mapped.latitude, null);
  assert.strictEqual(mapped.longitude, null);
  assert.strictEqual(mapped.accuracy, null);
  console.log('✅ Test 2: Nulls and false GPS fix handled safely without NaN or crash');
}

// Test 3: AQI calculation virtuals on model
{
  const reading = new Reading({
    deviceId: 'esp32-test',
    pm25: 12.0
  });
  // At PM2.5 = 12.0 ug/m3, AQI should be 50 (Good)
  assert.strictEqual(reading.aqi, 50);
  assert.strictEqual(reading.aqiCategory, 'Good');

  const readingMod = new Reading({
    deviceId: 'esp32-test',
    pm25: 35.4
  });
  // At PM2.5 = 35.4 ug/m3, AQI should be 100 (Moderate)
  assert.strictEqual(readingMod.aqi, 100);
  assert.strictEqual(readingMod.aqiCategory, 'Moderate');
  console.log('✅ Test 3: EPA AQI and category calculation virtuals verified');
}

console.log('\n🎉 All Unit Tests Passed!\n');
