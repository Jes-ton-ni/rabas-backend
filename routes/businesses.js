const express = require('express');
const router = express.Router();

// Get all businesses
router.get('/', async (req, res) => {
    try {
        const [businesses] = await req.db.query('SELECT * FROM businesses');
        res.json(businesses);
    } catch (err) {
        console.error('Error fetching businesses:', err);
        res.status(500).json({ error: 'Failed to fetch businesses' });
    }
});

// Get business by ID
router.get('/:id', async (req, res) => {
    try {
        const [businesses] = await req.db.query('SELECT * FROM businesses WHERE id = ?', [req.params.id]);
        if (businesses.length === 0) {
            return res.status(404).json({ error: 'Business not found' });
        }
        res.json(businesses[0]);
    } catch (err) {
        console.error('Error fetching business:', err);
        res.status(500).json({ error: 'Failed to fetch business' });
    }
});

module.exports = router; 