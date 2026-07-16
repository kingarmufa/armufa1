document.addEventListener('DOMContentLoaded', () => {
    // [PERBAIKAN] Panggil checkLogin() untuk memulai semuanya
    // checkLogin() sekarang akan memanggil loadInitialData() setelah berhasil
    checkLogin();

    // --- Variabel Global ---
    let allUsersData = {};
    let currentPage = 1;
    let totalPages = 1;
    let currentFilter = 'all';
    let currentDatabase = 'user.json'; // [BARU] Menyimpan database yang dipilih
    const usersPerPage = 10;

    // --- Elemen DOM ---
    const userListTable = document.getElementById('user-list-table');
    const userStatsContainer = document.getElementById('user-stats-container');
    
    // Elemen Filter Peran
    const roleFilterWrapper = document.getElementById('role-filter-wrapper');
    const roleFilterTrigger = roleFilterWrapper.querySelector('.custom-select-trigger');
    const filterTriggerText = document.getElementById('filter-trigger-text');
    const roleFilterOptions = document.getElementById('role-filter-options');

    // [BARU] Elemen Filter Database
    const dbFilterWrapper = document.getElementById('db-filter-wrapper');
    const dbFilterTrigger = dbFilterWrapper.querySelector('.custom-select-trigger');
    const dbFilterTriggerText = document.getElementById('db-filter-trigger-text');
    const dbFilterOptions = document.getElementById('db-filter-options');


    // --- LOGIKA TEMA ---
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    const themeToggleBtn = document.getElementById('theme-toggle');
    const themeIcon = document.getElementById('theme-icon');

    function applyThemeUI(theme) {
        const isDark = theme === 'dark';
        themeToggleBtn.setAttribute('aria-pressed', String(isDark));
        themeIcon.innerHTML = isDark ? '<svg class="ico" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>' : '<svg class="ico" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
        if (metaTheme) metaTheme.setAttribute('content', isDark ? '#0d1321' : '#f3f6fd');
    }

    function setTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        try { localStorage.setItem('theme', theme); } catch (e) { }
        applyThemeUI(theme);
    }
    themeToggleBtn.addEventListener('click', () => setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'));
    setTheme(localStorage.getItem('theme') || 'dark');

    // --- LOGIKA SIDEBAR ---
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
    
    logoutBtn.addEventListener('click', (e) => {
        e.preventDefault();
        logout();
    });

    // --- FUNGSI UTAMA ---
    
    // [PERBAIKAN] Pindahkan loadInitialData ke scope DOMContentLoaded
    // agar bisa diakses oleh checkLogin() melalui window.
    async function loadInitialData() {
        try {
            // [PERBAIKAN] Gunakan currentDatabase untuk mengambil data
            const response = await fetch(`/api/users?db=${encodeURIComponent(currentDatabase)}`);
            const data = await response.json();
            
            if (data.status && data.usersByRole) {
                allUsersData = data.usersByRole;
            } else {
                allUsersData = {}; // Kosongkan jika tidak ada data
            }
        } catch (error) {
            console.error('Gagal memuat pengguna:', error);
            showToast('Gagal memuat daftar pengguna.', 'error');
            allUsersData = {}; // Kosongkan jika terjadi error
        } finally {
            updateStatsAndFilters(); // Selalu update UI
            renderTable(); // Selalu render tabel (mungkin menampilkan "tidak ada data")
        }
    }
    
    // [PERBAIKAN] Buat loadInitialData dapat diakses secara global
    // agar checkLogin() (yang global) dapat memanggilnya.
    window.loadUsersPageData = loadInitialData;

    function getFilteredUsers(filter) {
        const users = [];
        if (!allUsersData) return users; 
        Object.entries(allUsersData).forEach(([role, roleUsers]) => {
            if (filter !== 'all' && filter !== role) return;
            Object.entries(roleUsers).forEach(([username, userData]) => {
                users.push({ username, role, userData });
            });
        });
        return users;
    }

    function renderTable(filter = 'all', page = 1) {
        userListTable.innerHTML = '';
        if (!allUsersData) {
            userListTable.innerHTML = '<tr><td colspan="4" style="text-align: center;">Tidak ada data pengguna.</td></tr>';
            updatePaginationControls();
            return;
        }

        const filteredUsers = getFilteredUsers(filter);
        totalPages = Math.ceil(filteredUsers.length / usersPerPage) || 1;
        currentPage = Math.min(page, totalPages);
        const start = (currentPage - 1) * usersPerPage;
        const end = start + usersPerPage;
        const usersToShow = filteredUsers.slice(start, end);

        if (usersToShow.length === 0) {
             userListTable.innerHTML = '<tr><td colspan="4" style="text-align: center;">Tidak ada pengguna ditemukan.</td></tr>';
        } else {
            usersToShow.forEach(({ username, role, userData }) => {
                const tr = document.createElement('tr');
                let creationTime = "N/A";
                if (typeof userData === 'object' && userData.createdAt) {
                    creationTime = new Date(userData.createdAt).toLocaleString('id-ID', {
                        timeZone: 'Asia/Jakarta', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'
                    });
                }
                tr.innerHTML = `
                    <td>${username}</td>
                    <td>${role.replace(/_/g, ' ')}</td>
                    <td>${creationTime}</td>
                    <td>
                        <button class="action-btn edit-btn" data-username="${username}" data-role="${role}">Edit</button>
                        <button class="action-btn delete-btn" data-username="${username}" data-role="${role}">Hapus</button>
                    </td>
                `;
                userListTable.appendChild(tr);
            });
        }

        updatePaginationControls();
    }

    function updatePaginationControls() {
        const paginationControls = document.getElementById('pagination-controls');
        const pageInfo = document.getElementById('page-info');
        const prevBtn = document.getElementById('prev-page-btn');
        const nextBtn = document.getElementById('next-page-btn');

        if (totalPages > 1) {
            paginationControls.style.display = 'block';
            pageInfo.textContent = `Halaman ${currentPage} dari ${totalPages}`;
            prevBtn.disabled = currentPage === 1;
            nextBtn.disabled = currentPage === totalPages;
        } else {
            paginationControls.style.display = 'none';
        }
    }

    function updateStatsAndFilters() {
        userStatsContainer.innerHTML = '';
        roleFilterOptions.innerHTML = '';
        let totalUsers = 0;

        // Tambahkan opsi "Semua Peran"
        const allOption = document.createElement('div');
        allOption.className = 'custom-option selected';
        allOption.dataset.value = 'all';
        allOption.textContent = 'Semua Peran';
        roleFilterOptions.appendChild(allOption);

        const knownRoles = ['ceo', 'tangan_kanan', 'owner', 'partner', 'admin_panel', 'reseller'];
        const allRolesInDb = allUsersData ? Object.keys(allUsersData) : [];
        const otherRoles = allRolesInDb.filter(r => !knownRoles.includes(r)).sort();
        const roleOrder = [...knownRoles, ...otherRoles];

        roleOrder.forEach(role => {
            if (allUsersData && allUsersData[role]) {
                const userCount = Object.keys(allUsersData[role]).length;
                if (userCount > 0) {
                    totalUsers += userCount;
                    const statItem = document.createElement('div');
                    statItem.className = 'stat-item';
                    statItem.innerHTML = `<div class="count">${userCount}</div><div class="label">${role.replace(/_/g, ' ')}</div>`;
                    userStatsContainer.appendChild(statItem);

                    const option = document.createElement('div');
                    option.className = 'custom-option';
                    option.dataset.value = role;
                    option.textContent = role.replace(/_/g, ' ');
                    roleFilterOptions.appendChild(option);
                }
            }
        });

        const totalStatItem = document.createElement('div');
        totalStatItem.className = 'stat-item';
        totalStatItem.innerHTML = `<div class="count">${totalUsers}</div><div class="label">Total Pengguna</div>`;
        userStatsContainer.prepend(totalStatItem);

        filterTriggerText.textContent = 'Semua Peran';
        currentFilter = 'all';
    }

    // --- EVENT LISTENERS ---

    // [BARU] Event listener untuk filter database
    dbFilterTrigger.addEventListener('click', () => {
        dbFilterWrapper.classList.toggle('open');
    });

    dbFilterOptions.addEventListener('click', (e) => {
        if (e.target.classList.contains('custom-option')) {
            const selectedValue = e.target.dataset.value;
            const selectedText = e.target.textContent;

            dbFilterTriggerText.textContent = selectedText;
            dbFilterWrapper.classList.remove('open');
            dbFilterOptions.querySelectorAll('.custom-option').forEach(opt => opt.classList.remove('selected'));
            e.target.classList.add('selected');

            // [BARU] Ubah database dan muat ulang semua data
            currentDatabase = selectedValue;
            currentPage = 1;
            loadInitialData(); // <-- Ini memanggil ulang data. INI SUDAH BENAR.
        }
    });

    // Event listener untuk filter peran
    roleFilterTrigger.addEventListener('click', () => {
        roleFilterWrapper.classList.toggle('open');
    });

    roleFilterOptions.addEventListener('click', (e) => {
        if (e.target.classList.contains('custom-option')) {
            const selectedValue = e.target.dataset.value;
            const selectedText = e.target.textContent;

            filterTriggerText.textContent = selectedText;
            roleFilterWrapper.classList.remove('open');
            roleFilterOptions.querySelectorAll('.custom-option').forEach(opt => opt.classList.remove('selected'));
            e.target.classList.add('selected');

            currentFilter = selectedValue;
            currentPage = 1;
            renderTable(currentFilter, currentPage);
        }
    });

    window.addEventListener('click', (e) => {
        if (!roleFilterWrapper.contains(e.target)) {
            roleFilterWrapper.classList.remove('open');
        }
        if (!dbFilterWrapper.contains(e.target)) {
            dbFilterWrapper.classList.remove('open');
        }
    });

    userListTable.addEventListener('click', async (e) => {
        const target = e.target;
        if (target.classList.contains('delete-btn')) {
            const username = target.dataset.username;
            const role = target.dataset.role;
            if (confirm(`Apakah Anda yakin ingin menghapus pengguna "${username}"?`)) {
                try {
                    const response = await fetch('/api/deleteuser', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ 
                            username, 
                            role, 
                            db: currentDatabase, 
                            loggedInUsername: localStorage.getItem('username') 
                        })
                    });
                    const data = await response.json();
                    showToast(data.message, response.ok ? 'success' : 'error');
                    if (response.ok) loadInitialData();
                } catch (err) {
                    showToast('Terjadi kesalahan jaringan.', 'error');
                }
            }
        } else if (target.classList.contains('edit-btn')) {
            const username = target.dataset.username;
            const role = target.dataset.role;
            window.location.href = `/edit-user?username=${encodeURIComponent(username)}&role=${encodeURIComponent(role)}&db=${encodeURIComponent(currentDatabase)}`;
        }
    });

    // Pagination buttons
    document.getElementById('prev-page-btn').addEventListener('click', () => {
        if (currentPage > 1) {
            currentPage--;
            renderTable(currentFilter, currentPage);
        }
    });

    document.getElementById('next-page-btn').addEventListener('click', () => {
        if (currentPage < totalPages) {
            currentPage++;
            renderTable(currentFilter, currentPage);
        }
    });

    // Delete all button
    document.getElementById('delete-all-btn').addEventListener('click', async () => {
        if (currentFilter === 'all') {
            showToast('Silakan pilih peran tertentu untuk dihapus semua.', 'error');
            return;
        }
        
        const userCount = getFilteredUsers(currentFilter).length;
        if (userCount === 0) {
            showToast('Tidak ada pengguna untuk dihapus.', 'error');
            return;
        }

        if (confirm(`Apakah Anda yakin ingin menghapus SEMUA ${userCount} pengguna dengan peran ${currentFilter.replace(/_/g, ' ')} dari ${currentDatabase}?`)) {
            try {
                const response = await fetch('/api/deleteallusers', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        role: currentFilter, 
                        db: currentDatabase, 
                        loggedInUsername: localStorage.getItem('username') 
                    })
                });
                const data = await response.json();
                showToast(data.message, response.ok ? 'success' : 'error');
                if (response.ok) {
                    loadInitialData(); 
                }
            } catch (err) {
                showToast('Terjadi kesalahan jaringan.', 'error');
            }
        }
    });

    // --- FUNGSI BANTU ---
    function showToast(message, type = 'success') {
        const container = document.getElementById('notification-container');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        container.appendChild(toast);
        setTimeout(() => toast.classList.add('show'), 100);
        setTimeout(() => {
            toast.classList.remove('show');
            toast.addEventListener('transitionend', () => toast.remove());
        }, 5000);
    }

    // --- INISIALISASI ---
    // [DIHAPUS] loadInitialData(); <-- Panggilan ini dihapus dari sini
    document.getElementById('y').textContent = new Date().getFullYear();
});


// --- [FUNGSI GLOBAL DI LUAR DOMCONTENTLOADED] ---

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
    
    if (data.role !== 'admin_website') {
         alert("Anda tidak memiliki izin mengakses halaman ini.");
         window.location.href = "/panel"; 
         return;
    }
    
    const { user, role, isMainDb, isPanel3User } = data;
    localStorage.setItem("username", user);
    localStorage.setItem("role", role);
    sessionStorage.setItem("creatorRole", role);
    
    setupPage(user, role, isMainDb, isPanel3User);
    
    // [PERBAIKAN] Panggil fungsi pemuat data SETELAH login berhasil
    if (window.loadUsersPageData) {
        window.loadUsersPageData();
    }
    
  } catch (err) {
    window.location.href = "/login";
  }
}