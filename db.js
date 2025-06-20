// Centralized SQLite3 database setup and export for use in other modules

const sqlite3 = require('sqlite3').verbose();
const { join } = require('path');
const { existsSync, mkdirSync } = require('fs');

const DB_PATH = join(__dirname, 'wildlifedata.db');
const IMAGES_DIR = join(__dirname, 'report-images');

// Ensure the images directory exists
if (!existsSync(IMAGES_DIR)) {
    mkdirSync(IMAGES_DIR, { recursive: true });
}

// Initialize SQLite database
const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
        console.error('Could not connect to database', err);
    } else {
        // Create users table
        db.run(`
            CREATE TABLE IF NOT EXISTS users (
                user_id TEXT PRIMARY KEY UNIQUE NOT NULL,
                username TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                auth_token TEXT,
                token_expiry INTEGER,
                salt TEXT NOT NULL,
                admin INTEGER DEFAULT 0
            )
        `);
        // Create reports table
        db.run(`
            CREATE TABLE IF NOT EXISTS reports (
                user_id TEXT,
                report_id INTEGER PRIMARY KEY AUTOINCREMENT,
                location_lat REAL,
                location_lon REAL,
                location_name TEXT,
                severity INTEGER NOT NULL,
                animal_type TEXT NOT NULL,
                description TEXT NOT NULL,
                date_reported TEXT NOT NULL,
                date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                imageExists INTEGER DEFAULT 0
            )
        `);
        // Create discussion table
        db.run(`
            CREATE TABLE IF NOT EXISTS discussion (
                post_id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                title TEXT NOT NULL,  
                message TEXT NOT NULL,
                date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                
            )
        `); //FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
            // Add that back once in production ^^
            // Deletes the discussion posts if the user is deleted
        console.log('Database initialized successfully');
    }
});



module.exports = {
    db,
    IMAGES_DIR
};
