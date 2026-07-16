document.addEventListener('DOMContentLoaded', () => {
  // [PERBAIKAN] Panggil checkLogin() untuk memulai semuanya
  checkLogin();

  const themeToggleBtn = document.getElementById('theme-toggle');
  const themeIcon = document.getElementById('theme-icon');

  function applyThemeUI(theme) {
    const isDark = theme === 'dark';
    themeToggleBtn.setAttribute('aria-pressed', String(isDark));
    themeIcon.innerHTML = isDark ? '<svg class="ico" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>' : '<svg class="ico" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
  }
  function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('theme', theme); } catch (e) { }
    applyThemeUI(theme);
  }
  themeToggleBtn.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    setTheme(current === 'dark' ? 'light' : 'dark');
  });
  setTheme(localStorage.getItem('theme') || 'dark');

  const menuBtn = document.getElementById('menu-btn');
  const sidebar = document.getElementById('sidebar');
  const sidebarCloseBtn = document.getElementById('sidebar-close-btn');
  const overlay = document.getElementById('sidebar-overlay');
  const logoutBtn = document.getElementById('sidebar-logout-btn');

  function openSidebar() { sidebar.classList.add('open'); overlay.classList.add('show'); }
  function closeSidebar() { sidebar.classList.remove('open'); overlay.classList.remove('show'); }

  menuBtn.addEventListener('click', openSidebar);
  sidebarCloseBtn.addEventListener('click', closeSidebar);
  overlay.addEventListener('click', closeSidebar);
  
  // [PERBAIKAN] Event listener ini sekarang memanggil fungsi logout()
  logoutBtn.addEventListener('click', (e) => {
    e.preventDefault();
    logout();
  });

  const startBtn = document.getElementById('start-delete-btn');
  const logOutput = document.getElementById('log-output');
  let eventSource;

  // ================= LOGIKA PANEL SELECTOR =================
  const panelSelectorWrapper = document.getElementById('panel-selector-wrapper');
  const panelSelector = document.getElementById("panel-selector");
  const currentPanelName = document.getElementById("current-panel-name");
  const panelOptionsContainer = document.getElementById("panel-options-container");

  async function initializePanelSelector() {
    panelSelectorWrapper.style.display = "block";
    try {
      const response = await fetch("/api/panels");
      const data = await response.json();
      if (data.status) {
        panelOptionsContainer.innerHTML = "";
        Object.entries(data.panels).forEach(([id, panel], index) => {
          const li = document.createElement("li");
          li.className = "panel-option";
          li.dataset.id = id;
          li.innerHTML = `<span>${panel.name}</span>`;
          li.addEventListener("click", () => {
            setActivePanel(id, panel.name);
            panelSelector.classList.remove("open");
          });
          panelOptionsContainer.appendChild(li);
        });
        const savedPanelId = sessionStorage.getItem("activePanelId");
        const firstPanelId = Object.keys(data.panels)[0];
        const firstPanelName = data.panels[firstPanelId].name;
        if (savedPanelId && data.panels[savedPanelId]) {
          setActivePanel(savedPanelId, data.panels[savedPanelId].name);
        } else {
          setActivePanel(firstPanelId, firstPanelName);
        }
      }
    } catch (error) {
      currentPanelName.textContent = "Gagal memuat panel";
    }
  }

  function setActivePanel(id, name) {
    sessionStorage.setItem("activePanelId", id);
    currentPanelName.textContent = name;
    document.querySelectorAll(".panel-option").forEach((opt) => {
      opt.classList.toggle("active", opt.dataset.id === id);
    });
  }

  panelSelector.querySelector(".panel-selector-header").addEventListener("click", () => {
    panelSelector.classList.toggle("open");
  });
  document.addEventListener("click", (e) => {
    if (!panelSelector.contains(e.target)) {
      panelSelector.classList.remove("open");
    }
  });

  initializePanelSelector();
  // ======================================================================

  // ================= LOGIKA MODE SELECTOR ==================
  const modeSelector = document.getElementById("mode-selector");
  const currentModeName = document.getElementById("current-mode-name");
  const modeOptionsContainer = document.getElementById("mode-options-container");
  let selectedMode = 'total'; // Default mode

  function setMode(mode, name) {
    selectedMode = mode;
    currentModeName.textContent = name;
    document.querySelectorAll('#mode-options-container .panel-option').forEach(opt => {
      opt.classList.toggle('active', opt.dataset.mode === mode);
    });
  }

  modeSelector.querySelector(".panel-selector-header").addEventListener("click", () => {
    modeSelector.classList.toggle("open");
  });

  modeOptionsContainer.addEventListener('click', (e) => {
    if (e.target.classList.contains('panel-option')) {
      setMode(e.target.dataset.mode, e.target.textContent);
      modeSelector.classList.remove('open');
    }
  });

  document.addEventListener("click", (e) => {
    if (!modeSelector.contains(e.target)) {
      modeSelector.classList.remove("open");
    }
  });
  // ======================================================================

  function connectEventSource() {
    if (eventSource) { eventSource.close(); }
    eventSource = new EventSource('/api/autodelete-stream');
    eventSource.onmessage = function (event) {
      logOutput.textContent += event.data + '\n';
      logOutput.scrollTop = logOutput.scrollHeight;
    };
    eventSource.onerror = function () {
      logOutput.textContent += 'Koneksi ke server terputus. Menyambungkan kembali...\n';
      eventSource.close();
      setTimeout(connectEventSource, 5000);
    };
  }

  connectEventSource();

  startBtn.addEventListener('click', async () => {
    startBtn.disabled = true;
    startBtn.textContent = 'Memproses...';
    logOutput.textContent = 'Memulai proses...\n';

    const activePanelId = sessionStorage.getItem('activePanelId');
    if (!activePanelId) {
      logOutput.textContent += 'Error: Panel aktif tidak dipilih. Silakan pilih panel di atas.\n';
      startBtn.disabled = false;
      startBtn.textContent = 'Mulai Proses';
      return;
    }

    try {
      const response = await fetch('/api/autodelete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          panelId: activePanelId,
          mode: selectedMode, 
          loggedInUsername: localStorage.getItem('username')
        }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || 'Gagal memulai proses.');
      }
    } catch (error) {
      logOutput.textContent += `Error: ${error.message}\n`;
    } finally {
      startBtn.disabled = false;
      startBtn.textContent = 'Mulai Proses';
    }
  });

  document.getElementById('y').textContent = new Date().getFullYear();

  // [PERBAIKAN] Hapus semua logika sidebar lama dari sini
});


// --- [FUNGSI BARU DITAMBAHKAN DI LUAR DOMCONTENTLOADED] ---

function logout() {
  fetch("/logout", { method: "GET" })
    .then((res) => res.json())
    .finally(() => {
      localStorage.clear();
      sessionStorage.clear();
      window.location.href = "/login";
    });
}

function populateSidebarProfile(username, userRole) {
  const profileName = document.querySelector('.profile-name');
  const profileRole = document.querySelector('.profile-role');

  if (profileName && profileRole) {
    profileName.textContent = username || 'Pengguna';
    let role = userRole || 'Tidak Diketahui';
    role = role.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    profileName.textContent = username;
    profileRole.textContent = role;
  }
}

function setupPage(username, userRole, isMainDb, isPanel3User) {
  populateSidebarProfile(username, userRole);

  const globalPanelLink = document.getElementById("admin-global-panel-link");
  const globalServerLink = document.getElementById("admin-global-server-link");
  const panelAstaLink = document.getElementById("panel-asta-link"); 
  const serverAstaLink = document.getElementById("server-asta-link"); 
  const adminPageLink = document.getElementById("admin-page-link");
  const manageUsersLink = document.getElementById("manage-users-link");
  const autodeleteLink = document.getElementById("autodelete-link");
  
  if (userRole === "admin_website") {
    if (globalPanelLink) globalPanelLink.style.display = "flex";
    if (globalServerLink) globalServerLink.style.display = "flex";
    if (panelAstaLink) panelAstaLink.style.display = "none";
    if (serverAstaLink) serverAstaLink.style.display = "none";
    
    if (adminPageLink) adminPageLink.style.display = "flex";
    if (manageUsersLink) manageUsersLink.style.display = "flex";
    if (autodeleteLink) autodeleteLink.style.display = "flex";
  
  } else if (userRole === "reseller") {
    if (globalPanelLink) globalPanelLink.style.display = "none";
    if (globalServerLink) globalServerLink.style.display = "none";
    if (panelAstaLink) panelAstaLink.style.display = "flex"; 
    if (serverAstaLink) serverAstaLink.style.display = "flex"; 
    
    if (adminPageLink) adminPageLink.style.display = "none";
    if (manageUsersLink) manageUsersLink.style.display = "none";
    if (autodeleteLink) autodeleteLink.style.display = "none";
  
  } else { // CEO, Owner, dll
    if (globalPanelLink) globalPanelLink.style.display = "none";
    if (globalServerLink) globalServerLink.style.display = "none";
    if (panelAstaLink) panelAstaLink.style.display = "flex";
    if (serverAstaLink) serverAstaLink.style.display = "flex";
    
    if (adminPageLink) adminPageLink.style.display = "flex";
    if (manageUsersLink) manageUsersLink.style.display = "none";
    if (autodeleteLink) autodeleteLink.style.display = "none";
  }
}

async function checkLogin() {
  try {
    const res = await fetch("/api/me");
    const data = await res.json();
    if (!data.loggedIn) {
      window.location.href = "/login";
      return;
    }
    
    // [PERBAIKAN] Hanya admin_website yang boleh di halaman ini
    if (data.role !== 'admin_website') {
         alert("Anda tidak memiliki izin mengakses halaman ini.");
         window.location.href = "/panel"; // Arahkan ke panel
         return;
    }
    
    const { user, role, isMainDb, isPanel3User } = data;
    localStorage.setItem("username", user);
    localStorage.setItem("role", role);
    sessionStorage.setItem("creatorRole", role);
    
    setupPage(user, role, isMainDb, isPanel3User);
    
  } catch (err) {
    window.location.href = "/login";
  }
}