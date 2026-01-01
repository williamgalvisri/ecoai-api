require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const mongoose = require('mongoose');
const readline = require('readline');
const { processIncomingMessage } = require('../controllers/whatsappController');
const ClientPersona = require('../models/ClientPersona');
const Contact = require('../models/Contact');

// ANSI Colors
const colors = {
    reset: "\x1b[0m",
    bright: "\x1b[1m",
    dim: "\x1b[2m",
    cyan: "\x1b[36m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    red: "\x1b[31m",
    blue: "\x1b[34m"
};

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI); // Provide default or read env
        console.log(`${colors.green}✓ Connected to MongoDB${colors.reset}`);
    } catch (err) {
        console.error(`${colors.red}✗ MongoDB connection error:${colors.reset}`, err);
        process.exit(1);
    }
};

const askQuestion = (query) => new Promise((resolve) => rl.question(query, resolve));

const start = async () => {
    console.log(`\n${colors.bright}${colors.cyan}=== ECOAI CLI CHAT ===${colors.reset}\n`);
    await connectDB();

    // 1. Select Persona
    const personas = await ClientPersona.find({}).limit(10);
    if (personas.length === 0) {
        console.log(`${colors.red}No ClientPersonas found in DB.${colors.reset}`);
        process.exit();
    }

    console.log(`${colors.yellow}Available Personas:${colors.reset}`);
    personas.forEach((p, idx) => {
        console.log(`${idx + 1}. ${p.botName} (${p.whatsappBussinesConfig?.phoneNumberId || 'No Phone ID'})`);
    });

    const choice = await askQuestion(`\nSelect Persona (1-${personas.length}): `);
    const selectedPersona = personas[parseInt(choice) - 1];

    if (!selectedPersona) {
        console.log(`${colors.red}Invalid selection.${colors.reset}`);
        process.exit();
    }

    const phoneNumberId = selectedPersona.whatsappBussinesConfig?.phoneNumberId || 'MOCK_PHONE_ID';
    // User Phone Number (Mock)
    let userPhone = await askQuestion(`Enter your mock phone number (default: 573001234567): `);
    if (!userPhone.trim()) userPhone = '573001234567';

    console.log(`\n${colors.green}Chat started with ${selectedPersona.botName}! Type 'exit' to quit.${colors.reset}\n`);

    const promptUser = () => {
        rl.question(`${colors.blue}You: ${colors.reset}`, async (input) => {
            if (input.toLowerCase() === 'exit') {
                console.log('Bye!');
                await mongoose.connection.close();
                process.exit();
            }

            // Msg Object Structure mimicking WhatsApp
            const messageObject = {
                from: userPhone,
                type: 'text',
                text: { body: input }
            };

            // Capture the reply
            // We need to 'spy' on the reply.
            // valid callback: (to, text, persona)
            const replyCallback = async (to, text, p) => {
                 console.log(`${colors.yellow}${selectedPersona.botName}: ${colors.reset}${text}\n`);
            };

            try {
                // Call the extracted controller logic
                const result = await processIncomingMessage(messageObject, phoneNumberId, replyCallback);
                // If the result indicates no response (e.g. BOT_DISABLED), we should probably say so if we want debug info
                if (result !== 'RESPONSE_SENT' && result !== 'EVENT_RECEIVED') {
                     // console.log(`${colors.dim}[System]: Result -> ${result}${colors.reset}`);
                }
            } catch (err) {
                console.error(`${colors.red}Error processing message:${colors.reset}`, err.message);
            }

            promptUser();
        });
    };

    promptUser();
};

start();
