'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { promisify } = require('node:util');

const scrypt = promisify(crypto.scrypt);
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const INQUIRIES_FILE = path.join(DATA_DIR, 'inquiries.json');
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const sessions = new Map();

const cars = [
  { id: 'e-class-2024', name: 'E-Class Sedan', type: 'Sedan', year: 2024, price: 68900, mileage: 4200, fuel: 'Hybrid', location: 'Beverly Hills, CA', image: 'https://images.unsplash.com/photo-1618843479313-40f8afb4b4d8?auto=format&fit=crop&w=1200&q=85', label: 'Mercedes-Benz Certified' },
  { id: 'gle-450-2023', name: 'GLE 450 SUV', type: 'SUV', year: 2023, price: 72900, mileage: 8650, fuel: 'Mild hybrid', location: 'New York, NY', image: 'https://images.unsplash.com/photo-1617469767053-d3b523a0b982?auto=format&fit=crop&w=1200&q=85', label: 'One owner' },
  { id: 'eqe-350-2024', name: 'EQE 350+', type: 'Electric', year: 2024, price: 81400, mileage: 1180, fuel: 'Electric', location: 'Miami, FL', image: 'https://images.unsplash.com/photo-1618843479618-39b7d7a9beab?auto=format&fit=crop&w=1200&q=85', label: 'All-electric' },
  { id: 'c-class-2022', name: 'C-Class Coupe', type: 'Coupe', year: 2022, price: 53900, mileage: 12400, fuel: 'Petrol', location: 'Austin, TX', image: 'https://images.unsplash.com/photo-1617531653332-bd46c24f2068?auto=format&fit=crop&w=1200&q=85', label: 'Rare find' },
  { id: 'glc-300-2024', name: 'GLC 300 SUV', type: 'SUV', year: 2024, price: 58900, mileage: 2950, fuel: 'Mild hybrid', location: 'Chicago, IL', image: 'https://images.unsplash.com/photo-1606664515524-ed2f786a0bd6?auto=format&fit=crop&w=1200&q=85', label: 'Mercedes-Benz Certified' },
  { id: 'amg-gt-2023', name: 'AMG GT Coupe', type: 'Coupe', year: 2023, price: 119900, mileage: 3600, fuel: 'Petrol', location: 'Los Angeles, CA', image: 'https://images.unsplash.com/photo-1614200187524-dc4b892acf16?auto=format&fit=crop&w=1200&q=85', label: 'AMG Performance' }
];

function ensureDataFiles() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  for (const file of [USERS_FILE, INQUIRIES_FILE]) {
    if (!fs.existsSync(file)) fs.writeFileSync(file, '[]\n', { mode: 0o600 });
  }
}
function readData(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return []; }
}
function writeData(file, value) {
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
}
function send(res, status, payload, extraHeaders = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extraHeaders });
  res.end(JSON.stringify(payload));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 16_384) {
        reject(Object.assign(new Error('Request body is too large.'), { status: 413 }));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try { resolve(JSON.parse(body)); }
      catch { reject(Object.assign(new Error('Please send valid JSON.'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}
function cleanString(value, max = 180) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}
function validEmail(value) {
  return typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
function getUser(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const session = sessions.get(token);
  if (!session || session.expiresAt < Date.now()) {
    if (token) sessions.delete(token);
    return null;
  }
  return readData(USERS_FILE).find(user => user.id === session.userId) || null;
}
async function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const derived = await scrypt(password, salt, 64);
  return { salt, hash: derived.toString('hex') };
}
async function handleApi(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/health') {
    return send(res, 200, { status: 'ok', service: 'Mercedes marketplace API' });
  }
  if (req.method === 'GET' && url.pathname === '/api/cars') {
    const type = url.searchParams.get('type');
    const query = (url.searchParams.get('q') || '').trim().toLowerCase();
    const filtered = cars.filter(car => (!type || type === 'All vehicles' || car.type === type) && (!query || `${car.name} ${car.type} ${car.year} ${car.location}`.toLowerCase().includes(query)));
    return send(res, 200, { cars: filtered });
  }
  if (req.method === 'POST' && (url.pathname === '/api/auth/register' || url.pathname === '/api/auth/login')) {
    const body = await readBody(req);
    const email = cleanString(body.email, 254).toLowerCase();
    const password = typeof body.password === 'string' ? body.password : '';
    if (!validEmail(email)) return send(res, 400, { error: 'Enter a valid email address.' });
    if (password.length < 8 || password.length > 200) return send(res, 400, { error: 'Password must be between 8 and 200 characters.' });
    const users = readData(USERS_FILE);
    let user;
    if (url.pathname.endsWith('/register')) {
      if (users.some(item => item.email === email)) return send(res, 409, { error: 'An account with that email already exists. Please log in.' });
      const credentials = await hashPassword(password);
      user = { id: crypto.randomUUID(), name: cleanString(body.name, 80) || email.split('@')[0], email, ...credentials, createdAt: new Date().toISOString() };
      users.push(user);
      writeData(USERS_FILE, users);
    } else {
      user = users.find(item => item.email === email);
      if (!user) return send(res, 401, { error: 'Email or password is incorrect.' });
      const credentials = await hashPassword(password, user.salt);
      const expected = Buffer.from(user.hash, 'hex');
      const actual = Buffer.from(credentials.hash, 'hex');
      if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return send(res, 401, { error: 'Email or password is incorrect.' });
    }
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, { userId: user.id, expiresAt: Date.now() + SESSION_TTL_MS });
    return send(res, url.pathname.endsWith('/register') ? 201 : 200, { token, user: { id: user.id, name: user.name, email: user.email } });
  }
  if (req.method === 'GET' && url.pathname === '/api/auth/me') {
    const user = getUser(req);
    if (!user) return send(res, 401, { error: 'Please log in to continue.' });
    return send(res, 200, { user: { id: user.id, name: user.name, email: user.email } });
  }
  if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/, '');
    sessions.delete(token);
    return send(res, 200, { message: 'You have been logged out.' });
  }
  if (req.method === 'POST' && (url.pathname === '/api/inquiries' || url.pathname === '/api/sell')) {
    const body = await readBody(req);
    const name = cleanString(body.name, 100);
    const email = cleanString(body.email, 254).toLowerCase();
    const phone = cleanString(body.phone, 30);
    if (!name || !validEmail(email)) return send(res, 400, { error: 'Please provide your name and a valid email address.' });
    const isSell = url.pathname === '/api/sell';
    const car = isSell ? null : cars.find(item => item.id === cleanString(body.carId, 80));
    if (!isSell && !car) return send(res, 404, { error: 'That vehicle is no longer available.' });
    const inquiry = {
      id: crypto.randomUUID(), type: isSell ? 'sell' : 'purchase', name, email, phone,
      ...(isSell ? { vehicle: cleanString(body.vehicle, 140), year: cleanString(body.year, 4), mileage: cleanString(body.mileage, 30), notes: cleanString(body.notes, 1000) } : { carId: car.id, carName: car.name }),
      createdAt: new Date().toISOString()
    };
    const inquiries = readData(INQUIRIES_FILE);
    inquiries.push(inquiry);
    writeData(INQUIRIES_FILE, inquiries);
    return send(res, 201, { message: isSell ? 'Your valuation request has been received.' : 'Your enquiry has been received.', inquiryId: inquiry.id });
  }
  return send(res, 404, { error: 'API endpoint not found.' });
}

const mimeTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
function serveStatic(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Method not allowed.' }, { Allow: 'GET, HEAD' });
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch { return send(res, 400, { error: 'Invalid path.' }); }
  if (pathname === '/') pathname = '/index.html';
  const filePath = path.resolve(ROOT, `.${pathname}`);
  if (!filePath.startsWith(`${ROOT}${path.sep}`)) return send(res, 403, { error: 'Forbidden.' });
  fs.readFile(filePath, (error, content) => {
    if (error) return send(res, 404, { error: 'Not found.' });
    res.writeHead(200, { 'Content-Type': mimeTypes[path.extname(filePath)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com https://images.unsplash.com; img-src 'self' https://images.unsplash.com data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; script-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'" });
    res.end(req.method === 'HEAD' ? undefined : content);
  });
}

ensureDataFiles();
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
    else serveStatic(req, res, url);
  } catch (error) {
    if (!res.headersSent) send(res, error.status || 500, { error: error.status ? error.message : 'Something went wrong. Please try again.' });
    if (!error.status) console.error(error);
  }
});
server.listen(PORT, HOST, () => console.log(`Mercedes marketplace running at http://${HOST}:${PORT}`));
