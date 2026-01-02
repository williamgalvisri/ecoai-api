const mongoose = require('mongoose');

const ProductSchema = new mongoose.Schema({
    ownerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'ClientPersona',
        required: true
    },
    // ID assigned by Meta/Facebook
    metaCatalogId: {
        type: String,
        default: '' 
    },
    // Internal SKU or Retailer ID (Unique per owner)
    retailerId: {
        type: String,
        required: true
    },
    name: {
        type: String,
        required: true
    },
    description: {
        type: String,
        default: ''
    },
    price: {
        type: Number,
        required: true
    },
    currency: {
        type: String,
        default: 'COP'
    },
    imageUrl: {
        type: String,
        default: ''
    },
    availability: {
        type: String,
        enum: ['in stock', 'out of stock'],
        default: 'in stock'
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

// Composite index to ensure unique retailerId per owner
ProductSchema.index({ ownerId: 1, retailerId: 1 }, { unique: true });

module.exports = mongoose.model('Product', ProductSchema);
