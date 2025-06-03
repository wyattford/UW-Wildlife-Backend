const express = require('express');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const cors = require('cors');

const { router: accountRouter } = require('./account');
const { router: reportsRouter } = require('./reports');
const { router: discussionRouter } = require('./discussion');
const path = require('path');
const fs = require('fs');
const marked = require('marked');

const app = express();

app.use(bodyParser.json());
app.use(cookieParser());
app.use(cors({
    origin: ['https://uwwildlife.com', 'https://auth.uwwildlife.com', 'https://www.uwwildlife.com', 'https://api.uwwildlife.com'],
    credentials: true
}));
app.use('/auth', accountRouter);
app.use('/reports', reportsRouter);
app.use('/discussion', discussionRouter);

// Default endpoint
app.get('/', (req, res) => {
    res.send('This is the backend service for UW Wildlife. Visit the documentation at <a href="/docs">/docs</a> for more information.');
});

app.get('/health', (req, res) => {
    res.status(200).json({ status: 'OK' });
});

app.get('/docs', (req, res) => {
    const docPath = path.join(__dirname, 'Documentation.md');
    fs.readFile(docPath, 'utf8', (err, data) => {
        if (err) {
            return res.status(404).send('Documentation not found.');
        }
        const html = marked.parse(data);
        res.type('text/html').send(html);
    });
});


const PORT = 19005;

app.listen(PORT, () => {
    console.log(`UW Wildlife backend running on port ${PORT}`);
});
