const ClientPersona = require('../models/ClientPersona');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const generateToken = (payload) => {
    return jwt.sign(payload, process.env.JWT_SECRET, {
        expiresIn: '24h',
    });
};

const login = async (req, res) => {
    const { phoneNumber, pin } = req.body;

    try {
        // Find user by phone number and include passwordHash
        const user = await ClientPersona.findOne({ phoneNumber }).select('+passwordHash');

        if (user && (await bcrypt.compare(pin, user.passwordHash))) {
            const payload = {
                clientPersonaId: user._id,
                firstName: user.firstName,
                lastName: user.lastName,
                businessPhone: user.phoneNumber,
                photoUrl: user.photoUrl,
                subscriptionPlan: user.subscription ? user.subscription.plan : 'basic'
            };

            res.json({
                token: generateToken(payload),
                user: payload,
            });
        } else {
            res.status(401).json({ message: 'Invalid phone number or PIN' });
        }
    } catch (error) {
        console.error('Login Error:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

module.exports = { login };
