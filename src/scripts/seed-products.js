require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const mongoose = require('mongoose');
const Product = require('../models/Product');
const ClientPersona = require('../models/ClientPersona');

// ANSI Colors
const colors = {
    reset: "\x1b[0m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    red: "\x1b[31m",
    cyan: "\x1b[36m"
};

const SAMPLE_PRODUCTS = [
    {
        retailerId: 'PROD_001',
        name: 'Eco T-Shirt',
        description: '100% Organic Cotton T-Shirt. Comfortable and sustainable.',
        price: 25000,
        currency: 'COP',
        availability: 'in stock',
        imageUrl: 'https://via.placeholder.com/300?text=Eco+T-Shirt'
    },
    {
        retailerId: 'PROD_002',
        name: 'Bamboo Water Bottle',
        description: 'Reusable bamboo and steel water bottle. Keep your drink cold for 12 hours.',
        price: 45000,
        currency: 'COP',
        availability: 'in stock',
        imageUrl: 'https://via.placeholder.com/300?text=Bottle'
    },
    {
        retailerId: 'PROD_003',
        name: 'Recycled Notebook',
        description: 'Notebook made from 100% recycled paper.',
        price: 15000,
        currency: 'COP',
        availability: 'in stock',
        imageUrl: 'https://via.placeholder.com/300?text=Notebook'
    },
    {
        retailerId: 'PROD_004',
        name: 'Solar Power Bank',
        description: 'Charge your phone with the power of the sun. 10000mAh.',
        price: 120000,
        currency: 'COP',
        availability: 'out of stock',
        imageUrl: 'https://via.placeholder.com/300?text=Solar+Bank'
    }
];

const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/ecoai-dev');
        console.log(`${colors.green}✓ Connected to MongoDB${colors.reset}`);
    } catch (err) {
        console.error(`${colors.red}✗ MongoDB connection error:${colors.reset}`, err);
        process.exit(1);
    }
};

const runSeed = async () => {
    await connectDB();

    try {
        // 1. Get Persona
        const persona = await ClientPersona.findOne({});
        if (!persona) {
            console.error(`${colors.red}No ClientPersona found. Please run the app or create one first.${colors.reset}`);
            process.exit(1);
        }

        console.log(`${colors.cyan}Seeding products for Persona: ${persona.botName} (${persona._id})${colors.reset}`);

        // 2. Clear existing products for this owner (optional, safer for dev)
        await Product.deleteMany({ ownerId: persona._id });
        console.log(`${colors.yellow}Cleared existing products for this owner.${colors.reset}`);

        // 3. Create Products
        const productsToInsert = SAMPLE_PRODUCTS.map(p => ({
            ...p,
            ownerId: persona._id,
            metaCatalogId: 'LOCAL_mOCK_' + p.retailerId // Mock ID
        }));

        await Product.insertMany(productsToInsert);
        console.log(`${colors.green}✓ Successfully added ${productsToInsert.length} products.${colors.reset}`);

        // 4. Update Agent Type to Sales
        persona.agentType = 'sales';
        // Add a mock catalog ID if missing
        if (!persona.whatsappBussinesConfig) persona.whatsappBussinesConfig = {};
        if (!persona.whatsappBussinesConfig.catalogId) persona.whatsappBussinesConfig.catalogId = 'MOCK_CATALOG_ID';
        
        await persona.save();
        console.log(`${colors.green}✓ Updated Persona agentType to 'sales'.${colors.reset}`);

        console.log(`\n${colors.cyan}Done! You can now run 'npm run dev:chat' to test the Sales Agent.${colors.reset}`);
        
    } catch (error) {
        console.error(`${colors.red}Error seeding products:${colors.reset}`, error);
    } finally {
        await mongoose.connection.close();
        process.exit();
    }
};

runSeed();
