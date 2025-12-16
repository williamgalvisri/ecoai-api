const mongoose = require('mongoose');

const ClientPersonaSchema = new mongoose.Schema({
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    photoUrl: { type: String, default: '' },
    phoneNumber: { type: String, required: true, unique: true },
    passwordHash: { type: String, select: false },
    botName: {
        type: String,
        default: 'Assistant',
    },
    toneDescription: {
        type: String,
        required: true,
        // e.g., 'Friendly, casual, uses emojis'
    },
    keywords: {
        type: [String],
        default: [],
    },
    fillers: {
        type: [String],
        default: [],
    },
    responseExamples: [{
        intent: String,
        userMessage: String,
        idealResponse: String,
    }],
    businessContext: {
        services: [{
            name: { type: String, required: true },
            description: String,
            duration: { type: Number }, // Optional override. If null, use defaultDuration
            price: { type: Number }
        }],
        hours: {
            monday: { open: String, close: String, isOpen: { type: Boolean, default: true } },
            tuesday: { open: String, close: String, isOpen: { type: Boolean, default: true } },
            wednesday: { open: String, close: String, isOpen: { type: Boolean, default: true } },
            thursday: { open: String, close: String, isOpen: { type: Boolean, default: true } },
            friday: { open: String, close: String, isOpen: { type: Boolean, default: true } },
            saturday: { open: String, close: String, isOpen: { type: Boolean, default: true } },
            sunday: { open: String, close: String, isOpen: { type: Boolean, default: false } }
        },
        location: { type: String, default: '' },
        contactPhone: { type: String }
    },
    appointmentSettings: {
        defaultDuration: { type: Number, default: 30 }, // Default service time in minutes
        bufferTime: { type: Number, default: 5 },       // Cleaning time between slots
        timezone: { type: String, default: 'America/Bogota' }
    },
    reminderSettings: {
        isEnabled: { type: Boolean, default: true },
        hoursBefore: { type: Number, default: 24 }
    },
    usage: {
        promptTokens: { type: Number, default: 0 },      // Monthly Input Sum
        completionTokens: { type: Number, default: 0 },  // Monthly Output Sum
        totalTokens: { type: Number, default: 0 },       // Monthly Total Sum
        lastResetDate: { type: Date, default: Date.now } // To track billing cycle
    },
    subscription: {
        plan: { type: String, enum: ['basic', 'pro'], default: 'basic' },
        tokenLimit: { type: Number, default: 100000 },   // Monthly limit
        isActive: { type: Boolean, default: true }
    },
    createdAt: {
        type: Date,
        default: Date.now,
    },
    whatsappBussinesConfig: {
        token: {
            type: String,
            default: ''
        },
        phoneNumberId: {
            type: String,
            default: ''
        }
    }
});

module.exports = mongoose.model('ClientPersona', ClientPersonaSchema);
