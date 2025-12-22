const express = require('express');
const router = express.Router();
const sseManager = require('../utils/sseManager');
const { protect } = require('../middlewares/authMiddleware');

router.get('/events', protect, (req, res) => {
    // Auth handled by middleware. req.user is populated.
    const ownerId = req.user.clientPersonaId || req.user.id || req.user._id;

    if (!ownerId) {
        console.error('SSE Auth Failed: Token payload missing clientPersonaId or id');
        return res.status(401).json({ message: 'Invalid token payload' });
    }

    // 2. Setup SSE Headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // 3. Register Client
    sseManager.addClient(ownerId.toString(), res);

    // 4. Cleanup on close
    req.on('close', () => {
        sseManager.removeClient(ownerId.toString(), res);
    });
});

module.exports = router;
