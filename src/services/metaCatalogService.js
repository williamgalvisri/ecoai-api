const axios = require('axios');

const GRAPH_API_URL = 'https://graph.facebook.com/v18.0';

/**
 * Service to interact with Meta's Commerce Manager (Catalog) API.
 * Requires:
 * 1. Catalog ID
 * 2. System User Token with 'catalog_management' permission
 */
class MetaCatalogService {

    /**
     * Adds a product to the Meta Catalog via Batch API (single item batch).
     * @param {string} catalogId - The Meta Catalog ID.
     * @param {object} productData - The product data from our DB.
     * @param {string} accessToken - The system user access token.
     * @returns {Promise<string>} - The ID of the product in Meta.
     */
    async addProduct(catalogId, productData, accessToken) {
        if (!catalogId || !accessToken) {
            console.warn('MetaCatalogService: Missing catalogId or accessToken. Skipping sync.');
            return `MOCK_META_ID_${Date.now()}`;
        }

        try {
            // Meta takes "retailer_id" as the unique key.
            // Documentation: https://developers.facebook.com/docs/commerce-platform/catalog/batch-api
            
            const payload = {
                item_type: 'PRODUCT_ITEM',
                requests: [
                    {
                        method: "CREATE",
                        data: {
                            id: productData.retailerId,
                            retailer_id: productData.retailerId,
                            
                            // Standard fields
                            title: productData.name,
                            name: productData.name, // Deprecated but sometimes used
                            description: productData.description || `${productData.name} - High quality eco-friendly product.`,
                            
                            // Images: Use image_link (standard)
                            image_link: productData.imageUrl || 'https://images.unsplash.com/photo-1523275335684-37898b6baf30', // High quality fallback
                            
                            brand: 'EcoAI', 
                            
                            // Category (Crucial for approval)
                            // 166 = Apparel & Accessories > Clothing
                            google_product_category: '166', 
                            
                            // Price
                            price: `${productData.price} ${productData.currency || 'COP'}`,
                            currency: productData.currency || 'COP',
                            
                            availability: productData.availability === 'in stock' ? 'in stock' : 'out of stock',
                            condition: 'new',
                            
                            // Link is strictly required for review
                            link: `https://ecoai-demo.com/product/${productData.retailerId}`,
                            website_link: `https://ecoai-demo.com/product/${productData.retailerId}`
                        }
                    }
                ]
            };

            const response = await axios.post(
                `${GRAPH_API_URL}/${catalogId}/items_batch`,
                payload,
                {
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            if (response.data && response.data.handles && response.data.handles[0]) {
                return response.data.handles[0];
            } else {
                 // If no handles, it means it failed even if status is 200 (Batch API behavior)
                 console.error('Meta Batch Response:', JSON.stringify(response.data, null, 2));
                 throw new Error('Meta API returned 200 but no handles were created. Check logs for validation errors.');
            }

        } catch (error) {
            console.error('MetaCatalogService Error:', error.response?.data || error.message);
            throw new Error('Failed to sync product to Meta Catalog');
        }
    }

    /**
     * Updates a product in the Meta Catalog.
     */
    async updateProduct(catalogId, retailerId, updateData, accessToken) {
        if (!catalogId || !accessToken) return;

        try {
             const payload = {
                item_type: 'PRODUCT_ITEM',
                requests: [
                    {
                        method: "UPDATE",
                        retailer_id: retailerId,
                        data: {
                             // Same standard fields map
                            title: updateData.name || null, // Only send if updating
                            price: updateData.price ? `${updateData.price} COP` : undefined,
                            availability: updateData.availability,
                            // If partial update, only send what's needed. BUT for simplicity/robustness if we have full object...
                            // For now this method takes 'updateData' which might be partial.
                            // Let's assume we might fallback to CREATE if this fails, so 'sync' script does full object.
                            // But here we just map what we have.
                        }
                    }
                ]
            };

            const response = await axios.post(
                `${GRAPH_API_URL}/${catalogId}/items_batch`,
                payload,
                { headers: { 'Authorization': `Bearer ${accessToken}` } }
            );

            if (!response.data || !response.data.handles || !response.data.handles[0]) {
                 console.error('Meta Batch Update Response:', JSON.stringify(response.data, null, 2));
                 throw new Error('Meta API returned 200 but no handles updated.');
            }

        } catch (error) {
            console.error('MetaCatalogService Update Error:', error.response?.data || error.message);
            throw error; // Re-throw to let caller know
        }
    }

    /**
     * Deletes a product from the Meta Catalog.
     */
    async deleteProduct(catalogId, retailerId, accessToken) {
        if (!catalogId || !accessToken) return;

        try {
            const payload = {
                item_type: 'PRODUCT_ITEM',
                requests: [
                    {
                        method: "DELETE",
                        retailer_id: retailerId
                    }
                ]
            };

            await axios.post(
                `${GRAPH_API_URL}/${catalogId}/items_batch`,
                payload,
                { headers: { 'Authorization': `Bearer ${accessToken}` } }
            );
        } catch (error) {
            console.error('MetaCatalogService Delete Error:', error.response?.data || error.message);
        }
    }
    /**
     * Creates a new Product Catalog owned by the Business.
     */
    async createCatalog(businessId, catalogName, accessToken) {
        try {
            const response = await axios.post(
                `${GRAPH_API_URL}/${businessId}/owned_product_catalogs`,
                {
                    name: catalogName,
                    // vertical: 'commerce' // Optional, defaults to generic
                },
                { headers: { 'Authorization': `Bearer ${accessToken}` } }
            );
            return response.data.id;
        } catch (error) {
            console.error('Create Catalog Error:', error.response?.data || error.message);
            throw new Error('Failed to create Meta Catalog');
        }
    }

    /**
     * Connects a Catalog to a WhatsApp Business Account (WABA).
     */
    async connectCatalogToWaba(catalogId, wabaId, accessToken) {
        try {
            await axios.post(
                `${GRAPH_API_URL}/${wabaId}/product_catalogs`,
                {
                    catalog_id: catalogId
                },
                { headers: { 'Authorization': `Bearer ${accessToken}` } }
            );
            return true;
        } catch (error) {
            console.error('Connect Catalog to WABA Error:', error.response?.data || error.message);
            // Don't throw, just return false, maybe it's already connected
            return false;
        }
    }

    /**
     * Retrieves products from the Meta Catalog.
     */
    async getProductsFromCatalog(catalogId, accessToken) {
        try {
            const response = await axios.get(
                `${GRAPH_API_URL}/${catalogId}/products`,
                { 
                    params: { 
                        fields: 'id,retailer_id,name,title,description,price,currency,image_url,availability',
                        limit: 50
                    },
                    headers: { 'Authorization': `Bearer ${accessToken}` } 
                }
            );
            return response.data.data;
        } catch (error) {
            console.error('Get Products Error:', error.response?.data || error.message);
            throw new Error('Failed to get products from Meta Catalog');
        }
    }
}

module.exports = new MetaCatalogService();
