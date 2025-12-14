const express = require('express');
const cors = require('cors');
const axios = require('axios');
const CircuitBreaker = require('opossum');
const { v4: uuidv4 } = require('uuid');
const pinoHttp = require('pino-http');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 8000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-key';

// Service URLs
const USERS_SERVICE_URL = 'http://service_users:8000';
const ORDERS_SERVICE_URL = 'http://service_orders:8000';

// Logger
const logger = pinoHttp({});

// Middleware
app.use(logger);
app.use(cors());
app.use(express.json());

// Rate Limiter
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per windowMs
    standardHeaders: true,
    legacyHeaders: false,
});
app.use(limiter);

// --- Circuit Breaker Configuration ---
const circuitOptions = {
    timeout: 5000,
    errorThresholdPercentage: 50,
    resetTimeout: 30000,
};

const createCircuitBreaker = (axiosCall) => {
    const breaker = new CircuitBreaker(axiosCall, circuitOptions);
    breaker.fallback(() => ({
        error: 'Service temporarily unavailable',
        code: 'SERVICE_UNAVAILABLE'
    }));
    return breaker;
};

// Axios instance for circuit breaker
const forwardRequest = (req, serviceUrl, path) => {
    const url = `${serviceUrl}${path}`;
    const { method, body, headers } = req;

    const requestHeaders = {
        'x-request-id': req.id,
        'Content-Type': 'application/json',
    };
    // Forward auth headers if they exist
    if (req.headers['x-user-id']) {
        requestHeaders['x-user-id'] = req.headers['x-user-id'];
    }
    if (req.headers['x-user-roles']) {
        requestHeaders['x-user-roles'] = req.headers['x-user-roles'];
    }

    // Let axios throw an error only on 5xx responses or network errors
    return axios({
        method,
        url,
        data: body,
        headers: requestHeaders,
        validateStatus: (status) => status < 500, // Resolve for 2xx and 4xx status codes
    });
};


const usersCircuit = createCircuitBreaker((req) => forwardRequest(req, USERS_SERVICE_URL, req.originalUrl));
const ordersCircuit = createCircuitBreaker((req) => forwardRequest(req, ORDERS_SERVICE_URL, req.originalUrl));


// --- Authentication Middleware ---
const authenticateJWT = (req, res, next) => {
    const authHeader = req.headers.authorization;
    console.log('DEBUG: authHeader:', authHeader);
    console.log('DEBUG: authHeader && authHeader.startsWith("Bearer "):', authHeader && typeof authHeader === 'string' && authHeader.startsWith('Bearer '));

    if (authHeader && typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
        const token = authHeader.split(' ')[1];
        console.log('DEBUG: token:', token);
        jwt.verify(token, JWT_SECRET, (err, user) => {
            if (err) {
                console.log('DEBUG: JWT verification error:', err);
                return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Invalid or expired token' } });
            }
            // Attach user info to request headers to be forwarded
            req.headers['x-user-id'] = user.id;
            req.headers['x-user-roles'] = user.roles.join(',');
            next();
        });
    } else {
        console.log('DEBUG: Hitting else branch for missing/malformed token.');
        res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authorization header with Bearer token is missing' } });
    }
};

// --- Routing ---
const handleServiceRequest = (circuit) => (req, res, next) => {
    circuit.fire(req)
        .then(serviceResponse => {
            // Forward the status and data from the downstream service
            res.status(serviceResponse.status).json(serviceResponse.data);
        })
        .catch(err => {
            req.log.error({err: err}, 'Error in circuit.fire or network issue');
            // This catch block should now only be hit for 5xx errors, network issues, or circuit breaker fallbacks
            const status = err.response?.status || 503; // Default to 503 Service Unavailable
            const data = err.response?.data || { error: { code: 'SERVICE_UNAVAILABLE', message: 'Service is unavailable' } };
            res.status(status).json(data);
        });
};

// --- Public Routes ---
// Health & Status Endpoints
app.get('/status', (req, res) => {
    res.json({ status: 'API Gateway is running' });
});

app.get('/health', (req, res) => {
    res.json({
        status: 'API Gateway is running',
        circuits: {
            users: usersCircuit.status,
            orders: ordersCircuit.status,
        }
    });
});

// Auth routes are public
app.use('/v1/auth', handleServiceRequest(usersCircuit));


// --- Protected Routes ---
const protectedRouter = express.Router();
protectedRouter.use(authenticateJWT); // Apply JWT authentication to this router

// User routes
protectedRouter.use('/users', handleServiceRequest(usersCircuit));

// Order routes
protectedRouter.use('/orders', handleServiceRequest(ordersCircuit));

app.use('/v1', protectedRouter); // Mount protected router under /v1

// --- Error Handling ---
app.use((err, req, res, next) => {
    req.log.error(err, 'An unexpected error occurred in the API Gateway');
    res.status(500).json({
        error: {
            code: 'INTERNAL_SERVER_ERROR',
            message: 'An unexpected error occurred.',
        },
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`API Gateway running on port ${PORT}`);
});
