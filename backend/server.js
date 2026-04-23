const express = require("express");
const mysql = require("mysql2");
const cors = require("cors");
const PDFDocument = require("pdfkit");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const nodemailer = require("nodemailer");
const XLSX = require("xlsx");
const bcrypt = require("bcryptjs");
const session = require("express-session");

const app = express();
const PORT = 3000;

app.use(
  cors({
    origin: true,
    credentials: true,
  })
);
app.use(express.json({ limit: "10mb" }));
// Serve frontend static files
app.use(express.static(path.join(__dirname, "..", "frontend", "public")));

app.use(
  session({
    secret: process.env.SESSION_SECRET || "uninavigator-dev-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
    },
  })
);

// ============================
// File uploads (timetable PDFs)
// ============================

const UPLOAD_DIR = path.join(__dirname, "uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const timetableUpload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

app.use("/uploads", express.static(UPLOAD_DIR));

// ============================
// Email (optional)
// ============================

function buildMailer() {
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT, 10) : null;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !port || !user || !pass) return null;
  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

async function sendMail({ to, subject, text }) {
  const mailer = buildMailer();
  if (!mailer) {
    // If SMTP not configured, we "simulate" by throwing so admin can see an error.
    throw new Error("SMTP is not configured on the server.");
  }
  await mailer.sendMail({
    from: process.env.SMTP_FROM || userEmailFallback(),
    to,
    subject,
    text,
  });
}

function userEmailFallback() {
  return process.env.SMTP_USER || "no-reply@localhost";
}

// ============================
// Role helpers (admin auth)
// ============================

async function getUserRole(userId) {
  const rows = await query("SELECT role FROM users WHERE id=?", [userId]);
  if (!rows || rows.length === 0) return null;
  return rows[0].role || "student";
}

async function requireAdmin(userId) {
  const role = await getUserRole(userId);
  if (role !== "admin") {
    const err = new Error("Forbidden: admin only");
    err.statusCode = 403;
    throw err;
  }
}

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

const VALID_GRADES = ["A+", "A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D", "E", "F"];
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

    const hashed = await bcrypt.hash(p, 10);
    const sql = "INSERT INTO users(name,email,password) VALUES (?,?,?)";
    const result = await db.query(sql, [n, e, hashed]);
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
    const email = typeof req.body.email === "string" ? req.body.email.trim() : "";
    const password = typeof req.body.password === "string" ? req.body.password : "";

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    // ONLY search by email
    const rows = await query("SELECT * FROM users WHERE email = ?", [email]);

    if (rows.length === 0) {
      return res.json({ error: "Invalid credentials" });
    }

    const user = rows[0];

    // Compare hashed password (fallback to legacy plaintext once)
    let isMatch = false;
    try {
      isMatch = await bcrypt.compare(password, user.password);
    } catch (_) {
      isMatch = false;
    }
    if (!isMatch && typeof user.password === "string" && user.password === password) {
      isMatch = true;
      try {
        const rehashed = await bcrypt.hash(password, 10);
        await query("UPDATE users SET password=? WHERE id=?", [rehashed, user.id]);
      } catch (_) {}
    }

    if (!isMatch) {
      return res.json({ error: "Invalid credentials" });
    }

    // session
    req.session.userId = user.id;

    res.json({
      id: user.id,
      name: user.name,
      email: user.email,
      index_number: user.index_number,
      profile_pic: user.profile_pic,
      role: user.role || "student",
      target_gpa: user.target_gpa ? parseFloat(user.target_gpa) : null,
      target_attendance: user.target_attendance || 80,
      notify_deadlines: user.notify_deadlines != null ? !!user.notify_deadlines : true,
      deadline_reminder_days: user.deadline_reminder_days != null ? parseInt(user.deadline_reminder_days, 10) : 3,
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/me", async (req, res) => {
  try {
    const uid = req.session?.userId;
    if (!uid) return res.json({ user: null });
    const rows = await query("SELECT * FROM users WHERE id=?", [uid]);
    const user = rows[0];
    if (!user) return res.json({ user: null });
    res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        index_number: user.index_number,
        profile_pic: user.profile_pic,
        role: user.role || "student",
        target_gpa: user.target_gpa ? parseFloat(user.target_gpa) : null,
        target_attendance: user.target_attendance || 80,
        notify_deadlines: user.notify_deadlines != null ? !!user.notify_deadlines : true,
        deadline_reminder_days: user.deadline_reminder_days != null ? parseInt(user.deadline_reminder_days, 10) : 3,
      },
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to load session" });
  }
});

app.post("/logout", async (req, res) => {
  try {
    req.session?.destroy(() => {
      res.json({ success: true });
    });
  } catch (err) {
    res.json({ success: true });
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
      university_id,
      academic_year,
      semester_in_year,
      source_type,
      name,
      code,
      credits,
      grade_letter,
      grade_point,
      ca_percentage,
      semester,
      is_repeat,
    } = req.body;
    if (!user_id) return res.status(400).json({ error: "User ID is required" });
    const n = typeof name === "string" ? name.trim() : "";
    if (!n || n.length > 255) return res.status(400).json({ error: "Module name is required (1–255 characters)" });
    const cred = parseInt(credits, 10) || 3;
    if (cred < 1 || cred > 30) return res.status(400).json({ error: "Credits must be between 1 and 30" });
    if (grade_letter && !VALID_GRADES.includes(grade_letter)) return res.status(400).json({ error: "Invalid grade" });
    const ca = ca_percentage != null ? parseInt(ca_percentage, 10) : null;
    if (ca != null && (ca < 0 || ca > 100)) return res.status(400).json({ error: "CA percentage must be between 0 and 100" });

    const c = (typeof code === "string" ? code.trim().slice(0, 50) : "").toUpperCase();
    if (!c) return res.status(400).json({ error: "Module code is required" });

    const sem = semester != null ? parseInt(semester, 10) : 1;
    if (!sem || isNaN(sem) || sem < 1 || sem > 20) return res.status(400).json({ error: "Semester must be between 1 and 20" });

    const uniId = university_id != null && university_id !== "" ? parseInt(university_id, 10) : null;
    if (uniId != null && isNaN(uniId)) return res.status(400).json({ error: "university_id is invalid" });

    const ay = academic_year != null && academic_year !== "" ? parseInt(academic_year, 10) : null;
    if (ay != null && (isNaN(ay) || ay < 1 || ay > 10)) return res.status(400).json({ error: "Academic year must be between 1 and 10" });

    const siy = semester_in_year != null && semester_in_year !== "" ? parseInt(semester_in_year, 10) : null;
    if (siy != null && (isNaN(siy) || siy < 1 || siy > 3)) return res.status(400).json({ error: "Semester must be between 1 and 3" });

    // If module code already exists for this user/semester/university, update that record.
    const dupRows = await query(
      "SELECT id FROM modules WHERE user_id=? AND UPPER(code)=? AND semester=? AND (university_id <=> ?) LIMIT 1",
      [user_id, c, sem, uniId]
    );
    const srcType = typeof source_type === "string" && source_type.trim() ? source_type.trim().slice(0, 30) : "normal";
    if (dupRows.length) {
      const existingId = dupRows[0].id;
      await db.query(
        `UPDATE modules
         SET university_id=?,
             academic_year=?,
             semester_in_year=?,
             source_type=?,
             name=?,
             code=?,
             credits=?,
             grade_letter=?,
             grade_point=?,
             ca_percentage=?,
             semester=?,
             is_repeat=?
         WHERE id=?`,
        [
          uniId,
          ay,
          siy,
          srcType,
          n,
          c,
          cred,
          grade_letter || null,
          grade_point != null ? parseFloat(grade_point) : null,
          ca,
          sem,
          is_repeat ? 1 : 0,
          existingId,
        ]
      );
      return res.json({ id: existingId, updated: true });
    }

    const sql = `
      INSERT INTO modules
      (user_id, university_id, academic_year, semester_in_year, source_type, name, code, credits, grade_letter, grade_point, ca_percentage, semester, is_repeat)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const [result] = await db.query(sql, [
      user_id,
      uniId,
      ay,
      siy,
      srcType,
      n,
      c,
      cred,
      grade_letter || null,
      grade_point != null ? parseFloat(grade_point) : null,
      ca,
      sem,
      is_repeat ? 1 : 0,
    ]);
    res.json({ id: result.insertId });
  } catch (err) {
    console.error(err);
    res.json({ error: "Insert failed" });
  }
});

// ============================
// Update Module (e.g. record improvement / replace grade)
// ============================

app.put("/modules/:id", async (req, res) => {
  try {
    const moduleId = parseInt(req.params.id, 10);
    if (isNaN(moduleId)) return res.status(400).json({ error: "Invalid module ID" });
    const existing = await query("SELECT id FROM modules WHERE id=?", [moduleId]);
    if (existing.length === 0) return res.status(404).json({ error: "Module not found" });
    const { grade_letter, grade_point, ca_percentage, is_repeat, semester } = req.body;
    const updates = [];
    const values = [];
    //VALIDATION
    if (grade_letter !== undefined) {
      if (grade_letter && !VALID_GRADES.includes(grade_letter)) return res.status(400).json({ error: "Invalid grade" });
      updates.push("grade_letter=?");
      values.push(grade_letter || null);
    }
    if (grade_point !== undefined) {
      const gp = grade_point != null ? parseFloat(grade_point) : null;
      if (gp != null && (isNaN(gp) || gp < 0 || gp > 4)) return res.status(400).json({ error: "Grade point must be between 0 and 4" });
      updates.push("grade_point=?");
      values.push(gp);
    }
    if (ca_percentage !== undefined) {
      const ca = ca_percentage != null ? parseInt(ca_percentage, 10) : null;
      if (ca != null && (isNaN(ca) || ca < 0 || ca > 100)) {
        return res.status(400).json({ error: "CA percentage must be between 0 and 100" });
      }
      updates.push("ca_percentage=?");
      values.push(ca);
    }
    if (is_repeat !== undefined) {
      updates.push("is_repeat=?");
      values.push(is_repeat ? 1 : 0);
    }
    if (semester !== undefined) {
      const sem = semester != null ? parseInt(semester, 10) : 1;
      if (sem < 1 || sem > 20) return res.status(400).json({ error: "Semester must be between 1 and 20" });
      updates.push("semester=?");
      values.push(sem);
    }
    if (updates.length === 0) {
      return res.json({ success: true });
    }
    values.push(moduleId);
    await db.query(
      `UPDATE modules SET ${updates.join(", ")} WHERE id=?`,
      values
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================
// Delete Module
// ============================

app.delete("/modules/:id", async (req, res) => {
  try {
    await query("DELETE FROM modules WHERE id=?", [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.json({ error: "Delete failed" });
  }
});

// ============================
// GPA Calculation
// ============================

app.get("/users/:id/gpa", async (req, res) => {
  try {
    const rows = await query("SELECT * FROM modules WHERE user_id=? ORDER BY semester, name", [
      req.params.id,
    ]);

    // Group modules by semester
    const semesters = {};
    let overallCredits = 0;
    let overallPoints = 0;

    rows.forEach((m) => {
      const sem = m.semester || 1;
      if (!semesters[sem]) {
        semesters[sem] = { modules: [], credits: 0, points: 0 };
      }
      semesters[sem].modules.push(m);
      if (m.grade_point != null) {
        semesters[sem].credits += m.credits;
        semesters[sem].points += m.grade_point * m.credits;
        overallCredits += m.credits;
        overallPoints += m.grade_point * m.credits;
      }
    });

    // Calculate semester GPAs
    const semesterGpas = Object.keys(semesters).map(sem => {
      const data = semesters[sem];
      const gpa = data.credits ? (data.points / data.credits).toFixed(2) : 0;
      return {
        semester: parseInt(sem),
        gpa: parseFloat(gpa),
        credits: data.credits,
        modules: data.modules
      };
    }).sort((a, b) => a.semester - b.semester);

    const overallGpa = overallCredits ? (overallPoints / overallCredits).toFixed(2) : 0;

    res.json({
      overall: { gpa: parseFloat(overallGpa), credits: overallCredits },
      semesters: semesterGpas,
      modules: rows,
    });
  } catch (err) {
    console.error('GPA calculation error:', err);
    res.json({ overall: { gpa: 0, credits: 0 }, semesters: [], modules: [] });
  }
});

// ============================
// Start Server
// ============================

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
