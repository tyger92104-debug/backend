/**
 * API-Key authentication middleware.
 * Devices must send the key in the X-API-Key header.
 * The key is stored in the DEVICE_API_KEY environment variable.
 */
module.exports = function deviceAuth(req, res, next) {
  const expectedKey = process.env.DEVICE_API_KEY;
  if (!expectedKey) {
    // If no key is configured, skip authentication (dev mode)
    console.warn('[AUTH] DEVICE_API_KEY not set – device auth is DISABLED');
    return next();
  }

  const providedKey = req.headers['x-api-key'];
  if (!providedKey || providedKey !== expectedKey) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized – invalid or missing X-API-Key header',
    });
  }

  next();
};
