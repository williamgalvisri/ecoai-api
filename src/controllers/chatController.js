const axios = require('axios');
const ChatHistory = require('../models/ChatHistory');
const sseManager = require('../utils/sseManager');
const Contact = require('../models/Contact');
const ClientPersona = require('../models/ClientPersona');
const { BadRequestError } = require('../utils/ApiResponse');

exports.handleChat = async (req, res) => {
    try {
        const { message, userPhone } = req.body;

        const clientPersonaId = req.user.clientPersonaId;
        if (!clientPersonaId) {
            return res.error(new BadRequestError('Client Persona ID is required.'));
        }

        if (!message || !userPhone) {
            return res.error(new BadRequestError('Message and userPhone are required.'));
        }

        const persona = await ClientPersona.findById(clientPersonaId);
        if (!persona) {
            return res.error(new BadRequestError('Client Persona not found.'));
        }

        const phoneNumberId = persona.whatsappBussinesConfig.phoneNumberId;
        if (!phoneNumberId) {
            console.error("Missing PHONE_NUMBER_ID in .env");
            return res.error(new BadRequestError('Server configuration error: Missing Phone Number ID.'));
        }

        // 1. Find Contact (for ID)
        const contact = await Contact.findOne({ phoneNumber: userPhone });

        // 2. Send to WhatsApp
        await axios({
            method: 'POST',
            url: `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`,
            headers: {
                'Authorization': `Bearer ${persona.whatsappBussinesConfig.token}`,
                'Content-Type': 'application/json',
            },
            data: {
                messaging_product: 'whatsapp',
                to: userPhone,
                text: { body: message },
            },
        });

        // 3. Save to History
        const savedMsg = await ChatHistory.create({
            phoneNumber: userPhone,
            role: 'owner',
            content: message,
            timestamp: new Date()
        });

        // Update last interaction for contact
        await Contact.findOneAndUpdate(
            { phoneNumber: userPhone },
            { lastInteraction: new Date() }
        );

        // 4. Emit SSE (so dashboard sees it too, avoiding refresh)
        if (contact) {
            sseManager.sendEvent(clientPersonaId, 'NEW_MESSAGE', {
                contactId: contact._id,
                phoneNumber: userPhone,
                role: 'owner',
                content: message,
                timestamp: savedMsg.timestamp,
            });
        }

        return res.success({ success: true, message: "Sent" });
    } catch (error) {
        console.error('Chat processing error:', error.response ? error.response.data : error.message);
        return res.error(error);
    }
};
