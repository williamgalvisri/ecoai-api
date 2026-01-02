const Product = require('../models/Product');
const ClientPersona = require('../models/ClientPersona');
const metaCatalogService = require('../services/metaCatalogService');
const { NotFoundError, BadRequestError } = require('../utils/ApiResponse');

exports.createProduct = async (req, res) => {
    try {
        const { ownerId, name, price, retailerId, description, imageUrl, availability } = req.body;

        const persona = await ClientPersona.findById(ownerId);
        if (!persona) throw new NotFoundError('ClientPersona (Owner) not found');

        // 1. Create in DB
        const newProduct = new Product({
            ownerId,
            retailerId,
            name,
            description,
            price,
            imageUrl,
            availability
        });

        // 2. Sync to Meta (Async or Await?? Best to await to confirm it works, or queue it)
        // Using await for simplicity in V1
        const catalogId = persona.whatsappBussinesConfig?.catalogId;
        const token = persona.whatsappBussinesConfig?.token;

        if (catalogId && token) {
            const metaId = await metaCatalogService.addProduct(catalogId, newProduct, token);
            newProduct.metaCatalogId = metaId;
        } else {
            console.log('Skipping Meta Sync: missing catalogId or token');
            newProduct.metaCatalogId = 'LOCAL_ONLY';
        }

        await newProduct.save();

        res.success(newProduct, 'Product created successfully');
    } catch (error) {
        res.error(error);
    }
};

exports.getProducts = async (req, res) => {
    try {
        const { ownerId } = req.query;
        const filter = {};
        if (ownerId) filter.ownerId = ownerId;

        const products = await Product.find(filter);
        res.success(products);
    } catch (error) {
        res.error(error);
    }
};

exports.updateProduct = async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;

        const product = await Product.findById(id);
        if (!product) throw new NotFoundError('Product not found');

        const persona = await ClientPersona.findById(product.ownerId);

        // 1. Update Meta
        if (persona && persona.whatsappBussinesConfig?.catalogId) {
             // Map updates to Meta format if necessary
             await metaCatalogService.updateProduct(
                 persona.whatsappBussinesConfig.catalogId, 
                 product.retailerId, 
                 updates, 
                 persona.whatsappBussinesConfig.token
             );
        }

        // 2. Update DB
        Object.assign(product, updates);
        await product.save();

        res.success(product, 'Product updated successfully');
    } catch (error) {
        res.error(error);
    }
};

/**
 * Bulk syncs all products for a specific owner to the Meta Catalog.
 */
exports.syncProducts = async (req, res) => {
    try {
        const { ownerId } = req.body;
        const persona = await ClientPersona.findById(ownerId);
        
        if (!persona) throw new NotFoundError('ClientPersona not found');
        
        const catalogId = persona.whatsappBussinesConfig?.catalogId;
        const token = persona.whatsappBussinesConfig?.token;

        if (!catalogId || !token) {
            throw new BadRequestError('Persona is missing Catalog ID or WhatsApp Token');
        }

        const products = await Product.find({ ownerId });
        let syncedCount = 0;
        let errors = [];

        console.log(`Starting bulk sync for ${products.length} products to Catalog ${catalogId}`);

        for (const product of products) {
            try {
                if (product.metaCatalogId && !product.metaCatalogId.startsWith('LOCAL') && !product.metaCatalogId.startsWith('MOCK')) {
                    // Update
                    await metaCatalogService.updateProduct(catalogId, product.retailerId, {
                        price: product.price,
                        availability: product.availability
                    }, token);
                } else {
                    // Create
                    const metaId = await metaCatalogService.addProduct(catalogId, product, token);
                    product.metaCatalogId = metaId;
                    await product.save();
                }
                syncedCount++;
            } catch (err) {
                console.error(`Failed to sync product ${product.retailerId}:`, err.message);
                errors.push({ id: product.retailerId, error: err.message });
            }
        }

        res.success({ syncedCount, total: products.length, errors }, 'Bulk sync completed');

    } catch (error) {
        res.error(error);
    }
};

exports.deleteProduct = async (req, res) => {
    try {
        const { id } = req.params;
        const product = await Product.findById(id);
        if (!product) throw new NotFoundError('Product not found');

        const persona = await ClientPersona.findById(product.ownerId);

        // 1. Delete from Meta
         if (persona && persona.whatsappBussinesConfig?.catalogId) {
             await metaCatalogService.deleteProduct(
                 persona.whatsappBussinesConfig.catalogId, 
                 product.retailerId, 
                 persona.whatsappBussinesConfig.token
             );
        }

        await product.deleteOne();
        res.success(null, 'Product deleted successfully');
    } catch (error) {
        res.error(error);
    }
};
