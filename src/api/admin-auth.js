const { timingSafeEqual } = require('node:crypto');

/** QR codes and control endpoints must not be publicly usable on Render. */
function requireAdmin(req, res, next) {
  const expected = process.env.ADMIN_API_TOKEN;
  if (!expected) {
    // Local development only. Production env validation requires the token.
    if (process.env.NODE_ENV !== 'production') return next();
    return res.status(503).json({ error: 'Admin access is not configured' });
  }
  const header = req.get('authorization') || '';
  const actual = header.startsWith('Bearer ') ? header.slice(7) : '';
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return res.status(401).json({ error: 'Admin authorization required' });
  }
  next();
}

module.exports = { requireAdmin };
