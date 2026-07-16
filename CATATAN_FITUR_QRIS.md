# Fitur Baru: Beli Role via QRIS (Pakasir)

## 1. Yang perlu diisi di `setting.js`
- `global.mongoUri` → connection string MongoDB Atlas kamu (bisa juga lewat env `MONGODB_URI`).
- `global.pakasir.slug` & `global.pakasir.apiKey` → dari dashboard Pakasir (app.pakasir.com), halaman detail proyek.
- `global.rolePrices` → harga & deskripsi tiap role, ini yang otomatis muncul di landing page (`/`).
- `global.purchasableRoles` → role apa aja yang boleh dibeli langsung lewat QRIS (CEO sengaja gak dimasukin).

Landing page (`/`) sekarang narik data harga dari `GET /api/roles`, jadi kalau ubah harga di `setting.js`, tampilan otomatis ikut berubah — gak perlu edit HTML.

## 2. Alur beli role
1. Buyer klik tombol "Beli [Role]" di landing page → isi username, password (opsional, kalau kosong dibikinin random), dan pilih cara terima detail akun: **Bot Telegram** atau **WhatsApp**.
2. Sistem bikin transaksi QRIS ke Pakasir, tampilin QR code, lalu polling status tiap 5 detik ke `GET /api/checkout/status/:orderId`.
3. Begitu lunas (dicek ke API Pakasir `transactiondetail`, plus ada webhook `/api/pakasir/webhook` sebagai cadangan), akun otomatis dibuat & disimpan di MongoDB (koleksi `buyer_luar_accounts`), lalu:
   - **Bot**: kredensial dikirim otomatis via Telegram (pakai `sendBotMessage`, gak butuh bot polling nyala).
   - **WhatsApp**: sistem generate link `wa.me` berisi teks username+password ke nomor WA yang diisi buyer sendiri, tinggal diklik "Buka WhatsApp & Kirim ke Diri Sendiri" (bukan kirim otomatis dari server, karena belum ada WA Gateway API).
4. Akun yang sudah dibuat bisa langsung dipakai login di `/login` — proses login sekarang juga ngecek MongoDB, bukan cuma file JSON lokal.

## 3. Kenapa MongoDB?
Vercel itu serverless — filesystem-nya read-only/sementara, jadi tulis ke `db/*.json` gak akan tersimpan permanen antar request. Makanya khusus fitur baru ini (transaksi QRIS + akun hasil beli + session login) disimpen ke MongoDB. Fitur admin lama (kelola staf lewat `admin.html`/`panel.html`, `db/user.json`, dll) **masih pakai file JSON** seperti sebelumnya — itu tetap jalan normal kalau di-hosting di VPS/self-host, tapi kalau mau full-Vercel juga, bagian itu perlu dimigrasi ke MongoDB juga nanti (belum termasuk di perubahan ini).

## 4. Deploy ke Vercel
- Sudah ditambahin `vercel.json`.
- `index.js` sekarang export `app` dan cuma `app.listen()` kalau BUKAN di Vercel.
- Bot Telegram (`telegram-bot.js`, mode polling) **otomatis gak jalan di Vercel** (dideteksi dari `process.env.VERCEL`), karena serverless gak bisa nahan proses polling terus-terusan. Kalau masih butuh bot Telegram jalan, jalankan `telegram-bot.js` terpisah di VPS/self-host seperti biasa — fitur kirim kredensial via bot di checkout tetap jalan dari sisi Vercel karena itu cuma manggil Telegram API langsung (bukan lewat proses polling).
- Set environment variable `MONGODB_URI` di dashboard Vercel (lebih aman daripada hardcode di `setting.js`).
- Session login sekarang disimpan di MongoDB (`connect-mongo`) supaya works di serverless, ganti dari `session-file-store` yang lama.

## 5. Dependency baru
`mongodb`, `qrcode`, `connect-mongo` — jalankan `npm install` setelah pull perubahan ini.
