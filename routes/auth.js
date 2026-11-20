const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { requireAuth, AUTH_COOKIE_NAME, JWT_SECRET } = require('../middleware/auth');

// In-memory rate limiting for brute-force protection
const loginAttempts = new Map();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;
const BLOCK_DURATION_MS = 15 * 60 * 1000;

function checkRateLimit(ip) {
  const now = Date.now();
  const record = loginAttempts.get(ip);
  if (!record) return { allowed: true };
  if (record.blockedUntil && record.blockedUntil > now) {
    const retryAfter = Math.ceil((record.blockedUntil - now) / 1000);
    return { allowed: false, retryAfter };
  }
  if (now - record.firstAttemptAt > WINDOW_MS) {
    loginAttempts.delete(ip);
    return { allowed: true };
  }
  return { allowed: record.attempts < MAX_ATTEMPTS };
}

function recordFailedAttempt(ip) {
  const now = Date.now();
  const record = loginAttempts.get(ip) || { attempts: 0, firstAttemptAt: now };
  if (now - record.firstAttemptAt > WINDOW_MS) {
    record.attempts = 1;
    record.firstAttemptAt = now;
    record.blockedUntil = undefined;
  } else {
    record.attempts += 1;
  }
  if (record.attempts >= MAX_ATTEMPTS) {
    record.blockedUntil = now + BLOCK_DURATION_MS;
    loginAttempts.set(ip, record);
    return { allowed: false, remaining: 0, retryAfter: Math.ceil(BLOCK_DURATION_MS / 1000) };
  }
  loginAttempts.set(ip, record);
  return { allowed: true, remaining: MAX_ATTEMPTS - record.attempts };
}

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.ip || '127.0.0.1';

    // Rate limit check
    const rateCheck = checkRateLimit(ip);
    if (!rateCheck.allowed) {
      return res.status(429).json({
        success: false,
        error: `Too many failed login attempts. Account temporarily locked. Please try again in ${rateCheck.retryAfter} seconds.`,
      });
    }

    const { email, password } = req.body;

    if (!email || !password || typeof email !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ success: false, error: 'Email and password are required.' });
    }

    const cleanEmail = email.toLowerCase().trim();

    // Find user in MongoDB
    let user = await User.findOne({ email: cleanEmail });

    // Auto-seed default admin if database is freshly deployed
    if (!user && cleanEmail === 'admin@doctortracker.health') {
      const initialPassword = process.env.INITIAL_ADMIN_PASSWORD || 'AdminSecure2026!';
      const hashedPassword = await bcrypt.hash(initialPassword, 10);
      user = await User.create({
        name: 'Dr. Tahsan Tamim',
        email: 'admin@doctortracker.health',
        password: hashedPassword,
        role: 'Administrator',
      });
    } else if (user && user.email === 'admin@doctortracker.health' && user.name !== 'Dr. Tahsan Tamim') {
      user.name = 'Dr. Tahsan Tamim';
      await user.save();
    }

    // Generic error for anti-enumeration
    if (!user) {
      const status = recordFailedAttempt(ip);
      const rem = status.remaining > 0 ? ` (${status.remaining} attempts remaining)` : '';
      return res.status(401).json({ success: false, error: `Invalid email or password.${rem}` });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      const status = recordFailedAttempt(ip);
      const rem = status.remaining > 0 ? ` (${status.remaining} attempts remaining)` : '';
      return res.status(401).json({ success: false, error: `Invalid email or password.${rem}` });
    }

    // Reset rate limit on success
    loginAttempts.delete(ip);

    const token = jwt.sign(
      { id: user._id, email: user.email, role: user.role, name: user.name },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    // Set HTTP-only Cookie
    res.cookie(AUTH_COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      path: '/',
    });

    return res.json({
      success: true,
      token,
      user: {
        id: user._id.toString(),
        name: user.name,
        email: user.email,
        role: user.role,
      },
      message: 'Authentication successful',
    });
  } catch (error) {
    console.error('Auth Login Error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error during authentication.' });
  }
});

// GET /api/auth/me
router.get('/me', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    if (!user) {
      return res.status(401).json({ success: false, error: 'User session no longer valid.' });
    }

    return res.json({
      success: true,
      user: {
        id: user._id.toString(),
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Error checking session.' });
  }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  res.clearCookie(AUTH_COOKIE_NAME, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  });

  return res.json({
    success: true,
    message: 'Session invalidated and logged out successfully.',
  });
});

module.exports = router;
