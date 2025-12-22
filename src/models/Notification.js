const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
    ownerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'ClientPersona',
        required: true
    },
    type: {
        type: String,
        enum: ['appointment_booked', 'appointment_cancelled'],
        required: true
    },
    title: {
        type: String,
        required: true
    },
    message: {
        type: String,
        required: true
    },
    relatedResourceId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Appointment'
    },
    status: {
        type: String,
        enum: ['new', 'viewed', 'deleted'],
        default: 'new'
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('Notification', notificationSchema);
