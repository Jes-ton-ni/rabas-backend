require('dotenv').config();
const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { getPool, closeConnections, sessionStore } = require('./db/connection');
const EventEmitter = require('events');
EventEmitter.defaultMaxListeners = 15; // Increase global limit if needed

const PORT = process.env.PORT || 5000;
const app = express();

(async () => {
    try {
        // Initialize the database pool
        const pool = await getPool();

        // Initialize session store
        const sessionStore = new MySQLStore({}, pool);

        // Check if sessionStore is initialized
        if (!sessionStore) {
            throw new Error('Session store is not initialized');
        }

        // Store sessionStore globally if needed
        app.locals.sessionStore = sessionStore;

        // Initial database connection test
        console.log('Testing database connection...');
        await pool.query('SELECT 1');
        console.log('Initial database connection successful');

        // Start the server only after successful initialization
        app.listen(PORT, () => {
            console.log(`Server running on port ${PORT}`);
        });

    } catch (err) {
        console.error('Error initializing session store:', err);
        process.exit(1); // Exit the process if session store initialization fails
    }
})();

// Middleware
app.use(cors({
    origin: 'http://localhost:5173',
    credentials: true
}));
app.use(express.json());

// Use session middleware
app.use(session({
    key: 'session_cookie_name',
    secret: 'your_secret_key',
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 1000 * 60 * 60 * 24 // 1 day
    }
}));

// User Login Endpoint
app.post('/login', async (req, res) => {
    const { identifier, password } = req.body; // Use 'identifier' to accept either username or email

    if (!identifier || !password) {
        return res.status(400).json({ success: false, message: 'Username or email and password are required' });
    }

    try {
        if (!req.db) {
            req.db = await getPool();
        }

        const sql = 'SELECT * FROM users WHERE (username = ? OR email = ?)';
        const [results] = await req.db.query(sql, [identifier, identifier]);

        if (results.length > 0) {
            const user = results[0];
            if (user.password === null) {
                // Handle users who signed up with Google
                return res.status(401).json({ success: false, message: 'Please log in using Google' });
            }

            // Compare the provided password with the hashed password from the database
            const passwordMatch = await bcrypt.compare(password, user.password);
            if (passwordMatch) {
                req.session.user = { user_id: user.user_id };
                return res.json({ success: true, message: 'Login successful' });
            } else {
                return res.status(401).json({ success: false, message: 'Invalid password' });
            }
        } else {
            return res.status(401).json({ success: false, message: 'User not found' });
        }
    } catch (err) {
        console.error('Login error:', err);
        return res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

// Endpoint for forgot password
app.post('/forgot-password', async (req, res) => {
    const { email } = req.body;

    // Generate a secure token
    const token = crypto.randomBytes(20).toString('hex');

    // Set token expiration time (e.g., 1 hour)
    const tokenExpiration = Date.now() + 3600000;

    try {
        // Store the token and expiration in the database for the user
        const sql = 'UPDATE users SET reset_password_token = ?, reset_password_expires = ? WHERE email = ?';
        const [results] = await req.db.query(sql, [token, tokenExpiration, email]);

        if (results.affectedRows === 0) {
            console.log('Email not found:', email); // Log the email not found
            return res.status(404).json({ success: false, message: 'Email not found' });
        }

        // Send email with the token
        const transporter = nodemailer.createTransport({
            service: 'Gmail',
            auth: {
                user: process.env.GMAIL_USER,
                pass: process.env.GMAIL_PASS
            }
        });

        const mailOptions = {
            to: email,
            from: process.env.GMAIL_USER,
            subject: 'Password Reset',
            text: `You are receiving this because you (or someone else) have requested the reset of the password for your account.\n\n
                   Please click on the following link, or paste this into your browser to complete the process:\n\n
                   http://localhost:5000/reset-password/${token}\n\n
                   If you did not request this, please ignore this email and your password will remain unchanged.\n`
        };

        await transporter.sendMail(mailOptions);
        res.json({ success: true, message: 'Password reset email sent' });

    } catch (err) {
        console.error('Error in forgot-password endpoint:', err);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

// Endpoint to handle password reset
app.post('/reset-password/:token', async (req, res) => {
    const { token } = req.params;
    const { newPassword } = req.body;
  
    if (!newPassword) {
        return res.status(400).json({ success: false, message: 'New password is required' });
    }
  
    try {
        // Hash the new password
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        
        // Update the user's password in the database
        const updateSql = 'UPDATE users SET password = ?, reset_password_token = NULL, reset_password_expires = NULL WHERE reset_password_token = ?';
        const [result] = await req.db.query(updateSql, [hashedPassword, token]);
        
        if (result.affectedRows === 0) {
            return res.status(400).json({ success: false, message: 'Invalid or expired token' });
        }
        
        res.json({ success: true, message: 'Password has been reset' });
    } catch (err) {
        console.error('Error resetting password:', err);
        return res.status(500).json({ success: false, message: 'Internal server error' });
    }
});


// Redirect to the React frontend for password reset
app.get('/reset-password/:token', (req, res) => {
    const { token } = req.params;
  
    // Redirect to the React frontend with the token as a query parameter
    res.redirect(`http://localhost:5173/resetpassword?token=${token}`);
});

// Handle the password reset form submission
app.post('/reset-password/:token', (req, res) => {
    const { token } = req.params;
    const { newPassword } = req.body;

    // Log the new password to ensure it's defined
    console.log('New password:', newPassword);

    if (!newPassword) {
        return res.status(400).json({ success: false, message: 'New password is required' });
    }

    // Hash the new password
    bcrypt.hash(newPassword, 10, (err, hashedPassword) => {
        if (err) {
            console.error('Error hashing password:', err);
            return res.status(500).json({ success: false, message: 'Internal server error' });
        }

        // Update the user's password in the database
        const updateSql = 'UPDATE users SET password = ?, reset_password_token = NULL, reset_password_expires = NULL WHERE reset_password_token = ?';
        connection.query(updateSql, [hashedPassword, token], (err) => {
            if (err) {
                console.error('Error updating password:', err);
                return res.status(500).json({ success: false, message: 'Internal server error' });
            }
            res.json({ success: true, message: 'Password has been reset' });
        });
    });
});

  
// Endpoint for checking login status
app.get('/check-login', (req, res) => {
    const sessionStore = app.locals.sessionStore; // Access the sessionStore from app.locals

    if (!sessionStore) {
        return res.status(500).json({ isLoggedIn: false, error: 'Session store is not available' });
    }

    // Retrieve session data from the database
    sessionStore.get(req.sessionID, (err, session) => {
        if (err) {
            console.error('Error fetching session from database:', err);
            return res.status(500).json({ isLoggedIn: false, error: 'Internal server error' });
        }

        // Check if session exists and has user data
        if (session && session.user) {
            // User is logged in
            return res.status(200).json({ isLoggedIn: true, user: session.user });
        } else {
            // Session not found or user not logged in
            return res.status(200).json({ isLoggedIn: false });
        }
    });
});

// Endpoint to get userData from users table based on user_id
app.get('/get-userData', (req, res) => {
    // Check if user is logged in and session contains user_id
    if (req.session.user && req.session.user.user_id) {
      const userId = req.session.user.user_id;
      const sql = 'SELECT user_id, google_id, Fname, Lname, username, contact, email, image, image_path FROM users WHERE user_id = ?';
  
      connection.query(sql, [userId], (err, results) => {
        if (err) {
          console.error('Error fetching user data:', err);
          return res.status(500).json({ success: false, message: 'Internal server error' });
        }
        if (results.length > 0) {
          const userData = results[0];
          return res.json({ success: true, userData });
        } else {
          return res.status(404).json({ success: false, message: 'User data not found' });
        }
      });
    } else {
      // If user is not authenticated or session user_id is not set
      return res.status(401).json({ success: false, message: 'User not authenticated' });
    }
  });

// Endpoint to get all business products
app.get('/api/getAllBusinessProducts', async (req, res) => {
    const maxRetries = 3;
    let attempt = 0;

    while (attempt < maxRetries) {
        try {
            if (!req.db) {
                req.db = await getPool();
            }

            const sql = `
                SELECT 
                    products.*, 
                    MAX(COALESCE(deals.discount, 0)) AS discount, 
                    MAX(COALESCE(deals.expirationDate, 'No Expiration')) AS expiration
                FROM 
                    products
                LEFT JOIN 
                    deals 
                ON 
                    products.product_id = deals.product_id
                GROUP BY 
                    products.product_id
                ORDER BY 
                    expiration DESC
                LIMIT 0, 1000
            `;

            const [results] = await req.db.query(sql);
            console.log('Successfully fetched business products:', results.length);
            
            return res.json({
                success: true,
                businessProducts: results.length > 0 ? results : []
            });
        } catch (err) {
            attempt++;
            console.error(`Error fetching business products (attempt ${attempt}/${maxRetries}):`, {
                message: err.message,
                code: err.code,
                state: err.sqlState
            });

            // Reset connection on error
            req.db = null;

            if (attempt === maxRetries) {
                return res.status(500).json({ 
                    success: false, 
                    message: 'Internal server error',
                    details: err.message
                });
            }

            // Wait before retrying with exponential backoff
            await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
        }
    }
});




app.get('/api/getAllBusinessProduct', (req, res) => {
    const sql = `
      SELECT 
          products.*, 
          MAX(COALESCE(deals.discount, 0)) AS discount, 
          MAX(COALESCE(deals.expirationDate, 'No Expiration')) AS expiration,
          AVG(r.ratings) AS rating
      FROM 
          products
      LEFT JOIN 
          deals 
      ON 
          products.product_id = deals.product_id
      LEFT JOIN
          product_ratings r ON products.product_id = r.product_id
      GROUP BY 
          products.product_id
      ORDER BY 
          expiration DESC
      LIMIT 0, 1000
    `;
  
    connection.query(sql, (err, results) => {
      if (err) {
        console.error('Error executing SQL query:', err);
        return res.status(500).json({ success: false, message: 'Internal server error' });
      }
  
      return res.json({ success: true, businessProducts: results.length > 0 ? results : [] });
    });
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
    const maxRetries = 3;
    let attempt = 0;

    while (attempt < maxRetries) {
        try {
            // Get a connection from the pool
            const db = await getPool();

            // Fetch users
            const [users] = await db.query('SELECT user_id, username, email FROM users');
            console.log('Successfully fetched users:', users.length);

            return res.json({
                success: true,
                users: users
            });

        } catch (err) {
            attempt++;
            console.error(`Error fetching users (attempt ${attempt}/${maxRetries}):`, {
                message: err.message,
                code: err.code,
                state: err.sqlState
            });

            if (attempt === maxRetries) {
                return res.status(500).json({
                    error: 'Failed to fetch users',
                    details: err.message
                });
            }

            // Wait before retrying
            await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Global error handler:', err);
    res.status(500).json({ error: 'Something broke!', details: err.message });
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('Shutting down...');
    await closeConnections();
    console.log('Database connections closed');
    process.exit(0);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
