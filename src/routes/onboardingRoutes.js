const express = require('express');
const router = express.Router();
const onboardingController = require('../controllers/onboardingController');
const { protect } = require('../middlewares/authMiddleware');

router.post('/setup-catalog', protect, onboardingController.setupCatalog);

module.exports = router;
