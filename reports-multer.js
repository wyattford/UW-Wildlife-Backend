// This module handles report creation, retrieval, and pagination for wildlife reports
// Using multer for file uploads instead of base64 in JSON

const express = require('express');
const multer = require('multer');
const { readFileSync } = require('fs');
const cors = require('cors');
const { randomInt } = require('crypto');
const { db, IMAGES_DIR } = require('./db');
const { join } = require('path');
const { promises: fs } = require('fs');

const router = express.Router();

// Remove restrictive CORS - use the app-level CORS from index.js instead

const imagesDir = IMAGES_DIR;

// Configure multer for handling file uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, imagesDir); // Save to your images directory
    },
    filename: function (req, file, cb) {
        // We'll set the filename after generating the report ID
        // For now, use a temporary name
        cb(null, `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.jpg`);
    }
});

// File filter to only allow images
const fileFilter = (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
        cb(null, true);
    } else {
        cb(new Error('Only image files are allowed!'), false);
    }
};

// Configure multer with size limits
const upload = multer({
    storage: storage,
    limits: {
        fileSize: 50 * 1024 * 1024, // 50MB limit
    },
    fileFilter: fileFilter
});

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

// Convert any image to JPG and save it with the correct filename
async function processAndSaveImage(tempFilePath, reportId, quality = 0.9) {
    try {
        const sharp = await import('sharp');
        const finalPath = join(imagesDir, `${reportId}.jpg`);
        
        await sharp.default(tempFilePath)
            .jpeg({ quality: quality * 100 })
            .toFile(finalPath);
            
        // Delete the temporary file
        await fs.unlink(tempFilePath);
        
        return finalPath;
    } catch (error) {
        console.error('Sharp processing failed:', error);
        // If sharp fails, try to at least move/rename the file
        try {
            const finalPath = join(imagesDir, `${reportId}.jpg`);
            await fs.rename(tempFilePath, finalPath);
            return finalPath;
        } catch (renameError) {
            console.error('Rename also failed:', renameError);
            // Clean up temp file
            try {
                await fs.unlink(tempFilePath);
            } catch (unlinkError) {
                console.error('Failed to clean up temp file:', unlinkError);
            }
            throw error;
        }
    }
}

// Create report endpoint using multer
router.post('/create', upload.single('image'), async (req, res) => {
    try {
        // Accept userId from cookies if present, otherwise set to null
        const { userId } = req.cookies || {};
        const user_id = userId || null;

        const { location_lat, location_lon, location_name, severity, animal_type, description, date_reported } = req.body;

        // Validate required fields
        if (!severity || !animal_type || !description || !date_reported) {
            // Clean up uploaded file if validation fails
            if (req.file) {
                try {
                    await fs.unlink(req.file.path);
                } catch (error) {
                    console.error('Failed to clean up file after validation error:', error);
                }
            }
            return res.status(400).json({ error: 'Missing required report data' });
        }

        // Generate report ID
        const reportId = await generateRandomReportId();
        
        // Handle image if present
        let hasImage = false;
        if (req.file) {
            try {
                await processAndSaveImage(req.file.path, reportId);
                hasImage = true;
            } catch (err) {
                console.error('Error processing image:', err);
                return res.status(500).json({ error: 'Error processing image', details: err.message });
            }
        }

        // Save report to database
        db.run(`
            INSERT INTO reports (user_id, report_id, location_lat, location_lon, location_name, severity, animal_type, description, date_reported, imageExists)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            user_id,
            reportId,
            location_lat,
            location_lon,
            location_name,
            severity,
            animal_type,
            description,
            date_reported,
            hasImage ? 1 : 0
        ], (err) => {
            if (err) {
                console.error('Error creating report:', err);
                return res.status(500).json({ error: 'Internal Server Error', details: err.message });
            }
            res.status(201).json({ message: 'Report created successfully', report_id: reportId });
        });

    } catch (error) {
        console.error('Error in create endpoint:', error);
        
        // Clean up uploaded file if there was an error
        if (req.file) {
            try {
                await fs.unlink(req.file.path);
            } catch (cleanupError) {
                console.error('Failed to clean up file after error:', cleanupError);
            }
        }
        
        res.status(500).json({ error: 'Internal Server Error', details: error.message });
    }
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
    }    // Build dynamic WHERE clause and params
    let whereClauses = [];
    let params = [];
    if (animal_type) {
        whereClauses.push('LOWER(animal_type) = ?');
        params.push(animal_type.toLowerCase()); // Convert to lowercase for comparison
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
                hasMore,
                page: page,
                totalPages: totalPages,
            });
        });
    });
});

// /latest?report_count=5&animal_type=deer&severity=2
router.get('/latest', (req, res) => {
    let { report_count, animal_type, severity } = req.query;
    animal_type = animal_type ? animal_type.toLowerCase() : null;
    severity = severity ? severity : null; // Keep severity as-is (numeric)
    report_count = parseInt(report_count, 10) || 10; // Default to 10 if not specified or invalid
    if (isNaN(report_count) || report_count < 1 || report_count > 100) {
        // Limit to 1-100 reports for safety
        return res.status(400).json({ error: 'Invalid report_count (must be 1-100)' });
    }
    // Build dynamic WHERE clause and params
    let whereClauses = [];
    let params = [];
    if (animal_type) {
        whereClauses.push('LOWER(animal_type) = ?');
        params.push(animal_type); // animal_type is already lowercase
    }
    if (severity) {
        whereClauses.push('severity = ?');
        params.push(severity);
    }    const whereSQL = whereClauses.length > 0 ? 'WHERE ' + whereClauses.join(' AND ') : '';

    db.all(`SELECT * FROM reports ${whereSQL} ORDER BY report_id DESC LIMIT ?`, [...params, report_count], (err, rows) => {
        if (err) {
            console.error('Error fetching latest reports:', err);
            return res.status(500).json({ error: 'Internal Server Error' });
        }
        res.json({ reports: rows });
    });
});

router.get('/personal', (req, res) => {
    const { authToken, userId } = req.cookies || {};
    if (!authToken || !userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const { checkUserStatus } = require('./account');
    checkUserStatus(userId, authToken).
        then((result) => {
            if (!result) {
                return res.status(401).json({ error: 'Unauthorized' });
            }
            db.all('SELECT * FROM reports WHERE user_id = ? ORDER BY report_id DESC', [userId], (err, rows) => {
                if (err) {
                    console.error('Error fetching personal reports:', err);
                    return res.status(500).json({ error: 'Internal Server Error' });
                }

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

                res.json({ reports });
            });
        })
        .catch((err) => {
            console.error('Error checking user status:', err);
            res.status(500).json({ error: 'Internal Server Error' });
        });
});



router.get('/download', (req, res) => {
    const zlib = require('zlib');
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

// Get image by report ID - serves the actual image file
router.get('/image/:report_id', (req, res) => {
    const { report_id } = req.params;
    
    // Validate report_id is a number
    if (!/^\d+$/.test(report_id)) {
        return res.status(400).json({ error: 'Invalid report ID' });
    }
    
    const imagePath = join(imagesDir, `${report_id}.jpg`);
    
    // Check if file exists and serve it
    res.sendFile(imagePath, (err) => {
        if (err) {
            if (err.code === 'ENOENT') {
                return res.status(404).json({ error: 'Image not found' });
            }
            console.error('Error serving image:', err);
            return res.status(500).json({ error: 'Internal Server Error' });
        }
    });
});

// /nearby?lat=47.6062&lon=-122.3321&report_count=10&animal_type=deer&severity=high
router.get('/nearby', (req, res) => {
    let { lat, lon, report_count, animal_type, severity } = req.query;
    
    // Validate required coordinates
    const latitude = parseFloat(lat);
    const longitude = parseFloat(lon);
    if (isNaN(latitude) || isNaN(longitude)) {
        return res.status(400).json({ error: 'Invalid or missing lat/lon coordinates' });
    }
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
        return res.status(400).json({ error: 'Coordinates out of valid range' });
    }    // Handle optional parameters
    animal_type = animal_type ? animal_type.toLowerCase() : null;
    severity = severity ? severity : null; // Keep severity as-is (numeric)
    report_count = parseInt(report_count, 10);
    if (isNaN(report_count) || report_count < 1 || report_count > 100) {
        report_count = 50; // Default to 50 if not specified or invalid
    }    // Calculate distance using Haversine formula in SQLite
    // Distance calculation: 3959 * acos(cos(radians(?)) * cos(radians(location_lat)) * cos(radians(location_lon) - radians(?)) + sin(radians(?)) * sin(radians(location_lat)))
    // 3959 is Earth's radius in miles
    const distanceFormula = `
        3959 * acos(
            cos(radians(?)) * cos(radians(location_lat)) * 
            cos(radians(location_lon) - radians(?)) + 
            sin(radians(?)) * sin(radians(location_lat))
        )`;

    // Build dynamic WHERE clause and filter params
    let whereClauses = ['location_lat IS NOT NULL', 'location_lon IS NOT NULL'];
    let filterParams = [];
    
    if (animal_type) {
        whereClauses.push('LOWER(animal_type) = ?');
        filterParams.push(animal_type); // animal_type is already lowercase
    }
    if (severity) {
        whereClauses.push('severity = ?');
        filterParams.push(severity);
    }
    
    // Add distance constraint (0.5 mile radius)
    whereClauses.push(`${distanceFormula} <= 0.5`);

    const whereSQL = 'WHERE ' + whereClauses.join(' AND ');

    // Add distance to SELECT to sort by closest first
    const query = `
        SELECT *, 
               ${distanceFormula} as distance_miles
        FROM reports 
        ${whereSQL} 
        ORDER BY distance_miles ASC, report_id DESC 
        LIMIT ?`;
    
    // Parameters must match the order they appear in the SQL:
    // 1. SELECT distance formula: lat, lon, lat
    // 2. WHERE filter params: animal_type?, severity?
    // 3. WHERE distance formula: lat, lon, lat  
    // 4. LIMIT: report_count
    const allParams = [
        latitude, longitude, latitude,  // SELECT distance formula
        ...filterParams,                // WHERE filter params
        latitude, longitude, latitude,  // WHERE distance formula
        report_count                    // LIMIT
    ];

    db.all(query, allParams, (err, rows) => {
        if (err) {
            console.error('Error fetching nearby reports:', err);
            return res.status(500).json({ error: 'Internal Server Error' });
        }
        
        // Round distance to 3 decimal places for cleaner output
        const reports = rows.map(report => ({
            ...report,
            distance_miles: Math.round(report.distance_miles * 1000) / 1000
        }));
        
        res.json({ 
            reports,
            search_center: { lat: latitude, lon: longitude },
            search_radius_miles: 0.25,
            total_found: reports.length
        });
    });
});

module.exports = {
    generateRandomReportId,
    router
};
