# Doctor Tracker — Backend API Server

> Standalone Node.js & Express RESTful API backend for the **Doctor Tracker** healthcare administration and clinical intelligence platform.

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express-4.19.2-lightgrey.svg)](https://expressjs.com/)
[![MongoDB](https://img.shields.io/badge/MongoDB-Atlas-brightgreen.svg)](https://www.mongodb.com/atlas)
[![License](https://img.shields.io/badge/License-ISC-blue.svg)](LICENSE)

---

## 📋 Table of Contents
- [Architecture & Tech Stack](#architecture--tech-stack)
- [Prerequisites](#prerequisites)
- [Project Structure](#project-structure)
- [Environment Configuration](#environment-configuration)
- [Installation & Setup](#installation--setup)
- [REST API Reference](#rest-api-reference)
  - [Authentication](#1-authentication)
  - [Physicians / Doctors](#2-physicians--doctors)
  - [Patients Registry](#3-patients-registry)
  - [Clinical Analytics & Insights](#4-clinical-analytics--insights)
  - [Document Parser (PDF & Excel)](#5-document-parser-pdf--excel)
- [Deployment Guide](#deployment-guide)

---

## 🏛️ Architecture & Tech Stack

The Doctor Tracker Backend is designed as an independent, decoupled RESTful microservice:

- **Runtime:** Node.js (v18+)
- **Framework:** Express.js 4.19
- **Database:** MongoDB Atlas via Mongoose ODM
- **Authentication:** JWT (JSON Web Tokens) & bcryptjs password hashing
- **File & Document Processing:** SheetJS (XLSX), PDF-Parse, Multer
- **CORS & Security:** Configured for cross-origin client requests and base64 payloads up to 15MB

---

## 📦 Prerequisites

Ensure you have the following installed locally:
- [Node.js](https://nodejs.org/) v18.0.0 or higher
- [npm](https://www.npmjs.com/) (bundled with Node.js)
- A [MongoDB Atlas](https://www.mongodb.com/cloud/atlas) cluster connection string or local MongoDB instance

---

## 📁 Project Structure

```
doctor-tracker-backend/
├── config/
│   └── db.js                 # MongoDB connection and pooling setup
├── models/
│   ├── Doctor.js             # Doctor schema with phone regex and compound indexes
│   ├── Patient.js            # Patient schema with condition status and Doctor ref
│   ├── User.js               # Admin authentication schema
│   └── Activity.js           # Real-time clinical audit log schema
├── routes/
│   ├── auth.js               # Admin login and token verification routes
│   ├── doctors.js            # Doctor CRUD, search, pagination, bulk import
│   ├── patients.js           # Patient enrollment, cohort filters, bulk import
│   ├── analytics.js          # KPI metrics, registration trends, status distributions
│   └── parseDocument.js      # Multi-format PDF and Excel clinical data parser
├── utils/
│   └── analyticsHelpers.js   # Date range calculators and aggregation helpers
├── .env.example              # Environment variables template
├── .gitignore                # Git ignore configuration
├── package.json              # Backend dependencies and run scripts
├── README.md                 # Documentation
└── server.js                 # Express application entry point
```

---

## ⚙️ Environment Configuration

Create a `.env` file in the root of `doctor-tracker-backend/` based on [.env.example](.env.example):

```bash
# Server Configuration
PORT=5000
NODE_ENV=development

# MongoDB Connection String (Atlas or Local)
MONGODB_URI=mongodb+srv://<username>:<password>@cluster0.mongodb.net/doctortracker?retryWrites=true&w=majority

# JWT Authentication Secret
JWT_SECRET=your_super_secret_jwt_key_change_in_production

# Frontend Application Origin (CORS allowlist)
CLIENT_URL=http://localhost:3000
```

> **Security Note:** Never commit your `.env` file or credentials to source control.

---

## 🚀 Installation & Setup

1. **Navigate to the backend directory:**
   ```bash
   cd doctor-tracker-backend
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Start in development mode (with nodemon hot-reload):**
   ```bash
   npm run dev
   ```

4. **Start in production mode:**
   ```bash
   npm start
   ```

The server will initialize on `http://localhost:5000`. You can test health status at:
```bash
curl http://localhost:5000/health
```

---

## 📡 REST API Reference

### 1. Authentication
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/auth/login` | Authenticate administrator credentials and return JWT |
| `GET` | `/api/auth/me` | Retrieve profile of currently authenticated user |

**Default Admin Credentials:**
- Email: `admin@doctortracker.health`
- Password: `AdminSecure2026!`
*(Automatically initialized in database on first login if not present)*

---

### 2. Physicians / Doctors
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/doctors` | List doctors with search (`q`), filters (`specialization`, `hospital`), sort, and pagination |
| `POST` | `/api/doctors` | Register a new physician with passport photo and validation |
| `POST` | `/api/doctors/bulk` | Bulk import multiple doctor records |
| `GET` | `/api/doctors/:id` | Get detailed physician profile and assigned patient cohort |
| `PUT` | `/api/doctors/:id` | Update physician information |
| `DELETE` | `/api/doctors/:id` | Remove physician and cascade clean up cohort |

---

### 3. Patients Registry
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/patients` | Query patients with filters (`condition`, `doctorId`, `date`), search, pagination |
| `POST` | `/api/patients` | Enroll a new patient with photo, clinical condition, and doctor assignment |
| `POST` | `/api/patients/bulk` | Bulk import patient records |
| `GET` | `/api/patients/:id` | Get full clinical dossier of a single patient |
| `PUT` | `/api/patients/:id` | Update patient records, condition status, or assigned physician |
| `DELETE` | `/api/patients/:id` | Discharge/archive patient record |

---

### 4. Clinical Analytics & Insights
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/analytics` | Overall dashboard metrics, recent activities, and cohort summaries |
| `GET` | `/api/analytics/overview` | KPI summary cards with period-over-period comparisons (`7d`, `30d`, `90d`, `year`, `all`) |
| `GET` | `/api/analytics/patient-trends` | Registration timeline aggregation (`daily`, `weekly`, `monthly`) |
| `GET` | `/api/analytics/patients-per-doctor` | Cohort distribution per physician (sorted, top 10 or all) |
| `GET` | `/api/analytics/patient-status` | Clinical condition breakdown (`Critical`, `Serious`, `Stable`, `Recovering`, `Routine Checkup`) |
| `GET` | `/api/analytics/specializations` | Doctor and patient distribution by medical specialty |

---

### 5. Document Parser (PDF & Excel)
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/parse-document` | Accepts PDF (`.pdf`), Excel (`.xlsx`, `.xls`), or CSV files and extracts clinical records for bulk preview |

---

## 🌐 Deployment Guide

### Deploying to Render / Railway / Heroku
1. Push this directory to your standalone GitHub repository: `doctor-tracker-backend`.
2. Create a new **Web Service** in your cloud provider dashboard connected to the repository.
3. Configure the build and start commands:
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
4. Set the Environment Variables:
   - `MONGODB_URI`: Your production MongoDB Atlas connection string
   - `JWT_SECRET`: A strong random string
   - `CLIENT_URL`: The production URL of your frontend application (e.g. `https://doctortracker.vercel.app`)
   - `PORT`: `5000` (or leave default for cloud assigned port)

