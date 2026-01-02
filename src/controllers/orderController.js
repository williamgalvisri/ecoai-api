const Order = require('../models/Order');
const Contact = require('../models/Contact');
const ClientPersona = require('../models/ClientPersona');
const whatsappController = require('./whatsappController');
// const axios = require('axios'); // Not needed if using whatsappController helper

exports.getOrders = async (req, res) => {
    try {
        const { ownerId, status } = req.query;
        let query = {};
        
        if (ownerId) query.ownerId = ownerId;
        if (status) query.status = status;

        const orders = await Order.find(query)
            .populate('contactId', 'name phoneNumber')
            .sort({ createdAt: -1 });

        return res.success(orders, 'Orders retrieved successfully');
    } catch (error) {
        console.error('Error fetching orders:', error);
        return res.error('Failed to fetch orders');
    }
};

exports.updateOrderStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        const validStatuses = ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'];
        if (!validStatuses.includes(status)) {
            return res.error(`Invalid status. Must be one of: ${validStatuses.join(', ')}`);
        }

        const order = await Order.findById(id).populate('contactId').populate('ownerId');
        if (!order) {
            return res.error('Order not found', 404);
        }

        const oldStatus = order.status;
        order.status = status;
        await order.save();

        // NOTIFICATION LOGIC
        if (oldStatus !== status && order.contactId && order.ownerId) {
            const customerPhone = order.contactId.phoneNumber;
            const persona = order.ownerId;
            let message = "";

            const orderIdStr = String(id);
            switch (status) {
                case 'confirmed':
                    message = `✅ ¡Tu orden #${orderIdStr.slice(-6)} ha sido confirmada y validada! Estamos preparándola.`;
                    break;
                case 'shipped':
                    message = `🚚 ¡Buenas noticias! Tu orden #${orderIdStr.slice(-6)} va en camino. Pronto llegará a tu dirección.`;
                    break;
                case 'delivered':
                    message = `🎉 Tu orden #${orderIdStr.slice(-6)} ha sido entregada. ¡Gracias por confiar en nosotros!`;
                    break;
                case 'cancelled':
                    message = `❌ Tu orden #${orderIdStr.slice(-6)} ha sido cancelada. Si crees que es un error, contáctanos.`;
                    break;
            }

            if (message) {
                 // Use the helper from whatsappController. 
                 // We need to ensure we use the 'sendReply' compatible function OR direct axios call.
                 // Since whatsappController exports 'sendMessage' usually, let's verify whatsappController. 
                 // Actually, whatsappController.processIncomingMessage uses a callback. 
                 // We need a direct 'sendMessage' utility. 
                 // For now, I will use a direct AXIOS call similar to what is likely in 'whatsappController' or 'utils'.
                 // BETTER: Create a focused helper in whatsappController called 'sendNotification'.
                 await whatsappController.sendNotification(customerPhone, message, persona);
            }
        }

        return res.success(order, `Order status updated to ${status}`);

    } catch (error) {
        console.error('Error updating order:', error);
        return res.error('Failed to update order status');
    }
};
