// Konfigurasi untuk Bot Telegram
global.botToken = '8720408065:AAHHc23mOfXjZsoy-jGglEEGtbJ5rQyA_7w'; // <-- GANTI DENGAN TOKEN DARI BOTFATHER
global.ownerIds = ['6854552378', '6854552378']; // <-- GANTI DENGAN ID TELEGRAM OWNER BOT, bisa lebih dari 1

// Konfigurasi Global Lainnya
global.author = 'ARMUFA CPANEL';

// =================== KONFIGURASI MULTI-PANEL ===================
global.panels = {
    "panel1": {
        name: "Panel 1",
        url: 'https://',
        ptla: 'ptla_',
        ptlc: 'ptlc_', // <-- PENTING: Client API Key, diperlukan untuk mode hapus 'inactive'
        egg: '15',
        nest: '5',
        loc: '1'
    },
    "panel2": {
        name: "Panel 2",
        url: 'https://',
        ptla: 'ptla_',
        ptlc: 'ptlc_',// <-- PENTING: Client API Key, diperlukan untuk mode hapus 'inactive'
        egg: '15',
        nest: '5',
        loc: '1'
    },
    "panel3": {
        name: "Panel 3",
        url: 'https:/',
        ptla: 'ptla_',
        ptlc: 'ptlc_', // <-- PENTING: Client API Key, diperlukan untuk mode hapus 'inactive'
        egg: '15',
        nest: '5',
        loc: '1'
    }
};
// ===============================================================

// =================== KONFIGURASI MONGODB ===================
// Dipakai untuk simpan transaksi QRIS & akun hasil pembelian role
// (biar tetap kesimpen kalau di-deploy di Vercel, soalnya fs Vercel gak permanen)
global.mongoUri = process.env.MONGODB_URI || 'mongodb+srv://armufa2010_db:ARMUFA@cluster0.eya7xqy.mongodb.net/?appName=Cluster0';
// ===============================================================

// =================== KONFIGURASI PAKASIR (QRIS) ===================
global.pakasir = {
  slug: 'payarmufa', // <-- Slug proyek dari dashboard Pakasir
  apiKey: 'P1m45UpfpXrtBtozDsI2panMDXl7Ahaq',    // <-- API Key dari halaman detail proyek Pakasir
};
// ===============================================================

// =================== HARGA & KONFIGURASI ROLE (untuk landing page & checkout QRIS) ===================
// key harus sama persis dengan ROLE_ORDER di index.js
// urutan di sini yang dipakai buat urutan tampilan di landing page (dari termurah/terendah ke termahal/tertinggi)
global.rolePrices = {
  reseller: { name: 'Reseller Panel', price: 5000, tag: 'Tier 01', desc: ['Buat panel sepuasnya', 'Jual panel ke pembeli', 'Buka bot pushkontak sendiri'] },
  reseller_private: { name: 'Reseller Panel Private', price: 20000, tag: 'Tier 01+', desc: ['Semua benefit Reseller Panel', 'Keamanan lebih ketat: anti rusuh dan anti curi session / sc'] },
  admin_panel: { name: 'Admin Panel', price: 10000, tag: 'Tier 02', desc: ['Semua benefit Reseller', 'Bisa membuka Reseller Panel untuk orang lain'] },
  partner: { name: 'PT Panel', price: 20000, tag: 'Tier 03', desc: ['Semua benefit Admin Panel', 'Bisa membuka Admin Panel untuk orang lain'] },
  owner: { name: 'Own Panel', price: 25000, tag: 'Paling Laris', featured: true, desc: ['Semua benefit PT Panel', 'Bisa membuka PT Panel untuk orang lain'] },
  tangan_kanan: { name: 'Tangan Kanan Panel', price: 35000, tag: 'Tier 05', desc: ['Semua benefit Own Panel', 'Bisa membuka Own Panel untuk orang lain'] },
  ceo: { name: 'CEO Panel', price: 65000, tag: 'Tier Puncak', desc: ['Semua benefit Tangan Kanan Panel', 'Bisa membuka Tangan Kanan Panel untuk orang lain'] },
};
// role yang boleh dibeli langsung lewat QRIS di landing page (CEO sengaja gak dimasukin, biar tetep lewat admin)
global.purchasableRoles = ['reseller', 'reseller_private', 'admin_panel', 'partner', 'owner', 'tangan_kanan'];
// ===============================================================