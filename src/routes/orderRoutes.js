const express = require('express');
const router = express.Router();
const orderController = require('../controllers/orderController');
const { protect } = require('../middleware/authMiddleware');


router.use(protect);
router.get('/', orderController.getOrders);
router.patch('/:id/status', orderController.updateOrderStatus);

module.exports = router;
