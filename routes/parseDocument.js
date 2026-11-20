const express = require('express');
const router = express.Router();
const multer = require('multer');
const XLSX = require('xlsx');

// In-memory upload storage for files up to 15MB
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

// Fallback stream text extractor for PDF
function fallbackStreamTextExtractor(buffer) {
  try {
    const raw = buffer.toString('latin1');
    const matches = [];

    const tjRegex = /\(([^)]+)\)\s*Tj/g;
    let m;
    while ((m = tjRegex.exec(raw)) !== null) {
      if (m[1] && m[1].trim()) matches.push(m[1].trim());
    }

    const arrayRegex = /\[([^\]]+)\]\s*TJ/g;
    while ((m = arrayRegex.exec(raw)) !== null) {
      const inner = m[1];
      const strMatches = inner.match(/\(([^)]+)\)/g);
      if (strMatches) {
        const line = strMatches.map((s) => s.replace(/[()]/g, '')).join('');
        if (line.trim()) matches.push(line.trim());
      }
    }

    return matches.join('\n');
  } catch {
    return '';
  }
}

function parsePatientRecordFromLine(line) {
  const clean = line.trim();
  if (!clean || clean.length < 8) return null;

  const lower = clean.toLowerCase();
  if (
    lower.startsWith('demo') ||
    lower.startsWith('fictional') ||
    lower.startsWith('note:') ||
    lower.includes('do not use these records') ||
    (lower.includes('patient id') && lower.includes('patient name')) ||
    (lower.includes('contact number') && lower.includes('email address'))
  ) {
    return null;
  }

  let email = '';
  const emailMatch = clean.match(/\b([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/);
  if (emailMatch) email = emailMatch[1].toLowerCase();

  let phone = '';
  const phoneMatch = clean.match(/(?:\+?88)?\b(01\d{9})\b|\b(\d{10,13})\b/);
  if (phoneMatch) phone = phoneMatch[1] || phoneMatch[2] || phoneMatch[0];

  let doctor = '';
  const doctorMatch =
    clean.match(/\b((?:Dr\.?|Doctor)\s+[A-Za-z\s.'-]+)$/i) ||
    clean.match(/\b((?:Dr\.?|Doctor)\s+[A-Za-z\s.'-]+?)(?=[|,\t;]|\s{2,}|$)/i);
  if (doctorMatch) doctor = doctorMatch[1].trim();

  let bloodGroup = '';
  const bloodMatch = clean.match(/(?:\s|^)(A|B|AB|O)[+-](?:\s|$|[|,\t;])/i);
  if (bloodMatch) bloodGroup = bloodMatch[0].replace(/[|,\t;\s]/g, '').toUpperCase();

  let age = 30;
  let gender = 'Male';
  const ageGenderMatch =
    clean.match(/\b(\d{1,3})\s+(Male|Female|Other|M|F)\b/i) ||
    clean.match(/\b(Male|Female|Other|M|F)\s+(\d{1,3})\b/i);

  if (ageGenderMatch) {
    if (/^\d+$/.test(ageGenderMatch[1])) {
      age = parseInt(ageGenderMatch[1], 10);
      const g = ageGenderMatch[2].toLowerCase();
      gender = g.startsWith('f') ? 'Female' : g.startsWith('m') ? 'Male' : 'Other';
    } else {
      age = parseInt(ageGenderMatch[2], 10);
      const g = ageGenderMatch[1].toLowerCase();
      gender = g.startsWith('f') ? 'Female' : g.startsWith('m') ? 'Male' : 'Other';
    }
  }

  let condition = 'Stable';
  const condMatch = clean.match(/\b(Critical|Serious|Stable|Recovering|Routine Checkup)\b/i);
  if (condMatch) {
    condition = condMatch[1].charAt(0).toUpperCase() + condMatch[1].slice(1).toLowerCase();
    if (condition === 'Routine checkup') condition = 'Routine Checkup';
  }

  let patientId = '';
  const idMatch = clean.match(/\b(PT-?\d+)\b/i);
  if (idMatch) patientId = idMatch[1].toUpperCase();

  let name = '';
  let address = '';

  const pipeParts = clean.split(/[|\t]/).map((p) => p.trim()).filter(Boolean);
  if (pipeParts.length >= 4) {
    name = pipeParts[1] || pipeParts[0] || '';
    if (name.includes('PT-') || /^\d+$/.test(name)) name = pipeParts[2] || '';
    address = pipeParts[6] || pipeParts[5] || '';
  } else {
    let remainder = clean;
    if (patientId) remainder = remainder.replace(patientId, ' ');
    if (email) remainder = remainder.replace(email, ' ');
    if (phone) remainder = remainder.replace(phone, ' ');
    if (doctor) remainder = remainder.replace(doctor, ' ');
    if (bloodGroup) remainder = remainder.replace(bloodGroup, ' ');
    if (condMatch) remainder = remainder.replace(condMatch[0], ' ');

    remainder = remainder.replace(/\b\d{1,3}\b/g, ' ');
    remainder = remainder.replace(/\b(Male|Female|Other|M|F)\b/gi, ' ');
    remainder = remainder.replace(/^[0-9.\s|,\t;]+/, '').trim();

    const textParts = remainder.split(/[|,\t;]|\s{2,}/).map((p) => p.trim()).filter(Boolean);
    name = textParts[0] || '';
    address = textParts.slice(1).join(', ').trim();
  }

  name = name.replace(/^(Mr\.|Mrs\.|Ms\.|Dr\.)\s*/i, '').trim();

  if (!name || (!phone && !email)) return null;

  return {
    patientId,
    name,
    age,
    gender,
    condition,
    bloodGroup,
    phone,
    email,
    address,
    doctor,
    notes: bloodGroup ? `Blood Group: ${bloodGroup}` : '',
  };
}

function parseDoctorRecordFromLine(line) {
  const clean = line.trim();
  if (!clean || clean.length < 8) return null;

  const lower = clean.toLowerCase();
  if (
    lower.startsWith('demo') ||
    lower.startsWith('fictional') ||
    lower.startsWith('note:') ||
    (lower.includes('doctor name') && lower.includes('specialization'))
  ) {
    return null;
  }

  let email = '';
  const emailMatch = clean.match(/\b([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/);
  if (emailMatch) email = emailMatch[1].toLowerCase();

  let phone = '';
  const phoneMatch = clean.match(/(?:\+?88)?\b(01\d{9})\b|\b(\d{10,13})\b/);
  if (phoneMatch) phone = phoneMatch[1] || phoneMatch[2] || phoneMatch[0];

  let name = '';
  const nameMatch = clean.match(/\b((?:Dr\.?|Doctor)\s+[A-Z][a-z.'-]+(?:\s+[A-Z][a-z.'-]+){1,3})\b/i);
  if (nameMatch) {
    name = nameMatch[1].trim();
  } else {
    const parts = clean.split(/[|\t;]|\s{2,}/).map((p) => p.trim()).filter(Boolean);
    name = parts[0] || '';
  }
  if (name && !name.startsWith('Dr.') && !name.startsWith('Doctor')) {
    name = `Dr. ${name}`;
  }

  const parts = clean.split(/[|\t]/).map((p) => p.trim()).filter(Boolean);
  let specialization = '';
  let hospital = '';
  let address = '';

  if (parts.length >= 4) {
    specialization = parts[1] || '';
    hospital = parts[2] || '';
    address = parts[5] || parts[4] || '';
    if (address.includes('@') || /^\d+$/.test(address)) address = '';
  } else {
    let remainder = clean;
    if (name) remainder = remainder.replace(name, ' ');
    if (email) remainder = remainder.replace(email, ' ');
    if (phone) remainder = remainder.replace(phone, ' ');
    remainder = remainder.replace(/^[0-9.\s|,\t;]+/, '').trim();

    const segments = remainder.split(/[|,\t;]|\s{2,}/).map((s) => s.trim()).filter(Boolean);
    specialization = segments[0] || 'General Medicine';
    hospital = segments[1] || 'Affiliated Hospital';
    address = segments.slice(2).join(', ').trim();
  }

  if (!name || (!phone && !email)) return null;

  return {
    name,
    specialization,
    hospital,
    phone,
    email,
    address,
  };
}

// POST /api/parse-document
router.post('/', upload.single('file'), async (req, res) => {
  try {
    let buffer = null;
    let fileName = '';
    let type = req.body.type || 'doctors';

    if (req.file) {
      buffer = req.file.buffer;
      fileName = (req.file.originalname || '').toLowerCase();
    } else if (req.body.base64Data) {
      buffer = Buffer.from(req.body.base64Data, 'base64');
      fileName = (req.body.fileName || '').toLowerCase();
    }

    if (!buffer) {
      return res.status(400).json({ success: false, error: 'No file uploaded or file buffer provided' });
    }

    let rawObjects = [];

    // 1. Handle Excel / CSV
    if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls') || fileName.endsWith('.csv') || fileName.endsWith('.tsv')) {
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      rawObjects = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    }
    // 2. Handle PDF
    else if (fileName.endsWith('.pdf')) {
      let extractedText = '';
      try {
        const pdfParse = require('pdf-parse');
        const pdfData = await pdfParse(buffer);
        extractedText = pdfData.text || '';
      } catch (err) {
        extractedText = fallbackStreamTextExtractor(buffer);
      }

      if (!extractedText || !extractedText.trim()) {
        extractedText = fallbackStreamTextExtractor(buffer);
      }

      let formattedText = extractedText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

      if (type === 'patients') {
        formattedText = formattedText.replace(/([^\n])\s+(PT-?\d+\b)/gi, '$1\n$2');
      } else {
        formattedText = formattedText.replace(/([^\n])\s+(Dr\.?\s+[A-Z])/gi, '$1\n$2');
      }

      const lines = formattedText
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && !/^--\s*\d+\s*of\s*\d+\s*--$/i.test(l));

      const parsedItems = [];
      for (const line of lines) {
        if (type === 'patients') {
          const item = parsePatientRecordFromLine(line);
          if (item) parsedItems.push(item);
        } else {
          const item = parseDoctorRecordFromLine(line);
          if (item) parsedItems.push(item);
        }
      }

      return res.json({
        success: true,
        type,
        count: parsedItems.length,
        data: parsedItems,
      });
    }

    // Process Excel/CSV rows
    const normalizedRows = [];
    for (const row of rawObjects) {
      const keys = Object.keys(row);
      const getVal = (...names) => {
        for (const n of names) {
          const found = keys.find((k) => k.toLowerCase().replace(/[^a-z0-9]/g, '') === n.toLowerCase().replace(/[^a-z0-9]/g, ''));
          if (found && row[found] !== undefined && row[found] !== '') {
            return String(row[found]).trim();
          }
        }
        return '';
      };

      if (type === 'patients') {
        const name = getVal('name', 'patientname', 'fullname');
        const phone = getVal('phone', 'contact', 'mobile', 'cell', 'phonenumber');
        if (name || phone) {
          normalizedRows.push({
            name: name || 'Unnamed Patient',
            age: parseInt(getVal('age') || '35', 10),
            gender: getVal('gender') || 'Other',
            condition: getVal('condition', 'status') || 'Stable',
            phone: phone || '01700000000',
            email: getVal('email', 'emailaddress'),
            address: getVal('address', 'location', 'city'),
            doctor: getVal('doctor', 'doctorname', 'physician'),
            notes: getVal('notes', 'comments', 'history'),
          });
        }
      } else {
        const name = getVal('name', 'doctorname', 'fullname');
        const phone = getVal('phone', 'contact', 'mobile', 'cell', 'phonenumber');
        if (name || phone) {
          normalizedRows.push({
            name: name || 'Dr. Physician',
            specialization: getVal('specialization', 'specialty', 'department') || 'General Medicine',
            hospital: getVal('hospital', 'clinic', 'institution') || 'Affiliated Hospital',
            phone: phone || '01700000000',
            email: getVal('email', 'emailaddress'),
            address: getVal('address', 'chamber', 'location'),
          });
        }
      }
    }

    return res.json({
      success: true,
      type,
      count: normalizedRows.length,
      data: normalizedRows,
    });
  } catch (error) {
    console.error('Parse Document Error:', error);
    return res.status(500).json({ success: false, error: error.message || 'File parsing failed' });
  }
});

module.exports = router;

