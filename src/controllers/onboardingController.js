const ClientPersona = require('../models/ClientPersona');
const metaCatalogService = require('../services/metaCatalogService');
const { BadRequestError, NotFoundError } = require('../utils/ApiResponse');

/**
 * Automates the setup of Meta resources (Catalog).
 */
exports.setupCatalog = async (req, res) => {
    try {
        const { ownerId, businessId, wabaId, adminToken } = req.body;

        if (!businessId || !wabaId || !adminToken) {
            throw new BadRequestError('Missing required fields: businessId, wabaId, adminToken');
        }

        const persona = await ClientPersona.findById(ownerId);
        if (!persona) throw new NotFoundError('ClientPersona not found');

        // 1. Create Catalog
        const catalogName = `${persona.botName} Catalog`;
        console.log(`Creating catalog: ${catalogName} for BusID: ${businessId}`);
        
        const catalogId = await metaCatalogService.createCatalog(businessId, catalogName, adminToken);
        console.log(`Catalog Created! ID: ${catalogId}`);

        // 2. Connect to WABA
        console.log(`Connecting Catalog ${catalogId} to WABA ${wabaId}...`);
        await metaCatalogService.connectCatalogToWaba(catalogId, wabaId, adminToken);
        console.log('Connected successfully.');

        // 3. Update DB
        if (!persona.whatsappBussinesConfig) persona.whatsappBussinesConfig = {};
        
        persona.whatsappBussinesConfig.catalogId = catalogId;
        // Optionally save the token if we want to reuse it, but usually admin tokens follow different rules.
        // For now, we assume the user provides it for setup.
        
        await persona.save();

        res.success({ catalogId }, 'Catalog setup complete and linked to WhatsApp.');

    } catch (error) {
        console.error('Setup Catalog Error:', error);
        res.error(error);
    }
};
