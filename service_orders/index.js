const express = require('express');
const cors = require('cors');
const pinoHttp = require('pino-http');
const { v4: uuidv4 } = require('uuid');
const { z } = require('zod');

const app = express();
const PORT = process.env.PORT || 8000;

// --- Logger and Middleware ---
const pinoConfig = {};

if (process.env.NODE_ENV === 'development') {
    pinoConfig.transport = {
        target: 'pino-pretty',
        options: {
            colorize: true,
            levelFirst: true,
        },
    };
}

const logger = pinoHttp(pinoConfig);

app.use(logger);
app.use(cors());
app.use(express.json());

// --- In-Memory Database ---
const ordersDB = {};

// --- Zod Schemas for Validation ---
const orderItemSchema = z.object({
    productId: z.string().uuid(),
    quantity: z.number().int().positive(),
});

const createOrderSchema = z.object({
    items: z.array(orderItemSchema).min(1),
    totalAmount: z.number().positive(),
});

const updateOrderSchema = z.object({
    status: z.enum(['created', 'in_progress', 'completed', 'cancelled']),
});


// --- Authentication Middleware ---
// This middleware relies on the gateway to validate the JWT and pass user info in headers.
const authMiddleware = (req, res, next) => {
    const userId = req.headers['x-user-id'];
    const userRoles = req.headers['x-user-roles']?.split(',') || [];

    if (!userId) {
        return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'User ID not provided in headers' } });
    }

    req.user = { id: userId, roles: userRoles };
    next();
};

// --- Domain Event Stubs ---
const publishOrderCreatedEvent = (order, req) => {
    req.log.info({ orderId: order.id, userId: order.userId, event: 'order_created' }, 'Publishing "Order Created" event stub');
    // In a real system, this would send a message to a broker like RabbitMQ or Kafka
};

const publishOrderStatusUpdatedEvent = (order, oldStatus, req) => {
    req.log.info({ orderId: order.id, oldStatus, newStatus: order.status, event: 'order_status_updated' }, 'Publishing "Order Status Updated" event stub');
};


// --- Routes ---
const v1Router = express.Router();
v1Router.use(authMiddleware); // Protect all routes

v1Router.post('/', (req, res, next) => {
    try {
        const { items, totalAmount } = createOrderSchema.parse(req.body);
        const newOrder = {
            id: uuidv4(),
            userId: req.user.id,
            items,
            totalAmount,
            status: 'created',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        ordersDB[newOrder.id] = newOrder;

        publishOrderCreatedEvent(newOrder, req);

        res.status(201).json(newOrder);
    } catch (error) {
        next(error);
    }
});

v1Router.get('/', (req, res) => {
    let orders = Object.values(ordersDB);
    if (!req.user.roles.includes('admin')) {
        orders = orders.filter(order => order.userId === req.user.id);
    }
    res.json(orders);
});

v1Router.get('/:orderId', (req, res) => {
    const order = ordersDB[req.params.orderId];
    if (!order) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Order not found' } });
    }
    if (order.userId !== req.user.id && !req.user.roles.includes('admin')) {
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You do not have permission to view this order' } });
    }
    res.json(order);
});

v1Router.put('/:orderId', (req, res, next) => {
    try {
        const { status } = updateOrderSchema.parse(req.body);
        const order = ordersDB[req.params.orderId];

        if (!order) {
            return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Order not found' } });
        }
        if (order.userId !== req.user.id && !req.user.roles.includes('admin')) {
            return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You do not have permission to update this order' } });
        }

        const oldStatus = order.status;
        order.status = status;
        order.updatedAt = new Date().toISOString();

        publishOrderStatusUpdatedEvent(order, oldStatus, req);

        res.json(order);
    } catch (error) {
        next(error);
    }
});

v1Router.delete('/:orderId', (req, res) => {
    const order = ordersDB[req.params.orderId];
    if (!order) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Order not found' } });
    }
    // For now, only owners can cancel their own order.
    if (order.userId !== req.user.id) {
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You do not have permission to cancel this order' } });
    }

    const oldStatus = order.status;
    order.status = 'cancelled';
    order.updatedAt = new Date().toISOString();

    publishOrderStatusUpdatedEvent(order, oldStatus, req);
    
    res.status(200).json(order);
});

app.use('/v1/orders', v1Router);

// --- Health & Status ---
app.get('/status', (req, res) => res.json({ status: 'Orders service is running' }));
app.get('/health', (req, res) => res.json({ status: 'OK' }));

// --- Error Handling Middleware ---
app.use((err, req, res, next) => {
    if (err instanceof z.ZodError) {
        return res.status(400).json({
            error: {
                code: 'VALIDATION_ERROR',
                message: 'Invalid input data',
                details: err.errors,
            },
        });
    }
    req.log.error(err, 'An unexpected error occurred');
    res.status(500).json({
        error: {
            code: 'INTERNAL_SERVER_ERROR',
            message: 'An unexpected error occurred.',
        },
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`Orders service running on port ${PORT}`);
});
