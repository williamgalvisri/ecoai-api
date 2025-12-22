// Store clients as a map of ownerId -> Set of response objects
// This allows multiple connections per owner (e.g. multiple tabs/devices)
const clients = new Map();

/**
 * Add a client connection
 * @param {string} ownerId - The ID of the authenticated user
 * @param {Object} res - The response object
 */
exports.addClient = (ownerId, res) => {
    if (!clients.has(ownerId)) {
        clients.set(ownerId, new Set());
    }
    clients.get(ownerId).add(res);

    // console.log(`SSE Client connected for owner: ${ownerId}. Total clients: ${clients.get(ownerId).size}`);
};

/**
 * Remove a client connection
 * @param {string} ownerId - The ID of the authenticated user
 * @param {Object} res - The response object
 */
exports.removeClient = (ownerId, res) => {
    if (clients.has(ownerId)) {
        const userClients = clients.get(ownerId);
        userClients.delete(res);
        if (userClients.size === 0) {
            clients.delete(ownerId);
        }
    }
    // console.log(`SSE Client disconnected for owner: ${ownerId}`);
};

/**
 * Send an event to a specific owner
 * @param {string} ownerId - The recipient's ID
 * @param {string} eventName - Name of the event
 * @param {Object} data - Payload
 */
exports.sendEvent = (ownerId, eventName, data) => {
    if (clients.has(ownerId)) {
        const userClients = clients.get(ownerId);
        userClients.forEach(client => {
            client.write(`event: ${eventName}\n`);
            client.write(`data: ${JSON.stringify(data)}\n\n`);
        });
    }
};

/**
 * Broadcast event to ALL connected clients (optional utility)
 */
exports.broadcast = (eventName, data) => {
    clients.forEach((userClients) => {
        userClients.forEach(client => {
            client.write(`event: ${eventName}\n`);
            client.write(`data: ${JSON.stringify(data)}\n\n`);
        });
    });
};
