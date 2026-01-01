const OpenAI = require('openai');
const ClientPersona = require('../models/ClientPersona');
const ChatHistory = require('../models/ChatHistory');
const Appointment = require('../models/Appointment');
const Contact = require('../models/Contact');
const Notification = require('../models/Notification');
const sseManager = require('../utils/sseManager');

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Generates a response from OpenAI based on the user's message, history, and the client's persona.
 * @param {string} phoneNumber - The user's phone number.
 * @param {string} messageText - The message from the user.
 * @param {string} ownerId - The ID of the business owner to fetch the persona.
 * @returns {Promise<{text: string, usage: object}>} - The AI's response and token usage.
 */
async function generateResponse(phoneNumber, messageText, ownerId) {
    try {
        // 1. Identify/Create Contact
        let contact = await Contact.findOne({ phoneNumber });
        if (!contact) {
            contact = await Contact.create({ phoneNumber, ownerId });
        }

        // Populating reference to current appointment if exists
        if (contact.currentAppointment) {
            await contact.populate('currentAppointment');
        }

        // 2. Fetch Client Persona
        // Assuming ownerId is passed or determined upstream
        const persona = await ClientPersona.findOne({ _id: ownerId });

        if (!persona) {
            console.warn(`Persona not found for ownerId: ${ownerId}. Using fallback.`);
        }

        // 3. Fetch Context (Optimized)
        const history = await ChatHistory.find({ phoneNumber })
            .sort({ timestamp: -1 })
            .limit(5);

        // Reverse to chronological order for the LLM
        const conversationHistory = history.reverse().map(msg => ({
            role: msg.role === 'owner' ? 'assistant' : msg.role,
            content: msg.content,
        }));

        // 4. Construct System Prompt
        let systemPrompt = "You are a helpful assistant.";
        if (persona) {
            const examples = persona.responseExamples.map(ex => `User: ${ex.userMessage}\nYou: ${ex.idealResponse}`).join('\n');

            // Format Services
            const servicesList = persona.businessContext?.services?.map(s =>
                `- ${s.name} ($${s.price || '?'})${s.duration ? `, ${s.duration} mins` : ''}${s.description ? `: ${s.description}` : ''}`
            ).join('\n') || 'No specific services listed.';

            // Format Hours
            const hoursObj = persona.businessContext?.hours;
            let hoursStr = "Hours not specified.";
            if (hoursObj) {
                // @ts-ignore
                hoursStr = Object.entries(hoursObj).map(([day, val]) => {
                    if (!val.isOpen) return `${day.charAt(0).toUpperCase() + day.slice(1)}: Closed`;
                    return `${day.charAt(0).toUpperCase() + day.slice(1)}: ${val.open} - ${val.close}`;
                }).join('\n');
            }

            const location = persona.businessContext?.location || 'Not specified';
            const contactPhone = persona.businessContext?.contactPhone || '';

            const defaultDuration = persona.appointmentSettings?.defaultDuration || 30;
            const bufferTime = persona.appointmentSettings?.bufferTime || 5;

            systemPrompt = `### 1. ROLE & IDENTITY
            You are ${persona.botName}. Your tone is ${persona.toneDescription}.
            Use these keywords naturally: ${persona.keywords.join(', ')}.
            Use these fillers occasionally: ${persona.fillers.join(', ')}.

            ### 2. DYNAMIC USER CONTEXT
            The user's current name in the database is: "${contact.name}".

            ${(contact.name === 'Cliente' || contact.name === 'Unknown')
            ? `!!! HIGHEST PRIORITY ALERT !!!
            - You DO NOT know the user's name yet.
            - Your PRIMARY GOAL is to politely ask for their name to save it.
            - Make up a casual excuse (e.g., "I lost my contacts" or "I changed my phone").
            - DO NOT confirm appointments until you have the name.
            - Once obtained, execute 'updateContactName' IMMEDIATELY.`
            : `You are speaking with ${contact.name}.`}

            ### 3. BUSINESS KNOWLEDGE BASE
            Location: ${location}
            Contact: ${contactPhone}
            Operating Hours:
            ${hoursStr}

            Services & Pricing:
            ${servicesList}

            Current Date/Time: ${new Date().toLocaleString('en-US', { timeZone: persona.appointmentSettings?.timezone || 'America/Bogota' })}
            Active Appointment: ${contact.currentAppointment ? `YES: ${new Date(contact.currentAppointment.dateTime).toLocaleString()} for ${contact.currentAppointment.service}.` : "None."}

            ### 4. PLAN-AND-SOLVE PROTOCOL (MANDATORY)
            **YOU ARE BLIND TO THE CALENDAR.** You have zero knowledge of free slots until you use the tool.
            Before responding, you MUST perform this internal "Plan-and-Solve" sequence:

            **Step 1: Decompose the Request** [1]
            - Identify the user's intent (Book, Cancel, Info).
            - Identify variables provided (Date, Time, Service) vs. variables missing.

            **Step 2: Tool Execution Plan** [3]
            - IF the user mentions a time/date OR asks for availability:
            - **ACTION:** You MUST call 'checkAvailability' immediately.
            - **CONSTRAINT:** Do NOT guess. Do NOT say "it is available" before the tool returns "Available".
            - IF the user confirms a booking:
            - **ACTION:** Call 'bookAppointment'.

            **Step 3: Self-Correction & Response** [5]
            - Did I run the tool? If no, STOP and run it.
            - Read the tool output. If the tool says "Busy", you MUST refuse the slot and offer the tool's alternatives.

            ### 5. EXECUTION RULES
            1. **SILENT EXECUTION:** Do not say "Let me check" or "One second". Just run the tool and speak the result [6].
            2. **MANDATORY CLOSING:** Always end with a question to move the process forward (e.g., "Shall I book that for you?") [7].
            3. **NEGATIVE CONSTRAINTS:** 
            - NEVER assume a slot is free because it is within "Operating Hours".
            - NEVER book without confirming the Service and Price first.

            ### 6. FEW-SHOT EXAMPLES
            ${examples}`;
        }

        // 5. Define Tools
        const tools = [
            {
                type: "function",
                function: {
                    name: "checkAvailability",
                    description: "Check availability for a specific date and time. If busy, returns alternative free slots for that day.",
                    parameters: {
                        type: "object",
                        properties: {
                            dateTime: {
                                type: "string",
                                description: "The date and time to check (ISO 8601 format or compatible string).",
                            },
                        },
                        required: ["dateTime"],
                    },
                },
            },
            {
                type: "function",
                function: {
                    name: "bookAppointment",
                    description: "Book an appointment for the client at a specific date and time.",
                    parameters: {
                        type: "object",
                        properties: {
                            dateTime: {
                                type: "string",
                                description: "The date and time of the appointment (ISO 8601 format or compatible string).",
                            },
                            serviceName: {
                                type: "string",
                                description: "The name of the service being booked (e.g., 'Haircut').",
                            },
                            notes: {
                                type: "string",
                                description: "Any special requests or notes from the customer.",
                            },
                        },
                        required: ["dateTime", "serviceName"],
                    },
                },
            },
            {
                type: "function",
                function: {
                    name: "updateContactName",
                    description: "Update the user's name if they provide it during the conversation.",
                    parameters: {
                        type: "object",
                        properties: {
                            name: {
                                type: "string",
                                description: "The name the user provided.",
                            },
                        },
                        required: ["name"],
                    },
                },
            },
            {
                type: "function",
                function: {
                    name: "cancelAppointment",
                    description: "Cancel the user's upcoming appointment.",
                    parameters: {
                        type: "object",
                        properties: {
                            reason: {
                                type: "string",
                                description: "Reason for cancellation (optional).",
                            },
                        },
                    },
                },
            },
            {
                type: "function",
                function: {
                    name: "rescheduleAppointment",
                    description: "Reschedule the user's existing appointment to a new time.",
                    parameters: {
                        type: "object",
                        properties: {
                            newDateTime: {
                                type: "string",
                                description: "The new date and time requested (ISO 8601).",
                            },
                        },
                        required: ["newDateTime"],
                    },
                },
            },
        ];

        // 5. Call OpenAI (Loop for sequential tool calls)
        let messages = [
            { role: "system", content: systemPrompt },
            ...conversationHistory,
            { role: "user", content: messageText },
        ];

        let totalUsage = {
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0,
        };

        let finalResponseText = "";
        let keepLooping = true;
        let loopCount = 0;
        const MAX_LOOPS = 5; // Safety break

        while (keepLooping && loopCount < MAX_LOOPS) {
            loopCount++;

            const response = await openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: messages,
                tools: tools,
                tool_choice: "auto",
            });

            // Accumulate usage
            if (response.usage) {
                totalUsage.prompt_tokens += response.usage.prompt_tokens;
                totalUsage.completion_tokens += response.usage.completion_tokens;
                totalUsage.total_tokens += response.usage.total_tokens;
            }

            const responseMessage = response.choices[0].message;

            // If text content exists, update final response (it might be the final answer or a thought before a tool)
            if (responseMessage.content) {
                finalResponseText = responseMessage.content;
            }

            // Check if tool calls present
            if (responseMessage.tool_calls) {
                messages.push(responseMessage); // Add assistant's tool-call request to history

                const availableFunctions = {
                    checkAvailability: async (args) => {
                        console.log('running checkAvailability tool');
                        // Pass persona to checkAvailability for hours/settings context
                        const availability = await checkAvailability(args.dateTime, persona);
                        return availability;
                    },
                    bookAppointment: async (args) => {
                        console.log('running bookAppointment tool');
                        return await bookAppointment(args.dateTime, args.serviceName, phoneNumber, args.notes, persona);
                    },
                    updateContactName: async (args) => {
                        console.log('running updateContactName tool');
                        await Contact.updateOne({ phoneNumber }, { name: args.name });
                        return JSON.stringify({ success: true, message: `Contact name updated to ${args.name}` });
                    },
                    cancelAppointment: async (args) => {
                        console.log('running cancelAppointment tool');
                        return await cancelAppointment(phoneNumber, args.reason);
                    },
                    rescheduleAppointment: async (args) => {
                        console.log('running rescheduleAppointment tool');
                        return await rescheduleAppointment(phoneNumber, args.newDateTime, persona);
                    }
                };

                for (const toolCall of responseMessage.tool_calls) {
                    const functionName = toolCall.function.name;
                    const functionToCall = availableFunctions[functionName];
                    const functionArgs = JSON.parse(toolCall.function.arguments);

                    // Execute the function
                    const functionResponse = await functionToCall(functionArgs);

                    messages.push({
                        tool_call_id: toolCall.id,
                        role: "tool",
                        name: functionName,
                        content: functionResponse,
                    });
                }
                // Loop continues to let OpenAI digest the tool results
            } else {
                // No more tool calls, we are done
                keepLooping = false;
            }
        }

        return {
            text: finalResponseText,
            usage: totalUsage
        };

    } catch (error) {
        console.error("Error in generateResponse:", error);
        return "Sorry, I'm having trouble processing your request right now.";
    }
}



/**
 * Helper function to book an appointment.
 */
async function bookAppointment(dateTime, serviceName, customerPhone, notes, persona) {
    try {
        const contact = await Contact.findOne({ phoneNumber: customerPhone });
        if (!contact) {
            throw new Error("Contact not found for booking");
        }

        // Calculate endTime based on Service Duration
        let duration = persona?.appointmentSettings?.defaultDuration || 30;

        if (serviceName && persona?.businessContext?.services) {
            // Fuzzy match service name? Or exact? Try exact first, then loose
            const service = persona.businessContext.services.find(s =>
                s.name.toLowerCase() === serviceName.toLowerCase()
            );
            if (service && service.duration) {
                duration = service.duration;
            }
        }

        const startDate = new Date(dateTime);
        const endTime = new Date(startDate.getTime() + duration * 60000);

        const newAppointment = new Appointment({
            contactId: contact._id,
            ownerId: persona._id,
            customerPhone,
            dateTime: startDate,
            endTime: endTime,
            service: serviceName || 'General',
            notes,
            status: 'confirmed',
        });

        const savedAppointment = await newAppointment.save();

        // Link to Contact
        contact.currentAppointment = savedAppointment._id;
        await contact.save();

        // --- NOTIFICATION & SSE TRIGGER ---
        const notification = await Notification.create({
            ownerId: persona._id,
            type: 'appointment_booked',
            title: 'Nueva Cita Agendada',
            message: `El cliente ${contact.name || customerPhone} ha agendado para el ${startDate.toLocaleString()}.`,
            relatedResourceId: savedAppointment._id
        });

        // Emit via SSE
        sseManager.sendEvent(persona._id.toString(), 'NEW_NOTIFICATION', notification);
        // ----------------------------------

        return `Appointment confirmed for ${dateTime} (${duration} mins).`;
    } catch (err) {
        console.error("Booking error:", err);
        return "Failed to book appointment. Please try again.";
    }
}

async function checkAvailability(dateTime, persona) {
    try {
        console.log('checking availability for:', dateTime);
        const timezone = persona?.appointmentSettings?.timezone || 'America/Bogota';

        // 1. "Shift" everything to the Business's Wall-Clock Time
        // Strategy: Create a Date object where the "UTC" time components match the "Wall Clock" time of the target timezone.
        // e.g. if it's 2PM in Bogota, we create a date that is 14:00 UTC.
        // This allows us to strictly use UTC methods for comparison and manipulation without local server timezone interference.

        const toShiftedDate = (date) => {
            const fmt = new Intl.DateTimeFormat('en-US', {
                timeZone: timezone,
                year: 'numeric', month: 'numeric', day: 'numeric',
                hour: 'numeric', minute: 'numeric', second: 'numeric',
                hour12: false
            });
            const parts = fmt.formatToParts(date);
            const part = (type) => parseInt(parts.find(p => p.type === type).value, 10);

            return new Date(Date.UTC(
                part('year'),
                part('month') - 1, // Month is 0-indexed for Date.UTC
                part('day'),
                part('hour'),
                part('minute'),
                part('second')
            ));
        };

        const nowShifted = toShiftedDate(new Date());
        const requestedDateShifted = toShiftedDate(new Date(dateTime));
        const dayName = requestedDateShifted.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }).toLowerCase();

        // 2. Check Basic Business Hours
        const schedule = persona?.businessContext?.hours?.[dayName];
        if (!schedule || !schedule.isOpen) {
            // Need to un-shift or just generic message? Generic is fine.
            return JSON.stringify({ available: false, message: `We are closed on ${dayName}s.` });
        }

        const { open, close } = schedule;
        const [openHour, openMin] = open.split(':').map(Number);
        const [closeHour, closeMin] = close.split(':').map(Number);

        // Business Open/Close in Shifted Time (UTC frame)
        const openTime = new Date(requestedDateShifted);
        openTime.setUTCHours(openHour, openMin, 0, 0);

        const closeTime = new Date(requestedDateShifted);
        closeTime.setUTCHours(closeHour, closeMin, 0, 0);

        if (requestedDateShifted < openTime || requestedDateShifted >= closeTime) {
            return JSON.stringify({ available: false, message: `That time is outside our business hours (${open} - ${close}).` });
        }

        // 3. Check Overlaps
        const defaultDuration = persona?.appointmentSettings?.defaultDuration || 30;
        const bufferTime = persona?.appointmentSettings?.bufferTime || 5;

        // DB Query needs REAL dates (Broad range)
        const queryStart = new Date(dateTime);
        queryStart.setHours(0, 0, 0, 0);
        queryStart.setDate(queryStart.getDate() - 1);
        const queryEnd = new Date(dateTime);
        queryEnd.setHours(23, 59, 59, 999);
        queryEnd.setDate(queryEnd.getDate() + 1);

        // Removing the 'cancelled' status filter as per user feedback that 'cancelado' implies 'occupied/paid'
        const rawAppointments = await Appointment.find({
            dateTime: { $gte: queryStart, $lte: queryEnd }
        });

        // Helper to check overlap in Shifted Time (UTC frame)
        const getConflictEnd = (slotStartShifted) => {

            const myDurationPlusBuffer = defaultDuration + bufferTime;
            const slotEndShifted = new Date(slotStartShifted.getTime() + myDurationPlusBuffer * 60000);

            // Sort appointments to find the earliest conflict
            const appointmentsShifted = rawAppointments.map(appt => {
                const start = toShiftedDate(appt.dateTime);
                // Use saved endTime if available, else calculate. 
                // Note: endTime in DB likely is just Service End. We need to add Buffer to it.
                let apptEndShifted;
                if (appt.endTime) {
                    apptEndShifted = toShiftedDate(appt.endTime);
                } else {
                    apptEndShifted = new Date(start.getTime() + defaultDuration * 60000);
                }

                // The "Busy Block" extends by bufferTime
                const busyBlockEnd = new Date(apptEndShifted.getTime() + bufferTime * 60000);

                return {
                    startDate: start,
                    busyBlockEnd: busyBlockEnd
                };
            }).sort((a, b) => a.startDate - b.startDate);

            for (const appt of appointmentsShifted) {
                // Classic Overlap: StartA < EndB && EndA > StartB
                if (slotStartShifted < appt.busyBlockEnd && slotEndShifted > appt.startDate) {
                    return appt.busyBlockEnd; // Return the end of the conflict
                }
            }
            return null;
        }

        const conflictEnd = getConflictEnd(requestedDateShifted);

        // 4. Calculate Alterative Slots / Future Schedule (Smart Scan)
        const freeSlots = [];
        let scanTime = new Date(openTime); // Start at Opening Time (UTC frame)

        // If "Now" is later than opening time, we should scan from "Now" onwards roughly
        // But scanning from Open Time is safer to get a full picture, filtering later.

        while (scanTime < closeTime) {
            const slotEnd = new Date(scanTime.getTime() + defaultDuration * 60000);

            // Must be future relative to NOW (Shifted is in UTC frame)
            const isFuture = scanTime > nowShifted;

            // Check conflict
            const busyUntil = getConflictEnd(scanTime);

            if (busyUntil) {
                // If busy, JUMP to the end of the busy block
                scanTime = new Date(busyUntil);
                continue;
            }

            if (isFuture && slotEnd <= closeTime) {
                // Format to string using UTC to avoid back-shifting
                const timeStr = scanTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'UTC' });
                freeSlots.push(timeStr);

                // Step by 30 mins
                scanTime.setUTCMinutes(scanTime.getUTCMinutes() + 30);
            } else {
                // Not future or too late, just step
                scanTime.setUTCMinutes(scanTime.getUTCMinutes() + 30);
            }
        }

        const uniqueSlots = [...new Set(freeSlots)];
        const maxSlotsToShow = 8; // Show more now
        const futureSlotsStr = uniqueSlots.slice(0, maxSlotsToShow).join(', ');

        if (conflictEnd) {
            return JSON.stringify({
                available: false,
                message: "Slot is busy.",
                alternativeSlots: futureSlotsStr ? `Try these times: ${futureSlotsStr}...` : "No other slots available today."
            });
        }

        // Even if available, return the schedule for context!
        return JSON.stringify({
            available: true,
            message: "Slot available",
            futureSlots: futureSlotsStr ? `Other available times today: ${futureSlotsStr}...` : "This is the last slot."
        });
    } catch (err) {
        console.error("Availability check error:", err);
        return JSON.stringify({ available: false, message: "Failed to check availability" });
    }
}

module.exports = { generateResponse };

async function cancelAppointment(phoneNumber, reason) {
    try {
        const contact = await Contact.findOne({ phoneNumber }).populate('currentAppointment');
        if (!contact || !contact.currentAppointment) {
            return "No active appointment found to cancel.";
        }

        const appointment = await Appointment.findById(contact.currentAppointment._id);
        if (!appointment) return "Appointment not found.";

        appointment.status = 'cancelled';
        appointment.notes = appointment.notes ? `${appointment.notes} | Cancelled: ${reason || 'User request'}` : `Cancelled: ${reason || 'User request'}`;
        await appointment.save();

        // Unlink from contact
        contact.currentAppointment = null;
        await contact.save();

        return "Appointment has been successfully cancelled.";
    } catch (error) {
        console.error("Cancel Error:", error);
        return "Failed to cancel appointment.";
    }
}

async function rescheduleAppointment(phoneNumber, newDateTime, persona) {
    try {
        const contact = await Contact.findOne({ phoneNumber }).populate('currentAppointment');
        if (!contact || !contact.currentAppointment) {
            return "No active appointment found to reschedule. Please book a new one.";
        }

        const appointment = await Appointment.findById(contact.currentAppointment._id);
        if (!appointment) return "Appointment not found.";

        // Calculate new end time based on original duration or default
        // We can re-fetch service duration if needed, or just assume same duration
        let duration = 30;
        if (appointment.endTime && appointment.dateTime) {
            duration = (appointment.endTime - appointment.dateTime) / 60000; // minutes
        }

        const newStart = new Date(newDateTime);
        const newEnd = new Date(newStart.getTime() + duration * 60000);

        // Optional: Check availability explicitly here?
        // The bot *should* have checked availability before calling this, per prompt rules.
        // But for safety, we could check for conflicts. For now, trusting the bot flow to allow override.

        appointment.dateTime = newStart;
        appointment.endTime = newEnd;
        appointment.status = 'confirmed'; // Re-confirm in case it was pending?
        await appointment.save();

        return `Appointment rescheduled to ${newDateTime}.`;
    } catch (error) {
        console.error("Reschedule Error:", error);
        return "Failed to reschedule appointment.";
    }
}
