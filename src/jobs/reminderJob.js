const cron = require('node-cron');
const Appointment = require('../models/Appointment');
const ChatHistory = require('../models/ChatHistory');
const ClientPersona = require('../models/ClientPersona');
const axios = require('axios');

const setupReminderJob = () => {
    // Run every 30 minutes
    cron.schedule('*/10 * * * *', async () => {
        console.log('Running reminder job...');
        try {
            const now = new Date();
            // Find confirmed appointments in the future that haven't had a reminder sent
            const appointments = await Appointment.find({
                status: 'confirmed',
                $or: [
                    { reminderSent: false },
                    { reminderSent: { $exists: false } }
                ]
            }).populate('contactId'); // Need contact phone if customerPhone is not reliable

            for (const apt of appointments) {
                // If ownerId is missing, we can't fetch specific settings easily
                // For now, let's assume one main persona or try to find one. 
                // Ideally apt.ownerId should be populated.
                // If apt.ownerId is missing, we might skip or use a default.

                let persona;
                if (apt.ownerId) {
                    // apt.ownerId is now an ObjectId referencing ClientPersona
                    persona = await ClientPersona.findById(apt.ownerId);
                } else {
                    // Fallback to the first persona found (temporary for single-tenant or if ownerId not saved yet)
                    persona = await ClientPersona.findOne({});
                }

                if (!persona || !persona.reminderSettings || !persona.reminderSettings.isEnabled) {
                    continue;
                }

                const hoursBefore = persona.reminderSettings.hoursBefore;
                const msBefore = hoursBefore * 60 * 60 * 1000;
                const timeDiff = new Date(apt.dateTime) - now;

                // Check if we are within the window (e.g., between N and N-1 hours before)
                // Actually, just check if timeDiff <= desired time. 
                // But to avoid duplicate sending (if job runs often), we rely on reminderSent=false.
                // However, if we check <= 24h, it will be true 24h before, 23h before, etc.
                // So we should verify we haven't missed it too much? 
                // "Simple reminder logic": If it's effectively "time to remind".
                // Let's say: timeDiff <= msBefore.

                if (timeDiff <= msBefore) {
                    // It's time!
                    const phone = apt.customerPhone || apt.contactId?.phoneNumber;
                    if (!phone) {
                        console.error(`No phone number for appointment ${apt._id}`);
                        continue;
                    }

                    // Send Message
                    const message = `Hola ${apt.contactId?.name || ''}, recuerda tu cita para mañana a las ${new Date(apt.dateTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`;

                    // Use WhatsApp API directly (or a helper if available)
                    // We need PHONE_NUMBER_ID and WHATSAPP_TOKEN
                    await sendWhatsAppMessage(phone, message);

                    // Add to Chat History using 'assistant' role so AI sees it
                    await ChatHistory.create({
                        phoneNumber: phone,
                        role: 'assistant',
                        content: message,
                        timestamp: new Date()
                    });

                    // Update Flag
                    apt.reminderSent = true;
                    await apt.save();
                    console.log(`Reminder sent for appointment ${apt._id}`);
                }
            }


        } catch (error) {
            console.error('Error in reminder job:', error);
        }
    });
};

async function sendWhatsAppMessage(to, body) {
    const token = process.env.WHATSAPP_TOKEN;
    const phoneId = process.env.PHONE_NUMBER_ID;

    if (!token || !phoneId) {
        console.error("Missing WhatsApp credentials for reminder.");
        return;
    }

    try {
        await axios.post(
            `https://graph.facebook.com/v18.0/${phoneId}/messages`,
            {
                messaging_product: "whatsapp",
                to: to,
                type: "text",
                text: { body: body },
            },
            {
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json",
                },
            }
        );
    } catch (error) {
        console.error("Error sending WhatsApp reminder:", error.response ? error.response.data : error.message);
    }
}

module.exports = setupReminderJob;
