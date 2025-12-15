const axios = require('axios');
const openaiService = require('../services/openaiService');
const ChatHistory = require('../models/ChatHistory');
const Contact = require('../models/Contact');
const ClientPersona = require('../models/ClientPersona');
const sseManager = require('../utils/sseManager');

// Verify Webhook
exports.verifyWebhook = (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token) {
        if (mode === 'subscribe' && token === process.env.VERIFY_TOKEN) {
            console.log('WEBHOOK_VERIFIED');
            res.status(200).send(challenge);
        } else {
            res.sendStatus(403);
        }
    }
};

// Handle Incoming Messages
exports.handleMessage = async (req, res) => {
    try {
        const body = req.body;

        if (body.object === 'whatsapp_business_account') {
            if (
                body.entry &&
                body.entry[0].changes &&
                body.entry[0].changes[0] &&
                body.entry[0].changes[0].value.messages &&
                body.entry[0].changes[0].value.messages[0]
            ) {
                const messageObject = body.entry[0].changes[0].value.messages[0];
                const phoneNumberId = body.entry[0].changes[0].value.metadata.phone_number_id;
                const from = messageObject.from; // Phone number
                const msgBody = messageObject.text?.body; // Text message content

                // BLOCK NON-TEXT MEDIA
                if (messageObject.type !== 'text') {
                    console.log(`Blocking non-text media: ${messageObject.type}`);

                    // 1. Reply to user
                    await axios({
                        method: 'POST',
                        url: `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`,
                        headers: {
                            'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}`,
                            'Content-Type': 'application/json',
                        },
                        data: {
                            messaging_product: 'whatsapp',
                            to: from,
                            text: { body: "Disculpa, por el momento solo puedo leer mensajes de texto. Por favor escríbeme lo que necesitas." },
                        },
                    });

                    // 2. Log attempt
                    await ChatHistory.create({
                        phoneNumber: from,
                        role: 'system',
                        content: `[User sent unsupported media: ${messageObject.type}]`
                    });

                    // Stop processing
                    return res.success(null, 'MEDIA_BLOCKED');
                }

                // Only handle text messages for now
                if (msgBody) {

                    // 1. Identify/Create Contact or Update
                    let contact = await Contact.findOne({ phoneNumber: from });
                    if (!contact) {
                        contact = await Contact.create({ phoneNumber: from, lastInteraction: new Date() });
                    } else {
                        // Update existing contact's last interaction
                        contact = await Contact.findByIdAndUpdate(
                            contact._id,
                            { lastInteraction: new Date() },
                            { new: true }
                        );
                    }

                    // 2. Save User Message
                    const userMsg = await ChatHistory.create({
                        phoneNumber: from,
                        role: 'user',
                        content: msgBody
                    });

                    // 3. Emit SSE Event (User Message)
                    sseManager.sendEvent('NEW_MESSAGE', {
                        contactId: contact._id,
                        phoneNumber: from,
                        role: 'user',
                        content: msgBody,
                        timestamp: userMsg.timestamp,
                    });

                    // 4. Check Bot Active Status
                    if (contact.isBotActive) {
                        // Generate AI Response
                        // TODO: Dynamic ownerId based on phoneNumberId or config
                        const ownerId = "user_123_costa";

                        // Limit Check
                        const persona = await ClientPersona.findOne({ ownerId });
                        // if (persona && persona.subscription.isActive) {
                        //     if (persona.usage.totalTokens >= persona.subscription.tokenLimit) {
                        //         console.warn(`Token limit exceeded for owner ${ownerId}.`);
                        //         // Optionally send a fallback message or just silence.
                        //         // sending fallback:
                        //         await axios({
                        //             method: 'POST',
                        //             url: `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`,
                        //             headers: {
                        //                 'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}`,
                        //                 'Content-Type': 'application/json',
                        //             },
                        //             data: {
                        //                 messaging_product: 'whatsapp',
                        //                 to: from,
                        //                 text: { body: "Service temporarily paused due to limit reached." },
                        //             },
                        //         });
                        //         return res.success(null, 'LIMIT_EXCEEDED');
                        //     }
                        // }

                        // Call Service
                        const { text: aiResponseText, usage } = await openaiService.generateResponse(from, msgBody, ownerId);

                        // Save Assistant Response & Audit Log
                        const aiMsg = await ChatHistory.create({
                            phoneNumber: from,
                            role: 'assistant',
                            content: aiResponseText, // Use the text part
                            tokens: {
                                prompt: usage.prompt_tokens,
                                completion: usage.completion_tokens,
                                total: usage.total_tokens
                            }
                        });

                        // Update Aggregate Usage
                        if (persona) {
                            await ClientPersona.updateOne(
                                { _id: persona._id },
                                {
                                    $inc: {
                                        'usage.promptTokens': usage.prompt_tokens,
                                        'usage.completionTokens': usage.completion_tokens,
                                        'usage.totalTokens': usage.total_tokens
                                    }
                                }
                            );
                        }

                        // Emit SSE Event (Assistant Message)
                        sseManager.sendEvent('NEW_MESSAGE', {
                            contactId: contact._id,
                            phoneNumber: from,
                            role: 'assistant',
                            content: aiResponseText,
                            timestamp: aiMsg.timestamp,
                        });

                        // Send Response to WhatsApp
                        await axios({
                            method: 'POST',
                            url: `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`,
                            headers: {
                                'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}`,
                                'Content-Type': 'application/json',
                            },
                            data: {
                                messaging_product: 'whatsapp',
                                to: from,
                                text: { body: aiResponseText },
                            },
                        });
                    } else {
                        console.log(`Bot disabled for ${from}. Skipping AI response.`);
                    }
                }
            }
            return res.success(null, 'EVENT_RECEIVED');
        } else {
            res.sendStatus(404);
        }
    } catch (error) {
        console.error('Error handling WhatsApp message:', error.response ? error.response.data : error.message);
        return res.error(error); // This sends a JSON error response. Webhooks usually just want a 500 status, but this is what was requested.
    }
};
