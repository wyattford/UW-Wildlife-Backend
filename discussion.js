const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const crypto = require('crypto');
const { checkUserStatus } = require('./account');
const { db, IMAGES_DIR } = require('./db');

const router = express.Router();
router.use(bodyParser.json());

router.use(cors({
    origin: ['https://uwwildlife.com', 'https://auth.uwwildlife.com', 'https://www.uwwildlife.com', 'https://www.auth.uwwildlife.com'],
    credentials: true
}));

function generateRandomPostId() {
    return new Promise((resolve, reject) => {
        function tryGenerate() {
            const id = parseInt(crypto.randomInt(10000000, 100000000).toString(), 10);
            db.get('SELECT post_id FROM discussion WHERE post_id = ?', [id], (err, row) => {
                if (err) {
                    return reject(err);
                }
                if (row) {
                    tryGenerate();
                } else {
                    resolve(id);
                }
            });
        }
        tryGenerate();
    });
}



router.get('/get', (req, res) => {
    const { post_id } = req.query;
    db.all('SELECT * FROM discussion WHERE post_id = ? LIMIT 1', [post_id], (err, rows) => {
        if (err) {
            console.error('Error fetching posts:', err);
            return res.status(500).json({ error: 'Internal Server Error' });
        }
        if (rows.length === 0) {
            return res.status(404).json({ error: 'Post not found' });
        }
        res.json(rows[0]);
    });

});

// /page?page=1
router.get('/page', (req, res) => {
    const page = parseInt(req.query.page, 10);
    if (isNaN(page) || page < 1) {
        return res.status(400).json({ error: 'Invalid page number' });
    }

    db.get('SELECT COUNT(*) as count FROM discussion', (err, countResult) => {
        if (err) {
            console.error('Error counting posts:', err);
            return res.status(500).json({ error: 'Internal Server Error' });
        }

        const totalRows = countResult.count;
        const totalPages = Math.ceil(totalRows / 10);

        if (page > totalPages && totalPages !== 0) {
            return res.status(400).json({ error: 'Page number exceeds total pages' });
        }

        const offset = (page - 1) * 10;
        db.all('SELECT * FROM discussion ORDER BY post_id DESC LIMIT 10 OFFSET ?', [offset], (err, rows) => {
            if (err) {
                console.error('Error fetching posts:', err);
                return res.status(500).json({ error: 'Internal Server Error' });
            }
            const hasMore = page < totalPages;
            res.json({
                posts: rows,
                hasMore
            });
        });
    });
});

router.post('/create', (req, res) => {
    const { auth_token, userId } = req.cookies || {};
    if (!auth_token || !userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    checkUserStatus(auth_token, userId)
        .then((user) => {
            if (!user) {
                return res.status(401).json({ error: 'Unauthorized' });
            }

            const { postData } = req.body;
            const { title, message } = postData || {};

            // Validate required fields
            if (!title || !message) {
                return res.status(400).json({ error: 'Missing required post data' });
            }

            let postId;
            generateRandomPostId()
                .then((id) => {
                    postId = id;
                    db.run(
                        `INSERT INTO discussion (post_id, user_id, title, message, date_created) VALUES (?, ?, ?, ?, ?)`,
                        [postId, userId, title, message, new Date().toISOString()],
                        (err) => {
                            if (err) {
                                console.error('Error creating post:', err);
                                return res.status(500).json({ error: 'Internal Server Error' });
                            }
                            res.status(201).json({ message: 'Post created successfully', post_id: postId });
                        }
                    );
                })
                .catch((err) => {
                    console.error('Error generating post ID:', err);
                    res.status(500).json({ error: 'Internal Server Error' });
                });
        })
        .catch((err) => {
            console.error('Error checking user status:', err);
            res.status(500).json({ error: 'Internal Server Error' });
        });
});



module.exports = {
    generateRandomPostId,
    router // Export the router
};