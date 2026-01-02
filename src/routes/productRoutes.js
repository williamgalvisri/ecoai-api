const express = require('express');
const router = express.Router();
const productController = require('../controllers/productController');
const { protect } = require('../middlewares/authMiddleware'); // Assuming we have auth

router.use(protect);

router.post('/', productController.createProduct);
router.get('/', productController.getProducts);
router.post('/sync', productController.syncProducts); // Bulk Sync Endpoint
router.put('/:id', productController.updateProduct);
router.delete('/:id', productController.deleteProduct);

module.exports = router;
