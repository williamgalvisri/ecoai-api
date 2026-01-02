require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const mongoose = require('mongoose');
const ClientPersona = require('../models/ClientPersona');
const Product = require('../models/Product');
const metaCatalogService = require('../services/metaCatalogService');

// Colors
const colors = {
    green: "\x1b[32m",
    red: "\x1b[31m",
    cyan: "\x1b[36m",
    yellow: "\x1b[33m",
    reset: "\x1b[0m"
};

async function runSync() {
    await mongoose.connect(process.env.MONGO_URI);
    console.log(`${colors.cyan}✓ Connected to DB${colors.reset}`);

    try {
        // 1. Get Persona (Single tenant assumption for CLI)
        const persona = await ClientPersona.findOne({});
        if (!persona) {
            console.error(`${colors.red}No Persona found.${colors.reset}`);
            process.exit(1);
        }

        const catalogId = persona.whatsappBussinesConfig?.catalogId;
        const token = persona.whatsappBussinesConfig?.token;

        console.log(`Syncing for Persona: ${persona.botName}`);
        console.log(`Catalog ID: ${catalogId || 'MISSING'}`);

        if (!catalogId || !token) {
            console.error(`${colors.red}Error: Missing Catalog ID or Token.${colors.reset}`);
            console.log(`Please run 'node src/scripts/onboard-catalog.js' first or check config.`);
            process.exit(1);
        }

        // 2. Get Products
        const products = await Product.find({ ownerId: persona._id });
        console.log(`Found ${products.length} products to sync...`);

        let successCount = 0;
        let failCount = 0;

        for (const product of products) {
            process.stdout.write(`Syncing ${product.retailerId} (${product.name})... `);
            
            try {
                // Determine if Create or Update
                // If it has a real meta ID (not mock/local), update it.
                // Otherwise, create it.
                const isSynced = product.metaCatalogId && !product.metaCatalogId.startsWith('LOCAL') && !product.metaCatalogId.startsWith('MOCK');
                
                if (isSynced) {
                    try {
                        await metaCatalogService.updateProduct(catalogId, product.retailerId, {
                            price: product.price,
                            availability: product.availability,
                        }, token);
                        console.log(`${colors.green}UPDATED${colors.reset}`);
                    } catch (updateError) {
                        console.warn(`${colors.yellow}Update failed, trying to create...${colors.reset}`);
                        // Fallback to create
                         const metaId = await metaCatalogService.addProduct(catalogId, product, token);
                        product.metaCatalogId = metaId;
                        await product.save();
                        console.log(`${colors.green}CREATED (Fallback)${colors.reset}`);
                    }
                } else {
                    const metaId = await metaCatalogService.addProduct(catalogId, product, token);
                    product.metaCatalogId = metaId;
                    await product.save();
                    console.log(`${colors.green}CREATED (ID: ${metaId})${colors.reset}`);
                }
                successCount++;
            } catch (err) {
                console.log(`${colors.red}FAILED${colors.reset}`);
                console.error(`  > ${err.message}`);
                failCount++;
            }
        }

        console.log(`\n${colors.cyan}Sync Complete details:${colors.reset}`);
        console.log(`- Success: ${successCount}`);
        console.log(`- Failed: ${failCount}`);

    } catch (error) {
        console.error(`${colors.red}Fatal Error:${colors.reset}`, error);
    } finally {
        await mongoose.connection.close();
        process.exit();
    }
}

runSync();
