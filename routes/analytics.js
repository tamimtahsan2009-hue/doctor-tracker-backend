const express = require('express');
const router = express.Router();
const Doctor = require('../models/Doctor');
const Patient = require('../models/Patient');
const Activity = require('../models/Activity');
const { parseDateRange, formatDateLabel } = require('../utils/analyticsHelpers');

// GET /api/analytics - Dashboard overall analytics stats
router.get('/', async (req, res) => {
  try {
    const [totalDoctors, totalPatients, criticalPatients, activities] = await Promise.all([
      Doctor.countDocuments(),
      Patient.countDocuments(),
      Patient.countDocuments({ condition: 'Critical' }),
      Activity.find().sort({ timestamp: -1 }).limit(10).lean(),
    ]);

    const avgPatientsPerDoctor =
      totalDoctors > 0 ? parseFloat((totalPatients / totalDoctors).toFixed(1)) : 0;

    // Aggregation: Condition distribution
    const conditionStats = await Patient.aggregate([
      {
        $group: {
          _id: '$condition',
          count: { $sum: 1 },
        },
      },
    ]);

    // Aggregation: Patients per doctor (top 8)
    const doctorStats = await Doctor.aggregate([
      {
        $lookup: {
          from: 'patients',
          localField: '_id',
          foreignField: 'doctorId',
          as: 'patients',
        },
      },
      {
        $project: {
          name: { $concat: ['Dr. ', '$name'] },
          fullName: '$name',
          specialization: '$specialization',
          patients: { $size: '$patients' },
        },
      },
      { $sort: { patients: -1 } },
      { $limit: 8 },
    ]);

    const formattedActivities = activities.map((a) => ({
      id: a._id.toString(),
      type: a.type,
      title: a.title,
      description: a.description,
      iconType: a.iconType,
      timestamp: a.timestamp,
    }));

    return res.json({
      success: true,
      stats: {
        totalDoctors,
        totalPatients,
        avgPatientsPerDoctor,
        criticalPatients,
        newRecordsThisMonth: totalDoctors + totalPatients,
      },
      doctorStats,
      conditionStats: conditionStats.map((c) => ({
        condition: c._id || 'Unknown',
        count: c.count,
      })),
      recentActivities: formattedActivities,
    });
  } catch (error) {
    console.error('Analytics Error:', error);
    return res.status(500).json({ success: false, error: error.message || 'Database error' });
  }
});

// GET /api/analytics/overview - KPI Summary with period comparisons
router.get('/overview', async (req, res) => {
  try {
    const { range, startDate, endDate, dateMatch, prevDateMatch } = parseDateRange(req.query);

    const [totalDoctors, totalPatients, prevPatientsCount, newRegistrations] = await Promise.all([
      Doctor.countDocuments(),
      Patient.countDocuments(),
      prevDateMatch ? Patient.countDocuments(prevDateMatch) : Promise.resolve(0),
      dateMatch && Object.keys(dateMatch).length > 0 ? Patient.countDocuments(dateMatch) : Patient.countDocuments(),
    ]);

    const avgPatientsPerDoctor =
      totalDoctors > 0 ? parseFloat((totalPatients / totalDoctors).toFixed(1)) : 0;

    let patientGrowthPercent = null;
    if (prevDateMatch && prevPatientsCount > 0) {
      patientGrowthPercent = parseFloat(
        (((newRegistrations - prevPatientsCount) / prevPatientsCount) * 100).toFixed(1)
      );
    } else if (prevDateMatch && prevPatientsCount === 0 && newRegistrations > 0) {
      patientGrowthPercent = 100;
    }

    return res.json({
      success: true,
      data: {
        range,
        startDate: startDate ? startDate.toISOString() : null,
        endDate: endDate.toISOString(),
        totalDoctors: {
          value: totalDoctors,
          label: 'Total Registered Doctors',
          subtext: 'Active clinical practitioners in directory',
        },
        totalPatients: {
          value: totalPatients,
          label: 'Total Patient Records',
          subtext: 'All-time enrolled healthcare files',
        },
        avgPatientsPerDoctor: {
          value: avgPatientsPerDoctor,
          label: 'Avg Patients per Doctor',
          subtext: 'Case distribution efficiency',
        },
        newRegistrations: {
          value: newRegistrations,
          label: 'New Patient Registrations',
          subtext: range === 'all' ? 'All-time admitted patients' : `Enrolled during selected range`,
          growthPercent: patientGrowthPercent,
          previousCount: prevDateMatch ? prevPatientsCount : null,
        },
        lastUpdated: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('Error fetching analytics overview:', error);
    return res.status(500).json({ success: false, error: error.message || 'Database error' });
  }
});

// GET /api/analytics/patient-trends - Patient registration trends over time
router.get('/patient-trends', async (req, res) => {
  try {
    const { range, startDate, endDate, groupBy, dateMatch } = parseDateRange(req.query);

    let dateFormat = '%Y-%m-%d';
    if (groupBy === 'monthly') {
      dateFormat = '%Y-%m';
    } else if (groupBy === 'weekly') {
      dateFormat = '%Y-W%V';
    }

    const matchStage = dateMatch && Object.keys(dateMatch).length > 0 ? [{ $match: dateMatch }] : [];

    const rawTrends = await Patient.aggregate([
      ...matchStage,
      {
        $group: {
          _id: {
            $dateToString: {
              format: dateFormat,
              date: '$admissionDate',
            },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    let cumulative = 0;
    const trends = rawTrends.map((t) => {
      cumulative += t.count;
      return {
        date: t._id,
        label: formatDateLabel(t._id, groupBy),
        count: t.count,
        cumulative,
      };
    });

    const totalInRange = trends.reduce((acc, curr) => acc + curr.count, 0);

    return res.json({
      success: true,
      data: {
        range,
        groupBy,
        startDate: startDate ? startDate.toISOString() : null,
        endDate: endDate.toISOString(),
        totalInRange,
        trends,
      },
    });
  } catch (error) {
    console.error('Error in patient-trends:', error);
    return res.status(500).json({ success: false, error: error.message || 'Database error' });
  }
});

// GET /api/analytics/patients-per-doctor - Horizontal bar chart data
router.get('/patients-per-doctor', async (req, res) => {
  try {
    const showAll = req.query.all === 'true';
    const limit = showAll ? 100 : 10;

    const doctorsWithCounts = await Doctor.aggregate([
      {
        $lookup: {
          from: 'patients',
          localField: '_id',
          foreignField: 'doctorId',
          as: 'patients',
        },
      },
      {
        $project: {
          id: { $toString: '$_id' },
          name: '$name',
          specialization: '$specialization',
          hospital: '$hospital',
          patientCount: { $size: '$patients' },
        },
      },
      { $sort: { patientCount: -1, name: 1 } },
      { $limit: limit },
    ]);

    const totalDoctors = await Doctor.countDocuments();

    return res.json({
      success: true,
      data: {
        doctors: doctorsWithCounts,
        totalDoctors,
        isShowingAll: showAll,
        hasMore: !showAll && totalDoctors > 10,
      },
    });
  } catch (error) {
    console.error('Error in patients-per-doctor:', error);
    return res.status(500).json({ success: false, error: error.message || 'Database error' });
  }
});

// GET /api/analytics/patient-status - Condition distribution donut chart
router.get('/patient-status', async (req, res) => {
  try {
    const { range, dateMatch } = parseDateRange(req.query);
    const matchStage = dateMatch && Object.keys(dateMatch).length > 0 ? [{ $match: dateMatch }] : [];

    const stats = await Patient.aggregate([
      ...matchStage,
      {
        $group: {
          _id: '$condition',
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
    ]);

    const totalPatients = stats.reduce((acc, curr) => acc + curr.count, 0);

    const statusColors = {
      Critical: '#EF4444',
      Serious: '#F59E0B',
      Stable: '#10B981',
      Recovering: '#3B82F6',
      'Routine Checkup': '#8B5CF6',
    };

    const categories = stats.map((item) => {
      const conditionName = item._id || 'Unknown';
      const percentage = totalPatients > 0 ? parseFloat(((item.count / totalPatients) * 100).toFixed(1)) : 0;
      return {
        condition: conditionName,
        count: item.count,
        percentage,
        color: statusColors[conditionName] || '#6B7280',
      };
    });

    return res.json({
      success: true,
      data: {
        range,
        totalPatients,
        categories,
      },
    });
  } catch (error) {
    console.error('Error in patient-status:', error);
    return res.status(500).json({ success: false, error: error.message || 'Database error' });
  }
});

// GET /api/analytics/specializations - Specialization distribution
router.get('/specializations', async (req, res) => {
  try {
    const doctorsBySpecialization = await Doctor.aggregate([
      {
        $group: {
          _id: '$specialization',
          doctorCount: { $sum: 1 },
        },
      },
      { $sort: { doctorCount: -1 } },
    ]);

    const patientsBySpecialization = await Patient.aggregate([
      {
        $lookup: {
          from: 'doctors',
          localField: 'doctorId',
          foreignField: '_id',
          as: 'doctor',
        },
      },
      { $unwind: { path: '$doctor', preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: '$doctor.specialization',
          patientCount: { $sum: 1 },
        },
      },
      { $sort: { patientCount: -1 } },
    ]);

    const patientMap = {};
    patientsBySpecialization.forEach((item) => {
      patientMap[item._id || 'Unassigned'] = item.patientCount;
    });

    const combined = doctorsBySpecialization.map((item) => {
      const spec = item._id || 'General Medicine';
      return {
        specialization: spec,
        doctors: item.doctorCount,
        patients: patientMap[spec] || 0,
      };
    });

    return res.json({
      success: true,
      data: combined,
    });
  } catch (error) {
    console.error('Error in specializations analytics:', error);
    return res.status(500).json({ success: false, error: error.message || 'Database error' });
  }
});

module.exports = router;

