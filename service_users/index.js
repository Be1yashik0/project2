const express = require('express');
const cors = require('cors');
const pinoHttp = require('pino-http');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { z } = require('zod');

const app = express();
const PORT = process.env.PORT || 8000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-key';

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
const usersDB = {}; // Store users by ID

// --- Zod Schemas for Validation ---
const registerSchema = z.object({
    name: z.string().min(2),
    email: z.string().email(),
    password: z.string().min(6),
});

const loginSchema = z.object({
    email: z.string().email(),
    password: z.string(),
});

// Helper to remove password from user object
const omit = (obj, key) => {
  const { [key]: _, ...rest } = obj;
  return rest;
};


// --- Authentication Middleware ---
const authMiddleware = (req, res, next) => {
    const userId = req.headers['x-user-id'];
    const userRoles = req.headers['x-user-roles'] ? req.headers['x-user-roles'].split(',') : [];

    if (!userId) {
        return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'User ID not provided by gateway' } });
    }

    req.user = { id: userId, roles: userRoles };
    next();
};

// --- Routes ---
const v1Router = express.Router();

// --- Auth Routes (Public) ---
const authRouter = express.Router();

authRouter.post('/register', async (req, res, next) => {
    try {
        const { name, email, password } = registerSchema.parse(req.body);

        if (Object.values(usersDB).some(user => user.email === email)) {
            return res.status(409).json({ error: { code: 'CONFLICT', message: 'User with this email already exists' } });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = {
            id: uuidv4(),
            name,
            email,
            password: hashedPassword,
            roles: ['user'],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };

        usersDB[newUser.id] = newUser;
        req.log.info({ userId: newUser.id }, 'User registered successfully');

        res.status(201).json(omit(newUser, 'password'));
    } catch (error) {
        next(error);
    }
});

authRouter.post('/login', async (req, res, next) => {
    try {
        const { email, password } = loginSchema.parse(req.body);
        const user = Object.values(usersDB).find(u => u.email === email);

        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid email or password' } });
        }

        const token = jwt.sign({ id: user.id, roles: user.roles }, JWT_SECRET, { expiresIn: '1h' });
        req.log.info({ userId: user.id }, 'User logged in successfully');

        res.json({ success: true, token });
    } catch (error) {
        next(error);
    }
});

v1Router.use('/auth', authRouter);


// --- User Routes (Protected) ---
const usersRouter = express.Router();
usersRouter.use(authMiddleware); // Protect all user routes

usersRouter.get('/profile', (req, res) => {
    const user = usersDB[req.user.id];
    if (!user) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found' } });
    }
    res.json(omit(user, 'password'));
});

usersRouter.put('/profile', (req, res, next) => {
    try {
        // For simplicity, allowing only name update
        const { name } = req.body;
        const user = usersDB[req.user.id];
        if (!user) {
            return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found' } });
        }
        user.name = name ?? user.name;
        user.updatedAt = new Date().toISOString();
        res.json(omit(user, 'password'));
    } catch (error) {
        next(error);
    }
});

// Admin-only route
usersRouter.get('/', (req, res) => {
    if (!req.user.roles.includes('admin')) {
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } });
    }
    const users = Object.values(usersDB).map(u => omit(u, 'password'));
    res.json(users);
});


v1Router.use('/users', usersRouter);

app.use('/v1', v1Router);


// --- Health & Status ---
app.get('/status', (req, res) => res.json({ status: 'Users service is running' }));
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
    req.log.error(err);
    res.status(500).json({
        error: {
            code: 'INTERNAL_SERVER_ERROR',
            message: 'An unexpected error occurred.',
        },
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`Users service running on port ${PORT}`);
});
