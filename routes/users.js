const express = require('express');
const router = express.Router();

// Get all users
router.get('/', async (req, res) => {
    try {
        const [users] = await req.db.query('SELECT * FROM users');
        res.json(users);
    } catch (err) {
        console.error('Error fetching users:', err);
        res.status(500).json({ error: 'Failed to fetch users' });
    }
});

// Get user by ID
router.get('/:id', async (req, res) => {
    try {
        const [users] = await req.db.query('SELECT * FROM users WHERE id = ?', [req.params.id]);
        if (users.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json(users[0]);
    } catch (err) {
        console.error('Error fetching user:', err);
        res.status(500).json({ error: 'Failed to fetch user' });
    }
});

// Create new user
router.post('/', async (req, res) => {
    try {
        const [result] = await req.db.query(
            'INSERT INTO users (name, email, password) VALUES (?, ?, ?)',
            [req.body.name, req.body.email, req.body.password]
        );
        res.status(201).json({ id: result.insertId });
    } catch (err) {
        console.error('Error creating user:', err);
        res.status(500).json({ error: 'Failed to create user' });
    }
});

module.exports = router; 