require('./setting');
// Bot Telegram (long-polling) HANYA dijalankan kalau bukan di Vercel/serverless.
// Vercel gak bisa jalanin proses polling terus-terusan, jadi kalau deploy ke Vercel,
// jalankan bot-nya terpisah di VPS/self-host, lalu set env DISABLE_BOT=1 di Vercel.
if (!process.env.VERCEL && process.env.DISABLE_BOT !== '1') {
  require('./telegram-bot');
}
const crypto = require('crypto');
const QRCode = require('qrcode');
const { createQrisTransaction, checkTransactionStatus } = require('./lib/pakasir');
const { getTransactionsCollection, getBuyerAccountsCollection } = require('./lib/mongo');
function logActivity(username, action) {
  const timestamp = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
  console.log(`[${timestamp}] [USER: ${username}] ${action}`);
}
const express = require('express');
const axios = require('axios');
const os = require('os');
const fs = require('fs');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const app = express();
const port = process.env.SERVER_PORT || 3000;
const path = require('path');

const adminDbPath = './db/admin.json';
const userDbPath = './db/user.json';
const userBuyerLuarDbPath = './db/user-buyerluar.json';
const userPanel3DbPath = './db/user-panel3.json'; // [PERUBAHAN BARU]
const idBuyerAstaDbPath = './db/idbuyerasta.json';

const ROLE_ORDER = ['ceo', 'tangan_kanan', 'owner', 'partner', 'admin_panel', 'reseller_private', 'reseller'];

if (!fs.existsSync(adminDbPath)) fs.writeFileSync(adminDbPath, JSON.stringify({}, null, 2));
if (!fs.existsSync(userDbPath)) {
  const emptyRoles = ROLE_ORDER.reduce((acc, r) => ({ ...acc, [r]: {} }), {});
  fs.writeFileSync(userDbPath, JSON.stringify(emptyRoles, null, 2));
}
if (!fs.existsSync(userBuyerLuarDbPath)) {
  const emptyRoles = ROLE_ORDER.slice(1).reduce((acc, r) => ({ ...acc, [r]: {} }), {});
  fs.writeFileSync(userBuyerLuarDbPath, JSON.stringify(emptyRoles, null, 2));
  console.log('Membuat file db/user-buyerluar.json.');
}
// [PERUBAHAN BARU] Buat file db/user-panel3.json jika belum ada
if (!fs.existsSync(userPanel3DbPath)) {
  fs.writeFileSync(userPanel3DbPath, JSON.stringify({ "reseller": {} }, null, 2));
  console.log('Membuat file db/user-panel3.json.');
}
if (!fs.existsSync(idBuyerAstaDbPath)) {
  fs.writeFileSync(idBuyerAstaDbPath, JSON.stringify([], null, 2));
  console.log('Membuat file db/idbuyerasta.json. Harap isi dengan ID Telegram buyer ARMUFA CPANEL.');
}

app.use(express.json());
app.use(express.static(__dirname));
app.use(express.static('public'));
app.use(session({
  store: MongoStore.create({
    mongoUrl: global.mongoUri,
    ttl: 7 * 24 * 60 * 60,
    collectionName: 'sessions',
  }),
  secret: 'armufa-cpanel-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000, httpOnly: true, secure: !!process.env.VERCEL },
}));


// --- Rute HTML (Sudah Disederhanakan) ---
app.get('/', (req, res) => res.sendFile(__dirname + '/public/landing.html'));
app.get('/login', (req, res) => {
  if (req.session.user) {
    return res.redirect('/panel');
  }
  res.sendFile(__dirname + '/public/login.html');
});
app.get('/admin', requireLogin, (req, res) => res.sendFile(__dirname + '/public/admin.html'));
app.get('/panel', requireLogin, (req, res) => res.sendFile(__dirname + '/public/panel.html'));
app.get('/add-server', requireLogin, (req, res) => res.sendFile(__dirname + '/public/add-server.html'));
app.get('/autodelete', (req, res) => res.sendFile(__dirname + '/public/autodelete.html'));
app.get('/users', (req, res) => res.sendFile(__dirname + '/public/users.html'));
app.get('/edit-user', (req, res) => res.sendFile(__dirname + '/public/edit-user.html'));
// --- Akhir Rute HTML ---


async function sendBotMessage(chatId, message, photoUrl = null) {
  const token = global.botToken;
  if (!token || token === 'TOKEN_BOT_ANDA_DI_SINI') {
    console.error("❌ Token Bot Telegram belum diatur di file setting.js");
    return;
  }
  const baseUrl = `https://api.telegram.org/bot${token}`;
  try {
    if (photoUrl) {
      await axios.post(`${baseUrl}/sendPhoto`, { chat_id: chatId, photo: photoUrl, caption: message, parse_mode: 'Markdown' });
    } else {
      await axios.post(`${baseUrl}/sendMessage`, { chat_id: chatId, text: message, parse_mode: 'Markdown' });
    }
    console.log(`✅ Pesan bot berhasil terkirim ke Chat ID: ${chatId}`);
  } catch (error) {
    console.error(`❌ Gagal mengirim pesan bot ke Chat ID: ${chatId}.`);
  }
}

app.get('/api/me', (req, res) => {
  if (req.session.user) {
    // [PERUBAHAN BARU] Kirim isPanel3User juga
    const { username, role, isMainDb, isPanel3User } = req.session.user;
    return res.json({
      loggedIn: true,
      user: username,
      role: role,
      isMainDb: isMainDb,
      isPanel3User: isPanel3User || false // Kirim status panel 3
    });
  }
  res.json({ loggedIn: false });
});

app.get('/api/panels', (req, res) => {
  try {
    const panelDataForClient = {};
    for (const [id, config] of Object.entries(global.panels)) {
      panelDataForClient[id] = { name: config.name };
    }
    res.json({ status: true, panels: panelDataForClient });
  } catch (error) {
    res.status(500).json({ status: false, message: 'Gagal memuat konfigurasi panel.' });
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ status: false, message: 'Gagal logout.' });
    }
    res.clearCookie('connect.sid');
    res.json({ status: true, message: 'Logout berhasil.' });
  });
});

// ======================= FUNGSI AUTO DELETE =======================
let clients = [];
function sendToAll(data) {
  clients.forEach(client => client.res.write(`data: ${data}\n\n`));
}
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
function requireLogin(req, res, next) {
  if (req.session.user) {
    next();
  } else {
    res.redirect('/login');
  }
}

async function deleteAllUsersAndServers(activePanel, panelId, onLog) {
  let deletedServersCount = 0;
  let deletedUsersCount = 0;

  try {
    onLog("Memulai (Mode: Total): Mengambil data pengguna dari panel...");

    let antidelEntries = [];
    try {
      if (fs.existsSync('./db/antidelpanel.json')) {
        antidelEntries = JSON.parse(fs.readFileSync('./db/antidelpanel.json', 'utf8')) || [];
      }
    } catch (e) {
      onLog(`   -> ⚠️ Gagal membaca db/antidelpanel.json: ${e.message}`);
      antidelEntries = [];
    }

    const protectedEmails = new Set(antidelEntries.filter(e => typeof e === 'string' && e.includes('@')));
    const protectedNumeric = new Set(antidelEntries.filter(e => /^\d+$/.test(String(e))).map(String));
    const protectedStrings = new Set(antidelEntries.filter(e => typeof e === 'string' && !e.includes('@') && !/^\d+$/.test(e)));

    const panelIdNormalized = String(panelId || '').toLowerCase();
    const panelNumber = panelIdNormalized.replace(/^panel/i, '');
    if (protectedStrings.has(panelIdNormalized) || protectedNumeric.has(panelNumber) || protectedNumeric.has(panelIdNormalized)) {
      onLog(`❌ Panel '${panelId}' dilindungi oleh antidelpanel. Proses dibatalkan.`);
      return { deletedUsersCount: 0, deletedServersCount: 0 };
    }

    const initialResponse = await fetch(`${activePanel.url}/api/application/users?include=servers`, {
      headers: { 'Authorization': `Bearer ${activePanel.ptla}` }
    });

    if (!initialResponse.ok)
      throw new Error("Gagal mengambil data awal pengguna. Cek URL dan API Key.");

    const initialData = await initialResponse.json();
    const totalUsers = initialData.meta.pagination.total;
    const totalPages = initialData.meta.pagination.total_pages;

    onLog(`Ditemukan ${totalUsers} pengguna di ${totalPages} halaman.`);
    let processedUsers = 0;

    for (let page = 1; page <= totalPages; page++) {
      onLog(`\nMemproses halaman ${page} dari ${totalPages}...`);

      let usersData;
      if (page === 1) {
        usersData = initialData;
      } else {
        const usersResponse = await fetch(`${activePanel.url}/api/application/users?include=servers&page=${page}`, {
          headers: { 'Authorization': `Bearer ${activePanel.ptla}` }
        });
        if (!usersResponse.ok) {
          onLog(`   -> ❌ Gagal memuat halaman ${page}, melanjutkan...`);
          continue;
        }
        usersData = await usersResponse.json();
      }

      for (const user of usersData.data) {
        processedUsers++;
        const attributes = user.attributes;

        onLog(`(${processedUsers}/${totalUsers}) Memeriksa: ${attributes.username}`);

        if (attributes.email === "admin@gmail.com" || protectedEmails.has(attributes.email) || protectedNumeric.has(String(attributes.id))) {
          onLog(`   -> 🛡️ Dilewati: Pengguna terlindungi (admin@gmail.com atau antidel).`);
          continue;
        }

        try {
          onLog(`   -> 🗑️ Menghapus semua server milik ${attributes.username}...`);

          const serversResponse = await fetch(`${activePanel.url}/api/application/servers`, {
            headers: { 'Authorization': `Bearer ${activePanel.ptla}` }
          });
          const serversData = await serversResponse.json();

          const servers = serversData?.data || [];
          const userServers = servers.filter(s => s.attributes.user === attributes.id);

          if (userServers.length > 0) {
            for (const srv of userServers) {
              const deleteServerResponse = await fetch(
                `${activePanel.url}/api/application/servers/${srv.attributes.id}/force`,
                {
                  method: 'DELETE',
                  headers: { 'Authorization': `Bearer ${activePanel.ptla}` }
                }
              );

              if (deleteServerResponse.ok || deleteServerResponse.status === 204) {
                onLog(`      -> ✅ Server ${srv.attributes.name} dihapus.`);
                deletedServersCount++;
              } else {
                onLog(`      -> ❌ Gagal hapus server ${srv.attributes.name}.`);
              }
              await sleep(200);
            }
          } else {
            onLog(`      -> ⚠️ Tidak ada server ditemukan di database, lanjut.`);
          }
        } catch (err) {
          onLog(`      -> ⚠️ Gagal mengambil daftar server: ${err.message}`);
        }

        await sleep(300);

        onLog(`   -> 🗑️ Menghapus akun ${attributes.username} (${attributes.email})...`);
        const deleteUserResponse = await fetch(
          `${activePanel.url}/api/application/users/${attributes.id}`,
          {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${activePanel.ptla}` }
          }
        );

        if (deleteUserResponse.ok || deleteUserResponse.status === 204) {
          onLog(`      -> ✅ Akun '${attributes.username}' berhasil dihapus.`);
          deletedUsersCount++;
        } else {
          onLog(`      -> ❌ Gagal menghapus akun '${attributes.username}'.`);
        }
        await sleep(300);
      }
    }

    onLog(`\n✅ PROSES SELESAI (Mode: Total)`);
    onLog(`Total akun dihapus: ${deletedUsersCount}`);
    onLog(`Total server dihapus: ${deletedServersCount}`);

    return { deletedUsersCount, deletedServersCount };
  } catch (error) {
    onLog(`❌ Terjadi kesalahan fatal: ${error.message}`);
    throw error;
  }
}
async function deleteInactiveUsersAndServers(activePanel, onLog) {
  let deletedUsersCount = 0;
  let deletedServersCount = 0;

  if (!activePanel.ptlc) {
    onLog("❌ Kesalahan Konfigurasi: Client API Key (ptlc) tidak ditemukan di setting.js untuk panel ini. Proses dibatalkan.");
    throw new Error("Client API Key (ptlc) tidak ada.");
  }

  try {
    onLog("Memulai (Mode: Inactive): Mengambil data pengguna dari panel...");

    let antidelEntries = [];
    try {
      if (fs.existsSync('./db/antidelpanel.json')) {
        antidelEntries = JSON.parse(fs.readFileSync('./db/antidelpanel.json', 'utf8')) || [];
      }
    } catch (e) {
      onLog(`   -> ⚠️ Gagal membaca db/antidelpanel.json: ${e.message}`);
      antidelEntries = [];
    }
    const protectedEmails = new Set(antidelEntries.filter(e => typeof e === 'string' && e.includes('@')));
    const protectedNumeric = new Set(antidelEntries.filter(e => /^\d+$/.test(String(e))).map(String));

    const initialResponse = await fetch(`${activePanel.url}/api/application/users?include=servers`, {
      headers: { 'Authorization': `Bearer ${activePanel.ptla}` }
    });
    if (!initialResponse.ok) throw new Error("Gagal mengambil data awal pengguna.");

    const initialData = await initialResponse.json();
    const totalUsers = initialData.meta.pagination.total;
    const totalPages = initialData.meta.pagination.total_pages;

    onLog(`Ditemukan ${totalUsers} pengguna di ${totalPages} halaman. Memeriksa status server...`);
    let processedUsers = 0;

    for (let page = 1; page <= totalPages; page++) {
      onLog(`\nMemproses halaman pengguna ${page} dari ${totalPages}...`);

      let usersData;
      if (page === 1) {
        usersData = initialData;
      } else {
        const usersResponse = await fetch(`${activePanel.url}/api/application/users?include=servers&page=${page}`, {
          headers: { 'Authorization': `Bearer ${activePanel.ptla}` }
        });
        if (!usersResponse.ok) {
          onLog(`   -> ❌ Gagal memuat halaman ${page}, melanjutkan...`);
          continue;
        }
        usersData = await usersResponse.json();
      }

      for (const user of usersData.data) {
        processedUsers++;
        const attributes = user.attributes;
        const servers = attributes.relationships.servers.data;

        onLog(`\n(${processedUsers}/${totalUsers}) Memeriksa: ${attributes.username}`);

        if (attributes.email === "admin@gmail.com" || protectedEmails.has(attributes.email) || protectedNumeric.has(String(attributes.id))) {
          onLog(`   -> 🛡️ Dilewati: Pengguna terlindungi (admin@gmail.com atau antidel).`);
          continue;
        }

        if (servers.length === 0) {
          onLog(`   -> 🗑️ Menghapus akun tanpa server: ${attributes.username}`);
          const deleteUserResponse = await fetch(`${activePanel.url}/api/application/users/${attributes.id}`, {
            method: 'DELETE', headers: { 'Authorization': `Bearer ${activePanel.ptla}` }
          });
          if (deleteUserResponse.ok || deleteUserResponse.status === 204) {
            onLog(`      -> ✅ Akun '${attributes.username}' berhasil dihapus.`);
            deletedUsersCount++;
          } else {
            onLog(`      -> ❌ Gagal menghapus akun '${attributes.username}'.`);
          }
          await sleep(300);
          continue;
        }

        let allServersOffline = true;
        onLog(`   -> Mengecek ${servers.length} server milik ${attributes.username}...`);

        for (const server of servers) {
          try {
            const serverDetailsRes = await fetch(`${activePanel.url}/api/client/servers/${server.attributes.uuid}/resources`, {
              headers: { 'Authorization': `Bearer ${activePanel.ptlc}` }
            });

            if (!serverDetailsRes.ok) {
              onLog(`      -> ⚠️ Tidak bisa cek status server ${server.attributes.name} (${server.attributes.uuid}). Anggap offline.`);
              continue;
            }

            const serverDetails = await serverDetailsRes.json();
            const currentState = serverDetails.attributes.current_state;
            onLog(`      -> Status server '${server.attributes.name}': ${currentState}`);

            if (currentState === 'running' || currentState === 'starting') {
              allServersOffline = false;
              break;
            }
          } catch (e) {
            onLog(`      -> ⚠️ Error saat cek server ${server.attributes.name}. Anggap offline. Error: ${e.message}`);
          }
          await sleep(200);
        }

        if (allServersOffline) {
          onLog(`   -> ✅ Semua server offline. Menghapus pengguna dan servernya...`);
          for (const server of servers) {
            onLog(`      -> 🗑️ Menghapus server ${server.attributes.name}...`);
            const deleteServerRes = await fetch(`${activePanel.url}/api/application/servers/${server.attributes.id}/force`, {
              method: 'DELETE', headers: { 'Authorization': `Bearer ${activePanel.ptla}` }
            });
            if (deleteServerRes.ok || deleteServerRes.status === 204) {
              onLog(`         -> ✅ Server dihapus.`);
              deletedServersCount++;
            } else {
              onLog(`         -> ❌ Gagal hapus server.`);
            }
            await sleep(200);
          }

          onLog(`      -> 🗑️ Menghapus akun ${attributes.username}...`);
          const deleteUserRes = await fetch(`${activePanel.url}/api/application/users/${attributes.id}`, {
            method: 'DELETE', headers: { 'Authorization': `Bearer ${activePanel.ptla}` }
          });
          if (deleteUserRes.ok || deleteUserRes.status === 204) {
            onLog(`         -> ✅ Akun dihapus.`);
            deletedUsersCount++;
          } else {
            onLog(`         -> ❌ Gagal hapus akun.`);
          }
        } else {
          onLog(`   -> ⚠️ Dilewati: Ada server yang masih aktif.`);
        }
        await sleep(300);
      }
    }

    onLog(`\n✅ PROSES SELESAI (Mode: Inactive)`);
    onLog(`Total akun dihapus: ${deletedUsersCount}`);
    onLog(`Total server dihapus: ${deletedServersCount}`);
    return { deletedUsersCount, deletedServersCount };

  } catch (error) {
    onLog(`❌ Terjadi kesalahan fatal: ${error.message}`);
    throw error;
  }
}
async function deleteOnlyInactiveServers(activePanel, onLog) {
  let deletedServersCount = 0;

  if (!activePanel.ptlc) {
    onLog("❌ Kesalahan Konfigurasi: Client API Key (ptlc) tidak ditemukan di setting.js untuk panel ini. Proses dibatalkan.");
    throw new Error("Client API Key (ptlc) tidak ada.");
  }

  try {
    onLog("Memulai (Mode: Only Inactive Servers): Membaca file antidelpanel.json...");
    let antidelEntries = [];
    try {
      if (fs.existsSync('./db/antidelpanel.json')) {
        antidelEntries = JSON.parse(fs.readFileSync('./db/antidelpanel.json', 'utf8')) || [];
      }
    } catch (e) {
      onLog(`   -> ⚠️ Gagal membaca db/antidelpanel.json: ${e.message}`);
      antidelEntries = [];
    }
    const protectedEmails = new Set(antidelEntries.filter(e => typeof e === 'string' && e.includes('@')));
    const protectedNumeric = new Set(antidelEntries.filter(e => /^\d+$/.test(String(e))).map(String));

    onLog("Mengambil daftar pengguna untuk memetakan ID yang dilindungi...");
    const allProtectedUserIDs = new Set(protectedNumeric);

    const initialUsersResponse = await fetch(`${activePanel.url}/api/application/users`, {
      headers: { 'Authorization': `Bearer ${activePanel.ptla}` }
    });
    if (!initialUsersResponse.ok) throw new Error("Gagal mengambil data pengguna awal untuk validasi antidel.");

    const initialUsersData = await initialUsersResponse.json();
    const totalUserPages = initialUsersData.meta.pagination.total_pages;

    onLog(`   -> Memeriksa ${totalUserPages} halaman pengguna untuk mencari email yang dilindungi...`);
    for (let page = 1; page <= totalUserPages; page++) {
      let usersOnPage = [];
      if (page === 1) {
        usersOnPage = initialUsersData.data;
      } else {
        const usersPageResponse = await fetch(`${activePanel.url}/api/application/users?page=${page}`, {
          headers: { 'Authorization': `Bearer ${activePanel.ptla}` }
        });
        if (!usersPageResponse.ok) continue;
        const usersPageData = await usersPageResponse.json();
        usersOnPage = usersPageData.data;
      }

      for (const user of usersOnPage) {
        const uAttr = user.attributes;
        if (uAttr.email === 'admin@gmail.com' || protectedEmails.has(uAttr.email)) {
          allProtectedUserIDs.add(String(uAttr.id));
        }
      }
    }
    onLog(`   -> Total ${allProtectedUserIDs.size} ID pengguna dilindungi (termasuk admin@gmail.com & antidel).`);

    onLog("Memulai: Mengambil data semua server dari panel...");
    const initialServersResponse = await fetch(`${activePanel.url}/api/application/servers`, {
      headers: { 'Authorization': `Bearer ${activePanel.ptla}` }
    });
    if (!initialServersResponse.ok) throw new Error("Gagal mengambil data server awal.");

    const initialServersData = await initialServersResponse.json();
    const totalServerPages = initialServersData.meta.pagination.total_pages;
    const totalServers = initialServersData.meta.pagination.total;
    onLog(`Ditemukan ${totalServers} server di ${totalServerPages} halaman. Memeriksa status...`);

    let processedServers = 0;
    for (let page = 1; page <= totalServerPages; page++) {
      onLog(`\nMemproses halaman server ${page} dari ${totalServerPages}...`);
      let serversOnPage = [];
      if (page === 1) {
        serversOnPage = initialServersData.data;
      } else {
        const serversPageResponse = await fetch(`${activePanel.url}/api/application/servers?page=${page}`, {
          headers: { 'Authorization': `Bearer ${activePanel.ptla}` }
        });
        if (!serversPageResponse.ok) continue;
        const serversPageData = await serversPageResponse.json();
        serversOnPage = serversPageData.data;
      }

      for (const server of serversOnPage) {
        processedServers++;
        const attributes = server.attributes;
        onLog(`\n(${processedServers}/${totalServers}) Memeriksa server: ${attributes.name} (Owner ID: ${attributes.user})`);

        if (allProtectedUserIDs.has(String(attributes.user))) {
          onLog(`   -> 🛡️ Dilewati: Server '${attributes.name}' dimiliki oleh akun terlindungi (admin@gmail.com atau antidel).`);
          continue;
        }

        try {
          const serverDetailsRes = await fetch(`${activePanel.url}/api/client/servers/${attributes.uuid}/resources`, {
            headers: { 'Authorization': `Bearer ${activePanel.ptlc}` }
          });

          if (!serverDetailsRes.ok) {
            onLog(`      -> ⚠️ Tidak bisa cek status server ${attributes.name} (${attributes.uuid}). Melewati. Status: ${serverDetailsRes.status}`);
            continue;
          }

          const serverDetails = await serverDetailsRes.json();
          const currentState = serverDetails.attributes.current_state;
          onLog(`      -> Status server '${attributes.name}': ${currentState}`);

          const inactiveStates = ['offline', 'suspended'];

          if (inactiveStates.includes(currentState)) {
            onLog(`   -> 🗑️ Server '${attributes.name}' dalam status tidak aktif (${currentState}). Menghapus...`);
            const deleteServerRes = await fetch(`${activePanel.url}/api/application/servers/${attributes.id}/force`, {
              method: 'DELETE', headers: { 'Authorization': `Bearer ${activePanel.ptla}` }
            });
            if (deleteServerRes.ok || deleteServerRes.status === 204) {
              onLog(`         -> ✅ Server dihapus.`);
              deletedServersCount++;
            } else {
              onLog(`         -> ❌ Gagal menghapus server. Status: ${deleteServerRes.status}`);
            }
          } else {
            onLog(`   -> ⚠️ Dilewati: Server '${attributes.name}' dalam status aktif (${currentState}).`);
          }
        } catch (e) {
          onLog(`      -> ❌ Error saat cek atau hapus server ${attributes.name}. Error: ${e.message}`);
        }
        await sleep(300);
      }
    }

    onLog(`\n✅ PROSES SELESAI (Mode: Only Inactive Servers)`);
    onLog(`Total server tidak aktif dihapus: ${deletedServersCount}`);
    return { deletedUsersCount: 0, deletedServersCount };

  } catch (error) {
    onLog(`❌ Terjadi kesalahan fatal: ${error.message}`);
    throw error;
  }
}
app.get('/api/autodelete-stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  const clientId = Date.now();
  clients.push({ id: clientId, res });
  req.on('close', () => {
    clients = clients.filter(client => client.id !== clientId);
  });
});
app.post('/api/autodelete', async (req, res) => {
  const { panelId, loggedInUsername, mode } = req.body;
  const actionUser = loggedInUsername || 'admin_website';
  if (!panelId || !global.panels[panelId]) {
    return res.status(400).json({ status: false, message: 'Panel ID tidak valid.' });
  }
  const activePanel = global.panels[panelId];
  logActivity(actionUser, `Memulai proses auto-delete (mode: ${mode}) untuk panel: ${activePanel.name}.`);
  res.json({ status: true, message: 'Proses dimulai.' });

  (async () => {
    try {
      sendToAll(`Memulai proses hapus otomatis (Mode: ${mode}) untuk panel: ${activePanel.name}...`);
      let result;
      if (mode === 'inactive') {
        result = await deleteInactiveUsersAndServers(activePanel, sendToAll);
      } else if (mode === 'only-inactive-servers') {
        result = await deleteOnlyInactiveServers(activePanel, sendToAll);
      } else {
        result = await deleteAllUsersAndServers(activePanel, panelId, sendToAll);
      }
      const { deletedUsersCount, deletedServersCount } = result;
      sendToAll(`\n✅ PROSES SELESAI`);
      sendToAll(`Laporan Akhir:`);
      sendToAll(`- Total Pengguna Dihapus: ${deletedUsersCount}`);
      sendToAll(`- Total Server Dihapus: ${deletedServersCount}`);
    } catch (error) {
      sendToAll(`\n❌ PROSES GAGAL: ${error.message}`);
    }
  })();
});
// =====================================================================================

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    // 1. Cek Admin Website
    const admins = JSON.parse(fs.readFileSync(adminDbPath, 'utf8'));
    if (admins[username] && password === admins[username]) {
      req.session.user = {
        username,
        role: 'admin_website',
        isMainDb: true,
        isPanel3User: false // [PERUBAHAN BARU]
      };
      logActivity(username, 'Berhasil login sebagai Admin Website.');
      return res.json({
        status: true,
        message: 'Login Admin Berhasil',
        isAdmin: true,
        role: 'admin_website',
        isMainDb: true
      });
    }

    // 2. Cek DB Utama (user.json)
    const users = JSON.parse(fs.readFileSync(userDbPath, 'utf8'));
    for (const r of ROLE_ORDER) {
      if (users[r]?.[username] && password === users[r][username].password) {
        req.session.user = {
          username,
          role: r,
          isMainDb: true,
          isPanel3User: false // [PERUBAHAN BARU]
        };
        logActivity(username, `Berhasil login (Main DB) sebagai role: ${r}.`);
        return res.json({
          status: true,
          message: 'Login Berhasil',
          isAdmin: false,
          role: r,
          isReseller: r === 'reseller',
          isMainDb: true
        });
      }
    }

    // 3. Cek DB Buyer Luar (user-buyerluar.json)
    const usersLuar = JSON.parse(fs.readFileSync(userBuyerLuarDbPath, 'utf8'));
    for (const r of ROLE_ORDER) {
      if (usersLuar[r]?.[username] && password === usersLuar[r][username].password) {
        req.session.user = {
          username,
          role: r,
          isMainDb: false,
          isPanel3User: false // [PERUBAHAN BARU]
        };
        logActivity(username, `Berhasil login (Luar DB) sebagai role: ${r}.`);
        return res.json({
          status: true,
          message: 'Login Berhasil',
          isAdmin: false,
          role: r,
          isReseller: r === 'reseller',
          isMainDb: false
        });
      }
    }

    // 4. [PERUBAHAN BARU] Cek DB Panel 3 (user-panel3.json)
    const usersPanel3 = JSON.parse(fs.readFileSync(userPanel3DbPath, 'utf8'));
    for (const r of ROLE_ORDER) {
      if (usersPanel3[r]?.[username] && password === usersPanel3[r][username].password) {
        req.session.user = {
          username,
          role: r,
          isMainDb: false, // Dianggap false karena bukan staf
          isPanel3User: true // Flag khusus
        };
        logActivity(username, `Berhasil login (Panel 3 DB) sebagai role: ${r}.`);
        return res.json({
          status: true,
          message: 'Login Berhasil',
          isAdmin: false,
          role: r,
          isReseller: r === 'reseller',
          isMainDb: false,
          isPanel3User: true // Kirim flag ini
        });
      }
    }

    // 5. Cek akun hasil pembelian role via QRIS (disimpan di MongoDB, biar aman kalau di-deploy Vercel)
    try {
      const buyerCol = await getBuyerAccountsCollection();
      const buyerAcc = await buyerCol.findOne({ username });
      if (buyerAcc && password === buyerAcc.password) {
        req.session.user = {
          username,
          role: buyerAcc.role,
          isMainDb: false,
          isPanel3User: false
        };
        logActivity(username, `Berhasil login (Buyer QRIS/MongoDB) sebagai role: ${buyerAcc.role}.`);
        return res.json({
          status: true,
          message: 'Login Berhasil',
          isAdmin: false,
          role: buyerAcc.role,
          isReseller: buyerAcc.role === 'reseller',
          isMainDb: false
        });
      }
    } catch (mongoErr) {
      // Kalau MongoDB belum dikonfigurasi/gak bisa konek, jangan sampai bikin login lain ikut gagal
      console.error('Gagal cek akun buyer QRIS di MongoDB:', mongoErr.message);
    }

    // 6. Gagal Login
    logActivity(username, 'Gagal login: Username atau password salah.');
    res.json({ status: false, message: 'Username atau password salah!' });
  } catch (error) {
    logActivity(username, `Error saat mencoba login: ${error.message}`);
    res.status(500).json({ status: false, message: 'Terjadi kesalahan server.' });
  }
});

// =================================================================
// --- LOGIKA /CPANEL (Diperbarui dengan LOGIKA BARU ANDA) ---
// =================================================================
app.post('/cpanel', async (req, res) => {
  let {
    nama, ram, sandi, isAdmin, creatorRole, telegramId,
    panelId, loggedInUsername, buyerType
  } = req.body;

  const actionUser = loggedInUsername || creatorRole || 'unknown_buyer';

  const sessionUser = req.session.user;
  if (!sessionUser) {
    return res.status(401).json({ status: false, message: 'Sesi tidak valid. Silakan login ulang.' });
  }

  const sessionRole = sessionUser.role;
  const isMainDbUser = sessionUser.isMainDb;
  const isPanel3User = sessionUser.isPanel3User; // [PERUBAHAN BARU]

  let activePanel;

  // --- [PERUBAHAN LOGIKA BARU ANDA v3] ---
  if (isPanel3User) {
    // 1. Jika ini pengguna Panel 3, paksa gunakan panel3
    logActivity(actionUser, `Pengguna Panel 3 terdeteksi. Memaksa penggunaan panel3.`);
    activePanel = global.panels['panel3'];
    isAdmin = false; // Pengguna Panel 3 tidak bisa buat admin
    buyerType = null; // Tidak perlu validasi ID ARMUFA CPANEL

  } else if (sessionRole === 'admin_website') {
    // 2. Jika Admin Website, gunakan panelId yang dipilih
    if (!panelId || !global.panels[panelId]) {
      logActivity(actionUser, 'Gagal: Admin Website tidak memilih panelId yang valid.');
      return res.status(400).json({ status: false, message: 'Konfigurasi panel tidak valid. Silakan pilih panel di halaman admin.' });
    }
    activePanel = global.panels[panelId];
    logActivity(actionUser, `Admin menggunakan panel: ${activePanel.name}`);
    // buyerType (asta/luar) dihormati

  } else {
    // 3. Jika ini Staf (mainDb) atau Buyer Luar (non-mainDb)
    isAdmin = false; // Non-admin tidak bisa buat admin

    if (isMainDbUser === false) {
      // 3a. User dari user-buyerluar.json (isMainDb: false, isPanel3User: false)
      buyerType = 'luar'; // Paksa ke 'luar'
      logActivity(actionUser, `Peran non-admin (Luar DB) terdeteksi. Memaksa penggunaan panel 'luar' (Panel 2).`);
    } else {
      // 3b. User dari user.json (isMainDb: true)
      logActivity(actionUser, `Peran non-admin (Main DB) terdeteksi. Menggunakan buyerType dari frontend: ${buyerType}`);
    }

    // Tentukan panel berdasarkan buyerType
    if (buyerType === 'asta') {
      activePanel = global.panels['panel1'];
    } else if (buyerType === 'luar') {
      activePanel = global.panels['panel2'];
    }
  }
  // --- [AKHIR PERUBAHAN] ---

  logActivity(actionUser, `Mencoba membuat panel baru: ${nama}, RAM: ${ram}, Tipe: ${buyerType || 'panel3'}.`);

  try {
    // Cek jika activePanel belum terdefinisi (misal, Staf tapi buyerType tidak valid)
    if (!activePanel) {
      if (isPanel3User) {
        logActivity(actionUser, 'Gagal: Konfigurasi panel3 tidak ditemukan di setting.js.');
        return res.status(500).json({ status: false, message: 'Konfigurasi panel private tidak ditemukan.' });
      }
      logActivity(actionUser, 'Gagal: Konfigurasi panel (panel1 atau panel2) tidak ditemukan di setting.js.');
      return res.status(500).json({ status: false, message: 'Konfigurasi panel default tidak ditemukan.' });
    }

    // --- Validasi ID ARMUFA CPANEL (HANYA jika buyerType adalah 'asta') ---
    if (buyerType === 'asta') {
      logActivity(actionUser, 'Proses sebagai Buyer ARMUFA CPANEL. Memeriksa ID Telegram...');
      let idBuyerAsta = [];
      try {
        idBuyerAsta = JSON.parse(fs.readFileSync(idBuyerAstaDbPath, 'utf8'));
      } catch (dbError) {
        console.error(`Gagal membaca ${idBuyerAstaDbPath}:`, dbError);
        return res.status(500).json({ status: false, message: 'Gagal memvalidasi database buyer.' });
      }

      if (!idBuyerAsta.includes(telegramId)) {
        logActivity(actionUser, `Gagal: ID Telegram ${telegramId} tidak ada di db/idbuyerasta.json.`);
        return res.status(403).json({ status: false, message: `ID Telegram ${telegramId} tidak terdaftar sebagai Buyer ARMUFA CPANEL. Gagal membuat panel.` });
      }
      logActivity(actionUser, `ID Telegram ${telegramId} tervalidasi.`);
    }
    // --- Akhir Validasi ID ARMUFA CPANEL ---

    // --- Lanjut ke proses pembuatan panel ---
    const packages = {
      "1gb": { memory: "1024", disk: "1024", cpu: "40" }, "2gb": { memory: "2048", disk: "2048", cpu: "60" }, "3gb": { memory: "3072", disk: "3072", cpu: "80" }, "4gb": { memory: "4096", disk: "4096", cpu: "100" }, "5gb": { memory: "5120", disk: "5120", cpu: "120" }, "6gb": { memory: "6144", disk: "6144", cpu: "140" }, "7gb": { memory: "7168", disk: "7168", cpu: "160" }, "8gb": { memory: "8192", disk: "8192", cpu: "180" }, "9gb": { memory: "9216", disk: "9216", cpu: "200" }, "10gb": { memory: "10240", disk: "10240", cpu: "220" }, "unli": { memory: "0", disk: "0", cpu: "0" }
    };
    const username = nama;
    const email = username + "@ARMUFACPANEL.PANEL";

    const userPayload = { email: email, username: username, first_name: username, last_name: telegramId, password: sandi, root_admin: isAdmin || false };
    const userResponse = await fetch(`${activePanel.url}/api/application/users`, { method: 'POST', headers: { 'Authorization': `Bearer ${activePanel.ptla}`, 'Content-Type': 'application/json', 'Accept': 'application/json' }, body: JSON.stringify(userPayload) });
    const userData = await userResponse.json();
    if (userData.errors) {
      logActivity(actionUser, `Gagal membuat user di Pterodactyl: ${userData.errors[0].detail}`);
      return res.status(400).json({ status: false, message: userData.errors[0].detail });
    }

    const userId = userData.attributes.id;
    const eggResponse = await fetch(`${activePanel.url}/api/application/nests/${activePanel.nest}/eggs/${activePanel.egg}`, { headers: { 'Authorization': `Bearer ${activePanel.ptla}`, 'Accept': 'application/json' } });
    const eggData = await eggResponse.json();

    const serverPayload = { name: username, user: userId, egg: parseInt(activePanel.egg), docker_image: "ghcr.io/parkervcp/yolks:nodejs_21", startup: eggData.attributes.startup, environment: { "INST": "npm", "USER_UPLOAD": "0", "AUTO_UPDATE": "0", "CMD_RUN": "npm start" }, limits: { ...packages[ram], swap: 0, io: 500 }, feature_limits: { databases: 5, backups: 5, allocations: 5 }, deploy: { locations: [parseInt(activePanel.loc)], dedicated_ip: false, port_range: [] } };
    const serverResponse = await fetch(`${activePanel.url}/api/application/servers`, { method: 'POST', headers: { 'Authorization': `Bearer ${activePanel.ptla}`, 'Content-Type': 'application/json', 'Accept': 'application/json' }, body: JSON.stringify(serverPayload) });
    const serverData = await serverResponse.json();

    if (serverData.errors) {
      logActivity(actionUser, `Gagal membuat server: ${serverData.errors[0].detail}. Menghapus user...`);
      await fetch(`${activePanel.url}/api/application/users/${userId}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${activePanel.ptla}` } });
      return res.status(400).json({ status: false, message: `Gagal membuat server: ${serverData.errors[0].detail}` });
    }

    const targetUser = `[${telegramId}](tg://user?id=${telegramId})`;
    const messageText = `\nHai ${targetUser},\nBerikut data akun panel anda:\n\n🆔 **ID:** \`${userId}\`\n👤 **USERNAME:** \`${username}\`\n🔐 **PASSWORD:** \`${sandi}\`\n\n🌐 **Domain:** \`${activePanel.url}\`\n\n📜 **Syarat Dan Ketentuan !!**\n- Jaga data panel anda!!\n- Jangan memakai script ddos\n- Jangan sebar link panel\n- Masa berlaku panel ini adalah 1 bulan\n\nGunakan panel anda dengan bijak.\n    `;
    const photoUrl = 'https://files.catbox.moe/fg5swy.jpg';
    await sendBotMessage(telegramId, messageText, photoUrl);

    logActivity(actionUser, `Berhasil membuat panel ${username} di ${activePanel.name}.`);
    res.json({ status: true, message: `Akun berhasil dibuat dan detail telah dikirim ke ${telegramId}!` });

  } catch (error) {
    console.error("Kesalahan CPanel:", error);
    logActivity(actionUser, `Error fatal di /cpanel: ${error.message}`);
    res.status(500).json({ status: false, message: 'Terjadi kesalahan internal server.' });
  }
});

// =================================================================
// --- LOGIKA /api/addserver (Diperbarui dengan LOGIKA BARU ANDA) ---
// =================================================================
app.post('/api/addserver', async (req, res) => {
  let { userId, serverName, ram, creatorRole, panelId, loggedInUsername, buyerType } = req.body;
  const actionUser = loggedInUsername || creatorRole;

  const sessionUser = req.session.user;
  if (!sessionUser) {
    return res.status(401).json({ status: false, message: 'Sesi tidak valid. Silakan login ulang.' });
  }

  const sessionRole = sessionUser.role;
  const isMainDbUser = sessionUser.isMainDb;
  const isPanel3User = sessionUser.isPanel3User; // [PERUBAHAN BARU]

  let activePanel;

  // --- [PERUBAHAN LOGIKA BARU ANDA v3] ---
  if (isPanel3User) {
    // 1. Jika ini pengguna Panel 3, paksa gunakan panel3
    logActivity(actionUser, `Pengguna Panel 3 terdeteksi. Memaksa penggunaan panel3.`);
    activePanel = global.panels['panel3'];
    buyerType = null; // Tidak perlu validasi ID ARMUFA CPANEL

  } else if (sessionRole === 'admin_website') {
    // 2. Jika Admin Website, gunakan panelId yang dipilih
    if (!panelId || !global.panels[panelId]) {
      return res.status(400).json({ status: false, message: 'Konfigurasi panel tidak valid. Silakan pilih panel.' });
    }
    activePanel = global.panels[panelId];
    logActivity(actionUser, `Admin menggunakan panel: ${activePanel.name}`);
    // buyerType (asta/luar) dihormati

  } else {
    // 3. Jika ini Staf (mainDb) atau Buyer Luar (non-mainDb)
    if (isMainDbUser === false) {
      // 3a. User dari user-buyerluar.json (isMainDb: false, isPanel3User: false)
      buyerType = 'luar'; // Paksa ke 'luar'
      logActivity(actionUser, `Peran non-admin (Luar DB) terdeteksi. Memaksa penggunaan panel 'luar' (Panel 2).`);
    } else {
      // 3b. User dari user.json (isMainDb: true)
      logActivity(actionUser, `Peran non-admin (Main DB) terdeteksi. Menggunakan buyerType dari frontend: ${buyerType}`);
    }

    // Tentukan panel berdasarkan buyerType
    if (buyerType === 'asta') {
      activePanel = global.panels['panel1'];
    } else if (buyerType === 'luar') {
      activePanel = global.panels['panel2'];
    }
  }
  // --- [AKHIR PERUBAHAN] ---

  logActivity(actionUser, `Mencoba menambahkan server '${serverName}' untuk User ID: ${userId}, Tipe: ${buyerType || 'panel3'}.`);

  try {
    // Cek jika activePanel belum terdefinisi
    if (!activePanel) {
      if (isPanel3User) {
        logActivity(actionUser, 'Gagal: Konfigurasi panel3 tidak ditemukan di setting.js.');
        return res.status(500).json({ status: false, message: 'Konfigurasi panel private tidak ditemukan.' });
      }
      logActivity(actionUser, 'Gagal: Konfigurasi panel (panel1 atau panel2) tidak ditemukan di setting.js.');
      return res.status(500).json({ status: false, message: 'Konfigurasi panel default tidak ditemukan.' });
    }

    const packages = {
      "1gb": { memory: "1024", disk: "1024", cpu: "40" },
      "2gb": { memory: "2048", disk: "2048", cpu: "60" },
      "3gb": { memory: "3072", disk: "3072", cpu: "80" },
      "4gb": { memory: "4096", disk: "4096", cpu: "100" },
      "5gb": { memory: "5120", disk: "5120", cpu: "120" },
      "6gb": { memory: "6144", disk: "6144", cpu: "140" },
      "7gb": { memory: "7168", disk: "7168", cpu: "160" },
      "8gb": { memory: "8192", disk: "8192", cpu: "180" },
      "9gb": { memory: "9216", disk: "9216", cpu: "200" },
      "10gb": { memory: "10240", disk: "10240", cpu: "220" },
      "unli": { memory: "0", disk: "0", cpu: "0" }
    };

    // --- Validasi User (Cek Batas Server & Validasi ARMUFA CPANEL) ---
    logActivity(actionUser, `Mengecek detail & batas server untuk User ID: ${userId} di panel ${activePanel.name}.`);
    const userDetailsResponse = await fetch(`${activePanel.url}/api/application/users/${userId}?include=servers`, {
      headers: { 'Authorization': `Bearer ${activePanel.ptla}` }
    });

    if (!userDetailsResponse.ok) {
      return res.status(404).json({ status: false, message: `User dengan ID ${userId} tidak ditemukan di panel ${activePanel.name}.` });
    }

    const userDetails = await userDetailsResponse.json();

    // --- VALIDASI ARMUFA CPANEL (Hanya relevan jika buyerType adalah 'asta') ---
    if (buyerType === 'asta') {
      const lastNameAsTelegramId = userDetails.attributes.last_name;
      logActivity(actionUser, `Memvalidasi Telegram ID (last_name) user: ${lastNameAsTelegramId}`);

      let idBuyerAsta = [];
      try {
        idBuyerAsta = JSON.parse(fs.readFileSync(idBuyerAstaDbPath, 'utf8'));
      } catch (dbError) {
        console.error(`Gagal membaca ${idBuyerAstaDbPath}:`, dbError);
        return res.status(500).json({ status: false, message: 'Gagal memvalidasi database buyer.' });
      }

      if (!idBuyerAsta.includes(lastNameAsTelegramId)) {
        logActivity(actionUser, `Gagal: User ID ${userId} (Tele ID: ${lastNameAsTelegramId}) tidak ada di db/idbuyerasta.json.`);
        return res.status(403).json({ status: false, message: `Gagal menambah server: User ID ${userId} tidak terdaftar sebagai Buyer ARMUFA CPANEL.` });
      }
      logActivity(actionUser, `User ID ${userId} tervalidasi sebagai Buyer ARMUFA CPANEL.`);
    }

    // --- Cek Batas Server (HANYA JIKA non-admin) ---
    if (sessionRole !== 'admin_website') {
      const serverCount = userDetails.attributes.relationships.servers.data.length;
      if (serverCount >= 3) {
        logActivity(actionUser, `Gagal menambah server untuk User ID ${userId}. Batas 3 server tercapai.`);
        return res.status(403).json({ status: false, message: 'Batas maksimal 3 server per pengguna telah tercapai.' });
      }
    }

    // --- Lolos Validasi, Buat Server ---
    const eggResponse = await fetch(`${activePanel.url}/api/application/nests/${activePanel.nest}/eggs/${activePanel.egg}`, {
      headers: { 'Authorization': `Bearer ${activePanel.ptla}`, 'Accept': 'application/json' }
    });
    const eggData = await eggResponse.json();
    if (!eggResponse.ok) throw new Error("Gagal mengambil data Egg.");

    const serverPayload = {
      name: serverName,
      user: parseInt(userId),
      egg: parseInt(activePanel.egg),
      docker_image: "ghcr.io/parkervcp/yolks:nodejs_21",
      startup: eggData.attributes.startup,
      environment: { "INST": "npm", "USER_UPLOAD": "0", "AUTO_UPDATE": "0", "CMD_RUN": "npm start" },
      limits: { ...packages[ram], swap: 0, io: 500 },
      feature_limits: { databases: 5, backups: 5, allocations: 5 },
      deploy: { locations: [parseInt(activePanel.loc)], dedicated_ip: false, port_range: [] }
    };

    const serverResponse = await fetch(`${activePanel.url}/api/application/servers`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${activePanel.ptla}`, 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(serverPayload)
    });
    const serverData = await serverResponse.json();

    if (serverData.errors) {
      logActivity(actionUser, `Gagal membuat server di Pterodactyl: ${serverData.errors[0].detail}`);
      return res.status(400).json({ status: false, message: `Gagal membuat server: ${serverData.errors[0].detail}` });
    }

    logActivity(actionUser, `Berhasil menambah server '${serverName}' untuk User ID ${userId} di ${activePanel.name}.`);
    res.json({ status: true, message: `Server '${serverName}' berhasil ditambahkan untuk User ID ${userId}!` });

  } catch (error) {
    console.error("Kesalahan Add Server:", error);
    logActivity(actionUser, `Error fatal di /api/addserver: ${error.message}`);
    res.status(500).json({ status: false, message: 'Terjadi kesalahan internal server.' });
  }
});
// =================================================================

// Di dalam index.js (Contoh Perbaikan)
app.get('/api/users', (req, res) => {
  // Ambil nama database dari query, default ke 'user.json'
  const dbName = req.query.db || 'user.json';

  // Validasi nama file agar aman
  const allowedDBs = ['user.json', 'user-buyerluar.json', 'user-panel3.json'];
  if (!allowedDBs.includes(dbName)) {
    return res.status(400).json({ status: false, message: 'Database tidak valid' });
  }

  // Buat path file yang aman
  // path.join akan membuat path seperti /home/container/db/user.json
  const filePath = path.join(__dirname, 'db', dbName);

  try {
    // [INI PERBAIKANNYA]
    // Ganti readJsonFile() dengan dua langkah ini:

    // A. Baca file secara sinkron (sync)
    const fileContent = fs.readFileSync(filePath, 'utf8');

    // B. Ubah (parse) konten file dari teks menjadi objek JSON
    const users = JSON.parse(fileContent);

    res.json({ status: true, usersByRole: users });

  } catch (error) {
    console.error(`Gagal membaca ${filePath}:`, error);

    // Kirim error yang lebih spesifik jika file tidak ada
    if (error.code === 'ENOENT') {
      // ENOENT = Error No Entry (File tidak ditemukan)
      return res.status(404).json({ status: false, message: 'File database tidak ditemukan.' });
    }

    res.status(500).json({ status: false, message: 'Gagal memuat data pengguna' });
  }
});

// =================================================================
// --- LOGIKA /api/adduser (Diperbarui dengan LOGIKA BARU ANDA) ---
// =================================================================
app.post('/api/adduser', async (req, res) => {
  // [PERUBAHAN BARU] Ambil userType dari body
  const { username, password, role, creatorRole, telegramId, loggedInUsername, userType } = req.body;
  const actionUser = loggedInUsername || creatorRole;

  logActivity(actionUser, `Mencoba menambahkan pengguna baru: '${username}' dengan role: '${role}'. Tipe: ${userType}`);
  if (!username || !password || !role || !telegramId) {
    return res.status(400).json({ status: false, message: 'Data tidak lengkap.' });
  }

  // --- LOGIKA HAK AKSES ---
  if (role === 'ceo' && creatorRole !== 'admin_website') {
    logActivity(actionUser, `Gagal: Hanya Admin Website yang dapat membuat role CEO.`);
    return res.status(403).json({ status: false, message: 'Hanya Admin Website yang dapat membuat peran CEO.' });
  }

  if (creatorRole !== 'admin_website') {
    const idxCreator = ROLE_ORDER.indexOf(creatorRole);
    const idxTarget = ROLE_ORDER.indexOf(role);

    if (idxCreator === -1 || idxTarget === -1) {
      logActivity(actionUser, `Gagal: Peran tidak valid (Creator: ${idxCreator}, Target: ${idxTarget}).`);
      return res.status(400).json({ status: false, message: `Peran tidak valid.` });
    }

    if (idxTarget <= idxCreator) {
      logActivity(actionUser, `Gagal: Role ${creatorRole} (idx ${idxCreator}) tidak bisa membuat role ${role} (idx ${idxTarget}).`);
      return res.status(403).json({ status: false, message: `Peran Anda tidak diizinkan membuat peran ${role}.` });
    }
  }
  // --- AKHIR LOGIKA HAK AKSES ---

  try {
    // --- [PERUBAHAN LOGIKA BARU ANDA v3] ---
    let targetDbPath;

    if (creatorRole === 'admin_website') {
      // Admin website memilih target
      if (userType === 'panel3') {
        targetDbPath = userPanel3DbPath;
        logActivity(actionUser, 'Admin Website memilih target Panel 3 -> user-panel3.json');
      } else {
        targetDbPath = userDbPath; // Default ke user.json (Staf)
        logActivity(actionUser, 'Admin Website memilih target Staf -> user.json');
      }
    } else {
      // Staf (dari user.json) hanya bisa membuat Buyer Luar
      targetDbPath = userBuyerLuarDbPath;
      logActivity(actionUser, `Role ${creatorRole} terdeteksi, menyimpan ke user-buyerluar.json`);
    }
    // --- [AKHIR PERUBAHAN] ---

    // Cek duplikat di SEMUA database
    const usersMain = JSON.parse(fs.readFileSync(userDbPath, 'utf8'));
    const usersLuar = JSON.parse(fs.readFileSync(userBuyerLuarDbPath, 'utf8'));
    const usersPanel3 = JSON.parse(fs.readFileSync(userPanel3DbPath, 'utf8'));

    for (const r of ROLE_ORDER) {
      if (usersMain[r]?.[username] || usersLuar[r]?.[username] || usersPanel3[r]?.[username]) {
        logActivity(actionUser, `Gagal: Username ${username} sudah ada di salah satu database.`);
        return res.status(409).json({ status: false, message: 'Username sudah ada.' });
      }
    }

    // Baca dan tulis ke database yang TEPAT
    const db = JSON.parse(fs.readFileSync(targetDbPath, 'utf8'));

    if (!db[role]) db[role] = {};

    db[role][username] = { password: password, createdAt: new Date().toISOString() };
    fs.writeFileSync(targetDbPath, JSON.stringify(db, null, 2));

    const messageText = `\n✅ **Akun Baru Telah Dibuat**\nSebuah akun baru telah berhasil dibuat.\n\nBerikut adalah detailnya:\n- **Username:** \`${username}\`\n- **Password:** \`${password}\`\n- **Role:** \`${role.replace(/_/g, ' ')}\`\n\nSilakan login dan gunakan dengan bijak.\n        `;
    await sendBotMessage(telegramId, messageText);
    res.json({ status: true, message: `Pengguna ${username} berhasil ditambahkan.` });
  } catch (error) {
    console.error("Add User Error:", error);
    res.status(500).json({ status: false, message: 'Terjadi kesalahan server.' });
  }
});

// [PERUBAHAN] Rute ini sekarang HANYA MENGEDIT user.json
app.post('/api/edituser', async (req, res) => {
  const { username, role, newRole, newPassword, telegramId, loggedInUsername } = req.body;
  const actionUser = loggedInUsername || 'admin_website';

  logActivity(actionUser, `Mencoba mengedit pengguna (di user.json): '${username}'. Role baru: ${newRole}, Password baru: ${newPassword ? 'Ada' : 'Tidak ada'}.`);

  const creatorRole = req.session.user.role;
  if (newRole === 'ceo' && creatorRole !== 'admin_website') {
    logActivity(actionUser, `Gagal: Hanya Admin Website yang dapat memindahkan user ke role CEO.`);
    return res.status(403).json({ status: false, message: 'Hanya Admin Website yang dapat menjadikan pengguna sebagai CEO.' });
  }

  try {
    const users = JSON.parse(fs.readFileSync(userDbPath, 'utf8')); // Hanya baca user.json
    if (!users[role]?.[username]) {
      return res.status(404).json({ status: false, message: 'Pengguna tidak ditemukan di db/user.json.' });
    }
    const userData = { ...users[role][username] };
    if (newPassword) userData.password = newPassword;
    if (role !== newRole) {
      delete users[role][username];
      if (!users[newRole]) users[newRole] = {};
      users[newRole][username] = userData;
    } else {
      users[role][username] = userData;
    }
    fs.writeFileSync(userDbPath, JSON.stringify(users, null, 2)); // Hanya tulis ke user.json
    if (telegramId) {
      let changes = [];
      if (role !== newRole) changes.push(`- **Role Diubah:** dari \`${role}\` menjadi \`${newRole}\``);
      if (newPassword) changes.push(`- **Password Baru:** \`${newPassword}\``);
      if (changes.length > 0) {
        const messageText = `\n⚙️ **Akun Telah Diperbarui**\nDetail untuk akun **${username}** telah diubah.\n\nPerubahan:\n${changes.join('\n')}\n`;
        await sendBotMessage(telegramId, messageText);
      }
    }
    res.json({ status: true, message: `Pengguna ${username} berhasil diperbarui.` });
  } catch (error) {
    res.status(500).json({ status: false, message: 'Terjadi kesalahan server.' });
  }
});

// [PERUBAHAN] Rute ini sekarang HANYA MENGHAPUS dari user.json
app.post('/api/deleteuser', (req, res) => {
  const { username, role, loggedInUsername } = req.body;
  const actionUser = loggedInUsername || 'admin_website';

  logActivity(actionUser, `Mencoba menghapus pengguna (dari user.json): '${username}' dari role: '${role}'.`);
  try {
    const users = JSON.parse(fs.readFileSync(userDbPath, 'utf8')); // Hanya baca user.json
    if (users[role]?.[username]) {
      delete users[role][username];
      fs.writeFileSync(userDbPath, JSON.stringify(users, null, 2)); // Hanya tulis ke user.json
      res.json({ status: true, message: `Pengguna ${username} berhasil dihapus.` });
    } else {
      res.status(404).json({ status: false, message: 'Pengguna tidak ditemukan di db/user.json.' });
    }
  } catch (error) {
    res.status(500).json({ status: false, message: 'Terjadi kesalahan server.' });
  }
});

// [PERUBAHAN] Rute ini sekarang HANYA MENGHAPUS SEMUA dari user.json
app.post('/api/deleteallusers', (req, res) => {
  const { role, loggedInUsername } = req.body;
  const actionUser = loggedInUsername || 'admin_website';

  logActivity(actionUser, `Mencoba menghapus SEMUA pengguna (dari user.json) dari role: '${role}'.`);
  if (!role || role === 'all') {
    return res.status(400).json({ status: false, message: 'Peran yang akan dihapus tidak valid.' });
  }
  try {
    const users = JSON.parse(fs.readFileSync(userDbPath, 'utf8')); // Hanya baca user.json
    if (users[role]) {
      users[role] = {}; // Kosongkan objek untuk peran tersebut
      fs.writeFileSync(userDbPath, JSON.stringify(users, null, 2)); // Hanya tulis ke user.json
      res.json({ status: true, message: `Semua pengguna dengan peran ${role} berhasil dihapus.` });
    } else {
      res.status(404).json({ status: false, message: 'Peran tidak ditemukan atau sudah kosong.' });
    }
  } catch (error) {
    res.status(500).json({ status: false, message: 'Terjadi kesalahan server saat menghapus pengguna.' });
  }
});

// ======================= FITUR BELI ROLE VIA QRIS (PAKASIR) =======================

// Daftar harga role buat landing page (dibaca langsung dari setting.js)
app.get('/api/roles', (req, res) => {
  try {
    const purchasable = global.purchasableRoles || [];
    const roles = purchasable
      .map((key) => {
        const r = global.rolePrices?.[key];
        if (!r) return null;
        return { key, name: r.name, price: r.price, tag: r.tag, featured: !!r.featured, desc: r.desc || [] };
      })
      .filter(Boolean);
    res.json({ status: true, roles });
  } catch (error) {
    res.status(500).json({ status: false, message: 'Gagal memuat daftar harga role.' });
  }
});

function generateRandomPassword() {
  return crypto.randomBytes(6).toString('base64url'); // ~8 karakter, aman buat URL/teks
}

function isValidUsername(username) {
  return typeof username === 'string' && /^[a-zA-Z0-9_]{3,20}$/.test(username);
}

async function isUsernameTaken(username) {
  try {
    const usersMain = JSON.parse(fs.readFileSync(userDbPath, 'utf8'));
    const usersLuar = JSON.parse(fs.readFileSync(userBuyerLuarDbPath, 'utf8'));
    const usersPanel3 = JSON.parse(fs.readFileSync(userPanel3DbPath, 'utf8'));
    for (const r of ROLE_ORDER) {
      if (usersMain[r]?.[username] || usersLuar[r]?.[username] || usersPanel3[r]?.[username]) return true;
    }
  } catch (e) {
    console.error('Gagal cek username di file JSON:', e.message);
  }
  try {
    const buyerCol = await getBuyerAccountsCollection();
    const existing = await buyerCol.findOne({ username });
    if (existing) return true;
  } catch (e) {
    console.error('Gagal cek username di MongoDB:', e.message);
  }
  return false;
}

function buildCredentialText(roleName, username, password) {
  return `✅ *Akun ${roleName} Berhasil Dibuat!*\n\nTerima kasih sudah melakukan pembelian.\nBerikut detail akun kamu:\n\n- *Username:* \`${username}\`\n- *Password:* \`${password}\`\n- *Role:* \`${roleName}\`\n\nSilakan login di halaman /login. Simpan baik-baik ya!`;
}

// Selesaikan transaksi yang sudah lunas: bikin akun + kirim kredensial (idempotent)
async function finalizePaidTransaction(trx) {
  const txCol = await getTransactionsCollection();
  if (trx.status === 'paid') return trx; // sudah pernah diproses

  const roleInfo = global.rolePrices?.[trx.roleKey];
  const buyerCol = await getBuyerAccountsCollection();

  // Jaga-jaga kalau ternyata username kepakai orang lain pas nunggu bayar
  const already = await buyerCol.findOne({ username: trx.username });
  if (already) {
    trx.username = `${trx.username}_${Date.now().toString().slice(-4)}`;
  }

  await buyerCol.insertOne({
    username: trx.username,
    password: trx.password,
    role: trx.roleKey,
    orderId: trx.orderId,
    createdAt: new Date(),
  });

  let waLink = null;
  if (trx.deliveryMethod === 'bot' && trx.telegramId) {
    await sendBotMessage(trx.telegramId, buildCredentialText(roleInfo?.name || trx.roleKey, trx.username, trx.password));
  } else if (trx.deliveryMethod === 'wa' && trx.waNumber) {
    const text = buildCredentialText(roleInfo?.name || trx.roleKey, trx.username, trx.password);
    waLink = `https://wa.me/${trx.waNumber}?text=${encodeURIComponent(text)}`;
  }

  const update = { status: 'paid', paidAt: new Date(), waLink };
  await txCol.updateOne({ orderId: trx.orderId }, { $set: update });
  return { ...trx, ...update };
}

// Bikin transaksi QRIS baru buat beli role
app.post('/api/checkout/create', async (req, res) => {
  try {
    const { roleKey, username, password, deliveryMethod, telegramId, waNumber } = req.body;

    if (!global.purchasableRoles?.includes(roleKey)) {
      return res.status(400).json({ status: false, message: 'Role tidak valid atau tidak bisa dibeli langsung.' });
    }
    const roleInfo = global.rolePrices[roleKey];
    if (!isValidUsername(username)) {
      return res.status(400).json({ status: false, message: 'Username minimal 3 karakter, hanya huruf/angka/underscore.' });
    }
    if (deliveryMethod === 'bot' && !telegramId) {
      return res.status(400).json({ status: false, message: 'ID Telegram wajib diisi untuk pengiriman via bot.' });
    }
    if (deliveryMethod === 'wa' && !/^62\d{8,14}$/.test(String(waNumber || ''))) {
      return res.status(400).json({ status: false, message: 'Nomor WA wajib diawali 62 dan valid.' });
    }
    if (await isUsernameTaken(username)) {
      return res.status(409).json({ status: false, message: 'Username sudah dipakai, pilih username lain.' });
    }

    const finalPassword = password && password.length >= 4 ? password : generateRandomPassword();
    const orderId = `RP${Date.now()}${crypto.randomBytes(2).toString('hex')}`.toUpperCase();

    const payment = await createQrisTransaction(orderId, roleInfo.price);
    const qrImage = await QRCode.toDataURL(payment.payment_number, { width: 320, margin: 1 });

    const txCol = await getTransactionsCollection();
    await txCol.insertOne({
      orderId,
      roleKey,
      username,
      password: finalPassword,
      deliveryMethod,
      telegramId: telegramId || null,
      waNumber: waNumber || null,
      amount: roleInfo.price,
      status: 'pending',
      createdAt: new Date(),
    });

    logActivity(username, `Membuat transaksi QRIS untuk role '${roleKey}' (order: ${orderId}).`);
    res.json({
      status: true,
      orderId,
      qrImage,
      amount: roleInfo.price,
      totalPayment: payment.total_payment,
      roleName: roleInfo.name,
    });
  } catch (error) {
    console.error('Checkout create error:', error.message);
    res.status(500).json({ status: false, message: error.message || 'Gagal membuat transaksi QRIS.' });
  }
});

// Cek status pembayaran (dipanggil polling dari landing page)
app.get('/api/checkout/status/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;
    const txCol = await getTransactionsCollection();
    let trx = await txCol.findOne({ orderId });
    if (!trx) return res.status(404).json({ status: false, message: 'Transaksi tidak ditemukan.' });

    if (trx.status === 'paid') {
      return res.json({ status: true, paid: true, username: trx.username, password: trx.password, waLink: trx.waLink || null });
    }

    const detail = await checkTransactionStatus(orderId, trx.amount);
    if (detail.status === 'completed') {
      trx = await finalizePaidTransaction(trx);
      return res.json({ status: true, paid: true, username: trx.username, password: trx.password, waLink: trx.waLink || null });
    }

    res.json({ status: true, paid: false });
  } catch (error) {
    console.error('Checkout status error:', error.message);
    res.status(500).json({ status: false, message: 'Gagal cek status pembayaran.' });
  }
});

// Webhook dari Pakasir (opsional tapi disarankan, isi di dashboard Pakasir: <domain>/api/pakasir/webhook)
app.post('/api/pakasir/webhook', async (req, res) => {
  try {
    const { order_id, amount, status } = req.body;
    if (status !== 'completed') return res.json({ status: true });

    const txCol = await getTransactionsCollection();
    const trx = await txCol.findOne({ orderId: order_id });
    if (!trx) return res.status(404).json({ status: false, message: 'Transaksi tidak ditemukan.' });
    if (Number(trx.amount) !== Number(amount)) {
      return res.status(400).json({ status: false, message: 'Amount tidak cocok.' });
    }

    await finalizePaidTransaction(trx);
    res.json({ status: true });
  } catch (error) {
    console.error('Pakasir webhook error:', error.message);
    res.status(500).json({ status: false, message: 'Gagal memproses webhook.' });
  }
});
// ======================= AKHIR FITUR BELI ROLE VIA QRIS =======================

app.get('/api/announcements', (req, res) => {
  try {
    const announcements = JSON.parse(fs.readFileSync('./db/announcements.json', 'utf8'));
    res.json({ status: true, announcements: announcements.reverse() }); // Reverse untuk menampilkan yang terbaru di atas
  } catch (error) {
    res.status(500).json({ status: false, message: 'Gagal memuat pengumuman.' });
  }
});

// Vercel (serverless) cukup butuh 'app' di-export, gak boleh app.listen().
// Kalau dijalanin sendiri (VPS/lokal, `node index.js`), baru listen beneran.
if (!process.env.VERCEL) {
  app.listen(port, '0.0.0.0', () => {
    const getIpAddress = () => {
      const interfaces = os.networkInterfaces();
      for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
          if (iface.family === 'IPv4' && !iface.internal) {
            return iface.address;
          }
        }
      }
      return '127.0.0.1';
    };
    const ip = getIpAddress();
    console.log(`ARMUFA CPANEL berjalan di http://${ip}:${port}`);
  });
}

module.exports = app;