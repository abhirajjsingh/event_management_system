const express = require('express');
const cors = require('cors');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';

app.use(cors());
app.use(express.json());
// Serve static frontend (index.html, app.js, style.css) from project root
app.use(express.static(path.join(__dirname)));

// API root helper endpoints
app.get('/api', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Event Management API',
    endpoints: [
      'POST /api/auth/register',
      'POST /api/auth/login',
      'GET  /api/events',
      'POST /api/events',
      'GET  /api/events/:id',
      'PUT  /api/events/:id',
      'DELETE /api/events/:id',
      'POST /api/events/:id/register',
      'DELETE /api/events/:id/register',
      'GET  /api/users/:id/registrations',
      'GET  /api/users/:id/events'
    ]
  });
});

app.post('/api', (req, res) => {
  res.status(405).json({ message: 'Method Not Allowed. Try GET /api or a specific endpoint.' });
});

// DB setup
const db = new sqlite3.Database('events.sqlite');

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    name TEXT,
    password_hash TEXT,
    created_at TEXT NOT NULL
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    date_time TEXT NOT NULL,
    location TEXT NOT NULL,
    max_capacity INTEGER NOT NULL,
    created_by INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (created_by) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS registrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    event_id INTEGER NOT NULL,
    registration_date TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('registered','cancelled')),
    UNIQUE(user_id, event_id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (event_id) REFERENCES events(id)
  )`);
  // Lightweight migration: ensure password_hash column exists (for older DBs)
  db.all("PRAGMA table_info(users)", [], (err, cols) => {
    if (!err && Array.isArray(cols)) {
      const hasPwd = cols.some(c => c.name === 'password_hash');
      if (!hasPwd) {
        db.run('ALTER TABLE users ADD COLUMN password_hash TEXT', (e) => {
          if (e) console.error('Migration failed adding password_hash:', e);
          else console.log('Migration: added users.password_hash');
        });
      }
    }
  });

  // Ensure unique index on users.email (older DBs may lack enforced index)
  db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email)', (e) => {
    if (e) console.warn('Could not ensure unique index on users.email:', e.message);
  });
});

// Helpers
function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err); else resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err); else resolve(row);
    });
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err); else resolve(rows);
    });
  });
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function isValidISODateTime(dt) {
  const d = new Date(dt);
  return !isNaN(d.getTime());
}

function authRequired(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ message: 'Missing token' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = { id: payload.userId };
    next();
  } catch (e) {
    return res.status(401).json({ message: 'Invalid token' });
  }
}

// Auth
app.post('/api/auth/register', async (req, res) => {
  try {
    let { email, name = '', password } = req.body;
    email = normalizeEmail(email);
    if (!email || !password) return res.status(400).json({ message: 'Email and password required' });
    // basic email shape check
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ message: 'Invalid email format' });
    if (String(password).length < 6) return res.status(400).json({ message: 'Password must be at least 6 characters' });
    const existing = await get(db, 'SELECT id FROM users WHERE email = ?', [email]);
    if (existing) return res.status(409).json({ message: 'Email already registered' });
    const password_hash = await bcrypt.hash(password, 10);
    const created_at = new Date().toISOString();
    try {
      const result = await run(db, 'INSERT INTO users (email, name, password_hash, created_at) VALUES (?,?,?,?)', [email, name, password_hash, created_at]);
      return res.status(201).json({ id: result.id, email, name, created_at });
    } catch (e) {
      if (String(e.message || '').includes('UNIQUE') && String(e.message).includes('users.email')) {
        return res.status(409).json({ message: 'Email already registered' });
      }
      throw e;
    }
  } catch (e) {
    return res.status(500).json({ message: 'Registration failed', error: String(e) });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    let { email, password } = req.body;
    email = normalizeEmail(email);
    if (!email || !password) return res.status(400).json({ message: 'Email and password required' });
    const user = await get(db, 'SELECT * FROM users WHERE email = ?', [email]);
    if (!user) return res.status(401).json({ message: 'Invalid credentials' });
    const ok = await bcrypt.compare(password, user.password_hash || '');
    if (!ok) return res.status(401).json({ message: 'Invalid credentials' });
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '2h' });
    return res.json({ token, userId: user.id, name: user.name, email: user.email });
  } catch (e) {
    return res.status(500).json({ message: 'Login failed', error: String(e) });
  }
});

// Events
app.post('/api/events', authRequired, async (req, res) => {
  try {
    const { title, description = '', date_time, location, max_capacity } = req.body;
    if (!title || !date_time || !location || max_capacity === undefined) {
      return res.status(400).json({ message: 'Missing required fields' });
    }
    if (!isValidISODateTime(date_time)) return res.status(400).json({ message: 'Invalid date_time format' });
    const cap = parseInt(max_capacity, 10);
    if (!Number.isInteger(cap) || cap < 0) return res.status(400).json({ message: 'max_capacity must be a non-negative integer' });
    const created_at = new Date().toISOString();
    const created_by = req.user.id;
    const result = await run(
      db,
      'INSERT INTO events (title, description, date_time, location, max_capacity, created_by, created_at) VALUES (?,?,?,?,?,?,?)',
      [title, description, date_time, location, cap, created_by, created_at]
    );
    const event = await get(db, 'SELECT * FROM events WHERE id = ?', [result.id]);
    return res.status(201).json(event);
  } catch (e) {
    return res.status(500).json({ message: 'Create event failed', error: String(e) });
  }
});

app.get('/api/events', async (req, res) => {
  try {
    const now = new Date().toISOString();
    const events = await all(db, 'SELECT * FROM events WHERE date_time >= ? ORDER BY date_time ASC', [now]);
    // augment with registration counts
    const withCounts = await Promise.all(events.map(async (ev) => {
      const row = await get(db, 'SELECT COUNT(*) as count FROM registrations WHERE event_id = ? AND status = "registered"', [ev.id]);
      return { ...ev, registrations: row?.count || 0, available_spots: Math.max(0, ev.max_capacity - (row?.count || 0)) };
    }));
    return res.json(withCounts);
  } catch (e) {
    return res.status(500).json({ message: 'List events failed', error: String(e) });
  }
});

app.get('/api/events/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const ev = await get(db, 'SELECT * FROM events WHERE id = ?', [id]);
    if (!ev) return res.status(404).json({ message: 'Event not found' });
    const row = await get(db, 'SELECT COUNT(*) as count FROM registrations WHERE event_id = ? AND status = "registered"', [id]);
    return res.json({ ...ev, registrations: row?.count || 0, available_spots: Math.max(0, ev.max_capacity - (row?.count || 0)) });
  } catch (e) {
    return res.status(500).json({ message: 'Get event failed', error: String(e) });
  }
});

app.put('/api/events/:id', authRequired, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const ev = await get(db, 'SELECT * FROM events WHERE id = ?', [id]);
    if (!ev) return res.status(404).json({ message: 'Event not found' });
    if (ev.created_by !== req.user.id) return res.status(403).json({ message: 'Forbidden: not creator' });
    const { title, description, date_time, location, max_capacity } = req.body;
    const newTitle = title ?? ev.title;
    const newDesc = description ?? ev.description;
    const newDT = date_time ?? ev.date_time;
    const newLoc = location ?? ev.location;
    let newCap = max_capacity ?? ev.max_capacity;
    if (max_capacity !== undefined) {
      const cap = parseInt(max_capacity, 10);
      if (!Number.isInteger(cap) || cap < 0) return res.status(400).json({ message: 'max_capacity must be a non-negative integer' });
      newCap = cap;
    }
    if (date_time !== undefined && !isValidISODateTime(newDT)) return res.status(400).json({ message: 'Invalid date_time format' });
    await run(db, 'UPDATE events SET title=?, description=?, date_time=?, location=?, max_capacity=? WHERE id=?', [newTitle, newDesc, newDT, newLoc, Number(newCap), id]);
    const updated = await get(db, 'SELECT * FROM events WHERE id = ?', [id]);
    return res.json(updated);
  } catch (e) {
    return res.status(500).json({ message: 'Update event failed', error: String(e) });
  }
});

app.delete('/api/events/:id', authRequired, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const ev = await get(db, 'SELECT * FROM events WHERE id = ?', [id]);
    if (!ev) return res.status(404).json({ message: 'Event not found' });
    if (ev.created_by !== req.user.id) return res.status(403).json({ message: 'Forbidden: not creator' });
    await run(db, 'DELETE FROM registrations WHERE event_id = ?', [id]);
    await run(db, 'DELETE FROM events WHERE id = ?', [id]);
    return res.json({ message: 'Event deleted' });
  } catch (e) {
    return res.status(500).json({ message: 'Delete event failed', error: String(e) });
  }
});

// Registrations
app.post('/api/events/:id/register', authRequired, async (req, res) => {
  const eventId = Number(req.params.id);
  let inTxn = false;
  try {
    await run(db, 'BEGIN IMMEDIATE');
    inTxn = true;
    const ev = await get(db, 'SELECT * FROM events WHERE id = ?', [eventId]);
    if (!ev) {
      await run(db, 'ROLLBACK');
      return res.status(404).json({ message: 'Event not found' });
    }
    const regCount = await get(db, 'SELECT COUNT(*) as count FROM registrations WHERE event_id = ? AND status = "registered"', [eventId]);
    const current = regCount?.count || 0;
    if (current >= ev.max_capacity) {
      await run(db, 'ROLLBACK');
      return res.status(400).json({ message: 'Event is at full capacity' });
    }
    const existing = await get(db, 'SELECT * FROM registrations WHERE user_id = ? AND event_id = ?', [req.user.id, eventId]);
    const now = new Date().toISOString();
    if (existing) {
      if (existing.status === 'registered') {
        await run(db, 'ROLLBACK');
        return res.status(409).json({ message: 'Already registered' });
      }
      await run(db, 'UPDATE registrations SET status = ?, registration_date = ? WHERE id = ?', ['registered', now, existing.id]);
      await run(db, 'COMMIT');
      const updated = await get(db, 'SELECT * FROM registrations WHERE id = ?', [existing.id]);
      return res.json(updated);
    }
    try {
      const result = await run(db, 'INSERT INTO registrations (user_id, event_id, registration_date, status) VALUES (?,?,?,?)', [req.user.id, eventId, now, 'registered']);
      await run(db, 'COMMIT');
      inTxn = false;
      const reg = await get(db, 'SELECT * FROM registrations WHERE id = ?', [result.id]);
      return res.status(201).json(reg);
    } catch (e) {
      if (String(e.message || '').includes('UNIQUE') && String(e.message).includes('registrations.user_id, event_id')) {
        await run(db, 'ROLLBACK');
        return res.status(409).json({ message: 'Already registered' });
      }
      throw e;
    }
  } catch (e) {
    if (inTxn) {
      try { await run(db, 'ROLLBACK'); } catch (_) {}
    }
    return res.status(500).json({ message: 'Register failed', error: String(e) });
  }
});

app.delete('/api/events/:id/register', authRequired, async (req, res) => {
  try {
    const eventId = Number(req.params.id);
    const existing = await get(db, 'SELECT * FROM registrations WHERE user_id = ? AND event_id = ?', [req.user.id, eventId]);
    if (!existing || existing.status !== 'registered') return res.status(404).json({ message: 'No active registration' });
    const now = new Date().toISOString();
    await run(db, 'UPDATE registrations SET status = ?, registration_date = ? WHERE id = ?', ['cancelled', now, existing.id]);
    const updated = await get(db, 'SELECT * FROM registrations WHERE id = ?', [existing.id]);
    return res.json(updated);
  } catch (e) {
    return res.status(500).json({ message: 'Cancel failed', error: String(e) });
  }
});

app.get('/api/users/:id/registrations', authRequired, async (req, res) => {
  try {
    const userId = Number(req.params.id);
    if (userId !== req.user.id) return res.status(403).json({ message: 'Forbidden' });
    const rows = await all(
      db,
      `SELECT r.*, e.title, e.date_time, e.location
       FROM registrations r
       JOIN events e ON e.id = r.event_id
       WHERE r.user_id = ?
       ORDER BY r.registration_date DESC`,
      [userId]
    );
    return res.json(rows);
  } catch (e) {
    return res.status(500).json({ message: 'Fetch registrations failed', error: String(e) });
  }
});

// Creator's events (all, including past)
app.get('/api/users/:id/events', authRequired, async (req, res) => {
  try {
    const userId = Number(req.params.id);
    if (userId !== req.user.id) return res.status(403).json({ message: 'Forbidden' });
    const events = await all(db, 'SELECT * FROM events WHERE created_by = ? ORDER BY date_time DESC', [userId]);
    const withCounts = await Promise.all(events.map(async (ev) => {
      const row = await get(db, 'SELECT COUNT(*) as count FROM registrations WHERE event_id = ? AND status = "registered"', [ev.id]);
      return { ...ev, registrations: row?.count || 0, available_spots: Math.max(0, ev.max_capacity - (row?.count || 0)) };
    }));
    return res.json(withCounts);
  } catch (e) {
    return res.status(500).json({ message: 'Fetch user events failed', error: String(e) });
  }
});

// Global error handler for JSON parsing errors
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ message: 'Bad JSON: ' + err.message });
  }
  next(err);
});

app.listen(PORT, () => {
  console.log(`API server listening on http://localhost:${PORT}`);
});
