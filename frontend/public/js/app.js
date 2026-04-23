(function () {
  // If the UI is opened from file:// or another dev server port,
  // fall back to the backend origin so API calls still work.
  const API =
    window.location.protocol === "file:" ||
    (window.location.hostname === "localhost" && window.location.port && window.location.port !== "3000")
      ? "http://localhost:3000"
      : "";

  let currentUser = null;

  let gpaChart = null;
  let dashboardAttendanceChart = null;
  let dashboardRepeatChart = null;
  let pageAttendanceChart = null;
  let tasksChart = null;
  let pageRepeatBarChart = null;
  let repeatPieChart = null;
  let adminUsageChart = null;
  let adminHallMap = null;
  let adminHallMarker = null;
  let adminHallCircle = null;
  let attendanceUniversities = [];
  let attendanceHalls = [];
  let selectedAttendanceUniversityId = null;

  const GRADE_POINTS = {
    "A+": 4.0, "A": 4.0, "A-": 3.7,
    "B+": 3.3, "B": 3.0, "B-": 2.7,
    "C+": 2.3, "C": 2.0, "C-": 1.7,
    "D": 1.0, "E": 0.5, "F": 0
  };

  const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  function parsePositiveInt(value, fallback = null) {
    const n = parseInt(value, 10);
    if (isNaN(n) || n < 1) return fallback;
    return n;
  }

  function normalizeCode(code) {
    return (code || "").trim().toUpperCase();
  }

  function isGradeBelowC(gradeLetter) {
    if (!gradeLetter) return false;
    const gp = GRADE_POINTS[gradeLetter];
    return gp != null && gp < 2.0;
  }

  function showFormError(formOrId, msg) {
    const el = typeof formOrId === "string" ? document.getElementById(formOrId) : formOrId;
    if (!el) return;
    let errEl = el.querySelector(".validation-error");
    if (!errEl) {
      errEl = document.createElement("div");
      errEl.className = "validation-error error-msg";
      el.insertBefore(errEl, el.firstChild);
    }
    errEl.textContent = msg;
    errEl.classList.remove("hidden");
  }

  function clearFormError(formOrId) {
    const el = typeof formOrId === "string" ? document.getElementById(formOrId) : formOrId;
    const errEl = el?.querySelector(".validation-error");
    if (errEl) errEl.classList.add("hidden");
  }

  // ==============================
  // API Helpers
  // ==============================

  async function get(url) {
    const res = await fetch(API + url, { credentials: "include" });
    return await res.json();
  }

  async function post(url, data) {
    const res = await fetch(API + url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
      credentials: "include",
    });
    return await res.json();
  }

  async function put(url, data) {
    const res = await fetch(API + url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
      credentials: "include",
    });
    return await res.json();
  }

  async function patch(url, data) {
    const res = await fetch(API + url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
      credentials: "include",
    });
    return await res.json();
  }

  async function del(url) {
    await fetch(API + url, { method: "DELETE", credentials: "include" });
  }

  // ==============================
  // Usage analytics helpers
  // ==============================

  async function trackUsage(event_type, page, meta) {
    if (!currentUser) return;
    const payload = {
      user_id: currentUser.id,
      event_type,
      page: page || null,
      meta: meta || null,
    };
    try {
      await fetch(API + "/analytics/event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        keepalive: true,
        credentials: "include",
      });
    } catch (_) {}
  }

  // Distance between lat/lng points (meters)
  function haversineMeters(lat1, lon1, lat2, lon2) {
    const R = 6371000; // earth radius
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  // ==============================
  // Auth & Navigation
  // ==============================

  async function login(e) {
    e.preventDefault();
    const email = document.getElementById("login-email").value?.trim() || "";
    const password = document.getElementById("login-password").value || "";
    const authError = document.getElementById("auth-error");
    if (authError) authError.classList.add("hidden");
    if (!email || !password) {
      if (authError) { authError.textContent = "Email and password are required"; authError.classList.remove("hidden"); }
      return;
    }
    const user = await post("/login", { email, password });
    if (!user || user.error) {
      const el = document.getElementById("auth-error");
      if (el) { el.textContent = user?.error || "Invalid login"; el.classList.remove("hidden"); }
      return;
    }
    currentUser = user;
    showApp();
  }

  async function tryResumeSession() {
    try {
      const res = await get("/me");
      if (res && res.user && res.user.id) {
        currentUser = res.user;
        showApp();
      }
    } catch (_) {}
  }

  async function register(e) {
    e.preventDefault();
    const name = (document.getElementById("reg-name").value || "").trim();
    const email = (document.getElementById("reg-email").value || "").trim();
    const password = document.getElementById("reg-password").value || "";
    const regError = document.getElementById("register-error");
    if (regError) regError.classList.add("hidden");
    if (!name || name.length > 255) {
      if (regError) { regError.textContent = "Name is required (1–255 characters)"; regError.classList.remove("hidden"); }
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(email)) {
      if (regError) { regError.textContent = "Enter a valid email address"; regError.classList.remove("hidden"); }
      return;
    }
    if (!password || password.length < 6) {
      if (regError) { regError.textContent = "Password must be at least 6 characters"; regError.classList.remove("hidden"); }
      return;
    }
    const result = await post("/register", { name, email, password });
    if (result.error) {
      const el = document.getElementById("register-error");
      if (el) { el.textContent = result.error; el.classList.remove("hidden"); }
      return;
    }
    alert("Registration successful! Sign in with your email.");
    document.getElementById("show-login").click();
  }

  const deadlineNotifiedIds = new Set();

  function showApp() {
    document.getElementById("auth-screen").classList.add("hidden");
    document.getElementById("register-screen").classList.add("hidden");
    document.getElementById("app").classList.remove("hidden");

    const sidebarName = document.getElementById("sidebar-name");
    const sidebarEmail = document.getElementById("sidebar-email");
    if (sidebarName) sidebarName.textContent = currentUser.name || "Student";
    if (sidebarEmail) sidebarEmail.textContent = currentUser.email || "";

    const isAdmin = currentUser?.role === "admin";
    document.querySelectorAll(".admin-only").forEach((el) => {
      el.classList.toggle("hidden", !isAdmin);
    });
    document.querySelectorAll(".student-only").forEach((el) => {
      el.classList.toggle("hidden", isAdmin);
    });

    initNavigation();

    if (isAdmin) {
      showPage("admin-dashboard");
      loadAdminDashboard();
      loadAdminUsers();
      loadAdminUniversitiesForHalls();
      loadAdminConcerns();
      // Timetable uploads are handled by students only
      loadAdminUsage();
    } else {
      loadDashboard();
      loadAttendance();
      loadRepeat();
      loadTasks();
      showPage("dashboard");
      checkUpcomingDeadlines();
      if (window.deadlineCheckInterval) clearInterval(window.deadlineCheckInterval);
      window.deadlineCheckInterval = setInterval(checkUpcomingDeadlines, 30 * 60 * 1000);
    }
  }

  function showDeadlinePrefsSaved() {
    const el = document.getElementById("save-notification-prefs");
    if (!el) return;
    const orig = el.textContent;
    el.textContent = "Saved!";
    setTimeout(() => { el.textContent = orig; }, 1500);
  }

  async function checkUpcomingDeadlines() {
    if (!currentUser || currentUser.notify_deadlines === false) return;
    const days = Math.min(30, Math.max(1, parseInt(currentUser.deadline_reminder_days, 10) || 3));
    let tasks = [];
    try {
      tasks = await get("/users/" + currentUser.id + "/tasks");
    } catch (_) {}
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const upcoming = tasks.filter((t) => {
      if (t.completed || !t.due_date) return false;
      const due = new Date(t.due_date);
      due.setHours(0, 0, 0, 0);
      const diffDays = Math.ceil((due - today) / (1000 * 60 * 60 * 24));
      return diffDays >= 0 && diffDays <= days;
    });
    if (upcoming.length === 0) {
      const banner = document.getElementById("deadline-alert-banner");
      if (banner) { banner.classList.add("hidden"); banner.innerHTML = ""; }
      return;
    }
    const toNotify = upcoming.filter((t) => !deadlineNotifiedIds.has(t.id));
    const banner = document.getElementById("deadline-alert-banner");
    if (banner) {
      banner.classList.remove("hidden");
      const list = upcoming.slice(0, 5).map((t) => {
        const due = new Date(t.due_date);
        const diff = Math.ceil((due - today) / (1000 * 60 * 60 * 24));
        const dayText = diff === 0 ? "Today" : diff === 1 ? "Tomorrow" : diff + " days";
        return `<span class="deadline-alert-item">${t.title} — ${dayText}</span>`;
      }).join("");
      banner.innerHTML = `<span class="deadline-alert-icon"></span><span class="deadline-alert-msg">Deadlines soon: ${list}</span><a href="#" data-page="tasks" class="deadline-alert-link">View tasks</a>`;
      banner.querySelector(".deadline-alert-link")?.addEventListener("click", (e) => { e.preventDefault(); showPage("tasks"); });
    }
    if (toNotify.length > 0 && "Notification" in window && Notification.permission === "granted") {
      toNotify.forEach((t) => {
        deadlineNotifiedIds.add(t.id);
        const due = new Date(t.due_date);
        const diff = Math.ceil((due - today) / (1000 * 60 * 60 * 24));
        const when = diff === 0 ? "today" : diff === 1 ? "tomorrow" : "in " + diff + " days";
        new Notification("UniNavigator: Deadline soon", { body: t.title + " is due " + when, icon: "/favicon.ico" });
      });
    } else if (toNotify.length > 0) {
      toNotify.forEach((t) => deadlineNotifiedIds.add(t.id));
    }
  }

  function showPage(pageId) {
    document.querySelectorAll(".page").forEach((p) => p.classList.remove("active"));
    document.querySelectorAll(".nav-link").forEach((l) => l.classList.remove("active"));
    const page = document.getElementById("page-" + pageId);
    const link = document.querySelector('.nav-link[data-page="' + pageId + '"]');
    if (page) page.classList.add("active");
    if (link) link.classList.add("active");

    trackUsage("page_view", pageId);

    if (pageId === "gpa") loadGpaPage();
    if (pageId === "attendance") loadAttendancePage();
    if (pageId === "tasks") loadTasks();
    if (pageId === "repeat") loadRepeat();
    if (pageId === "concerns") loadConcernsPage();

    if (pageId === "admin-dashboard") loadAdminDashboard();
    if (pageId === "admin-users") loadAdminUsers();
    if (pageId === "admin-halls") loadAdminHallsPage();
    if (pageId === "admin-concerns") loadAdminConcerns();
    if (pageId === "admin-usage") loadAdminUsage();
  }

  function initNavigation() {
    document.querySelectorAll(".nav-link[data-page]").forEach((link) => {
      link.addEventListener("click", (e) => {
        e.preventDefault();
        showPage(link.getAttribute("data-page"));
      });
    });
  }

  // ==============================
  // Dashboard (Profile + Report + Goals + GPA)
  // ==============================

  async function loadDashboard() {
    if (!currentUser) return;

    const [gpaData, profile, timetables] = await Promise.all([
      get("/users/" + currentUser.id + "/gpa"),
      get("/users/" + currentUser.id + "/profile").catch(() => currentUser),
      get("/users/" + currentUser.id + "/timetables").catch(() => []),
    ]);

    const cgpa = gpaData.overall?.gpa ?? 0;
    const modulesAll = gpaData.modules || [];
    const currentSemester = Math.max(
      1,
      ...modulesAll.map((m) => {
        const s = parseInt(m.semester, 10);
        return isNaN(s) ? 1 : s;
      })
    );
    const currentSemesterModules = modulesAll.filter((m) => (parseInt(m.semester, 10) || 1) === currentSemester);
    const moduleCount = currentSemesterModules.length;
    const targetGpa = profile.target_gpa != null ? profile.target_gpa : "–";
    const targetAtt = profile.target_attendance != null ? profile.target_attendance : 80;

    document.getElementById("dashboard-name").textContent = profile.name || currentUser.name || "Student";
    document.getElementById("dashboard-index").textContent = profile.index_number ? "Index: " + profile.index_number : "–";
    document.getElementById("dashboard-email").textContent = profile.email || currentUser.email || "–";

    const picEl = document.getElementById("profile-pic");
    if (picEl && (profile.profile_pic || currentUser.profile_pic)) {
      picEl.src = profile.profile_pic || currentUser.profile_pic;
    }

    document.getElementById("dashboard-current-gpa").textContent = cgpa;
    document.getElementById("dashboard-target-gpa").textContent = targetGpa;
    document.getElementById("dashboard-target-attendance").textContent = targetAtt + "%";
    document.getElementById("dashboard-module-count").textContent = moduleCount;


    // Goals edit
    const editBtn = document.getElementById("edit-goals-btn");
    const editFields = document.getElementById("goals-edit-fields");
    const saveBtn = document.getElementById("save-goals-btn");
    if (editBtn && editFields) {
      editBtn.onclick = () => {
        editFields.classList.toggle("hidden");
        if (!editFields.classList.contains("hidden")) {
          document.getElementById("edit-target-gpa").value = targetGpa !== "–" ? targetGpa : "";
          document.getElementById("edit-target-attendance").value = targetAtt !== "–" ? targetAtt : 80;
        }
      };
    }
    if (saveBtn) {
      saveBtn.onclick = async () => {
        const tg = parseFloat(document.getElementById("edit-target-gpa").value);
        const ta = parseInt(document.getElementById("edit-target-attendance").value, 10);
        if (!isNaN(tg) && (tg < 0 || tg > 4)) {
          alert("Target GPA must be between 0 and 4");
          return;
        }
        if (!isNaN(ta) && (ta < 0 || ta > 100)) {
          alert("Target attendance must be between 0 and 100");
          return;
        }
        const res = await put("/users/" + currentUser.id + "/profile", {
          target_gpa: isNaN(tg) ? null : tg,
          target_attendance: isNaN(ta) ? 80 : ta,
        });
        if (res && res.error) {
          alert(res.error);
          return;
        }
        currentUser.target_gpa = tg;
        currentUser.target_attendance = ta;
        editFields.classList.add("hidden");
        loadDashboard();
      };
    }

    // GPA line chart
    const labels = (gpaData.modules || [])
      .filter((m) => m.grade_point != null)
      .map((m) => m.name);
    const grades = (gpaData.modules || [])
      .filter((m) => m.grade_point != null)
      .map((m) => parseFloat(m.grade_point));

    const gpaCtx = document.getElementById("gpaChart");
    if (gpaCtx) {
      if (gpaChart) gpaChart.destroy();
      gpaChart = new Chart(gpaCtx, {
        type: "line",
        data: {
          labels,
          datasets: [{ label: "Grade Points", data: grades, borderColor: "#00c9a7", tension: 0.2 }],
        },
        options: { responsive: true, maintainAspectRatio: true },
      });
    }

  // ==============================
  // GPA Calculator + Goal Planner
  // ==============================

  async function loadGpaPage() {
    if (!currentUser) return;
    const [gpaData, universities] = await Promise.all([
      get("/users/" + currentUser.id + "/gpa"),
      get("/universities").catch(() => []),
    ]);
    const modules = gpaData.modules || [];
    const semesters = gpaData.semesters || [];

    const cards = document.getElementById("gpa-summary-cards");
    const cgpa = gpaData.overall?.gpa ?? 0;
    const totalCredits = gpaData.overall?.credits ?? 0;
    cards.innerHTML = `
      <div class="card"><div class="label">Current GPA</div><div class="value">${cgpa}</div></div>
      <div class="card"><div class="label">Total Credits</div><div class="value">${totalCredits}</div></div>
      <div class="card"><div class="label">Semesters</div><div class="value">${semesters.length}</div></div>
    `;

    // Display semester-wise GPA
    const semesterContainer = document.getElementById("gpa-semester-container");
    if (semesterContainer) {
      semesterContainer.innerHTML = semesters.map(sem => {
        const year = Math.ceil(sem.semester / 2);
        const semInYear = sem.semester % 2 === 0 ? 2 : 1;
        return `
          <div class="semester-section">
            <h3>Year ${year} | Semester ${semInYear} | Semester GPA: ${sem.gpa}</h3>
            <div class="table-wrap">
              <table>
                <thead>
                  <tr><th>Code</th><th>Subject Name</th><th>Credits</th><th>CA%</th><th>Grade</th><th>Grade Points</th></tr>
                </thead>
                <tbody>
                  ${sem.modules.map(m => `
                    <tr>
                      <td>${m.code || '–'}</td>
                      <td>${m.name}</td>
                      <td>${m.credits}</td>
                      <td>${m.ca_percentage != null ? m.ca_percentage + '%' : '–'}</td>
                      <td>${m.grade_letter || '–'}</td>
                      <td>${m.grade_point != null ? m.grade_point : '–'}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        `;
      }).join('');
    }

    const tbody = document.getElementById("gpa-modules-tbody");
    tbody.innerHTML = modules
      .map(
        (m) =>
          `<tr>
            <td>${m.name}</td>
            <td>${m.code || "–"}</td>
            <td>${m.credits}</td>
            <td><input type="number" min="0" max="100" value="${m.ca_percentage != null ? m.ca_percentage : ""}" data-ca-input="${m.id}" style="max-width:90px;"></td>
            <td>${m.grade_letter || "–"}</td>
            <td><button type="button" class="btn btn-ghost btn-small" data-save-ca="${m.id}">Save CA</button></td>
            <td><button type="button" class="btn btn-ghost btn-small" data-delete-module="${m.id}">Delete</button></td>
          </tr>`
      )
      .join("");

    const gpaUniSelect = document.getElementById("gpa-mod-university");
    if (gpaUniSelect) {
      gpaUniSelect.innerHTML =
        '<option value="">Select university</option>' +
        (universities || []).map((u) => `<option value="${u.id}">${u.name}</option>`).join("");
    }

    const existingSelect = document.getElementById("gpa-existing-module-select");
    if (existingSelect) {
      const unique = [];
      const seen = new Set();
      (modules || []).forEach((m) => {
        const key = `${normalizeCode(m.code)}|${m.name}|${m.credits}|${m.academic_year || ""}|${m.semester_in_year || ""}|${m.university_id || ""}`;
        if (!seen.has(key)) {
          seen.add(key);
          unique.push(m);
        }
      });
      existingSelect.innerHTML =
        '<option value="">Select existing module (optional)</option>' +
        unique
          .map(
            (m, idx) =>
              `<option value="${idx}">${m.name}${m.code ? " (" + m.code + ")" : ""}${m.credits ? " - " + m.credits + " credits" : ""}</option>`
          )
          .join("");
      existingSelect.onchange = () => {
        if (!existingSelect.value) return;
        const m = unique[parseInt(existingSelect.value, 10)];
        if (!m) return;
        const nameEl = document.getElementById("gpa-mod-name");
        const codeEl = document.getElementById("gpa-mod-code");
        const creditsEl = document.getElementById("gpa-mod-credits");
        const yearEl = document.getElementById("gpa-mod-academic-year");
        const semInYearEl = document.getElementById("gpa-mod-semester-in-year");
        const semEl = document.getElementById("gpa-mod-semester");
        const uniEl = document.getElementById("gpa-mod-university");
        if (nameEl) nameEl.value = m.name || "";
        if (codeEl) codeEl.value = normalizeCode(m.code || "");
        if (creditsEl) creditsEl.value = m.credits || "";
        if (yearEl) yearEl.value = m.academic_year || 1;
        if (semInYearEl) semInYearEl.value = m.semester_in_year || 1;
        if (semEl) semEl.value = m.semester || (((m.academic_year || 1) - 1) * 2 + (m.semester_in_year || 1));
        if (uniEl && m.university_id) uniEl.value = String(m.university_id);
      };
    }

    tbody.querySelectorAll("[data-delete-module]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await del("/modules/" + btn.getAttribute("data-delete-module"));
        loadGpaPage();
      });
    });
    tbody.querySelectorAll("[data-save-ca]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const moduleId = btn.getAttribute("data-save-ca");
        const input = tbody.querySelector(`[data-ca-input="${moduleId}"]`);
        const ca = input?.value === "" ? null : parseInt(input?.value, 10);
        if (ca != null && (isNaN(ca) || ca < 0 || ca > 100)) {
          alert("CA percentage must be between 0 and 100");
          return;
        }
        const res = await put("/modules/" + moduleId, { ca_percentage: ca });
        if (res?.error) {
          alert(res.error);
          return;
        }
        loadGpaPage();
      });
    });

    // Prefill goal planner with current totals
    let totalCreditsCompleted = 0;
    let totalPoints = 0;
    modules.forEach((m) => {
      if (m.grade_point != null) {
        totalCreditsCompleted += m.credits;
        totalPoints += m.grade_point * m.credits;
      }
    });
    const creditsPerModuleInput = document.getElementById("goal-credits-per-module-input");
    if (creditsPerModuleInput && modules.length > 0) {
      const avg = modules.reduce((acc, m) => acc + (parseInt(m.credits, 10) || 0), 0) / modules.length;
      creditsPerModuleInput.value = Math.max(1, Math.round(avg));
    }
  }

  function initGpaFormAndGoalPlanner() {
    const form = document.getElementById("gpa-add-form");
    if (form) {
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const name = (document.getElementById("gpa-mod-name").value || "").trim();
        const code = normalizeCode(document.getElementById("gpa-mod-code").value || "");
        const universityId = document.getElementById("gpa-mod-university")?.value || "";
        const academicYear = parsePositiveInt(document.getElementById("gpa-mod-academic-year")?.value);
        const semesterInYear = parsePositiveInt(document.getElementById("gpa-mod-semester-in-year")?.value);
        const credits = parseInt(document.getElementById("gpa-mod-credits").value, 10);
        const caPercentage = document.getElementById("gpa-mod-ca").value ? parseInt(document.getElementById("gpa-mod-ca").value, 10) : null;
        const gradeLetter = document.getElementById("gpa-mod-grade").value;
        const semester = parseInt(document.getElementById("gpa-mod-semester").value, 10) || (academicYear && semesterInYear ? ((academicYear - 1) * 2 + semesterInYear) : 1);
        const grade_point = gradeLetter ? (GRADE_POINTS[gradeLetter] ?? null) : null;
//GPA VALIDATION
        if (!name || name.length > 255) {
          alert("Module name is required (1–255 characters)");
          return;
        }
        if (!code) {
          alert("Module code is required");
          return;
        }
        if (!universityId) {
          alert("Please select university");
          return;
        }
        if (!academicYear || academicYear < 1 || academicYear > 10) {
          alert("Academic year must be between 1 and 10");
          return;
        }
        if (!semesterInYear || semesterInYear < 1 || semesterInYear > 3) {
          alert("Semester must be between 1 and 3");
          return;
        }
        if (isNaN(credits) || credits < 1 || credits > 30) {
          alert("Credits must be between 1 and 30");
          return;
        }
        if (caPercentage != null && (caPercentage < 0 || caPercentage > 100)) {
          alert("CA percentage must be between 0 and 100");
          return;
        }
        if (semester < 1 || semester > 20) {
          alert("Semester must be between 1 and 20");
          return;
        }

        const res = await post("/modules", {
          user_id: currentUser.id,
          university_id: universityId,
          academic_year: academicYear,
          semester_in_year: semesterInYear,
          name,
          code,
          credits,
          grade_letter: gradeLetter || null,
          grade_point,
          ca_percentage: caPercentage,
          semester,
        });
        if (res && res.error) {
          alert(res.error);
          return;
        }
        if (res && res.updated) {
          alert("Existing module record was updated for this module code.");
        }
        form.reset();
        document.getElementById("gpa-mod-semester").value = 1;
        document.getElementById("gpa-mod-academic-year").value = 1;
        document.getElementById("gpa-mod-semester-in-year").value = 1;
        const existingSelect = document.getElementById("gpa-existing-module-select");
        if (existingSelect) existingSelect.value = "";
        loadGpaPage();
        trackUsage("module_add", "gpa", { credits, semester });
      });
    }

    const calcBtn = document.getElementById("calculate-goal-btn");
    const resultEl = document.getElementById("goal-planner-result");
    const goalInputs = [
      "target-gpa-input",
      "goal-academic-year-input",
      "goal-semester-input",
      "goal-module-count-input",
      "goal-credits-per-module-input"
    ];

    const calculateGoal = () => {
      const targetGpa = parseFloat(document.getElementById("target-gpa-input").value);
      const goalAcademicYear = parsePositiveInt(document.getElementById("goal-academic-year-input").value);
      const goalSemester = parsePositiveInt(document.getElementById("goal-semester-input").value);
      const moduleCount = parsePositiveInt(document.getElementById("goal-module-count-input").value, 0);
      const creditsPerModule = parsePositiveInt(document.getElementById("goal-credits-per-module-input").value, 3) || 3;
      let completedCredits = 0;
      let currentPoints = 0;
      const tableRows = Array.from(document.querySelectorAll("#gpa-modules-tbody tr"));
      tableRows.forEach((row) => {
        const creditsText = row.children?.[2]?.textContent || "0";
        const gradeText = row.children?.[4]?.textContent || "";
        const credits = parseInt(creditsText, 10) || 0;
        const gp = GRADE_POINTS[gradeText] != null ? GRADE_POINTS[gradeText] : null;
        if (gp != null) {
          completedCredits += credits;
          currentPoints += gp * credits;
        }
      });
      const totalCredits = completedCredits + moduleCount * creditsPerModule;

      if (!targetGpa || !goalAcademicYear || !goalSemester || !moduleCount) {
        resultEl.classList.add("hidden");
        return;
      }

      try {
        const result = calculateTargetPlan({
          targetGpa,
          totalCredits,
          completedCredits,
          currentPoints,
          totalModules: moduleCount
        });

        if (result.message) {
          resultEl.innerHTML = `<p>${result.message}</p>`;
          resultEl.classList.remove("hidden");
          return;
        }

        resultEl.innerHTML = `
          <h4>To achieve GPA ${targetGpa}:</h4>
          <p>Academic Year ${goalAcademicYear}, Semester ${goalSemester}</p>
          <div class="goal-result-grid">
            <div class="goal-item">
              <div class="label">Remaining GPA needed</div>
              <div class="value">${result.requiredRemainingGPA}</div>
            </div>
            <div class="goal-item">
              <div class="label">Target Grade</div>
              <div class="value">${result.suggestedGrade}</div>
            </div>
            <div class="goal-item">
              <div class="label">Required CA% per module</div>
              <div class="value">${result.requiredCA}</div>
            </div>
            <div class="goal-item">
              <div class="label">Required grade per module</div>
              <div class="value">${result.suggestedGrade}</div>
            </div>
            <div class="goal-item">
              <div class="label">Required CGPA</div>
              <div class="value">${result.requiredCgpa}</div>
            </div>
            <div class="goal-item">
              <div class="label">Required points per module</div>
              <div class="value">${result.perModulePoints ?? "–"}</div>
            </div>
            <div class="goal-item">
              <div class="label">Total points needed from remaining modules</div>
              <div class="value">${result.remainingPoints}</div>
            </div>
          </div>
          <p class="goal-note">This is an estimate. Actual grades depend on your final exam performance and CA weighting.</p>
        `;
        resultEl.classList.remove("hidden");
      } catch (error) {
        resultEl.innerHTML = `<p>${error.message}</p>`;
        resultEl.classList.remove("hidden");
      }
    };

    if (calcBtn && resultEl) {
      calcBtn.addEventListener("click", calculateGoal);
      
      // Auto-calculate when inputs change
      goalInputs.forEach(inputId => {
        const input = document.getElementById(inputId);
        if (input) {
          input.addEventListener("input", calculateGoal);
        }
      });
    }
  }


  // ==============================
  // Repeat & Improvement (charts, record improvement, remove entries)
  // ==============================

  async function loadRepeat() {
    if (!currentUser) return;
    const [modules, universities] = await Promise.all([
      get("/users/" + currentUser.id + "/modules"),
      get("/universities").catch(() => []),
    ]);

    const repeatCandidates = modules.filter(
      (m) => Boolean(m.is_repeat) || isGradeBelowC(m.grade_letter) || m.source_type === "repeat_add"
    );
    const repeatCount = repeatCandidates.length;
    const normalCount = modules.length - repeatCount;

    const barCtx = document.getElementById("page-repeatChart");
    if (barCtx) {
      if (pageRepeatBarChart) pageRepeatBarChart.destroy();
      pageRepeatBarChart = new Chart(barCtx, {
        type: "bar",
        data: {
          labels: ["Target (0 repeats)", "Current repeats"],
          datasets: [{ label: "Count", data: [0, repeatCount], backgroundColor: ["#00c9a7", "#f59e0b"] }],
        },
        options: { responsive: true, maintainAspectRatio: true, plugins: { title: { display: true, text: "Target vs current repeat modules" } } },
      });
    }

    const pieCtx = document.getElementById("repeat-pie-chart");
    if (pieCtx) {
      if (repeatPieChart) repeatPieChart.destroy();
      repeatPieChart = new Chart(pieCtx, {
        type: "pie",
        data: {
          labels: ["Normal", "Repeat"],
          datasets: [{ data: [normalCount, repeatCount], backgroundColor: ["#00c9a7", "#f59e0b"] }],
        },
        options: { responsive: true, maintainAspectRatio: true },
      });
    }

    // Record improvement: populate module dropdown
    const improveSelect = document.getElementById("repeat-improve-module");
    if (improveSelect) {
      improveSelect.innerHTML = '<option value="">Select module</option>' +
        repeatCandidates.map((m) => `<option value="${m.id}">${m.name}${m.code ? " (" + m.code + ")" : ""} — ${m.grade_letter || "–"}</option>`).join("");
    }
    const repeatAddUni = document.getElementById("repeat-add-university");
    if (repeatAddUni) {
      repeatAddUni.innerHTML =
        '<option value="">Select university</option>' +
        universities.map((u) => `<option value="${u.id}">${u.name}</option>`).join("");
    }
//ERROR HANDLING
    const academicHistoryModules = repeatCandidates;
    const tbody = document.getElementById("repeat-modules-tbody");
    tbody.innerHTML = academicHistoryModules.length
      ? academicHistoryModules
          .map(
            (m) =>
              `<tr>
                <td>${m.name}</td><td>${m.code || "–"}</td><td>${m.credits}</td><td>${m.grade_letter || "–"}</td><td>${m.academic_year || "–"} / ${m.semester_in_year || "–"}</td>
                <td>${m.is_repeat ? "Yes" : "No"}</td>
                <td class="actions">
                  <button type="button" class="btn btn-ghost btn-small" data-repeat-improve="${m.id}">Improve</button>
                  <button type="button" class="btn btn-ghost btn-small btn-danger-outline" data-repeat-remove="${m.id}">Remove</button>
                </td>
              </tr>`
          )
          .join("")
      : "<tr><td colspan=\"7\">No modules. Add modules in GPA Calculator first.</td></tr>";

    // Improve button: select this module in the form
    tbody.querySelectorAll("[data-repeat-improve]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-repeat-improve");
        if (improveSelect) improveSelect.value = id;
        document.getElementById("repeat-improve-grade")?.focus();
      });
    });

    // Remove button: confirm and delete
    tbody.querySelectorAll("[data-repeat-remove]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-repeat-remove");
        if (!confirm("Remove this entry from your academic history? This cannot be undone.")) return;
        await del("/modules/" + id);
        loadRepeat();
        loadDashboard();
        trackUsage("module_remove", "repeat", { module_id: id });
      });
    });
  }

  function initRepeatImprovementForm() {
    const form = document.getElementById("repeat-record-improvement-form");
    if (!form) return;
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const moduleId = document.getElementById("repeat-improve-module")?.value;
      const gradeLetter = document.getElementById("repeat-improve-grade")?.value;
      const noLongerRepeat = document.getElementById("repeat-improve-no-longer-repeat")?.checked !== false;
      if (!moduleId || !gradeLetter) {
        alert("Select a module and new grade.");
        return;
      }
      if (!GRADE_POINTS[gradeLetter] && gradeLetter !== "F") {
        alert("Please select a valid grade.");
        return;
      }
      const gradePoint = GRADE_POINTS[gradeLetter] ?? null;
      const res = await put("/modules/" + moduleId, {
        grade_letter: gradeLetter,
        grade_point: gradePoint,
        is_repeat: noLongerRepeat ? 0 : 1,
      });
      if (res && res.error) {
        alert(res.error);
        return;
      }
      form.reset();
      document.getElementById("repeat-improve-no-longer-repeat").checked = true;
      loadRepeat();
      loadDashboard();
      trackUsage("repeat_improve", "repeat", { module_id: moduleId, grade_letter: gradeLetter, no_longer_repeat: noLongerRepeat });
    });
  }

  function initRepeatAddModuleForm() {
    const form = document.getElementById("repeat-add-module-form");
    if (!form || form.dataset.bound) return;
    form.dataset.bound = "1";
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const university_id = document.getElementById("repeat-add-university")?.value || "";
      const academic_year = parsePositiveInt(document.getElementById("repeat-add-academic-year")?.value);
      const semester_in_year = parsePositiveInt(document.getElementById("repeat-add-semester-in-year")?.value);
      const name = (document.getElementById("repeat-add-module-name")?.value || "").trim();
      const code = normalizeCode(document.getElementById("repeat-add-module-code")?.value || "");
      const credits = parseInt(document.getElementById("repeat-add-credits")?.value, 10);
      if (!university_id || !academic_year || !semester_in_year || !name || !code || isNaN(credits)) {
        return alert("Fill all module fields.");
      }
      const semester = (academic_year - 1) * 2 + semester_in_year;
      const res = await post("/modules", {
        user_id: currentUser.id,
        university_id,
        academic_year,
        semester_in_year,
        source_type: "repeat_add",
        name,
        code,
        credits,
        semester,
        is_repeat: 1,
      });
      if (res?.error) return alert(res.error);
      if (res?.updated) alert("Existing module record was updated for this module code.");
      form.reset();
      document.getElementById("repeat-add-academic-year").value = 1;
      document.getElementById("repeat-add-semester-in-year").value = 1;
      document.getElementById("repeat-add-credits").value = 3;
      await loadRepeat();
      await loadDashboard();
    });
  }

  initRepeatImprovementForm();
  initRepeatAddModuleForm();

  // ==============================
  // Auth form listeners
  // ==============================

  document.getElementById("login-form").addEventListener("submit", login);
  document.getElementById("register-form").addEventListener("submit", register);

  document.getElementById("show-register").addEventListener("click", (e) => {
    e.preventDefault();
    document.getElementById("auth-screen").classList.add("hidden");
    document.getElementById("register-screen").classList.remove("hidden");
  });
  document.getElementById("show-login").addEventListener("click", (e) => {
    e.preventDefault();
    document.getElementById("register-screen").classList.add("hidden");
    document.getElementById("auth-screen").classList.remove("hidden");
  });

  // ==============================
  // Init form listeners (run once; they use currentUser on submit)
  // ==============================

  initGpaFormAndGoalPlanner();
  initAttendance();
  initTasksForm();
  tryResumeSession();
})();
