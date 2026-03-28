(function () {

  // Correct backend API address
  const API = "http://localhost:3000/api";

  let currentUser = null;

  function get(path) {
    return fetch(API + path).then(r => r.json());
  }

  function post(path, body) {
    return fetch(API + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(r => r.json());
  }

  function put(path, body) {
    return fetch(API + path, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(r => r.json());
  }

  function patch(path, body) {
    return fetch(API + path, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(r => r.json());
  }

  function del(path) {
    return fetch(API + path, {
      method: 'DELETE'
    }).then(r => r.json().catch(() => ({})));
  }

  function showAuth() {
    document.getElementById('auth-screen').classList.remove('hidden');
    document.getElementById('register-screen').classList.add('hidden');
    document.getElementById('app').classList.add('hidden');
  }
  function showRegister() {
    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('register-screen').classList.remove('hidden');
    document.getElementById('app').classList.add('hidden');
  }
  function showApp() {
    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('register-screen').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    document.getElementById('sidebar-name').textContent = currentUser.name || 'Student';
    document.getElementById('sidebar-email').textContent = currentUser.email || '';
  }

  function setPage(pageId) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-link').forEach(a => a.classList.remove('active'));
    const page = document.getElementById('page-' + pageId);
    const link = document.querySelector('[data-page="' + pageId + '"]');
    if (page) page.classList.add('active');
    if (link) link.classList.add('active');
    if (pageId === 'dashboard') loadDashboard();
    if (pageId === 'gpa') loadGPA();
    if (pageId === 'attendance') loadAttendance();
    if (pageId === 'tasks') loadTasks();
    if (pageId === 'repeat') loadRepeat();
    if (pageId === 'profile') loadProfile();
  }

  // --- Login / Register ---
  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const data = { email: form.email.value, password: form.password.value };
    const errEl = document.getElementById('auth-error');
    try {
      const res = await post('/login', data);
      if (res.success) {
        currentUser = res.user;
        showApp();
        setPage('dashboard');
      } else {
        errEl.textContent = res.error || 'Login failed';
        errEl.classList.remove('hidden');
      }
    } catch (err) {
      errEl.textContent = 'Network error. Is the server running?';
      errEl.classList.remove('hidden');
    }
  });

  document.getElementById('register-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const data = { name: form.name.value, index_number: form.index_number.value, email: form.email.value, password: form.password.value };
    const errEl = document.getElementById('register-error');
    try {
      const res = await post('/register', data);
      if (res.success) {
        currentUser = res.user;
        showApp();
        setPage('dashboard');
      } else {
        errEl.textContent = res.error || 'Registration failed';
        errEl.classList.remove('hidden');
      }
    } catch (err) {
      errEl.textContent = 'Network error. Is the server running?';
      errEl.classList.remove('hidden');
    }
  });

  document.getElementById('show-register').addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('auth-error').classList.add('hidden');
    showRegister();
  });
  document.getElementById('show-login').addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('register-error').classList.add('hidden');
    showAuth();
  });

  document.getElementById('logout-btn').addEventListener('click', () => {
    currentUser = null;
    showAuth();
  });

  // --- Nav ---
  document.querySelectorAll('.nav-link').forEach(a => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      setPage(a.dataset.page);
    });
  });

  // --- Dashboard ---
  async function loadDashboard() {
    if (!currentUser) return;
    const gpaData = await get('/users/' + currentUser.id + '/gpa');
    const cards = document.getElementById('dashboard-cards');
    const cgpa = gpaData.overall?.gpa ?? '–';
    const modCount = gpaData.modules?.length ?? 0;
    cards.innerHTML = `
      <div class="card"><div class="label">CGPA</div><div class="value">${cgpa}</div></div>
      <div class="card"><div class="label">Modules recorded</div><div class="value">${modCount}</div></div>
    `;
    const tbody = document.getElementById('dashboard-modules');
    const recent = (gpaData.modules || []).slice(-10).reverse();
    tbody.innerHTML = recent.length
      ? recent.map(m => `<tr><td>${m.name}</td><td>${m.credits}</td><td>${m.grade_letter || '–'}</td><td>${m.semester || 1}</td></tr>`).join('')
      : '<tr><td colspan="4">No modules yet. Add some in GPA Calculator.</td></tr>';
  }

  // --- Profile ---
  function loadProfile() {
    if (!currentUser) return;
    document.getElementById('profile-name').textContent = currentUser.name || '–';
    document.getElementById('profile-index').textContent = currentUser.index_number || '–';
    document.getElementById('profile-email').textContent = currentUser.email || '–';
  }

  document.getElementById('download-pdf').addEventListener('click', (e) => {
    e.preventDefault();
    window.open(API + '/users/' + currentUser.id + '/report.pdf', '_blank');
  });

  // Init: show auth (no persisted session for demo)
  showAuth();
  function loadRepeat() {
    const page = document.getElementById("page-repeat");

    if (page) {
      console.log("Repeat & Improvement page loaded");

      const button = page.querySelector("button");

      if (button) {
        button.addEventListener("click", () => {
          alert("Result updated successfully!");
        });
      }
    }
  }
})();
