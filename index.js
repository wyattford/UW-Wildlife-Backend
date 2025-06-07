// General imports
const express = require('express');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const app = express();

// Load exported routes with Express router
const { router: accountRouter } = require('./account');
const { router: reportsRouter } = require('./reports-multer');
const { router: discussionRouter } = require('./discussion');

// Prepare the Express app
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
app.use(cookieParser());
app.use(cors({
    origin: true,
    // origin: ['https://uwwildlife.com', 'https://auth.uwwildlife.com', 'https://www.uwwildlife.com', 'https://api.uwwildlife.com', *],
    credentials: true
}));
app.use('/auth', accountRouter);
app.use('/reports', reportsRouter);
app.use('/discussion', discussionRouter);

// Default endpoint
app.get('/', (req, res) => {
    res.send('This is the backend service for UW Wildlife. Visit the documentation at <a href="/docs">/docs</a> for more information.');
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'OK' });
});

// API documentation endpoint
app.get('/docs', (req, res) => {
    res.sendFile('Documentation.html', {root: __dirname })
});

// Default port for server
const PORT = 19005;

// Start the server
app.listen(PORT, () => {
    console.log(`UW Wildlife backend running on port ${PORT}`);
});
