const Notification = require('../models/Notification');
const { BadRequestError, NotFoundError } = require('../utils/ApiResponse');

/**
 * Get notifications for the authenticated owner
 * GET /api/notifications
 */
exports.getNotifications = async (req, res) => {
    try {
        const ownerId = req.user.clientPersonaId; // From authMiddleware

        if (!ownerId) {
            return res.error(new BadRequestError('Client Persona ID required'));
        }

        const notifications = await Notification.find({
            ownerId: ownerId,
            status: { $ne: 'deleted' }
        })
            .sort({ createdAt: -1 })
            .limit(50); // Optional limit to keep frontend light

        return res.success(notifications);
    } catch (error) {
        console.error('Error fetching notifications:', error);
        return res.error(error);
    }
};

/**
 * Mark a notification as viewed
 * PATCH /api/notifications/:id/viewed
 */
exports.markAsViewed = async (req, res) => {
    try {
        const { id } = req.params;
        const ownerId = req.user.clientPersonaId;

        const notification = await Notification.findOne({ _id: id, ownerId });

        if (!notification) {
            return res.error(new NotFoundError('Notification not found'));
        }

        notification.status = 'viewed';
        await notification.save();

        return res.success({ success: true, message: 'Marked as viewed', notification });
    } catch (error) {
        return res.error(error);
    }
};

/**
 * Soft delete a notification
 * DELETE /api/notifications/:id
 */
exports.deleteNotification = async (req, res) => {
    try {
        const { id } = req.params;
        const ownerId = req.user.clientPersonaId;

        const notification = await Notification.findOne({ _id: id, ownerId });

        if (!notification) {
            return res.error(new NotFoundError('Notification not found'));
        }

        notification.status = 'deleted';
        await notification.save();

        return res.success({ success: true, message: 'Notification deleted' });
    } catch (error) {
        return res.error(error);
    }
};
