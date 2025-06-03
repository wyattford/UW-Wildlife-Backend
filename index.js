const express = require('express');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const cors = require('cors');

const { router: accountRouter } = require('./account');
const { router: reportsRouter } = require('./reports');
const { router: discussionRouter } = require('./discussion');

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
    res.send('This is the backend service for UW Wildlife.');
});

app.get('/health', (req, res) => {
    res.status(200).json({ status: 'OK' });
});


const PORT = 19005;

app.listen(PORT, () => {
    console.log(`UW Wildlife backend running on port ${PORT}`);
});
