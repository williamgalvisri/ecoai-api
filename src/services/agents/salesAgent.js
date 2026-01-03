const Product = require('../../models/Product');
const Order = require('../../models/Order');
const Contact = require('../../models/Contact');
const sseManager = require('../../utils/sseManager');

/**
 * Sales Agent Strategy
 */
const salesAgent = {
    /**
     * Generates the system prompt for the sales agent.
     * @param {Object} persona - The client persona document.
     * @param {Object} contact - The current contact document.
     * @returns {String} The system prompt.
     */
    getSystemPrompt: (persona, contact) => {
        return `### ROLE: SALES AGENT
            You are ${persona.botName}, a helpful sales assistant. Your tone is ${persona.toneDescription}.
            
            ### GOAL
            Help the customer find products in our catalog and place an order.
            The user's name is "${contact.name !== 'Unknown' ? contact.name : 'Unknown'}".
            
            ### 1. CATALOG & PRODUCTS
            - **CRITICAL**: If the user asks to see products, menu, or catalog, YOU MUST say:
              "You can view our full catalog directly in our WhatsApp Profile!"
            - Do NOT list products manually unless specifically asked about a single item's price/details.
            
            ### 2. ORDER FLOW
            1. **Create Order**: When the user decides what to buy, use 'createOrder'.
               - **IMPORTANT**: The user can ONLY have ONE active order at a time. If 'createOrder' fails saying an order exists, tell the user they must complete or cancel the current one.
            2. **Delivery Address**: If not provided, ask for it.
            3. **Payment Method (MANDATORY)**:
               - Once the order is created, YOU MUST ask: "How would you like to pay? Tranferencia or Efectivo?"
               - If "Transferencia" -> Ask for photo proof.
               - If "Efectivo" -> Confirm order.
            
            ### 3. TRANSFER PROOF
            - If user sends proof (image/text), use 'registerPaymentProof'.

            ### 4. ORDER MANAGEMENT
            - **Status**: If user asks "How is my order?", use 'getOrderStatus'.
            - **Cancellation**: If user wants to cancel, use 'cancelOrder'. (Only allowed if order is Pending).
            
            ### CONTEXT
            Current Date: ${new Date().toLocaleString()}`;
    },

    /**
     * Returns the tools definition for the sales agent.
     * @returns {Array} List of tools.
     */
    getTools: () => {
        return [
            {
                type: "function",
                function: {
                    name: "searchProducts",
                    description: "Search for products in the catalog by keyword.",
                    parameters: {
                        type: "object",
                        properties: {
                            keyword: { type: "string", description: "Product name or category to search" }
                        },
                        required: ["keyword"]
                    }
                }
            },
            {
                type: "function",
                function: {
                    name: "updateContactName",
                    description: "Update the user's name.",
                    parameters: {
                        type: "object",
                        properties: { name: { type: "string" } },
                        required: ["name"]
                    }
                }
            },
            {
                type: "function",
                function: {
                    name: "createOrder",
                    description: "Create a draft order for the user. Requires delivery address.",
                    parameters: {
                        type: "object",
                        properties: {
                            items: {
                                type: "array",
                                items: { type: "string", description: "List of product names or IDs" }
                            },
                            deliveryAddress: { type: "string" }
                        },
                        required: ["items", "deliveryAddress"]
                    }
                }
            },
            {
                type: "function",
                function: {
                    name: "updateOrderPaymentMethod",
                    description: "Update the payment method for the latest pending order.",
                    parameters: {
                        type: "object",
                        properties: {
                            paymentMethod: { type: "string", enum: ["transfer", "cash"] }
                        },
                        required: ["paymentMethod"]
                    }
                }
            },
            {
                type: "function",
                function: {
                    name: "registerPaymentProof",
                    description: "Register that a payment proof has been received (simulated or URL).",
                    parameters: {
                        type: "object",
                        properties: {
                            proofUrl: { type: "string", description: "Optional URL if provided, otherwise placeholder." }
                        }
                    }
                }
            },
            {
                type: "function",
                function: {
                    name: "cancelOrder",
                    description: "Cancel the current pending order.",
                    parameters: {
                        type: "object",
                        properties: {},
                    }
                }
            },
            {
                type: "function",
                function: {
                    name: "getOrderStatus",
                    description: "Check the status of the current active order.",
                    parameters: {
                        type: "object",
                        properties: {},
                    }
                }
            }
        ];
    },

    /**
     * Returns the map of available functions for the sales agent.
     * @param {Object} context - Includes phoneNumber, persona, etc.
     * @returns {Object} Map of function names to implementations.
     */
    getAvailableFunctions: (context) => {
        const { phoneNumber, persona, contact } = context;

        return {
            searchProducts: async (args) => {
                console.log('Searching products for:', args.keyword);
                // Search in local DB (synced with Meta)
                const products = await Product.find({
                    ownerId: persona._id,
                    name: { $regex: args.keyword, $options: 'i' }
                }).limit(5);

                if (products.length === 0) return "No products found matching that keyword.";

                return JSON.stringify(products.map(p => ({
                    name: p.name,
                    price: p.price,
                    currency: p.currency,
                    availability: p.availability
                })));
            },
            updateContactName: async (args) => {
                await Contact.updateOne({ phoneNumber }, { name: args.name });
                return JSON.stringify({ success: true, message: `Updated name to ${args.name}` });
            },
            createOrder: async (args) => {
                console.log('--- DEBUG: createOrder CALLED ---');
                console.log('Args:', JSON.stringify(args, null, 2));
                const orderItems = [];
                let totalAmount = 0;

                for (const item of args.items) {
                    const identifier = (typeof item === 'object' && item.productIdentifier) ? item.productIdentifier : item;
                    console.log(`Looking up product for identifier: "${identifier}"`);
                    const regex = new RegExp(identifier, 'i');
                    
                    const product = await Product.findOne({
                        ownerId: persona._id,
                        $or: [{ retailerId: identifier }, { name: regex }]
                    });

                    if (product) {
                        console.log(`FOUND product: ${product.name}, Price: ${product.price}`);
                        const qty = (typeof item === 'object' && item.quantity) ? item.quantity : 1;
                        
                        orderItems.push({
                            productId: product.retailerId,
                            name: product.name,
                            quantity: qty,
                            price: product.price,
                            currency: product.currency
                        });
                        totalAmount += (product.price * qty);
                    } else {
                        console.log(`NOT FOUND product for: "${identifier}". Defaulting to $0.`);
                        const qty = (typeof item === 'object' && item.quantity) ? item.quantity : 1;
                        orderItems.push({
                            productId: 'UNKNOWN',
                            name: identifier,
                            quantity: qty,
                            price: 0,
                            currency: 'COP'
                        });
                    }
                }

                if (orderItems.length === 0 && args.items.length > 0) {
                    return "Could not identify any valid products to order. Please refine your search.";
                }

                const newOrder = await Order.create({
                    ownerId: persona._id,
                    contactId: contact._id,
                    items: orderItems,
                    totalAmount: totalAmount,
                    currency: 'COP',
                    deliveryAddress: args.deliveryAddress || 'not_specified',
                    paymentMethod: 'not_specified',
                    status: 'pending'
                });

                console.log(`Order created: ${newOrder._id}, Total: ${totalAmount}`);
                sseManager.sendEvent(persona._id.toString(), 'NEW_ORDER', newOrder);

                return JSON.stringify({
                    success: true,
                    message: `Order #${newOrder._id} created. Total: $${totalAmount}. Need Payment Method.`
                });
            },
            updateOrderPaymentMethod: async (args) => {
                console.log('--- DEBUG: updateOrderPaymentMethod CALLED ---');
                console.log('Args:', JSON.stringify(args, null, 2));

                const order = await Order.findOne({ contactId: contact._id, status: 'pending' }).sort({ createdAt: -1 });
                if (!order) {
                    console.log('No pending order found for this contact.');
                    return "No pending order found to update.";
                }
                
                order.paymentMethod = args.paymentMethod;
                await order.save();
                console.log(`Payment method updated for order ${order._id} to ${args.paymentMethod}`);
                
                return `Payment method updated to ${args.paymentMethod}. ${args.paymentMethod === 'transfer' ? 'Waiting for proof.' : 'Order confirmed.'}`;
            },
            registerPaymentProof: async (args) => {
                 const order = await Order.findOne({ contactId: contact._id, status: 'pending' }).sort({ createdAt: -1 });
                 if (!order) return "No pending order found.";
                 
                 order.paymentProofUrl = args.proofUrl || "PENDING_VERIFICATION_VIA_CHAT";
                 order.status = 'pending_verification';
                 await order.save();
                 
                 sseManager.sendEvent(persona._id.toString(), 'PAYMENT_PROOF_RECEIVED', {
                     orderId: order._id,
                     proofUrl: order.paymentProofUrl
                 });

                 return "Payment proof registered. Admin will verify.";
            },
            cancelOrder: async (args) => {
                const order = await Order.findOne({ 
                    contactId: contact._id, 
                    status: { $in: ['pending', 'pending_verification'] } 
                }).sort({ createdAt: -1 });

                if (!order) return "No pending order found to cancel.";

                order.status = 'cancelled';
                await order.save();

                sseManager.sendEvent(persona._id.toString(), 'ORDER_CANCELLED', order);
                return `Order #${order._id} has been cancelled successfully.`;
            },
            getOrderStatus: async (args) => {
                 const order = await Order.findOne({ 
                    contactId: contact._id, 
                    status: { $nin: ['cancelled', 'completed'] } 
                }).sort({ createdAt: -1 });
                
                if (!order) return "You have no active orders at the moment.";
                
                return `Your Order #${order._id} is currently: ${order.status.toUpperCase()}. Total: $${order.totalAmount}. ${(order.status === 'confirmed') ? 'We are preparing it!' : ''}`;
            }
        };
    }
};

module.exports = salesAgent;
