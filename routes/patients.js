const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Patient = require('../models/Patient');
const Doctor = require('../models/Doctor');
const Activity = require('../models/Activity');

// GET /api/patients - List patients with search, condition, doctor, date filtering, pagination
router.get('/', async (req, res) => {
  try {
    const search = (req.query.search || '').trim();
    const condition = (req.query.condition || 'all').trim();
    const doctorId = (req.query.doctorId || 'all').trim();
    const dateFilter = (req.query.date || 'all').trim();
    const sortBy = (req.query.sortBy || 'admissionDate').trim();
    const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = Math.max(1, parseInt(req.query.limit || '50', 10));

    const query = {};

    if (search) {
      const searchRegex = new RegExp(search, 'i');
      query.$or = [
        { name: searchRegex },
        { phone: searchRegex },
        { email: searchRegex },
        { address: searchRegex },
        { notes: searchRegex },
      ];
    }

    if (condition && condition !== 'all') {
      query.condition = condition;
    }

    if (doctorId && doctorId !== 'all') {
      query.doctorId = doctorId;
    }

    if (dateFilter && dateFilter !== 'all') {
      const now = new Date();
      let pastDays = 30;
      if (dateFilter === '90d') pastDays = 90;
      if (dateFilter === 'year') pastDays = 365;
      const cutoff = new Date(now.getTime() - pastDays * 24 * 60 * 60 * 1000);
      query.admissionDate = { $gte: cutoff };
    }

    const sortOptions = {};
    if (sortBy === 'name') sortOptions.name = sortOrder;
    else if (sortBy === 'age') sortOptions.age = sortOrder;
    else if (sortBy === 'condition') sortOptions.condition = sortOrder;
    else sortOptions.admissionDate = sortOrder;

    const patients = await Patient.find(query)
      .populate('doctorId', 'name specialization hospital')
      .sort(sortOptions)
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    const formatted = patients.map((p) => ({
      id: p._id.toString(),
      name: p.name,
      avatar: p.avatar || '',
      age: p.age,
      gender: p.gender,
      condition: p.condition,
      phone: p.phone,
      email: p.email || '',
      address: p.address || '',
      doctorId: p.doctorId?._id?.toString() || p.doctorId?.toString(),
      doctorName: p.doctorId?.name || 'Unassigned',
      hospital: p.doctorId?.hospital || 'Hospital',
      admissionDate: p.admissionDate,
      notes: p.notes,
      createdAt: p.createdAt,
    }));

    const total = await Patient.countDocuments(query);

    return res.json({
      success: true,
      data: formatted,
      total,
      page,
      totalPages: Math.ceil(total / limit) || 1,
    });
  } catch (error) {
    console.error('Error fetching patients:', error);
    return res.status(500).json({ success: false, error: error.message || 'Database error' });
  }
});

// POST /api/patients - Register new patient
router.post('/', async (req, res) => {
  try {
    const body = req.body;
    const { name, avatar, age, gender, condition, phone, email, address, doctorId, admissionDate, notes } = body;

    if (!name || age === undefined || !gender || !condition || !phone || !doctorId) {
      return res.status(400).json({
        success: false,
        error: 'Missing mandatory fields: name, age, gender, condition, phone, and doctorId are required.',
      });
    }

    if (!mongoose.Types.ObjectId.isValid(doctorId)) {
      return res.status(400).json({ success: false, error: 'Invalid Doctor ID' });
    }

    const doctor = await Doctor.findById(doctorId);
    if (!doctor) {
      return res.status(404).json({ success: false, error: 'Assigned doctor was not found.' });
    }

    const newPatient = await Patient.create({
      name: name.trim(),
      avatar: avatar ? String(avatar) : undefined,
      age: Number(age),
      gender,
      condition,
      phone: phone.trim(),
      email: email ? email.toLowerCase().trim() : undefined,
      address: address ? address.trim() : undefined,
      doctorId,
      admissionDate: admissionDate ? new Date(admissionDate) : new Date(),
      notes: notes ? notes.trim() : undefined,
    });

    await Activity.create({
      type: 'patient_added',
      title: 'Patient Enrolled',
      description: `${newPatient.name} enrolled under Dr. ${doctor.name} (${newPatient.condition}).`,
      iconType: 'patient',
      timestamp: new Date(),
    });

    return res.status(201).json({
      success: true,
      data: {
        id: newPatient._id.toString(),
        name: newPatient.name,
        avatar: newPatient.avatar || '',
        age: newPatient.age,
        gender: newPatient.gender,
        condition: newPatient.condition,
        phone: newPatient.phone,
        email: newPatient.email || '',
        address: newPatient.address || '',
        doctorId: doctor._id.toString(),
        doctorName: doctor.name,
        hospital: doctor.hospital,
        admissionDate: newPatient.admissionDate,
        notes: newPatient.notes,
        createdAt: newPatient.createdAt,
      },
    });
  } catch (error) {
    console.error('Error creating patient:', error);
    return res.status(500).json({ success: false, error: error.message || 'Database error' });
  }
});

// POST /api/patients/bulk - Bulk import patients
router.post('/bulk', async (req, res) => {
  try {
    const { patients } = req.body;

    if (!Array.isArray(patients) || patients.length === 0) {
      return res.status(400).json({ success: false, error: 'Invalid patients array' });
    }

    const allDoctors = await Doctor.find().lean();
    if (allDoctors.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No doctors registered in database to assign patients to.',
      });
    }

    const validConditions = ['Critical', 'Serious', 'Stable', 'Recovering', 'Routine Checkup'];
    const validPatients = [];

    for (const p of patients) {
      if (p.name && p.phone) {
        let assignedDoctor = null;
        if (p.doctorName) {
          assignedDoctor = allDoctors.find(
            (d) => d.name.toLowerCase().includes(p.doctorName.toLowerCase()) ||
                   p.doctorName.toLowerCase().includes(d.name.toLowerCase())
          );
        }
        if (!assignedDoctor && p.doctorId && mongoose.Types.ObjectId.isValid(p.doctorId)) {
          assignedDoctor = allDoctors.find((d) => d._id.toString() === p.doctorId);
        }
        if (!assignedDoctor) {
          assignedDoctor = allDoctors[Math.floor(Math.random() * allDoctors.length)];
        }

        const condition = validConditions.includes(p.condition) ? p.condition : 'Stable';
        const gender = ['Male', 'Female', 'Other'].includes(p.gender) ? p.gender : 'Other';

        validPatients.push({
          name: p.name.trim(),
          avatar: p.avatar ? String(p.avatar) : undefined,
          age: Number(p.age) || 35,
          gender,
          condition,
          phone: p.phone.trim(),
          email: p.email ? p.email.toLowerCase().trim() : undefined,
          address: p.address ? p.address.trim() : undefined,
          doctorId: assignedDoctor._id,
          admissionDate: p.admissionDate ? new Date(p.admissionDate) : new Date(),
          notes: p.notes ? p.notes.trim() : 'Bulk imported cohort record',
        });
      }
    }

    if (validPatients.length === 0) {
      return res.status(400).json({ success: false, error: 'No valid patient records could be parsed.' });
    }

    const inserted = await Patient.insertMany(validPatients);

    await Activity.create({
      type: 'patient_added',
      title: 'Bulk Patients Imported',
      description: `Successfully enrolled ${inserted.length} patient records.`,
      iconType: 'patient',
      timestamp: new Date(),
    });

    return res.json({
      success: true,
      count: inserted.length,
      data: inserted.map((p) => ({
        id: p._id.toString(),
        name: p.name,
        condition: p.condition,
        doctorId: p.doctorId.toString(),
      })),
    });
  } catch (error) {
    console.error('Bulk patient import error:', error);
    return res.status(500).json({ success: false, error: error.message || 'Bulk patient import failed' });
  }
});

// GET /api/patients/:id - Get patient details
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: 'Invalid Patient ID' });
    }

    const patient = await Patient.findById(id).populate('doctorId', 'name specialization hospital phone email').lean();
    if (!patient) {
      return res.status(404).json({ success: false, error: 'Patient not found' });
    }

    return res.json({
      success: true,
      data: {
        id: patient._id.toString(),
        name: patient.name,
        avatar: patient.avatar || '',
        age: patient.age,
        gender: patient.gender,
        condition: patient.condition,
        phone: patient.phone,
        email: patient.email || '',
        address: patient.address || '',
        doctorId: patient.doctorId?._id?.toString() || patient.doctorId?.toString(),
        doctorName: patient.doctorId?.name || 'Unassigned',
        specialization: patient.doctorId?.specialization || '',
        hospital: patient.doctorId?.hospital || '',
        doctorPhone: patient.doctorId?.phone || '',
        admissionDate: patient.admissionDate,
        notes: patient.notes || '',
        createdAt: patient.createdAt,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /api/patients/:id - Update patient
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const body = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: 'Invalid Patient ID' });
    }

    const updateData = {
      name: body.name?.trim(),
      age: body.age !== undefined ? Number(body.age) : undefined,
      gender: body.gender,
      condition: body.condition,
      phone: body.phone?.trim(),
      email: body.email?.trim(),
      address: body.address !== undefined ? (body.address ? String(body.address).trim() : '') : undefined,
      avatar: body.avatar !== undefined ? (body.avatar ? String(body.avatar) : '') : undefined,
      notes: body.notes?.trim(),
    };

    if (body.admissionDate) {
      updateData.admissionDate = new Date(body.admissionDate);
    }

    if (body.doctorId) {
      updateData.doctorId = body.doctorId;
    }

    const updated = await Patient.findByIdAndUpdate(id, updateData, { new: true })
      .populate('doctorId', 'name specialization hospital')
      .lean();

    if (!updated) {
      return res.status(404).json({ success: false, error: 'Patient not found' });
    }

    await Activity.create({
      type: 'patient_updated',
      title: 'Patient Record Updated',
      description: `Clinical record updated for ${updated.name}.`,
      iconType: 'edit',
      timestamp: new Date(),
    });

    return res.json({
      success: true,
      data: {
        id: updated._id.toString(),
        name: updated.name,
        avatar: updated.avatar || '',
        age: updated.age,
        gender: updated.gender,
        condition: updated.condition,
        phone: updated.phone,
        email: updated.email || '',
        address: updated.address || '',
        doctorId: updated.doctorId?._id?.toString() || updated.doctorId?.toString(),
        doctorName: updated.doctorId?.name || 'Doctor',
        hospital: updated.doctorId?.hospital || 'Hospital',
        admissionDate: updated.admissionDate,
        notes: updated.notes,
        createdAt: updated.createdAt,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /api/patients/:id - Delete patient
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: 'Invalid Patient ID' });
    }

    const patient = await Patient.findByIdAndDelete(id);
    if (!patient) {
      return res.status(404).json({ success: false, error: 'Patient not found' });
    }

    await Activity.create({
      type: 'patient_deleted',
      title: 'Patient Discharged / Removed',
      description: `Patient file for ${patient.name} has been archived/deleted.`,
      iconType: 'alert',
      timestamp: new Date(),
    });

    return res.json({
      success: true,
      message: 'Patient record deleted successfully.',
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;

