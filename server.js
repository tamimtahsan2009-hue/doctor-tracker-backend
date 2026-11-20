require('dotenv').config();
const express = require('express');
const cors = require('cors');
const connectDB = require('./config/db');

// Route handlers
const authRoutes = require('./routes/auth');
const doctorRoutes = require('./routes/doctors');
const patientRoutes = require('./routes/patients');
const analyticsRoutes = require('./routes/analytics');
const parseDocumentRoutes = require('./routes/parseDocument');
const { requireAuth } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 5000;

// Connect to MongoDB database
connectDB();

// CORS Configuration
const allowedOrigins = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  process.env.CLIENT_URL,
].filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps, curl, server-to-server)
      if (!origin) return callback(null, true);
      if (allowedOrigins.indexOf(origin) !== -1 || allowedOrigins.includes('*')) {
        return callback(null, true);
      }
      return callback(null, true); // Permissive for local dev and cloud deployments
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
  })
);

// High-capacity JSON parser for base64 avatars and bulk data
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

// Health Check Endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'doctor-tracker-backend',
    version: '1.0.0',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// Root API Welcome Endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'Doctor Tracker Clinical Intelligence API',
    version: '1.0.0',
    status: 'online',
    endpoints: {
      health: '/health',
      auth: '/api/auth',
      doctors: '/api/doctors',
      patients: '/api/patients',
      analytics: '/api/analytics',
      parseDocument: '/api/parse-document',
    },
  });
});

// RESTful Route Mounts
// Public Authentication endpoints
app.use('/api/auth', authRoutes);

// Protected Clinical Resource Endpoints (Require Valid Authenticated Session)
app.use('/api/doctors', requireAuth, doctorRoutes);
app.use('/api/patients', requireAuth, patientRoutes);
app.use('/api/analytics', requireAuth, analyticsRoutes);
app.use('/api/parse-document', requireAuth, parseDocumentRoutes);

// 404 Handler for undefined routes
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: `Cannot ${req.method} ${req.originalUrl} - Route not found`,
  });
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('Unhandled Application Error:', err);
  res.status(err.status || 500).json({
    success: false,
    error: err.message || 'Internal Server Error',
  });
});

app.listen(PORT, () => {
  console.log(`===============================================`);
  console.log(`  Doctor Tracker Backend Server Active`);
  console.log(`  Port: ${PORT}`);
  console.log(`  Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`  Health Check: http://localhost:${PORT}/health`);
  console.log(`===============================================`);
});

module.exports = app;

