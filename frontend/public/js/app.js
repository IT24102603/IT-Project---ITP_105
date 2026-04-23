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


    // Dashboard attendance chart (from attendance logs: includes delivery_mode)
    const attData = await get("/users/" + currentUser.id + "/attendance-logs").catch(() => []);
    const attLabels = attData.map((a) => `${a.module_name}${a.delivery_mode === "online" ? " (Online)" : " (Physical)"}`);
    const attValues = attData.map((a) => Math.round((a.attended / (a.total_sessions || 1)) * 100));
    const dashAttCtx = document.getElementById("dashboard-attendanceChart");
    if (dashAttCtx) {
      if (dashboardAttendanceChart) dashboardAttendanceChart.destroy();
      dashboardAttendanceChart = new Chart(dashAttCtx, {
        type: "bar",
        data: {
          labels: attLabels,
          datasets: [
            {
              label: "Attendance %",
              data: attValues,
              backgroundColor: attData.map((a) => (a.delivery_mode === "online" ? "rgba(59,130,246,0.6)" : "rgba(0,201,167,0.6)")),
            },
          ],
        },
        options: { responsive: true, maintainAspectRatio: true },
      });
    }

    // Dashboard repeat chart (pie)
    const modules = gpaData.modules || [];
    const repeatCount = modules.filter((m) => m.is_repeat).length;
    const normalCount = modules.length - repeatCount;
    const dashRepeatCtx = document.getElementById("dashboard-repeatChart");
    if (dashRepeatCtx) {
      if (dashboardRepeatChart) dashboardRepeatChart.destroy();
      dashboardRepeatChart = new Chart(dashRepeatCtx, {
        type: "pie",
        data: {
          labels: ["Normal", "Repeat"],
          datasets: [{ data: [normalCount, repeatCount], backgroundColor: ["#00c9a7", "#f59e0b"] }],
        },
        options: { responsive: true, maintainAspectRatio: true },
      });
    }

    // Recent modules table
    const tbody = document.getElementById("dashboard-modules");
    const recent = currentSemesterModules.slice(-10).reverse();
    tbody.innerHTML = recent.length
      ? recent
          .map(
            (m) =>
              `<tr><td>${m.name}</td><td>${m.credits}</td><td>${m.grade_letter || "–"}</td><td>${m.semester || 1}</td></tr>`
          )
          .join("")
      : "<tr><td colspan=\"4\">No modules yet</td></tr>";

    // Timetables table
    const ttBody = document.getElementById("dashboard-timetables-tbody");
    if (ttBody) {
      const rows = timetables || [];
      ttBody.innerHTML = rows.length
        ? rows
            .map((t) => {
              const fileName = t.file_path ? String(t.file_path).split(/[\\\\/]/).pop() : "";
              const fileUrl = fileName ? "/uploads/" + fileName : null;
              return `
                <tr>
                  <td>${t.university_name || "—"}</td>
                  <td>${t.semester || "—"}</td>
                  <td>${t.academic_year || t.year_number || "—"}</td>
                  <td>${fileUrl ? `<a href="${fileUrl}" target="_blank">View PDF</a> | <a href="${fileUrl}" target="_blank" download>Download</a>` : "—"}</td>
                  <td>${t.created_at ? String(t.created_at).slice(0, 10) : "—"}</td>
                </tr>
              `;
            })
            .join("")
        : "<tr><td colspan=\"5\">No timetable uploads yet</td></tr>";
    }
  }

  // ==============================
  // Attendance (modules dropdown + add module)
  // ==============================

  async function loadAttendancePage() {
    if (!currentUser) return;
    const [modules, attendanceLogs, universities] = await Promise.all([
      get("/users/" + currentUser.id + "/modules"),
      get("/users/" + currentUser.id + "/attendance-logs"),
      get("/universities"),
    ]);

    attendanceUniversities = universities || [];
    const attendance = attendanceLogs || [];

    const uniSelect = document.getElementById("attendance-university-select");
    const addModuleUniSelect = document.getElementById("attendance-module-university");
    if (uniSelect) {
      uniSelect.innerHTML =
        '<option value="">Select university</option>' +
        attendanceUniversities
          .map((u) => `<option value="${u.id}">${u.name}</option>`)
          .join("");
      selectedAttendanceUniversityId = attendanceUniversities.length ? attendanceUniversities[0].id : null;
      if (selectedAttendanceUniversityId) uniSelect.value = String(selectedAttendanceUniversityId);
    }
    if (addModuleUniSelect) {
      addModuleUniSelect.innerHTML =
        '<option value="">Select university</option>' +
        attendanceUniversities.map((u) => `<option value="${u.id}">${u.name}</option>`).join("");
      if (selectedAttendanceUniversityId) addModuleUniSelect.value = String(selectedAttendanceUniversityId);
    }

    const hallsSummaryEl = document.getElementById("attendance-halls-summary");
    const hallSelect = document.getElementById("attendance-hall-select");

    function filterModulesByYearSem() {
      const ay = parsePositiveInt(document.getElementById("attendance-slot-year")?.value);
      const sem = parsePositiveInt(document.getElementById("attendance-slot-semester")?.value);
      return (modules || []).filter((m) => {
        const my = parsePositiveInt(m.academic_year);
        const ms = parsePositiveInt(m.semester_in_year);
        if (!ay || !sem) return true;
        return my === ay && ms === sem;
      });
    }

    function renderAttendanceModuleDropdowns() {
      const filtered = filterModulesByYearSem();
      const select = document.getElementById("attendance-module-select");
      if (select) {
        select.innerHTML =
          '<option value="">Select module</option>' +
          filtered.map((m) => `<option value="${m.name}">${m.name}${m.code ? " (" + m.code + ")" : ""}</option>`).join("");
      }
      const slotModuleSelect = document.getElementById("attendance-slot-module-select");
      if (slotModuleSelect) {
        slotModuleSelect.innerHTML =
          '<option value="">Select module</option>' +
          filtered.map((m) => `<option value="${m.name}">${m.name}${m.code ? " (" + m.code + ")" : ""}</option>`).join("");
      }
    }
    renderAttendanceModuleDropdowns();
    const slotSemSel = document.getElementById("attendance-slot-semester");
    const slotYearSel = document.getElementById("attendance-slot-year");
    if (slotSemSel && !slotSemSel.dataset.moduleFilterBound) {
      slotSemSel.dataset.moduleFilterBound = "1";
      slotSemSel.addEventListener("change", renderAttendanceModuleDropdowns);
    }
    if (slotYearSel && !slotYearSel.dataset.moduleFilterBound) {
      slotYearSel.dataset.moduleFilterBound = "1";
      slotYearSel.addEventListener("change", renderAttendanceModuleDropdowns);
    }

    const tbody = document.getElementById("attendance-table");
    tbody.innerHTML = attendance.length
      ? attendance
          .map((a) => {
            const pct = Math.round((a.attended / (a.total_sessions || 1)) * 100);
            const modeLabel = a.delivery_mode === "online" ? " (Online)" : " (Physical)";
            return `<tr><td>${a.module_name}${modeLabel}</td><td>${a.attended}</td><td>${a.total_sessions}</td><td>${pct}%</td></tr>`;
          })
          .join("")
      : "<tr><td colspan=\"4\">No attendance records yet</td></tr>";

    const ctx = document.getElementById("page-attendanceChart");
    if (ctx) {
      if (pageAttendanceChart) pageAttendanceChart.destroy();
      pageAttendanceChart = new Chart(ctx, {
        type: "bar",
        data: {
          labels: attendance.map((a) => `${a.module_name}${a.delivery_mode === "online" ? " (Online)" : " (Physical)"}`),
          datasets: [
            {
              label: "Attendance %",
              data: attendance.map((a) => Math.round((a.attended / (a.total_sessions || 1)) * 100)),
              backgroundColor: attendance.map((a) =>
                a.delivery_mode === "online" ? "rgba(59,130,246,0.6)" : "rgba(0,201,167,0.6)"
              ),
            },
          ],
        },
        options: { responsive: true, maintainAspectRatio: true },
      });
    }
//GEOFENCE COORDIBNTION
    // Load halls for selected university (circle geofences)
    async function loadSelectedHalls() {
      if (!selectedAttendanceUniversityId) {
        attendanceHalls = [];
        if (hallsSummaryEl) hallsSummaryEl.textContent = "No halls configured";
        return;
      }
      attendanceHalls = await get("/universities/" + selectedAttendanceUniversityId + "/halls");
      if (hallsSummaryEl) {
        hallsSummaryEl.textContent = attendanceHalls.length
          ? `${attendanceHalls.length} lecture hall circle(s) configured`
          : "No halls configured for this university";
      }
      if (hallSelect) {
        hallSelect.innerHTML =
          '<option value="">Select hall</option>' +
          attendanceHalls
            .map((h) => `<option value="${h.id}">${h.hall_name}${h.building_name ? " (" + h.building_name + ")" : ""}</option>`)
            .join("");
      }

      const slotHallSelect = document.getElementById("attendance-slot-hall-select");
      if (slotHallSelect) {
        slotHallSelect.innerHTML =
          '<option value="">Select hall</option>' +
          attendanceHalls
            .map((h) => `<option value="${h.id}">${h.hall_name}${h.building_name ? " (" + h.building_name + ")" : ""}</option>`)
            .join("");
      }
    }

    if (uniSelect) {
      uniSelect.onchange = async () => {
        selectedAttendanceUniversityId = uniSelect.value ? parseInt(uniSelect.value, 10) : null;
        // Reset UI when changing geofence source
        document.getElementById("attendance-mark-section")?.classList.add("hidden");
        document.getElementById("geofence-outside-msg")?.classList.add("hidden");
        document.getElementById("geofence-status-card")?.classList.remove("within", "outside");
        document.getElementById("geofence-status-text").textContent = "Check your location to mark attendance";
        document.getElementById("geofence-status-detail").textContent = 'Tap "Check location" to verify you are inside a lecture hall circle';

        await loadSelectedHalls();
      };
    }

    await loadSelectedHalls();

    // Prefill slot semester/year from timetable upload inputs (if present)
    const timetableSemester = document.getElementById("attendance-timetable-semester")?.value;
    const timetableYear = document.getElementById("attendance-timetable-year")?.value;
    const slotSem = document.getElementById("attendance-slot-semester");
    const slotYear = document.getElementById("attendance-slot-year");
    if (slotSem && timetableSemester) slotSem.value = timetableSemester;
    if (slotYear && timetableYear) slotYear.value = timetableYear;
    renderAttendanceModuleDropdowns();
  }

  async function loadAttendance() {
    await loadAttendancePage();
  }

  function initAttendance() {
    const timetableForm = document.getElementById("attendance-timetable-upload-form");
    if (timetableForm && !timetableForm.dataset.bound) {
      timetableForm.dataset.bound = "1";
      timetableForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (currentUser?.role !== "student") {
          return alert("Only students can upload timetables.");
        }
        const universityId = document.getElementById("attendance-university-select")?.value;
        const semester = document.getElementById("attendance-timetable-semester")?.value || "";
        const yearNumber = document.getElementById("attendance-timetable-year")?.value || "";
        const fileInput = document.getElementById("attendance-timetable-file");
        const file = fileInput?.files?.[0];

        if (!universityId) return alert("Select a university first.");
        if (!semester.trim()) return alert("Enter semester.");
        if (!yearNumber || isNaN(parseInt(yearNumber, 10))) return alert("Enter a valid academic year.");
        if (!file) return alert("Select a PDF file.");

        const fd = new FormData();
        fd.append("user_id", currentUser.id);
        fd.append("university_id", universityId);
        fd.append("semester", semester.trim());
        fd.append("year_number", parseInt(yearNumber, 10));
        fd.append("file", file);

        const msgEl = document.getElementById("attendance-timetable-upload-msg");
        if (msgEl) {
          msgEl.classList.remove("hidden");
          msgEl.textContent = "Uploading...";
        }

        const resp = await fetch(API + "/attendance/timetable-pdfs", { method: "POST", body: fd, credentials: "include" });
        const json = await resp.json().catch(() => ({}));
        if (!resp.ok || json.error) {
          if (msgEl) msgEl.textContent = json.error || "Upload failed";
          return;
        }
        if (msgEl) msgEl.textContent = "Timetable uploaded successfully.";
        trackUsage("timetable_upload", "attendance", { university_id: universityId, semester, year_number: parseInt(yearNumber, 10) });
      });
    }

    // ==============================
    // Day-wise schedule slots
    // ==============================

    const slotAddForm = document.getElementById("attendance-slot-add-form");
    const slotsTbody = document.getElementById("attendance-slots-tbody");
    const slotSelect = document.getElementById("attendance-slot-select");
    const slotDaySelect = document.getElementById("attendance-slot-day");
    const slotModeSelect = document.getElementById("attendance-slot-mode");
    const slotHallGroup = document.getElementById("attendance-slot-hall-group");
    const slotHallSelect = document.getElementById("attendance-slot-hall-select");

    let attendanceSlotsForDay = [];

    function dayOfWeekFromDate(dateStr) {
      if (!dateStr) return "";
      const d = new Date(dateStr + "T00:00:00");
      if (isNaN(d.getTime())) return "";
      const idx = d.getDay(); // 0 Sun ... 6 Sat
      const map = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
      return map[idx] || "";
    }

    function syncSlotHallUI() {
      const mode = slotModeSelect?.value || "physical";
      if (slotHallGroup) slotHallGroup.classList.toggle("hidden", mode !== "physical");
    }

    if (slotModeSelect && !slotModeSelect.dataset.bound) {
      slotModeSelect.dataset.bound = "1";
      slotModeSelect.addEventListener("change", syncSlotHallUI);
      syncSlotHallUI();
    }

    async function refreshSlotsList() {
      if (!slotsTbody) return;
      const universityId = document.getElementById("attendance-university-select")?.value;
      const semester = document.getElementById("attendance-slot-semester")?.value || "";
      const yearNumber = document.getElementById("attendance-slot-year")?.value || "";
      if (!universityId || !semester || !yearNumber) {
        slotsTbody.innerHTML = "<tr><td colspan=\"5\">Select university, semester & year to view slots</td></tr>";
        return;
      }
      const rows = await get(
        `/attendance/slots?user_id=${currentUser.id}&university_id=${universityId}&semester=${semester}&year_number=${yearNumber}`
      ).catch(() => []);
      slotsTbody.innerHTML = rows.length
        ? rows
            .map(
              (s) => `
                <tr>
                  <td>${s.day_of_week}</td>
                  <td>${s.start_time} - ${s.end_time}</td>
                  <td>${s.module_name}</td>
                  <td>${s.delivery_mode}</td>
                  <td>${s.verification_status || "—"}</td>
                </tr>
              `
            )
            .join("")
        : "<tr><td colspan=\"5\">No slots yet</td></tr>";
    }

    async function refreshAttendanceSlotSelect() {
      if (!slotSelect) return;
      attendanceSlotsForDay = [];

      const universityId = document.getElementById("attendance-university-select")?.value;
      const lectureDate = document.getElementById("attendance-lecture-date")?.value;
      const semester = document.getElementById("attendance-semester")?.value;
      if (!universityId || !lectureDate || !semester) {
        slotSelect.innerHTML = '<option value="">Select slot</option>';
        return;
      }
      const yearNumber = parsePositiveInt(document.getElementById("attendance-academic-year")?.value);
      const day = dayOfWeekFromDate(lectureDate);
      if (!day || !yearNumber) {
        slotSelect.innerHTML = '<option value="">Select slot</option>';
        return;
      }

      const rows = await get(
        `/attendance/slots?user_id=${currentUser.id}&university_id=${universityId}&semester=${semester}&year_number=${yearNumber}&day_of_week=${encodeURIComponent(
          day
        )}`
      ).catch(() => []);
      attendanceSlotsForDay = rows;
      slotSelect.innerHTML = rows.length
        ? rows
            .map((s) => {
              const title = `${s.module_name} | ${s.start_time}-${s.end_time} | ${s.delivery_mode}`;
              const disabled = s.verification_status !== "auto_verified";
              return `<option value="${s.id}" ${disabled ? "disabled" : ""}>${title}</option>`;
            })
            .join("")
        : '<option value="">No slots available for this day</option>';
    }

    if (slotAddForm && !slotAddForm.dataset.bound) {
      slotAddForm.dataset.bound = "1";
      slotAddForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const universityId = document.getElementById("attendance-university-select")?.value;
        if (!universityId) return alert("Select university first.");
        const day = slotDaySelect?.value || "";
        const start_time = document.getElementById("attendance-slot-start")?.value || "";
        const end_time = document.getElementById("attendance-slot-end")?.value || "";
        const mode = slotModeSelect?.value || "physical";
        const module_name = document.getElementById("attendance-slot-module-select")?.value || "";
        const location_text = document.getElementById("attendance-slot-location")?.value || "";
        const semester = document.getElementById("attendance-slot-semester")?.value || "";
        const year_number = document.getElementById("attendance-slot-year")?.value || "";
        const hall_id = mode === "physical" ? slotHallSelect?.value || "" : "";

        if (!day || !start_time || !end_time || !module_name || !semester || !year_number) {
          return alert("Fill all slot fields correctly.");
        }
        const res = await post("/attendance/slots", {
          user_id: currentUser.id,
          university_id: universityId,
          semester,
          year_number,
          day_of_week: day,
          start_time,
          end_time,
          module_name,
          delivery_mode: mode,
          location_text: location_text || null,
          hall_id: hall_id || null,
        });
        if (res && res.error) return alert(res.error);
        await refreshSlotsList();
        await refreshAttendanceSlotSelect();
      });
    }

    if (slotSelect && !slotSelect.dataset.bound) {
      slotSelect.dataset.bound = "1";
      slotSelect.addEventListener("change", () => {
        const id = slotSelect.value;
        const slot = attendanceSlotsForDay.find((s) => String(s.id) === String(id));
        if (!slot) return;

        const modeSelect = document.getElementById("attendance-delivery-mode");
        if (modeSelect) {
          modeSelect.value = slot.delivery_mode === "online" ? "online" : "offline";
          modeSelect.dispatchEvent(new Event("change"));
        }
        const hallSelect = document.getElementById("attendance-hall-select");
        if (hallSelect) {
          hallSelect.value = slot.hall_id ? String(slot.hall_id) : "";
        }
        const moduleSelect = document.getElementById("attendance-module-select");
        if (moduleSelect) {
          moduleSelect.value = slot.module_name || "";
        }
      });
    }

    const lectureDateEl = document.getElementById("attendance-lecture-date");
    const semesterEl = document.getElementById("attendance-semester");
    if (lectureDateEl && !lectureDateEl.dataset.bound) {
      lectureDateEl.dataset.bound = "1";
      lectureDateEl.addEventListener("change", () => refreshAttendanceSlotSelect());
    }
    if (semesterEl && !semesterEl.dataset.bound) {
      semesterEl.dataset.bound = "1";
      semesterEl.addEventListener("change", () => refreshAttendanceSlotSelect());
    }
    const academicYearEl = document.getElementById("attendance-academic-year");
    if (academicYearEl && !academicYearEl.dataset.bound) {
      academicYearEl.dataset.bound = "1";
      academicYearEl.addEventListener("change", () => refreshAttendanceSlotSelect());
    }
    const uniSel = document.getElementById("attendance-university-select");
    if (uniSel && !uniSel.dataset.boundSlots) {
      uniSel.dataset.boundSlots = "1";
      uniSel.addEventListener("change", () => {
        refreshSlotsList();
        refreshAttendanceSlotSelect();
      });
    }

    // Initial load (if user already selected inputs)
    refreshSlotsList();
    refreshAttendanceSlotSelect();

    const addModuleForm = document.getElementById("attendance-add-module-form");
    if (addModuleForm && !addModuleForm.dataset.bound) {
      addModuleForm.dataset.bound = "1";
      addModuleForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const universityId = document.getElementById("attendance-module-university")?.value || "";
        const academicYear = parsePositiveInt(document.getElementById("attendance-module-academic-year")?.value);
        const semesterInYear = parsePositiveInt(document.getElementById("attendance-module-semester-in-year")?.value);
        const name = (document.getElementById("attendance-module-name").value || "").trim();
        const code = normalizeCode(document.getElementById("attendance-module-code").value || "");
        if (!universityId) return alert("Select university.");
        if (!academicYear || !semesterInYear) return alert("Enter academic year and semester.");
        if (!name || name.length > 255) {
          alert("Module name is required (1–255 characters)");
          return;
        }
        if (!code) return alert("Module code is required.");
        const res = await post("/modules", {
          user_id: currentUser.id,
          university_id: universityId,
          academic_year: academicYear,
          semester_in_year: semesterInYear,
          name,
          code,
          credits: 3,
          semester: (academicYear - 1) * 2 + semesterInYear,
        });
        if (res && res.error) {
          alert(res.error);
          return;
        }
        addModuleForm.reset();
        loadAttendancePage();
      });
    }

    const attForm = document.getElementById("attendance-form");
    if (attForm) {
      const modeSelect = document.getElementById("attendance-delivery-mode");
      const proofGroup = document.getElementById("attendance-online-proof-group");
      const hallGroup = document.getElementById("attendance-hall-group");
      const toggleModeUi = () => {
        const mode = modeSelect?.value || "offline";
        if (proofGroup) proofGroup.classList.toggle("hidden", mode !== "online");
        if (hallGroup) hallGroup.classList.toggle("hidden", mode === "online");
      };
      if (modeSelect && !modeSelect.dataset.bound) {
        modeSelect.dataset.bound = "1";
        modeSelect.addEventListener("change", toggleModeUi);
        toggleModeUi();
      }

      attForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const slot_id = document.getElementById("attendance-slot-select")?.value || "";
        const module_name = document.getElementById("attendance-module-select").value?.trim() || "";
        const total_sessions = parseInt(document.getElementById("attendance-total").value, 10) || 0;
        const attended = parseInt(document.getElementById("attendance-attended").value, 10) || 0;
        const semester = parseInt(document.getElementById("attendance-semester").value, 10) || null;
        const academic_year = parseInt(document.getElementById("attendance-academic-year").value, 10) || null;
        const delivery_mode = document.getElementById("attendance-delivery-mode")?.value || "offline";
        const hall_id = document.getElementById("attendance-hall-select")?.value || "";
        const lecture_date = document.getElementById("attendance-lecture-date")?.value || "";
        const proofFile = document.getElementById("attendance-online-proof")?.files?.[0] || null;
        if (!lecture_date) {
          alert("Select lecture date.");
          return;
        }
        if (!slot_id) {
          alert("Select a verified schedule slot.");
          return;
        }
        if (!module_name) {
          alert("Select a module");
          return;
        }
        if (total_sessions < 0 || attended < 0) {
          alert("Attended and total sessions must be 0 or greater");
          return;
        }
        if (attended > total_sessions) {
          alert("Attended cannot exceed total sessions");
          return;
        }
        if (delivery_mode === "offline" && !hall_id) {
          alert("Select lecture hall for offline attendance.");
          return;
        }
        if (delivery_mode === "online" && !proofFile) {
          alert("Upload proof for online lecture change.");
          return;
        }

        const fd = new FormData();
        fd.append("user_id", currentUser.id);
        fd.append("slot_id", slot_id);
        fd.append("module_name", module_name);
        fd.append("attended", attended);
        fd.append("total_sessions", total_sessions);
        if (semester != null) fd.append("semester", semester);
        if (academic_year != null) fd.append("academic_year", academic_year);
        fd.append("delivery_mode", delivery_mode);
        if (selectedAttendanceUniversityId) fd.append("university_id", selectedAttendanceUniversityId);
        if (hall_id) fd.append("hall_id", hall_id);
        if (lecture_date) fd.append("lecture_date", lecture_date);
        if (proofFile) fd.append("proof", proofFile);

        const resp = await fetch(API + "/attendance/mark", { method: "POST", body: fd, credentials: "include" });
        const res = await resp.json().catch(() => ({}));
        if (!resp.ok || (res && res.error)) {
          alert(res.error || "Attendance mark failed");
          return;
        }

        if (res.verification_status === "timetable_missing") {
          alert("Attendance submitted, but timetable verification failed. Upload your timetable PDF for this semester and wait for admin approval.");
        } else if (res.verification_status === "pending") {
          alert("Attendance submitted for admin verification (online lecture proof).");
        } else if (res.verification_status === "auto_verified") {
          alert("Attendance marked successfully and verified.");
        }
        attForm.reset();
        toggleModeUi();
        loadAttendancePage();
        loadDashboard();
        trackUsage("attendance_mark", "attendance", { module_name, delivery_mode });
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
  // Geofence (attendance) – circle based on admin-configured lecture halls
  // ==============================

  function initGeofence() {
    const checkBtn = document.getElementById("check-geofence-btn");
    const statusCard = document.getElementById("geofence-status-card");
    const statusText = document.getElementById("geofence-status-text");
    const statusDetail = document.getElementById("geofence-status-detail");
    const markSection = document.getElementById("attendance-mark-section");
    const outsideMsg = document.getElementById("geofence-outside-msg");

    if (!checkBtn) return;

    checkBtn.addEventListener("click", async () => {
      const mode = document.getElementById("attendance-delivery-mode")?.value || "offline";
      if (mode === "online") {
        statusCard.classList.remove("outside");
        statusCard.classList.add("within");
        statusText.textContent = "Online lecture mode enabled";
        statusDetail.textContent = "Geofence is not required for online lecture submissions. Upload proof and mark attendance.";
        if (markSection) markSection.classList.remove("hidden");
        if (outsideMsg) outsideMsg.classList.add("hidden");
        return;
      }

      checkBtn.disabled = true;
      checkBtn.textContent = "Checking...";
      statusText.textContent = "Verifying location...";
        statusDetail.textContent = "Getting your GPS position...";
      statusCard.classList.remove("within", "outside");

      const domUniId = parseInt(document.getElementById("attendance-university-select")?.value, 10);
      if (!domUniId || isNaN(domUniId)) {
        alert("Please select a university first.");
        checkBtn.disabled = false;
        checkBtn.textContent = "Check location";
        statusText.textContent = "Check your location to mark attendance";
      statusDetail.textContent = "Tap \"Check location\" after selecting a university to verify by GPS";
        return;
      }

      selectedAttendanceUniversityId = domUniId;
      attendanceHalls = await get("/universities/" + domUniId + "/halls").catch(() => []);
      if (!attendanceHalls || attendanceHalls.length === 0) {
        alert("No lecture hall geofences configured for this university yet.");
        checkBtn.disabled = false;
        checkBtn.textContent = "Check location";
        statusText.textContent = "Check your location to mark attendance";
        statusDetail.textContent = "Ask your admin to configure lecture hall circles.";
        return;
      }

      const onSuccess = (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        const selectedHallId = document.getElementById("attendance-hall-select")?.value || "";
        const restrictToHall = mode === "offline" && selectedHallId;

        let within = false;
        let nearestHall = null;
        let nearestDist = Infinity;

        for (const h of attendanceHalls) {
          if (restrictToHall && String(h.id) !== String(selectedHallId)) continue;
          const dist = haversineMeters(lat, lng, parseFloat(h.center_lat), parseFloat(h.center_lng));
          if (dist <= parseFloat(h.radius_m)) {
            within = true;
            if (dist < nearestDist) {
              nearestDist = dist;
              nearestHall = h;
            }
          }
        }

        statusCard.classList.add(within ? "within" : "outside");
        statusText.textContent = within ? "Within a lecture hall geofence ✓" : "Outside lecture hall geofences";
        statusDetail.textContent = within
          ? `You are inside: ${nearestHall.hall_name}${nearestHall.building_name ? " (" + nearestHall.building_name + ")" : ""}`
          : "Move within the designated lecture hall area and try again.";

        if (markSection) markSection.classList.toggle("hidden", !within);
        if (outsideMsg) outsideMsg.classList.toggle("hidden", within);

        if (within) trackUsage("attendance_geofence_ok", "attendance", { hall_id: nearestHall?.id || null, university_id: selectedAttendanceUniversityId });

        checkBtn.disabled = false;
        checkBtn.textContent = "Check location";
      };

      const onError = () => {
        statusCard.classList.add("outside");
        statusText.textContent = "Location unavailable";
        statusDetail.textContent = "Please enable location services and try again.";
        if (markSection) markSection.classList.add("hidden");
        if (outsideMsg) outsideMsg.classList.remove("hidden");
        checkBtn.disabled = false;
        checkBtn.textContent = "Check location";
      };

      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(onSuccess, onError, {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0,
        });
      } else {
        onError();
      }
    });
  }

  initGeofence();

  // ==============================
  // Logout
  // ==============================

  document.getElementById("logout-btn").addEventListener("click", () => {
    currentUser = null;
    post("/logout", {}).catch(() => {});
    document.getElementById("app").classList.add("hidden");
    document.getElementById("auth-screen").classList.remove("hidden");
    document.getElementById("register-screen").classList.add("hidden");
  });

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
