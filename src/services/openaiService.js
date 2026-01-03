const OpenAI = require('openai');
const ClientPersona = require('../models/ClientPersona');
const ChatHistory = require('../models/ChatHistory');
const Contact = require('../models/Contact');
const schedulerAgent = require('./agents/schedulerAgent');
const salesAgent = require('./agents/salesAgent');

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Generates a response from OpenAI based on the user's message, history, and the client's persona.
 */
async function generateResponse(phoneNumber, messageText, ownerId, orderContext = null) {
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

        // === AGENT STRATEGY SELECTION ===
        const agentType = persona?.agentType || 'scheduler';
        let strategy;

        if (agentType === 'scheduler') {
            strategy = schedulerAgent;
        } else if (agentType === 'sales') {
            strategy = salesAgent;
        } else {
            console.warn(`Unknown agent type: ${agentType}. Defaulting to scheduler.`);
            strategy = schedulerAgent;
        }

        const systemPrompt = strategy.getSystemPrompt(persona, contact);
        const tools = strategy.getTools();
        const availableFunctions = strategy.getAvailableFunctions({ phoneNumber, persona, contact });


        // 5. Call OpenAI (Loop for sequential tool calls)
        let messages = [
            { role: "system", content: systemPrompt },
            ...conversationHistory
        ];

        // INJECT ORDER CONTEXT (Mostly for Sales, but harmless for Scheduler if unused)
        if (orderContext) {
            messages.push({
                role: "system",
                content: `[SYSTEM PRIORITY] The user just sent a structured WhatsApp Cart/Order. Details:\n${orderContext}\n\nINSTRUCTIONS:\n1. Acknowledge the items.\n2. Calculate the total (if strictly clear from context) or confirm it.\n3. ASK FOR MISSING DELIVERY DETAILS (Address, Payment Method) to finalize the order.`
            });
        }

        messages.push({ role: "user", content: messageText });

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

                for (const toolCall of responseMessage.tool_calls) {
                    const functionName = toolCall.function.name;
                    const functionToCall = availableFunctions[functionName];
                    const functionArgs = JSON.parse(toolCall.function.arguments);

                    // Execute the function
                    // Handle missing tools gracefully
                    let functionResponse = "Tool execution failed.";
                    if (functionToCall) {
                        functionResponse = await functionToCall(functionArgs);
                    } else {
                        console.error(`Tool ${functionName} not found in availableFunctions for agentType ${agentType}`);
                    }

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
        return { text: "Lo siento, tengo problemas para procesar tu solicitud en este momento.", usage: {} };
    }
}

module.exports = { generateResponse };


