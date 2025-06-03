// This module handles user account management including
// registration, login, logout, and status checking.

const crypto = require('crypto');
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { db } = require('./db');
const router = express.Router();
router.use(bodyParser.json());

const TOKEN_EXPIRY_DAYS = 7;

router.use(cors({
    origin: ['https://uwwildlife.com', 'https://auth.uwwildlife.com', 'https://www.uwwildlife.com', 'https://www.auth.uwwildlife.com'],
    credentials: true
}));

// Validates that the username is at least 3 characters long and contains only letters, numbers, and underscores
function validateUsername(username) {
    const regex = /^[a-zA-Z0-9_]{3,}$/;
    if (!regex.test(username)) {
        return false;
    }
    return true;
}

// Validates that the password is at least 10 characters long and contains at least one uppercase letter
function validatePassword(password) {
    const regex = /^(?=.*[A-Z]).{10,}$/;
    if (!regex.test(password)) {
        return false;
    }
    return true;
}

// Generates a random user ID of specified length (default is 12 digits)
function generateRandomId(length = 12) {
    if (!Number.isInteger(length) || length <= 0) {
        throw new Error('Length must be a positive integer');
    }
    return Array.from({ length }, () => Math.floor(Math.random() * 10)).join('');
}

// Generates a random authentication token
function generateAuthToken() {
    return crypto.randomBytes(32).toString('hex');
}

// Hashes the password with salt using SHA-256
function hashPasswordWithSalt(password, salt) {
    return crypto.createHash('sha256')
        .update(password + salt)
        .digest('hex');
}

function getExpiryTimestamp() {
    return Math.floor(Date.now() / 1000) + TOKEN_EXPIRY_DAYS * 24 * 60 * 60;
}

// Register a new user with salted password
function registerUser(username, password) {
    return new Promise((resolve, reject) => {
        if (!username || !password) {
            return reject(new Error('Username and password required.'));
        }
        const user_id = generateRandomId();
        const auth_token = generateAuthToken();
        const token_expiry = getExpiryTimestamp();
        const salt = crypto.randomBytes(16).toString('hex');
        const hashedPassword = hashPasswordWithSalt(password, salt);
        db.run(
            `INSERT INTO users (username, password, user_id, auth_token, token_expiry, salt) VALUES (?, ?, ?, ?, ?, ?)`,
            [username, hashedPassword, user_id, auth_token, token_expiry, salt],
            function (err) {
                if (err) {
                    if (err.code === 'SQLITE_CONSTRAINT') {
                        return reject(new Error('Username already exists.'));
                    }
                    return reject(new Error('Database error.'));
                }
                // Successfully registered and auto-logged in
                resolve({ auth_token, user_id, token_expiry });
            }
        );
    });
}

// Login a user with salted password
function loginUser(username, password) {
    return new Promise((resolve, reject) => {
        if (!username || !password) {
            return reject(new Error('Username and password required.'));
        }
        db.get(
            `SELECT * FROM users WHERE username = ?`,
            [username],
            (err, user) => {
                if (err) return reject(new Error('Database error.'));
                if (!user) return reject(new Error('Invalid credentials.'));
                if (!user.salt) return reject(new Error('User salt missing.'));
                const hashedInput = hashPasswordWithSalt(password, user.salt);
                if (hashedInput !== user.password) return reject(new Error('Invalid credentials.'));

                const auth_token = generateAuthToken();
                const token_expiry = getExpiryTimestamp();
                db.run(
                    `UPDATE users SET auth_token = ?, token_expiry = ? WHERE user_id = ?`,
                    [auth_token, token_expiry, user.user_id],
                    (err) => {
                        if (err) return reject(new Error('Database error.'));
                        resolve({ auth_token, user_id: user.user_id, token_expiry });
                    }
                );
            }
        );
    });
}

// Logout a user
function logoutUser(user_id, auth_token) {
    return new Promise((resolve, reject) => {
        if (!user_id || !auth_token) {
            return reject(new Error('User ID and auth token required.'));
        }
        db.run(
            `UPDATE users SET auth_token = NULL, token_expiry = NULL WHERE user_id = ? AND auth_token = ?`,
            [user_id, auth_token],
            function (err) {
                if (err) return reject(new Error('Database error.'));
                if (this.changes === 0) return reject(new Error('Invalid user or token.'));
                resolve({ message: 'Logged out successfully.' });
            }
        );
    });
}

function checkUserStatus(user_id, auth_token) {
    return new Promise((resolve, reject) => {
        if (!user_id || !auth_token) {
            return reject(new Error('User ID and auth token required.'));
        }
        db.get(
            `SELECT * FROM users WHERE user_id = ? AND auth_token = ?`,
            [user_id, auth_token],
            (err, user) => {
                if (err) return reject(new Error('Database error.'));
                if (!user) return resolve(false);
                const now = Math.floor(Date.now() / 1000);
                if (!user.token_expiry || user.token_expiry < now) {
                    return resolve(false);
                }
                resolve(true);
            }
        );
    });
}

function getUserDetails(user_id, auth_token) {
    return new Promise((resolve, reject) => {
        if (!user_id || !auth_token) {
            return reject(new Error('User ID and auth token required.'));
        }
        db.get(
            `SELECT * FROM users WHERE user_id = ? AND auth_token = ?`,
            [user_id, auth_token],
            (err, user) => {
                if (err) return reject(new Error('Database error.'));
                if (!user) return resolve(null);
                resolve(user);
            }
        );
    });
}



// Register endpoint
router.post('/register', async (req, res) => {
    const { username, password } = req.body;
    if (!validateUsername(username)) {
        return res.status(400).json({ message: 'Invalid username. Must be at least 3 characters and contain only letters, numbers, and underscores.' });
    }
    if (!validatePassword(password)) {
        return res.status(400).json({ message: 'Invalid password. Must be at least 10 characters and contain at least one uppercase letter.' });
    }
    try {
        const user = await registerUser(username, password);
        res.cookie('authToken', user.auth_token, { httpOnly: true, secure: true, sameSite: 'strict', domain: '.uwwildlife.com' });
        res.cookie('userId', user.user_id, { httpOnly: true, secure: true, sameSite: 'strict', domain: '.uwwildlife.com' });
        res.status(200).json({ message: 'Registration successful', userId: user.user_id, token_expiry: user.token_expiry });
    } catch (error) {
        if (error.message === 'Username already exists.') {
            res.status(409).json({ message: error.message });
        } else if (error.message === 'Username and password required.') {
            res.status(400).json({ message: error.message });
        } else {
            res.status(500).json({ message: 'Server error', error: error.message });
        }
    }
});

// Login endpoint
router.post('/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const result = await loginUser(username, password);
        res.cookie('authToken', result.auth_token, { httpOnly: true, secure: true, sameSite: 'strict', domain: '.uwwildlife.com' });
        res.cookie('userId', result.user_id, { httpOnly: true, secure: true, sameSite: 'strict', domain: '.uwwildlife.com' });
        res.status(200).json({ message: 'Login successful', userId: result.user_id, token_expiry: result.token_expiry });
    } catch (error) {
        if (error.message === 'Invalid credentials.' || error.message === 'Username and password required.') {
            res.status(401).json({ message: error.message });
        } else {
            res.status(500).json({ message: 'Server error', error: error.message });
        }
    }
});

// Logout endpoint
router.post('/logout', async (req, res) => {
    const user_id = req.cookies.userId;
    const auth_token = req.cookies.authToken;
    try {
        const result = await logoutUser(user_id, auth_token);
        res.clearCookie('authToken', { domain: '.uwwildlife.com' });
        res.clearCookie('userId', { domain: '.uwwildlife.com' });
        res.status(200).json(result);
    } catch (error) {
        if (error.message === 'User ID and auth token required.' || error.message === 'Invalid user or token.') {
            res.status(401).json({ message: error.message });
        } else {
            res.status(500).json({ message: 'Server error', error: error.message });
        }
    }
});

// Status endpoint
router.post('/status', (req, res) => {
    const user_id = req.cookies.userId;
    const auth_token = req.cookies.authToken;
    if (!user_id || !auth_token) {
        return res.status(200).json({ loggedIn: false });
    }
    checkUserStatus(user_id, auth_token)
        .then(result => {
            res.status(200).json({ loggedIn: !!result });
        })
        .catch(error => {
            res.status(200).json({ loggedIn: false });
        });
});


router.get('/details', async (req, res) => {
    const user_id = req.cookies.userId;
    const auth_token = req.cookies.authToken;

    if (!user_id || !auth_token) {
        return res.status(200).json({ loggedIn: false });
    }

    try {
        const userDetails = await getUserDetails(user_id, auth_token);
        res.status(200).json({ loggedIn: true, userDetails });
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

module.exports = {
    registerUser,
    loginUser,
    logoutUser,
    checkUserStatus,
    generateRandomId,
    router // Export the router
};