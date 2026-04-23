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
// User profile (get/update for dashboard goals & profile pic)
// ============================

app.get("/users/:id/profile", async (req, res) => {
  try {
    const rows = await query("SELECT * FROM users WHERE id=?", [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: "Not found" });
    const u = rows[0];
    res.json({
      id: u.id,
      name: u.name,
      email: u.email,
      index_number: u.index_number,
      profile_pic: u.profile_pic,
      target_gpa: u.target_gpa ? parseFloat(u.target_gpa) : null,
      target_attendance: u.target_attendance || 80,
      notify_deadlines: u.notify_deadlines != null ? !!u.notify_deadlines : true,
      deadline_reminder_days: u.deadline_reminder_days != null ? parseInt(u.deadline_reminder_days, 10) : 3,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/users/:id/profile", async (req, res) => {
  try {
    const { name, index_number, target_gpa, target_attendance, profile_pic, notify_deadlines, deadline_reminder_days } =
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
    if (target_gpa !== undefined) {
      const tg = parseFloat(target_gpa);
      if (isNaN(tg) || tg < 0 || tg > 4) return res.status(400).json({ error: "Target GPA must be between 0 and 4" });
      updates.push("target_gpa=?");
      values.push(tg);
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
    if (notify_deadlines !== undefined) {
      updates.push("notify_deadlines=?");
      values.push(notify_deadlines ? 1 : 0);
    }
    if (deadline_reminder_days !== undefined) {
      updates.push("deadline_reminder_days=?");
      values.push(Math.min(30, Math.max(1, parseInt(deadline_reminder_days, 10) || 3)));
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
    await db.query("DELETE FROM tasks WHERE user_id=?", [userId]);
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

app.get("/users/:id/attendance-logs", async (req, res) => {
  try {
    const rows = await query(
      `SELECT
         l.id,
         l.user_id,
         l.module_name,
         l.semester,
         l.attended,
         l.total_sessions,
         l.lecture_date,
         l.delivery_mode,
         l.university_id,
         l.hall_id,
         l.proof_path,
         l.verification_status,
         l.created_at,
         u.name AS student_name,
         un.name AS university_name,
         lh.hall_name
       FROM attendance_logs l
       LEFT JOIN users u ON u.id=l.user_id
       LEFT JOIN universities un ON un.id=l.university_id
       LEFT JOIN lecture_halls lh ON lh.id=l.hall_id
       WHERE l.user_id=?
         AND l.verification_status IN ('auto_verified','approved')
       ORDER BY l.lecture_date DESC, l.created_at DESC`,
      [req.params.id]
    );
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

// Rich attendance mark with timetable/proof verification
app.post("/attendance/mark", timetableUpload.single("proof"), async (req, res) => {
  try {
    const body = req.body || {};
    const slot_id = body.slot_id;
    const user_id = body.user_id;
    let module_name = body.module_name;
    const attended = body.attended;
    const total_sessions = body.total_sessions;
    let semester = body.semester;
    let delivery_mode = body.delivery_mode;
    let university_id = body.university_id;
    let hall_id = body.hall_id;
    const academic_year = body.academic_year;
    const lecture_date = body.lecture_date;

    if (!user_id) return res.status(400).json({ error: "user_id is required" });
    const uid = parseInt(user_id, 10);
    let mn = typeof module_name === "string" ? module_name.trim() : "";
    if (slot_id) {
      const sid = parseInt(slot_id, 10);
      if (isNaN(sid)) return res.status(400).json({ error: "slot_id is invalid" });
      const slotRows = await query(
        "SELECT * FROM schedule_slots WHERE id=? AND user_id=?",
        [sid, uid]
      );
      const slot = slotRows[0];
      if (!slot) return res.status(404).json({ error: "Schedule slot not found" });
      mn = slot.module_name;
      delivery_mode = slot.delivery_mode;
      university_id = slot.university_id;
      hall_id = slot.hall_id;
      semester = slot.semester;
    }

    if (!mn || mn.length > 255) return res.status(400).json({ error: "Module name is required (1-255 characters)" });

    const sem = semester != null ? parseInt(semester, 10) : null;
    const att = parseInt(attended, 10) || 0;
    const tot = parseInt(total_sessions, 10) || 0;
    if (att < 0 || tot < 0) return res.status(400).json({ error: "Attended and total sessions must be 0 or greater" });
    if (att > tot) return res.status(400).json({ error: "Attended cannot exceed total sessions" });

    const mode = delivery_mode === "online" ? "online" : "offline";
    const uniId = university_id ? parseInt(university_id, 10) : null;
    const hallId = hall_id ? parseInt(hall_id, 10) : null;
    const dateVal = lecture_date ? String(lecture_date).slice(0, 10) : null;
    const yearNumber = academic_year != null ? parseInt(academic_year, 10) : null;

    let verificationStatus = "pending";
    let proofPath = null;

    // Offline auto-verify only when hall is valid and a student timetable exists for that semester+university.
    if (mode === "offline") {
      if (!uniId || !hallId || !sem) {
        return res.status(400).json({ error: "Offline attendance requires university, hall and semester" });
      }
      if (yearNumber == null || isNaN(yearNumber) || yearNumber < 1 || yearNumber > 10) {
        return res.status(400).json({ error: "Offline attendance requires academic_year (1-10)" });
      }
      const halls = await query("SELECT id FROM lecture_halls WHERE id=? AND university_id=?", [hallId, uniId]);
      if (!halls.length) return res.status(400).json({ error: "Selected hall does not belong to the selected university" });

      const timetableRows = await query(
        "SELECT id FROM timetable_pdfs WHERE uploaded_by_user_id=? AND university_id=? AND semester=? AND year_number=? ORDER BY created_at DESC LIMIT 1",
        [uid, uniId, String(sem), yearNumber]
      );
      verificationStatus = timetableRows.length ? "auto_verified" : "timetable_missing";
    } else {
      // Online lecture: proof is mandatory (pdf/image)
      if (!uniId || !sem) {
        return res.status(400).json({ error: "Online attendance requires university and semester" });
      }
      if (!req.file) return res.status(400).json({ error: "Proof upload is required for online lecture mode" });
      const allowed = ["application/pdf"];
      if (!allowed.includes(req.file.mimetype)) {
        return res.status(400).json({ error: "Proof must be PDF" });
      }
      proofPath = req.file.path;
      // Presence-based: verify timetable exists for semester+academic year.
      const lectureYear = yearNumber;
      if (lectureYear == null || isNaN(lectureYear) || lectureYear < 1 || lectureYear > 10) {
        return res.status(400).json({ error: "Online attendance requires academic_year (1-10)" });
      }
      const timetableRows = await query(
        "SELECT id FROM timetable_pdfs WHERE uploaded_by_user_id=? AND university_id=? AND semester=? AND year_number=? ORDER BY created_at DESC LIMIT 1",
        [uid, uniId, String(sem), lectureYear]
      );
      verificationStatus = timetableRows.length ? "auto_verified" : "timetable_missing";
    }

    const [logInsert] = await db.query(
      `INSERT INTO attendance_logs
       (user_id, module_name, semester, attended, total_sessions, lecture_date, delivery_mode, university_id, hall_id, proof_path, verification_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        uid,
        mn,
        sem || null,
        att,
        tot,
        dateVal || null,
        mode,
        uniId || null,
        hallId || null,
        proofPath,
        verificationStatus,
      ]
    );
//attendance validation
    let attendanceInserted = false;
    if (verificationStatus === "auto_verified") {
      await db.query(
        `INSERT INTO attendance (user_id, module_name, attended, total_sessions, semester)
         VALUES (?, ?, ?, ?, ?)`,
        [uid, mn, att, tot, sem || null]
      );
      attendanceInserted = true;
    }

    res.json({
      success: true,
      log_id: logInsert.insertId,
      verification_status: verificationStatus,
      attendance_inserted: attendanceInserted,
    });
  } catch (err) {
    res.status(500).json({ error: "Attendance mark failed" });
  }
});

// ============================
// Admin: Attendance verification queue
// ============================

app.get("/admin/attendance-queue", async (req, res) => {
  try {
    const adminUserId = req.query.admin_user_id || req.session?.userId;
    if (!adminUserId) return res.status(400).json({ error: "admin_user_id is required" });
    await requireAdmin(adminUserId);

    const status = req.query.status ? String(req.query.status).trim() : "";
    const allowed = ["pending", "timetable_missing", "approved", "rejected", "auto_verified", ""];
    const effectiveStatus = allowed.includes(status) ? status : "";

    const whereClause = effectiveStatus
      ? "WHERE l.verification_status=?"
      : "WHERE l.verification_status IN ('pending','timetable_missing')";

    const params = effectiveStatus ? [effectiveStatus] : [];

    const rows = await query(
      `SELECT
          l.id,
          l.user_id,
          u.name AS student_name,
          l.module_name,
          l.semester,
          l.attended,
          l.total_sessions,
          l.lecture_date,
          l.delivery_mode,
          l.verification_status,
          l.proof_path,
          un.name AS university_name,
          lh.hall_name,
          lh.building_name,
          lh.floor_number,
          tp.file_path AS latest_student_timetable_path
        FROM attendance_logs l
        JOIN users u ON u.id=l.user_id
        LEFT JOIN universities un ON un.id=l.university_id
        LEFT JOIN lecture_halls lh ON lh.id=l.hall_id
        LEFT JOIN timetable_pdfs tp ON tp.id=(
          SELECT t2.id
          FROM timetable_pdfs t2
          WHERE t2.uploaded_by_user_id=l.user_id
            AND t2.university_id=l.university_id
            AND t2.semester=l.semester
            AND t2.year_number=YEAR(l.lecture_date)
          ORDER BY t2.created_at DESC
          LIMIT 1
        )
        ${whereClause}
        ORDER BY l.created_at DESC
        LIMIT 500`,
      params
    );
    res.json(rows);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || "Admin failed" });
  }
});

app.post("/admin/attendance-queue/:id/approve", async (req, res) => {
  try {
    const adminUserId = req.body?.admin_user_id || req.session?.userId;
    if (!adminUserId) return res.status(400).json({ error: "admin_user_id is required" });
    await requireAdmin(adminUserId);

    const logId = parseInt(req.params.id, 10);
    if (isNaN(logId)) return res.status(400).json({ error: "Invalid log id" });

    const logs = await query("SELECT * FROM attendance_logs WHERE id=?", [logId]);
    const log = logs[0];
    if (!log) return res.status(404).json({ error: "Attendance log not found" });
    if (log.verification_status === "approved") return res.json({ success: true, skipped: true });
    if (log.verification_status === "rejected") return res.status(400).json({ error: "Cannot approve rejected log" });

    await query("UPDATE attendance_logs SET verification_status='approved' WHERE id=?", [logId]);

    await query(
      `INSERT INTO attendance (user_id, module_name, attended, total_sessions, semester)
       VALUES (?, ?, ?, ?, ?)`,
      [log.user_id, log.module_name, log.attended, log.total_sessions, log.semester]
    );

    res.json({ success: true });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || "Approve failed" });
  }
});

app.post("/admin/attendance-queue/:id/reject", async (req, res) => {
  try {
    const adminUserId = req.body?.admin_user_id || req.session?.userId;
    if (!adminUserId) return res.status(400).json({ error: "admin_user_id is required" });
    await requireAdmin(adminUserId);

    const logId = parseInt(req.params.id, 10);
    if (isNaN(logId)) return res.status(400).json({ error: "Invalid log id" });

    const logs = await query("SELECT * FROM attendance_logs WHERE id=?", [logId]);
    const log = logs[0];
    if (!log) return res.status(404).json({ error: "Attendance log not found" });
    if (log.verification_status === "rejected") return res.json({ success: true, skipped: true });

    await query("UPDATE attendance_logs SET verification_status='rejected' WHERE id=?", [logId]);
    res.json({ success: true });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || "Reject failed" });
  }
});

// ============================
// Student: day-wise schedule slots
// Presence-based verification vs uploaded timetable
// ============================

app.post("/attendance/slots", async (req, res) => {
  try {
    const {
      user_id,
      university_id,
      semester,
      year_number,
      day_of_week,
      start_time,
      end_time,
      module_name,
      delivery_mode,
      location_text,
      hall_id,
    } = req.body || {};

    if (!user_id) return res.status(400).json({ error: "user_id is required" });
    const uid = parseInt(user_id, 10);
    const uniId = university_id ? parseInt(university_id, 10) : null;
    const sem = semester != null ? parseInt(semester, 10) : null;
    const yn = year_number != null ? parseInt(year_number, 10) : null;
    const day = typeof day_of_week === "string" ? day_of_week.trim() : "";
    const st = typeof start_time === "string" ? start_time.trim() : "";
    const et = typeof end_time === "string" ? end_time.trim() : "";
    let mn = typeof module_name === "string" ? module_name.trim() : "";
    let mode = delivery_mode === "online" ? "online" : "physical";
    const loc = location_text ? String(location_text).slice(0, 255) : null;
    const hallId = hall_id ? parseInt(hall_id, 10) : null;

    //ERROR HANDLING
    if (!uniId || isNaN(uniId)) return res.status(400).json({ error: "university_id is invalid" });
    if (!sem || isNaN(sem)) return res.status(400).json({ error: "semester is invalid" });
    if (!yn || isNaN(yn) || yn < 1 || yn > 10) return res.status(400).json({ error: "academic year is invalid" });
    if (!day || day.length > 15) return res.status(400).json({ error: "day_of_week is required" });
    if (!st || !et) return res.status(400).json({ error: "start_time and end_time are required" });
    if (!mn || mn.length > 255) return res.status(400).json({ error: "module_name is required" });

    if (mode === "physical" && hallId) {
      const hallRows = await query("SELECT id FROM lecture_halls WHERE id=? AND university_id=?", [hallId, uniId]);
      if (!hallRows.length) return res.status(400).json({ error: "hall_id does not belong to selected university" });
    }
    // physical slots can be created with either hall_id or free-text location

    // Presence-based verification: timetable exists for that university+semester+year for this student.
    const timetableRows = await query(
      "SELECT id FROM timetable_pdfs WHERE uploaded_by_user_id=? AND university_id=? AND semester=? AND year_number=? ORDER BY created_at DESC LIMIT 1",
      [uid, uniId, String(sem), yn]
    );
    const verificationStatus = timetableRows.length ? "auto_verified" : "timetable_missing";

    const [result] = await db.query(
      `INSERT INTO schedule_slots
        (user_id, university_id, semester, year_number, day_of_week, start_time, end_time, module_name, delivery_mode, location_text, hall_id, verification_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [uid, uniId, sem, yn, day, st, et, mn, mode, loc, hallId || null, verificationStatus]
    );

    res.json({ success: true, slot_id: result.insertId, verification_status: verificationStatus });
  } catch (err) {
    res.status(500).json({ error: "Slot insert failed" });
  }
});

app.get("/attendance/slots", async (req, res) => {
  try {
    const { user_id, university_id, semester, year_number, day_of_week } = req.query || {};
    const uid = user_id ? parseInt(user_id, 10) : null;
    const uniId = university_id ? parseInt(university_id, 10) : null;
    const sem = semester != null ? parseInt(semester, 10) : null;
    const yn = year_number != null ? parseInt(year_number, 10) : null;
    const day = typeof day_of_week === "string" ? day_of_week.trim() : "";

    if (!uid || isNaN(uid)) return res.status(400).json({ error: "user_id is required" });
    if (!uniId || isNaN(uniId)) return res.status(400).json({ error: "university_id is invalid" });
    if (!sem || isNaN(sem)) return res.status(400).json({ error: "semester is invalid" });
    if (!yn || isNaN(yn)) return res.status(400).json({ error: "year_number is invalid" });

    const sql = day
      ? `SELECT
           id, day_of_week, start_time, end_time, module_name, delivery_mode,
           location_text, hall_id, verification_status, created_at
         FROM schedule_slots
         WHERE user_id=? AND university_id=? AND semester=? AND year_number=? AND day_of_week=?
         ORDER BY start_time ASC`
      : `SELECT
           id, day_of_week, start_time, end_time, module_name, delivery_mode,
           location_text, hall_id, verification_status, created_at
         FROM schedule_slots
         WHERE user_id=? AND university_id=? AND semester=? AND year_number=?
         ORDER BY day_of_week ASC, start_time ASC`;

    const params = day ? [uid, uniId, sem, yn, day] : [uid, uniId, sem, yn];
    const rows = await query(sql, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Slots fetch failed" });
  }
});

// ============================
// Universities & lecture halls (circle geofence)
// ============================

app.get("/universities", async (req, res) => {
  try {
    const rows = await query("SELECT id, name, general_email FROM universities ORDER BY name ASC");
    res.json(rows);
  } catch (err) {
    res.json([]);
  }
});

app.get("/universities/:id/halls", async (req, res) => {
  try {
    const halls = await query(
      "SELECT id, hall_name, building_name, floor_number, center_lat, center_lng, radius_m FROM lecture_halls WHERE university_id=? ORDER BY floor_number ASC, building_name ASC, hall_name ASC",
      [req.params.id]
    );
    res.json(halls);
  } catch (err) {
    res.json([]);
  }
});

// ============================
// Start Server
// ============================

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
