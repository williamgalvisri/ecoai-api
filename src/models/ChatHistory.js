const mongoose = require('mongoose');

const ChatHistorySchema = new mongoose.Schema({
    phoneNumber: {
        type: String,
        required: true,
        index: true,
    },
    role: {
        type: String,
        enum: ['user', 'assistant', 'owner', 'system'],
        required: true,
    },
    content: {
        type: String,
        required: true,
    },
    timestamp: {
        type: Date,
        default: Date.now,
    },
    tokens: {
        prompt: { type: Number, default: 0 },      // Tokens used for this specific message input
        completion: { type: Number, default: 0 },  // Tokens generated for this specific response
        total: { type: Number, default: 0 }        // Total for this single interaction
    }
});

module.exports = mongoose.model('ChatHistory', ChatHistorySchema);
