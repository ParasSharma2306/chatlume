require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cookieParser = require('cookie-parser');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Capture raw body for webhook signature verification (must come before express.json)
app.use('/api/payments/webhook', express.raw({ type: '*/*' }));

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Serve static frontend files from project root
// Serves index.html, css/, js/, assets/, sw.js, manifest.json, etc.
app.use(express.static(path.join(__dirname), {
  index: 'index.html',
  dotfiles: 'deny',
}));

// MongoDB connection
mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch((err) => console.error('MongoDB connection error:', err));

// API routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/payments', require('./routes/payments'));

// SEO files
app.get('/sitemap.xml', (req, res) => res.sendFile(path.join(__dirname, 'public/sitemap.xml')));
app.get('/robots.txt',  (req, res) => res.sendFile(path.join(__dirname, 'public/robots.txt')));

// Auth & account pages
app.get('/login',   (req, res) => res.sendFile(path.join(__dirname, 'public/login.html')));
app.get('/signup',  (req, res) => res.sendFile(path.join(__dirname, 'public/signup.html')));
app.get('/account', (req, res) => res.sendFile(path.join(__dirname, 'public/account.html')));
app.get('/pricing', (req, res) => res.sendFile(path.join(__dirname, 'public/pricing.html')));

// Clean URLs for public pages
app.get('/viewer',                  (req, res) => res.sendFile(path.join(__dirname, 'public/viewer.html')));
app.get('/instagram-viewer',        (req, res) => res.sendFile(path.join(__dirname, 'public/instagram-viewer.html')));
app.get('/instagram-analyzer',     (req, res) => res.sendFile(path.join(__dirname, 'public/instagram-analyzer.html')));
app.get('/analyzer',                (req, res) => res.sendFile(path.join(__dirname, 'public/analyzer.html')));
app.get('/wrapped',                 (req, res) => res.sendFile(path.join(__dirname, 'public/wrapped.html')));
app.get('/how-to-export',           (req, res) => res.sendFile(path.join(__dirname, 'public/how-to-export.html')));
app.get('/how-to-export-instagram', (req, res) => res.sendFile(path.join(__dirname, 'public/how-to-export-instagram.html')));
app.get('/how-to-use',              (req, res) => res.sendFile(path.join(__dirname, 'public/how-to-use.html')));
app.get('/how-it-works',            (req, res) => res.sendFile(path.join(__dirname, 'public/how-it-works.html')));
app.get('/privacy',                 (req, res) => res.sendFile(path.join(__dirname, 'public/privacy.html')));

// Fallback: serve index.html for any unmatched route (Express 5 named wildcard)
app.get('/{*splat}', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`ChatLume server running at http://localhost:${PORT}`);
});
