const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const PDFDocument = require('pdfkit');
const mysql = require('mysql2/promise');
require('dotenv').config();

const app = express();

// Server must NOT use MySQL port
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// MySQL connection (port 3306 is correct here)
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '200412',
  database: process.env.DB_NAME || 'uniNavigator',
  waitForConnections: true,
  connectionLimit: 10,
  namedPlaceholders: true
});

// Test database connection
(async () => {
  try {
    const connection = await pool.getConnection();
    console.log("Connected to MySQL database");
    connection.release();
  } catch (err) {
    console.error("MySQL connection failed:", err.message);
  }
})();

// ---------------- AUTH ----------------

app.post('/api/register', async (req, res) => {
  try {
    const { email, password, name, index_number } = req.body;

    const hash = bcrypt.hashSync(password, 10);

    const [result] = await pool.execute(
      'INSERT INTO users (email, password, name, index_number) VALUES (?, ?, ?, ?)',
      [email, hash, name || email, index_number || null]
    );

    const id = result.insertId;

    const [rows] = await pool.execute(
      'SELECT id, email, name, index_number FROM users WHERE id = ?',
      [id]
    );

    res.json({ success: true, user: rows[0] });

  } catch (e) {

    if (e.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({
        success: false,
        error: 'Email already registered'
      });
    }

    res.status(500).json({ success: false, error: e.message });
  }
});


app.post('/api/login', async (req, res) => {

  const { email, password } = req.body;

  const [rows] = await pool.execute(
    'SELECT id, email, password, name, index_number FROM users WHERE email = ?',
    [email]
  );

  const user = rows[0];

  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({
      success: false,
      error: 'Invalid email or password'
    });
  }

  const { password: _, ...safe } = user;

  res.json({ success: true, user: safe });
});

// ---------------- PDF REPORT ----------------

app.get('/api/users/:id/report.pdf', async (req, res) => {

  const userId = toInt(req.params.id);

  const [userRows] = await pool.execute(
    'SELECT * FROM users WHERE id = ?',
    [userId]
  );

  const user = userRows[0];

  if (!user) return res.status(404).send('User not found');

  const [modules] = await pool.execute(
    'SELECT * FROM modules WHERE user_id = ? ORDER BY semester',
    [userId]
  );

  const { gpa: cgpa } = calcGPA(modules);

  const doc = new PDFDocument({ margin: 50 });

  res.setHeader('Content-Type', 'application/pdf');

  res.setHeader(
    'Content-Disposition',
    'attachment; filename=UniNavigator-Academic-Report.pdf'
  );

  doc.pipe(res);

  doc.fontSize(20).text(
    'UniNavigator – Academic Report',
    { align: 'center' }
  );

  doc.moveDown();

  doc.fontSize(12).text(`Student: ${user.name}`);
  doc.text(`Index: ${user.index_number || 'N/A'}`);
  doc.text(`CGPA: ${cgpa || 'N/A'}`);

  doc.moveDown();
  doc.text('Modules:');

  modules.forEach(m => {

    doc.text(
      `${m.code || m.name} - ${m.credits} credits - ${m.grade_letter || 'N/A'} (Semester ${m.semester})`
    );

  });

  doc.end();
});


// SPA fallback

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`UniNavigator server running on http://localhost:${PORT}`);
});