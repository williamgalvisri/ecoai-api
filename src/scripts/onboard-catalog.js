require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const mongoose = require('mongoose');
const ClientPersona = require('../models/ClientPersona');
const metaCatalogService = require('../services/metaCatalogService');

// IDs provided by the user
const BUSINESS_ID = '1446002553804725';
const WABA_ID = '1212713897474323';

// Colors for console
const colors = {
    green: "\x1b[32m",
    red: "\x1b[31m",
    cyan: "\x1b[36m",
    reset: "\x1b[0m"
};

async function onboard() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log(`${colors.cyan}✓ Connected to DB${colors.reset}`);

        const persona = await ClientPersona.findOne({});
        if (!persona) throw new Error('No ClientPersona found.');

        console.log(`Onboarding Persona: ${persona.botName}`);

        // 1. Ensure we have a token
        const token = persona.whatsappBussinesConfig?.token || process.env.WHATSAPP_TOKEN;
        if (!token) {
            throw new Error('No Token found in ClientPersona or .env (WHATSAPP_TOKEN). Cannot interact with Meta.');
        }

        // 2. Create Catalog
        const catalogName = `${persona.botName} Catalog [Auto]`;
        console.log(`Creating Meta Catalog: "${catalogName}"...`);
        
        try {
            const catalogId = await metaCatalogService.createCatalog(BUSINESS_ID, catalogName, token);
            console.log(`${colors.green}✓ Catalog Created! ID: ${catalogId}${colors.reset}`);

            // 3. Connect to WABA
            console.log(`Connecting Catalog ${catalogId} to WABA ${WABA_ID}...`);
            await metaCatalogService.connectCatalogToWaba(catalogId, WABA_ID, token);
            console.log(`${colors.green}✓ Connected Catalog to WhatsApp!${colors.reset}`);

            // 4. Update DB
            if (!persona.whatsappBussinesConfig) persona.whatsappBussinesConfig = {};
            persona.whatsappBussinesConfig.catalogId = catalogId;
            persona.whatsappBussinesConfig.phoneNumberId = WABA_ID; // Store WABA ID? Or keep phone ID separate?
            // Note: phoneNumberId in config usually refers to the specific phone number object ID (for sending messages), 
            // WABA ID is the parent. We might want to store WABA ID separately if needed, but for now catalogId is key.
            
            await persona.save();
            console.log(`${colors.green}✓ Database updated with Catalog ID.${colors.reset}`);

        } catch (apiError) {
             console.error(`${colors.red}Meta API Error:${colors.reset}`, apiError.message);
             // If manual creation is preferred, we can skip and just save the ID if needed.
        }

    } catch (error) {
        console.error(`${colors.red}Error:${colors.reset}`, error);
    } finally {
        await mongoose.connection.close();
        process.exit();
    }
}

onboard();
