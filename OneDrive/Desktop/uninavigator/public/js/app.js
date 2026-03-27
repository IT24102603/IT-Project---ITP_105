(function () {
  const API = "http://localhost:3000";

  let currentUser = null;

  let dashboardAttendanceChart = null;
  let pageAttendanceChart = null;

  const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
    const res = await fetch(API + url);
    return await res.json();
  }

  async function post(url, data) {
    const res = await fetch(API + url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    return await res.json();
  }

  async function put(url, data) {
    const res = await fetch(API + url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    return await res.json();
  }

  async function patch(url, data) {
    const res = await fetch(API + url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    return await res.json();
  }

  async function del(url) {
    await fetch(API + url, { method: "DELETE" });
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


  function showApp() {
    document.getElementById("auth-screen").classList.add("hidden");
    document.getElementById("register-screen").classList.add("hidden");
    document.getElementById("app").classList.remove("hidden");

    const sidebarName = document.getElementById("sidebar-name");
    const sidebarEmail = document.getElementById("sidebar-email");
    if (sidebarName) sidebarName.textContent = currentUser.name || "Student";
    if (sidebarEmail) sidebarEmail.textContent = currentUser.email || "";

    loadDashboard();
    loadAttendance();
    initNavigation();
  }


  function showPage(pageId) {
    document.querySelectorAll(".page").forEach((p) => p.classList.remove("active"));
    document.querySelectorAll(".nav-link").forEach((l) => l.classList.remove("active"));
    const page = document.getElementById("page-" + pageId);
    const link = document.querySelector('.nav-link[data-page="' + pageId + '"]');
    if (page) page.classList.add("active");
    if (link) link.classList.add("active");

    if (pageId === "attendance") loadAttendancePage();
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

    const profile = await get("/users/" + currentUser.id + "/profile").catch(() => currentUser);

    const targetAtt = profile.target_attendance != null ? profile.target_attendance : 80;

    document.getElementById("dashboard-name").textContent = profile.name || currentUser.name || "Student";
    document.getElementById("dashboard-index").textContent = profile.index_number ? "Index: " + profile.index_number : "–";
    document.getElementById("dashboard-email").textContent = profile.email || currentUser.email || "–";

    const picEl = document.getElementById("profile-pic");
    if (picEl && (profile.profile_pic || currentUser.profile_pic)) {
      picEl.src = profile.profile_pic || currentUser.profile_pic;
    }

    document.getElementById("dashboard-target-attendance").textContent = targetAtt + "%";

    // Notification (deadline alerts) prefs


    // Goals edit
    const editBtn = document.getElementById("edit-goals-btn");
    const editFields = document.getElementById("goals-edit-fields");
    const saveBtn = document.getElementById("save-goals-btn");
    if (editBtn && editFields) {
      editBtn.onclick = () => {
        editFields.classList.toggle("hidden");
        if (!editFields.classList.contains("hidden")) {
          document.getElementById("edit-target-attendance").value = targetAtt !== "–" ? targetAtt : 80;
        }
      };
    }
    if (saveBtn) {
      saveBtn.onclick = async () => {
        const ta = parseInt(document.getElementById("edit-target-attendance").value, 10);
        if (!isNaN(ta) && (ta < 0 || ta > 100)) {
          alert("Target attendance must be between 0 and 100");
          return;
        }
        const res = await put("/users/" + currentUser.id + "/profile", {
          target_attendance: isNaN(ta) ? 80 : ta,
        });
        if (res && res.error) {
          alert(res.error);
          return;
        }
        currentUser.target_attendance = ta;
        editFields.classList.add("hidden");
        loadDashboard();
      };
    }

    // Profile picture upload
    const uploadPic = document.getElementById("upload-pic");
    if (uploadPic) {
      uploadPic.onchange = async (e) => {
        const file = e.target.files?.[0];
        if (!file || !file.type.startsWith("image/")) return;
        const reader = new FileReader();
        reader.onload = async () => {
          const base64 = reader.result;
          await put("/users/" + currentUser.id + "/profile", { profile_pic: base64 });
          currentUser.profile_pic = base64;
          if (picEl) picEl.src = base64;
        };
        reader.readAsDataURL(file);
      };
    }


    // Dashboard attendance chart (from attendance data)
    const attData = await get("/users/" + currentUser.id + "/attendance");
    const attLabels = attData.map((a) => a.module_name);
    const attValues = attData.map((a) => Math.round((a.attended / (a.total_sessions || 1)) * 100));
    const dashAttCtx = document.getElementById("dashboard-attendanceChart");
    if (dashAttCtx) {
      if (dashboardAttendanceChart) dashboardAttendanceChart.destroy();
      dashboardAttendanceChart = new Chart(dashAttCtx, {
        type: "bar",
        data: {
          labels: attLabels,
          datasets: [{ label: "Attendance %", data: attValues, backgroundColor: "rgba(0,201,167,0.6)" }],
        },
        options: { responsive: true, maintainAspectRatio: true },
      });
    }

  }


  // ==============================
  // Attendance (modules dropdown + add module)
  // ==============================

  async function loadAttendancePage() {
    if (!currentUser) return;
    const [modules, attendance] = await Promise.all([
      get("/users/" + currentUser.id + "/modules"),
      get("/users/" + currentUser.id + "/attendance"),
    ]);

    const select = document.getElementById("attendance-module-select");
    select.innerHTML = '<option value="">Select module</option>' + modules.map((m) => `<option value="${m.name}">${m.name}${m.code ? " (" + m.code + ")" : ""}</option>`).join("");

    const tbody = document.getElementById("attendance-table");
    tbody.innerHTML = attendance.length
      ? attendance
          .map((a) => {
            const pct = Math.round((a.attended / (a.total_sessions || 1)) * 100);
            return `<tr><td>${a.module_name}</td><td>${a.attended}</td><td>${a.total_sessions}</td><td>${pct}%</td></tr>`;
          })
          .join("")
      : "<tr><td colspan=\"4\">No attendance records yet</td></tr>";

    const ctx = document.getElementById("page-attendanceChart");
    if (ctx) {
      if (pageAttendanceChart) pageAttendanceChart.destroy();
      pageAttendanceChart = new Chart(ctx, {
        type: "bar",
        data: {
          labels: attendance.map((a) => a.module_name),
          datasets: [{ label: "Attendance %", data: attendance.map((a) => Math.round((a.attended / (a.total_sessions || 1)) * 100)), backgroundColor: "rgba(0,201,167,0.6)" }],
        },
        options: { responsive: true, maintainAspectRatio: true },
      });
    }
  }

  async function loadAttendance() {
    await loadAttendancePage();
  }

  function initAttendance() {
    const addModuleForm = document.getElementById("attendance-add-module-form");
    if (addModuleForm) {
      addModuleForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const name = (document.getElementById("attendance-module-name").value || "").trim();
        const code = (document.getElementById("attendance-module-code").value || "").trim();
        if (!name || name.length > 255) {
          alert("Module name is required (1–255 characters)");
          return;
        }
        const res = await post("/modules", {
          user_id: currentUser.id,
          name,
          code,
          credits: 3,
          semester: 1,
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
      attForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const module_name = document.getElementById("attendance-module-select").value?.trim() || "";
        const total_sessions = parseInt(document.getElementById("attendance-total").value, 10) || 0;
        const attended = parseInt(document.getElementById("attendance-attended").value, 10) || 0;
        const semester = parseInt(document.getElementById("attendance-semester").value, 10) || null;
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
        const res = await post("/attendance", {
          user_id: currentUser.id,
          module_name,
          attended,
          total_sessions,
          semester,
        });
        if (res && res.error) {
          alert(res.error);
          return;
        }
        attForm.reset();
        loadAttendancePage();
        loadDashboard();
      });
    }
  }


  // ==============================
  // Delete Profile
  // ==============================

  const deleteOverlay = document.getElementById("delete-profile-overlay");
  const deleteConfirmBtn = document.getElementById("delete-profile-confirm");
  const deleteCancelBtn = document.getElementById("delete-profile-cancel");

  document.getElementById("delete-profile-btn").addEventListener("click", () => {
    if (deleteOverlay) deleteOverlay.classList.add("active");
  });

  if (deleteCancelBtn) {
    deleteCancelBtn.addEventListener("click", () => {
      if (deleteOverlay) deleteOverlay.classList.remove("active");
    });
  }

  if (deleteOverlay) {
    deleteOverlay.addEventListener("click", (e) => {
      if (e.target === deleteOverlay) deleteOverlay.classList.remove("active");
    });
  }

  if (deleteConfirmBtn) {
    deleteConfirmBtn.addEventListener("click", async () => {
      try {
        await del("/users/" + currentUser.id);
        currentUser = null;
        document.getElementById("app").classList.add("hidden");
        document.getElementById("auth-screen").classList.remove("hidden");
        document.getElementById("register-screen").classList.add("hidden");
        if (deleteOverlay) deleteOverlay.classList.remove("active");
      } catch (err) {
        alert("Failed to delete profile. Please try again.");
      }
    });
  }

  // ==============================
  // Geofence (attendance) – mock until backend ready
  // ==============================

  function initGeofence() {
    const checkBtn = document.getElementById("check-geofence-btn");
    const statusCard = document.getElementById("geofence-status-card");
    const statusText = document.getElementById("geofence-status-text");
    const statusDetail = document.getElementById("geofence-status-detail");
    const markSection = document.getElementById("attendance-mark-section");
    const outsideMsg = document.getElementById("geofence-outside-msg");

    if (!checkBtn) return;

    checkBtn.addEventListener("click", () => {
      checkBtn.disabled = true;
      checkBtn.textContent = "Checking...";
      statusText.textContent = "Verifying location...";
      statusDetail.textContent = "Getting your position...";
      statusCard.classList.remove("within", "outside");

      // Mock: use geolocation, then simulate geofence check
      // When backend is ready, replace with: post("/geofence/check", { lat, lng, module_id })
      const checkGeofence = (lat, lng) => {
        // Placeholder: always "within" for demo. Backend will validate against stored geofence bounds.
        return true;
      };

      const onSuccess = (position) => {
        const within = checkGeofence(position.coords.latitude, position.coords.longitude);
        statusCard.classList.add(within ? "within" : "outside");
        statusText.textContent = within ? "Within geofence ✓" : "Outside geofence";
        statusDetail.textContent = within
          ? "You can mark attendance now."
          : "Move within the class area and try again.";
        if (markSection) markSection.classList.toggle("hidden", !within);
        if (outsideMsg) outsideMsg.classList.toggle("hidden", within);
        checkBtn.disabled = false;
        checkBtn.textContent = "Check location";
      };

      const onError = () => {
        // Fallback: allow marking for demo when location unavailable (e.g. desktop)
        statusCard.classList.add("within");
        statusText.textContent = "Within geofence ✓ (demo mode)";
        statusDetail.textContent = "Location unavailable. Demo mode: you can mark attendance.";
        if (markSection) markSection.classList.remove("hidden");
        if (outsideMsg) outsideMsg.classList.add("hidden");
        checkBtn.disabled = false;
        checkBtn.textContent = "Check location";
      };

      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(onSuccess, onError, { timeout: 5000 });
      } else {
        onError();
      }
    });
  }

  initGeofence();

  // ==============================
  // PDF Report
  // ==============================

  document.getElementById("download-report").addEventListener("click", () => {
    window.open(API + "/users/" + currentUser.id + "/report.pdf", "_blank");
  });

  // ==============================
  // Logout
  // ==============================

  document.getElementById("logout-btn").addEventListener("click", () => {
    currentUser = null;
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

  initAttendance();
})();
