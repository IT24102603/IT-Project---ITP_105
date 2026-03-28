const express = require("express");
const mysql = require("mysql2");
const cors = require("cors");
const PDFDocument = require("pdfkit");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.join(__dirname, "public")));

// ============================
// MySQL Connection
// ============================

const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 3306,
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "200412",
  database: process.env.DB_NAME || "uniNavigator",
  waitForConnections: true,
  connectionLimit: 10,
  namedPlaceholders: true,
});

const db = pool.promise();

async function query(sql, params = []) {
  const [rows] = await db.query(sql, params);
  return rows;
}

// ============================
// Validation helpers
// ============================

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidEmail(str) {
  return typeof str === "string" && str.length >= 3 && str.length <= 255 && EMAIL_REGEX.test(str.trim());
}

// Test database connection
(async () => {
  try {
    await db.query("SELECT 1");
    console.log("Connected to MySQL database");
  } catch (err) {
    console.error("MySQL connection failed:", err.message);
  }
})();

// ============================
// Register
// ============================

app.post("/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;
    const n = typeof name === "string" ? name.trim() : "";
    const e = typeof email === "string" ? email.trim() : "";
    const p = typeof password === "string" ? password : "";

    if (!n || n.length < 1 || n.length > 255) {
      return res.status(400).json({ error: "Name is required (1–255 characters)" });
    }
    if (!isValidEmail(e)) {
      return res.status(400).json({ error: "Enter a valid email address" });
    }
    if (!p || p.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }

    const sql = "INSERT INTO users(name,email,password) VALUES (?,?,?)";
    const result = await db.query(sql, [n, e, p]);
    res.json({ id: result[0].insertId, name: n, email: e });
  } catch (err) {
    res.status(400).json({ error: "Email already exists" });
  }
});

// ============================
// Login
// ============================

app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password || typeof email !== "string" || typeof password !== "string") {
      return res.status(400).json({ error: "Email and password are required" });
    }
    const sql = "SELECT * FROM users WHERE email=? AND password=?";
    const rows = await query(sql, [email, password]);
    if (rows.length === 0) {
      return res.json({ error: "Invalid credentials" });
    }
    const user = rows[0];
    res.json({
      id: user.id,
      name: user.name,
      email: user.email,
      index_number: user.index_number,
      profile_pic: user.profile_pic,
      target_attendance: user.target_attendance || 80,
    });
  } catch (err) {
    res.json({ error: "Database error" });
  }
});

// ============================
// User profile (get/update for dashboard goals & profile pic)
// ============================

app.get("/users/:id/profile", async (req, res) => {
  try {
    const rows = await query("SELECT * FROM users WHERE id=?", [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: "Not found" });
    const u = rows[0];
    res.json({
      name: u.name,
      email: u.email,
      index_number: u.index_number,
      profile_pic: u.profile_pic,
      target_attendance: u.target_attendance || 80,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/users/:id/profile", async (req, res) => {
  try {
    const { name, index_number, target_attendance, profile_pic } =
      req.body;
    const updates = [];
    const values = [];
    if (name !== undefined) {
      const n = typeof name === "string" ? name.trim() : "";
      if (n.length > 255) return res.status(400).json({ error: "Name must be 255 characters or less" });
      updates.push("name=?");
      values.push(n);
    }
    if (index_number !== undefined) {
      const idx = typeof index_number === "string" ? index_number.trim().slice(0, 100) : "";
      updates.push("index_number=?");
      values.push(idx || null);
    }
    if (target_attendance !== undefined) {
      const ta = parseInt(target_attendance, 10);
      if (isNaN(ta) || ta < 0 || ta > 100) return res.status(400).json({ error: "Target attendance must be between 0 and 100" });
      updates.push("target_attendance=?");
      values.push(ta);
    }
    if (profile_pic !== undefined) {
      updates.push("profile_pic=?");
      values.push(profile_pic);
    }
    if (updates.length === 0) {
      return res.json({ success: true });
    }
    values.push(req.params.id);
    await db.query(
      `UPDATE users SET ${updates.join(", ")} WHERE id=?`,
      values
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/users/:id", async (req, res) => {
  try {
    const userId = req.params.id;
    await db.query("DELETE FROM attendance WHERE user_id=?", [userId]);

    await db.query("DELETE FROM modules WHERE user_id=?", [userId]);
    await db.query("DELETE FROM users WHERE id=?", [userId]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================
// Get Modules
// ============================

app.get("/users/:id/modules", async (req, res) => {
  try {
    const rows = await query("SELECT * FROM modules WHERE user_id=?", [
      req.params.id,
    ]);
    res.json(rows);
  } catch (err) {
    res.json([]);
  }
});

// ============================
// Add Module
// ============================

app.post("/modules", async (req, res) => {
  try {
    const {
      user_id,
      name,
      code
    } = req.body;
    if (!user_id) return res.status(400).json({ error: "User ID is required" });
    const n = typeof name === "string" ? name.trim() : "";
    if (!n || n.length > 255) return res.status(400).json({ error: "Module name is required (1–255 characters)" });
    const sql = `
      INSERT INTO modules
      (user_id, name, code)
      VALUES (?, ?, ?)
    `;
    const [result] = await db.query(sql, [
      user_id,
      n,
      (typeof code === "string" ? code.trim().slice(0, 50) : "") || ""
    ]);
    res.json({ id: result.insertId });
  } catch (err) {
    console.error(err);
    res.json({ error: "Insert failed" });
  }
});



// ============================
// Attendance
// ============================

app.get("/users/:id/attendance", async (req, res) => {
  try {
    const rows = await query("SELECT * FROM attendance WHERE user_id=?", [
      req.params.id,
    ]);
    res.json(rows);
  } catch (err) {
    res.json([]);
  }
});

app.post("/attendance", async (req, res) => {
  try {
    const { user_id, module_name, attended, total_sessions, semester } =
      req.body;
    if (!user_id) return res.status(400).json({ error: "User ID is required" });
    const mn = typeof module_name === "string" ? module_name.trim() : "";
    if (!mn || mn.length > 255) return res.status(400).json({ error: "Module name is required (1–255 characters)" });
    const att = parseInt(attended, 10) || 0;
    const tot = parseInt(total_sessions, 10) || 0;
    if (att < 0 || tot < 0) return res.status(400).json({ error: "Attended and total sessions must be 0 or greater" });
    if (att > tot) return res.status(400).json({ error: "Attended cannot exceed total sessions" });
    const sql = `
      INSERT INTO attendance
      (user_id, module_name, attended, total_sessions, semester)
      VALUES (?, ?, ?, ?, ?)
    `;
    const [result] = await db.query(sql, [
      user_id,
      mn,
      att,
      tot,
      semester != null ? parseInt(semester, 10) || null : null,
    ]);
    res.json({ id: result.insertId });
  } catch (err) {
    res.json({ error: "Attendance insert failed" });
  }
});



// ============================
// PDF Report
// ============================

app.get("/users/:id/report.pdf", async (req, res) => {
  const user_id = req.params.id;
  const doc = new PDFDocument();
  res.setHeader(
    "Content-Disposition",
    "attachment; filename=uninavigator-report.pdf"
  );
  doc.pipe(res);
  doc.fontSize(20).text("UniNavigator Student Report");

  try {
    const [users] = await db.query("SELECT * FROM users WHERE id=?", [
      user_id,
    ]);
    if (users.length) {
      doc.moveDown();
      doc.text(`Student: ${users[0].name}`);
      doc.text(`Email: ${users[0].email}`);
    }

    const attendance = await query("SELECT * FROM attendance WHERE user_id=?", [
      user_id,
    ]);
    doc.moveDown();
    doc.text("Attendance");
    attendance.forEach((a) => {
      const percent = Math.round(
        (a.attended / (a.total_sessions || 1)) * 100
      );
      doc.text(`${a.module_name} : ${percent}%`);
    });
  } catch (err) {
    doc.text("Error loading data.");
  }
  doc.end();
});

// ============================
// Start Server
// ============================

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
