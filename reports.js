// This module handles report creation, retrieval, and pagination for wildlife reports

const express = require('express');
const bodyParser = require('body-parser');
const { readFileSync } = require('fs');
const cors = require('cors');
const { randomInt } = require('crypto');
const { checkUserStatus } = require('./account');
const { db, IMAGES_DIR } = require('./db');
const { join } = require('path');

const router = express.Router();
router.use(bodyParser.json());

router.use(cors({
    origin: ['https://uwwildlife.com', 'https://auth.uwwildlife.com', 'https://www.uwwildlife.com', 'https://www.auth.uwwildlife.com'],
    credentials: true
}));

const imagesDir = IMAGES_DIR;

function generateRandomReportId() {
    return new Promise((resolve, reject) => {
        function tryGenerate() {
            const id = parseInt(randomInt(10000000, 100000000).toString(), 10);
            db.get('SELECT report_id FROM reports WHERE report_id = ?', [id], (err, row) => {
                if (err) {
                    return reject(err);
                }
                if (row) {
                    // ID exists, try again
                    tryGenerate();
                } else {
                    resolve(id);
                }
            });
        }
        tryGenerate();
    });
}

router.post('/create', (req, res) => {
    const { auth_token, userId } = req.cookies || {};
    if (!auth_token || !userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    checkUserStatus(auth_token, userId)
        .then((user) => {
            // If the use credentials are invalid, return 401 Unauthorized
            if (!user) {
                return res.status(401).json({ error: 'Unauthorized' });
            }

            const { reportData } = req.body;
            const { location_lat, location_lon, severity, animal_type, description, date } = reportData;

            // Validate required fields
            if (!location_lat || !location_lon || !severity || !animal_type || !description || !date) {
                return res.status(400).json({ error: 'Missing required report data' });
            }

            // Validate image if present
            const hasImage = reportData.image && typeof reportData.image === 'string' && reportData.image.startsWith('data:image/');
            let reportId;

            generateRandomReportId()
                .then((id) => {
                    reportId = id;

                    // Handle image if present
                    if (hasImage) {
                        // Extract base64 data
                        const base64Data = reportData.image.split(',')[1];
                        const buffer = Buffer.from(base64Data, 'base64');

                        // Use sharp to convert to jpg with 90% quality
                        import('sharp').then(sharp => {
                            sharp.default(buffer)
                                .jpeg({ quality: 90 })
                                .toFile(join(imagesDir, `${reportId}.jpg`))
                                .catch(err => {
                                    console.error('Error saving image:', err);
                                });
                        }).catch(err => {
                            console.error('Error importing sharp:', err);
                        });
                    }

                    // Remove image from reportData before saving to DB
                    const reportDataToSave = { ...reportData };
                    delete reportDataToSave.image;

                    db.run(`
                        INSERT INTO reports (user_id, report_id, location_lat, location_lon, severity, animal_type, description, date_created, imageExists)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `, [
                        userId,
                        reportId,
                        reportDataToSave.location_lat,
                        reportDataToSave.location_lon,
                        reportDataToSave.severity,
                        reportDataToSave.animal_type,
                        reportDataToSave.description,
                        reportDataToSave.date,
                        hasImage ? 1 : 0
                    ], (err) => {
                        if (err) {
                            console.error('Error creating report:', err);
                            return res.status(500).json({ error: 'Internal Server Error' });
                        }
                        res.status(201).json({ message: 'Report created successfully', report_id: reportId });
                    });
                })
                .catch((err) => {
                    console.error('Error generating report ID:', err);
                    res.status(500).json({ error: 'Internal Server Error' });
                });
            return;
        })
        .catch((err) => {
            console.error('Error checking user status:', err);
            res.status(500).json({ error: 'Internal Server Error' });
        });
});

router.get('/get', (req, res) => {
    const { report_id } = req.query;
    db.all('SELECT * FROM reports WHERE report_id = ? LIMIT 1', [report_id], (err, rows) => {
        
        // Handle any errors during the query
        if (err) {
            console.error('Error fetching reports:', err);
            return res.status(500).json({ error: 'Internal Server Error' });
        }

        // If no reports found, return 404
        if (rows.length === 0) {
            return res.status(404).json({ error: 'Report not found' });
        }

        // Prepare the report object
        const report = rows[0];

        // Check if an image exists for this report
        // Encode the image in base-64 if it exists
        if (report.imageExists) {
            const imagePath = join(imagesDir, `${report.report_id}.jpg`);
            try {
            const imageData = readFileSync(imagePath, { encoding: 'base64' });
            report.image = `data:image/jpeg;base64,${imageData}`;
            } catch (err) {
            console.error('Error reading image file:', err);
            report.image = null;
            }
        } else {
            report.image = null;
        }

        // Send the report as a JSON response
        res.json(report);
    });
});

// /page?page=1&animal_type=deer&severity=high
router.get('/page', (req, res) => {
    const { animal_type, severity } = req.query;
    const page = parseInt(req.query.page, 10);
    if (isNaN(page) || page < 1) {
        return res.status(400).json({ error: 'Invalid page number' });
    }

    // Build dynamic WHERE clause and params
    let whereClauses = [];
    let params = [];
    if (animal_type) {
        whereClauses.push('animal_type = ?');
        params.push(animal_type);
    }
    if (severity) {
        // Accept both string and integer for severity
        whereClauses.push('severity = ?');
        params.push(severity);
    }
    const whereSQL = whereClauses.length > 0 ? 'WHERE ' + whereClauses.join(' AND ') : '';

    // Count total filtered rows
    db.get(`SELECT COUNT(*) as count FROM reports ${whereSQL}`, params, (err, countResult) => {
        if (err) {
            console.error('Error counting reports:', err);
            return res.status(500).json({ error: 'Internal Server Error' });
        }

        const totalRows = countResult.count;
        const totalPages = Math.ceil(totalRows / 10);

        if (page > totalPages && totalPages !== 0) {
            return res.status(400).json({ error: 'Page number exceeds total pages' });
        }

        const offset = (page - 1) * 10;
        db.all(`SELECT * FROM reports ${whereSQL} ORDER BY report_id DESC LIMIT 10 OFFSET ?`, [...params, offset], (err, rows) => {
            if (err) {
                console.error('Error fetching reports:', err);
                return res.status(500).json({ error: 'Internal Server Error' });
            }
            const hasMore = page < totalPages;
            res.json({
                reports: rows,
                hasMore
            });
        });
    });
});

module.exports = {
    router // Export the router
};