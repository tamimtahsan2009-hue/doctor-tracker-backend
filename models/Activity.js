const mongoose = require('mongoose');

const ActivitySchema = new mongoose.Schema(
  {
    type: { type: String, required: true },
    title: { type: String, required: true },
    description: { type: String, required: true },
    iconType: { type: String, default: 'doctor' },
    timestamp: { type: Date, default: Date.now, index: true },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.models.Activity || mongoose.model('Activity', ActivitySchema);

