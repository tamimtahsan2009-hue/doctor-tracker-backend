const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'doctor_tracker_jwt_secret_key_production_2026';
const AUTH_COOKIE_NAME = 'dt_token';

/**
 * Express Authentication Middleware
 * Extracts JWT token from HTTP-only cookie or Authorization header.
 * Attaches decoded user payload to req.user.
 */
function requireAuth(req, res, next) {
  try {
    let token = null;

    // 1. Try to read from Cookie header
    if (req.headers.cookie) {
      const cookies = req.headers.cookie.split(';').reduce((acc, cookie) => {
        const parts = cookie.trim().split('=');
        if (parts.length >= 2) {
          acc[parts[0]] = decodeURIComponent(parts.slice(1).join('='));
        }
        return acc;
      }, {});
      token = cookies[AUTH_COOKIE_NAME];
    }

    // 2. Fall back to Authorization: Bearer <token>
    if (!token && req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      token = req.headers.authorization.substring(7).trim();
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized: Authentication token required to access clinical intelligence resources.',
      });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized: Authentication session expired. Please log in again.',
      });
    }
    return res.status(401).json({
      success: false,
      error: 'Unauthorized: Invalid authentication credentials.',
    });
  }
}

/**
 * Role-based authorization middleware
 */
function requireRole(allowedRoles = []) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    if (allowedRoles.length > 0 && !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden: Insufficient privileges for this clinical operation.',
      });
    }
    next();
  };
}

module.exports = {
  requireAuth,
  requireRole,
  AUTH_COOKIE_NAME,
  JWT_SECRET,
};

