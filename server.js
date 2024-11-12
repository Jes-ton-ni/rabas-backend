require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { getPool } = require('./db/connection');

const PORT = process.env.PORT || 3000;
const app = express();

// Middleware
app.use(cors({
    origin: 'http://localhost:5173',
    credentials: true
}));
app.use(express.json());

// Initial database connection test
console.log('Testing database connection...');
getPool()
    .then(pool => {
        console.log('Initial database connection successful');
        return pool.query('SHOW TABLES');
    })
    .then(([tables]) => {
        console.log('Available tables:', tables);
    })
    .catch(err => {
        console.error('Initial database connection failed:', err);
    });

// Database middleware
app.use(async (req, res, next) => {
    try {
        if (!req.db) {
            console.log('Establishing database connection for request...');
            req.db = await getPool();
            console.log('Database connection established for request');
        }
        next();
    } catch (err) {
        console.error('Database middleware error:', err);
        res.status(500).json({ error: 'Database connection failed' });
    }
});

// User Routes
app.post('/api/users/register', async (req, res) => {
    try {
        const { email, password, name } = req.body;
        const [existingUsers] = await req.db.query('SELECT * FROM users WHERE email = ?', [email]);
        
        if (existingUsers.length > 0) {
            return res.status(400).json({ error: 'Email already registered' });
        }

        const [result] = await req.db.query(
            'INSERT INTO users (email, password, name) VALUES (?, ?, ?)',
            [email, password, name]
        );

        res.status(201).json({ 
            message: 'User registered successfully',
            userId: result.insertId 
        });
    } catch (err) {
        console.error('Registration error:', err);
        res.status(500).json({ error: 'Registration failed' });
    }
});

app.post('/api/users/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const [users] = await req.db.query(
            'SELECT * FROM users WHERE email = ? AND password = ?',
            [email, password]
        );

        if (users.length === 0) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const user = users[0];
        res.json({ 
            message: 'Login successful',
            user: {
                id: user.id,
                email: user.email,
                name: user.name
            }
        });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Login failed' });
    }
});

// Business Routes
app.post('/api/businesses/register', async (req, res) => {
    try {
        const { name, description, userId } = req.body;
        const [result] = await req.db.query(
            'INSERT INTO businesses (name, description, user_id) VALUES (?, ?, ?)',
            [name, description, userId]
        );

        res.status(201).json({
            message: 'Business registered successfully',
            businessId: result.insertId
        });
    } catch (err) {
        console.error('Business registration error:', err);
        res.status(500).json({ error: 'Business registration failed' });
    }
});

app.get('/api/businesses', async (req, res) => {
    try {
        const [businesses] = await req.db.query('SELECT * FROM businesses');
        res.json(businesses);
    } catch (err) {
        console.error('Error fetching businesses:', err);
        res.status(500).json({ error: 'Failed to fetch businesses' });
    }
});

app.get('/api/businesses/:id', async (req, res) => {
    try {
        const [businesses] = await req.db.query(
            'SELECT * FROM businesses WHERE id = ?',
            [req.params.id]
        );

        if (businesses.length === 0) {
            return res.status(404).json({ error: 'Business not found' });
        }

        res.json(businesses[0]);
    } catch (err) {
        console.error('Error fetching business:', err);
        res.status(500).json({ error: 'Failed to fetch business' });
    }
});

// Business Application Routes
app.post('/api/business-applications', async (req, res) => {
    try {
        const { businessId, status = 'pending' } = req.body;
        const [result] = await req.db.query(
            'INSERT INTO business_applications (business_id, status) VALUES (?, ?)',
            [businessId, status]
        );

        res.status(201).json({
            message: 'Business application submitted successfully',
            applicationId: result.insertId
        });
    } catch (err) {
        console.error('Business application error:', err);
        res.status(500).json({ error: 'Failed to submit business application' });
    }
});

app.get('/api/business-applications', async (req, res) => {
    try {
        const [applications] = await req.db.query(`
            SELECT ba.*, b.name as business_name 
            FROM business_applications ba 
            JOIN businesses b ON ba.business_id = b.id
        `);
        res.json(applications);
    } catch (err) {
        console.error('Error fetching applications:', err);
        res.status(500).json({ error: 'Failed to fetch applications' });
    }
});

app.get('/api/allUsers', async (req, res) => {
    try {
        const [users] = await req.db.query('SELECT * FROM users');
        console.log(users);
        res.json(users);
    } catch (err) {
        console.error('Error fetching users:', err);
        res.status(500).json({ error: 'Failed to fetch users' });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Global error handler:', err);
    res.status(500).json({ error: 'Something broke!', details: err.message });
});

// Start server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('Shutting down...');
    const { closePool } = require('./db/connection');
    await closePool();
    console.log('Database connections closed');
    process.exit(0);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
