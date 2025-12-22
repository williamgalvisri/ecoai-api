const express = require('express');
const cors = require('cors');
const responseHandler = require('./middlewares/responseHandler');
const chatRoutes = require('./routes/chatRoutes');
const whatsappRoutes = require('./routes/whatsappRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const sseRoutes = require('./routes/sseRoutes');
const authRoutes = require('./routes/authRoutes');
const notificationRoutes = require('./routes/notificationRoutes');

const app = express();

// Middleware
app.use(express.json());
app.use(cors());
app.use(responseHandler);

// Routes
app.use('/api/chat', chatRoutes);
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api', sseRoutes);

// Health Check
app.get('/', (req, res) => {
    res.send('Eco AI API is running...');
});

module.exports = app;
