const mongoose = require('mongoose');

const readingSchema = new mongoose.Schema(
  {
    deviceId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    pm1: { type: Number, default: null, min: 0, max: 1000 },
    pm25: { type: Number, default: null, min: 0, max: 1000 },
    pm10: { type: Number, default: null, min: 0, max: 1000 },
    temperature: { type: Number, default: null, min: -40, max: 85 },
    humidity: { type: Number, default: null, min: 0, max: 100 },
    latitude: { type: Number, default: null, min: -90, max: 90 },
    longitude: { type: Number, default: null, min: -180, max: 180 },
    satellites: { type: Number, default: null, min: 0, max: 50 },
    accuracy: { type: Number, default: null, min: 0 },
    gpsFix: { type: Boolean, default: false },
    timestamp: { type: Date, default: Date.now, index: true },
  },
  { collection: 'readings', versionKey: false }
);

// Compound indexes for efficient history queries
readingSchema.index({ deviceId: 1, timestamp: -1 });
readingSchema.index({ timestamp: -1 });

// US EPA PM2.5 AQI breakpoints (2018 Technical Assistance Document)
// Source: https://www.airnow.gov/sites/default/files/2020-05/aqi-technical-assistance-document-sept2018.pdf
const EPA_PM25_BREAKPOINTS = [
  { cLow: 0.0,   cHigh: 12.0,  iLow: 0,   iHigh: 50  },
  { cLow: 12.1,  cHigh: 35.4,  iLow: 51,  iHigh: 100 },
  { cLow: 35.5,  cHigh: 55.4,  iLow: 101, iHigh: 150 },
  { cLow: 55.5,  cHigh: 150.4, iLow: 151, iHigh: 200 },
  { cLow: 150.5, cHigh: 250.4, iLow: 201, iHigh: 300 },
  { cLow: 250.5, cHigh: 350.4, iLow: 301, iHigh: 400 },
  { cLow: 350.5, cHigh: 500.4, iLow: 401, iHigh: 500 },
];

function calcAQI(pm25) {
  if (pm25 == null || pm25 < 0) return null;
  const bp = EPA_PM25_BREAKPOINTS.find((b) => pm25 >= b.cLow && pm25 <= b.cHigh);
  if (!bp) return pm25 > 500.4 ? 500 : 0;
  return Math.round(
    ((bp.iHigh - bp.iLow) / (bp.cHigh - bp.cLow)) * (pm25 - bp.cLow) + bp.iLow
  );
}

function aqiCategory(aqi) {
  if (aqi == null) return null;
  if (aqi <= 50)  return 'Good';
  if (aqi <= 100) return 'Moderate';
  if (aqi <= 150) return 'Unhealthy for Sensitive Groups';
  if (aqi <= 200) return 'Unhealthy';
  if (aqi <= 300) return 'Very Unhealthy';
  return 'Hazardous';
}

readingSchema.virtual('aqi').get(function () { return calcAQI(this.pm25); });
readingSchema.virtual('aqiCategory').get(function () { return aqiCategory(this.aqi); });

readingSchema.set('toJSON', { virtuals: true });
readingSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Reading', readingSchema);
