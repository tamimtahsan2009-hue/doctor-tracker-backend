const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Doctor = require('../models/Doctor');
const Patient = require('../models/Patient');
const Activity = require('../models/Activity');

// GET /api/doctors - List doctors with filters, search, sorting, and pagination
router.get('/', async (req, res) => {
  try {
    const q = req.query.q || '';
    const specialization = req.query.specialization;
    const hospital = req.query.hospital;
    const dateFilter = req.query.dateFilter;
    const sortBy = req.query.sortBy || 'createdAt';
    const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;
    const page = parseInt(req.query.page || '1', 10);
    const limit = parseInt(req.query.limit || '50', 10);

    const query = {};

    if (q) {
      query.$or = [
        { name: { $regex: q, $options: 'i' } },
        { specialization: { $regex: q, $options: 'i' } },
        { hospital: { $regex: q, $options: 'i' } },
        { email: { $regex: q, $options: 'i' } },
        { phone: { $regex: q, $options: 'i' } },
      ];
    }

    if (specialization && specialization !== 'All Specializations') {
      query.specialization = specialization;
    }

    if (hospital && hospital !== 'All Hospitals') {
      query.hospital = hospital;
    }

    if (dateFilter && dateFilter !== 'all') {
      const now = new Date();
      let pastDays = 30;
      if (dateFilter === '90d') pastDays = 90;
      if (dateFilter === 'year') pastDays = 365;
      const cutoff = new Date(now.getTime() - pastDays * 24 * 60 * 60 * 1000);
      query.createdAt = { $gte: cutoff };
    }

    const sortOptions = {};
    if (sortBy === 'name') sortOptions.name = sortOrder;
    else if (sortBy === 'patients') sortOptions.patientCount = sortOrder;
    else sortOptions.createdAt = sortOrder;

    // Aggregation to get doctors + live patient count
    const doctors = await Doctor.aggregate([
      { $match: query },
      {
        $lookup: {
          from: 'patients',
          localField: '_id',
          foreignField: 'doctorId',
          as: 'patients',
        },
      },
      {
        $addFields: {
          id: { $toString: '$_id' },
          patientCount: { $size: '$patients' },
        },
      },
      { $project: { patients: 0 } },
      { $sort: sortOptions },
      { $skip: (page - 1) * limit },
      { $limit: limit },
    ]);

    const total = await Doctor.countDocuments(query);

    return res.json({
      success: true,
      data: doctors,
      total,
      page,
      totalPages: Math.ceil(total / limit) || 1,
    });
  } catch (error) {
    console.error('Error fetching doctors:', error);
    return res.status(500).json({ success: false, error: error.message || 'Database connection error' });
  }
});

// POST /api/doctors - Create single doctor
router.post('/', async (req, res) => {
  try {
    const body = req.body;
    const { name, avatar, specialization, hospital, phone, email, address } = body;

    if (!name || !specialization || !hospital || !phone) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: name, specialization, hospital, and phone are mandatory.',
      });
    }

    const phoneRegex = /^01\d{9}$/;
    if (!phoneRegex.test(phone.trim())) {
      return res.status(400).json({
        success: false,
        error: 'Please enter a valid 11-digit phone number (e.g. 01712345678).',
      });
    }

    const docToCreate = {
      name: name.trim(),
      specialization: specialization.trim(),
      hospital: hospital.trim(),
      phone: phone.trim(),
    };
    if (avatar && String(avatar).trim()) docToCreate.avatar = String(avatar).trim();
    if (email && email.trim()) docToCreate.email = email.toLowerCase().trim();
    if (address && address.trim()) docToCreate.address = address.trim();

    const newDoctor = await Doctor.create(docToCreate);

    await Activity.create({
      type: 'doctor_added',
      title: 'New Physician Registered',
      description: `Dr. ${newDoctor.name} (${newDoctor.specialization}) was added to registry.`,
      iconType: 'doctor',
      timestamp: new Date(),
    });

    return res.status(201).json({
      success: true,
      data: {
        id: newDoctor._id.toString(),
        name: newDoctor.name,
        avatar: newDoctor.avatar || '',
        specialization: newDoctor.specialization,
        hospital: newDoctor.hospital,
        phone: newDoctor.phone,
        email: newDoctor.email || '',
        address: newDoctor.address || '',
        patientCount: 0,
        createdAt: newDoctor.createdAt,
      },
    });
  } catch (error) {
    console.error('Error creating doctor:', error);
    return res.status(500).json({ success: false, error: error.message || 'Database error' });
  }
});

// POST /api/doctors/bulk - Bulk import doctors
router.post('/bulk', async (req, res) => {
  try {
    const { doctors } = req.body;

    if (!Array.isArray(doctors) || doctors.length === 0) {
      return res.status(400).json({ success: false, error: 'Invalid doctors array provided.' });
    }

    const validDocs = [];
    const phoneRegex = /^01\d{9}$/;

    for (const d of doctors) {
      if (d.name && d.specialization && d.hospital && d.phone) {
        validDocs.push({
          name: d.name.trim(),
          avatar: d.avatar ? String(d.avatar) : undefined,
          specialization: d.specialization.trim(),
          hospital: d.hospital.trim(),
          phone: phoneRegex.test(d.phone.trim()) ? d.phone.trim() : `017${Math.floor(10000000 + Math.random() * 90000000)}`,
          email: d.email ? d.email.toLowerCase().trim() : undefined,
          address: d.address ? d.address.trim() : undefined,
        });
      }
    }

    if (validDocs.length === 0) {
      return res.status(400).json({ success: false, error: 'No valid doctor records found to import.' });
    }

    const inserted = await Doctor.insertMany(validDocs);

    await Activity.create({
      type: 'doctor_added',
      title: 'Bulk Physicians Imported',
      description: `Successfully imported ${inserted.length} physicians to the system.`,
      iconType: 'doctor',
      timestamp: new Date(),
    });

    return res.json({
      success: true,
      count: inserted.length,
      data: inserted.map((d) => ({
        id: d._id.toString(),
        name: d.name,
        specialization: d.specialization,
        hospital: d.hospital,
        phone: d.phone,
        email: d.email || '',
        patientCount: 0,
      })),
    });
  } catch (error) {
    console.error('Bulk doctor import error:', error);
    return res.status(500).json({ success: false, error: error.message || 'Bulk import failed' });
  }
});

// GET /api/doctors/:id - Get single doctor + assigned patient cohort
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: 'Invalid Doctor ID' });
    }

    const doctor = await Doctor.findById(id).lean();
    if (!doctor) {
      return res.status(404).json({ success: false, error: 'Doctor not found' });
    }

    const patients = await Patient.find({ doctorId: id })
      .sort({ admissionDate: -1 })
      .lean();

    const formattedPatients = patients.map((p) => ({
      id: p._id.toString(),
      name: p.name,
      avatar: p.avatar || '',
      age: p.age,
      gender: p.gender,
      condition: p.condition,
      phone: p.phone,
      email: p.email || '',
      address: p.address || '',
      admissionDate: p.admissionDate,
      notes: p.notes || '',
      createdAt: p.createdAt,
    }));

    return res.json({
      success: true,
      doctor: {
        id: doctor._id.toString(),
        name: doctor.name,
        avatar: doctor.avatar || '',
        specialization: doctor.specialization,
        hospital: doctor.hospital,
        phone: doctor.phone,
        email: doctor.email || '',
        address: doctor.address || '',
        createdAt: doctor.createdAt,
        patientCount: formattedPatients.length,
      },
      patients: formattedPatients,
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /api/doctors/:id - Update doctor
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const body = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: 'Invalid Doctor ID' });
    }

    const updateData = {};
    if (body.name) updateData.name = body.name.trim();
    if (body.avatar !== undefined) updateData.avatar = body.avatar ? String(body.avatar) : '';
    if (body.specialization) updateData.specialization = body.specialization.trim();
    if (body.hospital) updateData.hospital = body.hospital.trim();
    if (body.phone) {
      const phoneRegex = /^01\d{9}$/;
      if (!phoneRegex.test(body.phone.trim())) {
        return res.status(400).json({
          success: false,
          error: 'Please enter a valid 11-digit phone number (e.g. 01712345678).',
        });
      }
      updateData.phone = body.phone.trim();
    }
    if (body.email !== undefined) updateData.email = body.email ? body.email.toLowerCase().trim() : undefined;
    if (body.address !== undefined) updateData.address = body.address ? body.address.trim() : undefined;

    const updated = await Doctor.findByIdAndUpdate(id, updateData, { new: true }).lean();

    if (!updated) {
      return res.status(404).json({ success: false, error: 'Doctor not found' });
    }

    const patientCount = await Patient.countDocuments({ doctorId: id });

    await Activity.create({
      type: 'doctor_updated',
      title: 'Physician Profile Updated',
      description: `Details updated for Dr. ${updated.name}.`,
      iconType: 'edit',
      timestamp: new Date(),
    });

    return res.json({
      success: true,
      data: {
        id: updated._id.toString(),
        name: updated.name,
        avatar: updated.avatar || '',
        specialization: updated.specialization,
        hospital: updated.hospital,
        phone: updated.phone,
        email: updated.email || '',
        address: updated.address || '',
        patientCount,
        createdAt: updated.createdAt,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /api/doctors/:id - Delete doctor and clean up cohort
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: 'Invalid Doctor ID' });
    }

    const doctor = await Doctor.findById(id);
    if (!doctor) {
      return res.status(404).json({ success: false, error: 'Doctor not found' });
    }

    // Cascade delete assigned patients
    const patientDeleteResult = await Patient.deleteMany({ doctorId: id });
    await Doctor.findByIdAndDelete(id);

    await Activity.create({
      type: 'doctor_deleted',
      title: 'Physician Removed',
      description: `Dr. ${doctor.name} and ${patientDeleteResult.deletedCount} cohort records removed.`,
      iconType: 'alert',
      timestamp: new Date(),
    });

    return res.json({
      success: true,
      message: `Doctor and ${patientDeleteResult.deletedCount} assigned patients deleted successfully.`,
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;

