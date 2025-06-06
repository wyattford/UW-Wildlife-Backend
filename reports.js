// This module handles report creation, retrieval, and pagination for wildlife reports

const express = require('express');
const bodyParser = require('body-parser');
const { readFileSync } = require('fs');
const cors = require('cors');
const { randomInt } = require('crypto');
const { checkUserStatus } = require('./account');
const { db, IMAGES_DIR } = require('./db');
const { join } = require('path');
const zlib = require('zlib');

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

// Convert any image to JPG and save it
function saveImage(imageData, reportId, quality = 0.9) {
    const [meta, base64] = imageData.split(',');
    const buffer = Buffer.from(base64, 'base64');
    const mimeMatch = meta.match(/data:(image\/[^;]+);/);
    const mimeType = mimeMatch ? mimeMatch[1] : '';

    let getJpegBuffer;
    if (mimeType === 'image/heic' || mimeType === 'image/heif') {
        // Convert HEIC/HEIF to JPEG buffer
        getJpegBuffer = import('heic-convert').then(heicConvert =>
            heicConvert.default({ buffer, format: 'JPEG', quality })
        );
    } else {
        // Use original buffer for other formats
        getJpegBuffer = Promise.resolve(buffer);
    }

    // Always use sharp to write the JPEG file
    return getJpegBuffer.then(jpegBuffer =>
        import('sharp').then(sharp =>
            sharp.default(jpegBuffer)
                .jpeg({ quality: quality * 100 })
                .toFile(join(imagesDir, `${reportId}.jpg`))
        )
    );
}

router.post('/create', (req, res) => {
    const { authToken, userId } = req.cookies || {};
    if (!authToken || !userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    checkUserStatus(userId, authToken)
        .then((user) => {
            // If the user credentials are invalid, return 401 Unauthorized
            if (!user) {
                return res.status(401).json({ error: 'Unauthorized' });
            }

            const { location_lat, location_lon, location_name, severity, animal_type, description, date_reported } = req.body;

            // Validate required fields
            if (!location_name || !severity || !animal_type || !description || !date_reported) {
                return res.status(400).json({ error: 'Missing required report data' });
            }

            // Validate image if present
            const { image } = req.body;
            const hasImage = image && typeof image === 'string' && image.startsWith('data:image/');
            let reportId;

            generateRandomReportId()
                .then(async (id) => {
                    reportId = id;

                    // Handle image if present
                    if (hasImage) {
                        try {
                            console.log('Saving image for report', reportId, 'type:', typeof image, 'length:', image.length);
                            await saveImage(image, reportId);
                        } catch (err) {
                            console.error('Error saving image:', err);
                            return res.status(500).json({ error: 'Error saving image', details: err.message });
                        }
                    }

                    // Remove image from req.body before saving to DB
                    const reportDataToSave = { ...req.body };
                    delete reportDataToSave.image;

                    db.run(`
                        INSERT INTO reports (user_id, report_id, location_lat, location_lon, location_name, severity, animal_type, description, date_reported, imageExists)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `, [
                        userId,
                        reportId,
                        reportDataToSave.location_lat,
                        reportDataToSave.location_lon,
                        reportDataToSave.location_name,
                        reportDataToSave.severity,
                        reportDataToSave.animal_type,
                        reportDataToSave.description,
                        reportDataToSave.date_reported, // use the correct field for date_reported
                        hasImage ? 1 : 0
                    ], (err) => {
                        if (err) {
                            console.error('Error creating report:', err, req.body);
                            return res.status(500).json({ error: 'Internal Server Error', details: err.message });
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

router.get('/get/:report_id', (req, res) => {
    const { report_id } = req.params;
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

            const reports = rows.map(report => {
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
                delete report.imageExists;
                return report;
            });

            res.json({
                reports,
                hasMore
            });
        });
    });
});

// /latest?report_count=5&animal_type=deer&severity=2
router.get('/latest', (req, res) => {
    let { report_count, animal_type, severity } = req.query;
    report_count = parseInt(report_count, 10);
    if (isNaN(report_count) || report_count < 1 || report_count > 100) {
        // Limit to 1-100 reports for safety
        return res.status(400).json({ error: 'Invalid report_count (must be 1-100)' });
    }

    // Build dynamic WHERE clause and params
    let whereClauses = [];
    let params = [];
    if (animal_type) {
        whereClauses.push('animal_type = ?');
        params.push(animal_type);
    }
    if (severity) {
        whereClauses.push('severity = ?');
        params.push(severity);
    }
    const whereSQL = whereClauses.length > 0 ? 'WHERE ' + whereClauses.join(' AND ') : '';

    // Ensure only reports with non-null latitude and longitude are returned
    const latLonClause = 'location_lat IS NOT NULL AND location_lon IS NOT NULL';
    const finalWhereSQL = whereSQL
        ? `${whereSQL} AND ${latLonClause}`
        : `WHERE ${latLonClause}`;

    db.all(`SELECT * FROM reports ${finalWhereSQL} ORDER BY report_id DESC LIMIT ?`, [...params, report_count], (err, rows) => {
        if (err) {
            console.error('Error fetching latest reports:', err);
            return res.status(500).json({ error: 'Internal Server Error' });
        }
        res.json({ reports: rows });
    });
});

router.get('/download', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Encoding', 'gzip');
    res.setHeader('Content-Disposition', 'attachment; filename="reports.json.gz"');

    const gzip = zlib.createGzip();
    gzip.pipe(res);
    gzip.write('[');
    let first = true;

    db.each('SELECT * FROM reports', (err, row) => {
        if (err) {
            gzip.write(']');
            gzip.end();
            return;
        }
        if (!first) gzip.write(',');
        gzip.write(JSON.stringify(row));
        first = false;
    }, (err, count) => {
        gzip.write(']');
        gzip.end();
    });
});

module.exports = {
    generateRandomReportId,
    router // Export the router
};