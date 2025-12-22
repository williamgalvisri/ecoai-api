const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notificationController');
const { protect } = require('../middlewares/authMiddleware');

// All routes are protected
router.use(protect);

router.get('/', notificationController.getNotifications);
router.patch('/:id/viewed', notificationController.markAsViewed);
router.delete('/:id', notificationController.deleteNotification);

module.exports = router;
