const mongoose = require('mongoose');

const PatientSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    avatar: { type: String, required: false },
    age: { type: Number, required: true, min: 0, max: 150 },
    gender: { type: String, enum: ['Male', 'Female', 'Other'], required: true },
    condition: {
      type: String,
      enum: ['Critical', 'Serious', 'Stable', 'Recovering', 'Routine Checkup'],
      required: true,
      index: true,
    },
    phone: { type: String, required: true, trim: true },
    email: { type: String, lowercase: true, trim: true },
    address: { type: String, trim: true },
    doctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Doctor', required: true, index: true },
    admissionDate: { type: Date, default: Date.now, index: true },
    notes: { type: String, trim: true },
  },
  {
    timestamps: true,
  }
);

// High-performance search and filter indexes
PatientSchema.index({ doctorId: 1, createdAt: -1 });
PatientSchema.index({ condition: 1, admissionDate: -1 });
PatientSchema.index({ name: 'text', phone: 'text', address: 'text' });

module.exports = mongoose.models.Patient || mongoose.model('Patient', PatientSchema);

