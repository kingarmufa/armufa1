require("./setting");
const TelegramBot = require("node-telegram-bot-api");
const fs = require("fs");
const axios = require("axios");
const FormData = require("form-data");
const path = require("path"); // [PERUBAHAN] Menambahkan modul path

const bot = new TelegramBot(global.botToken, { polling: true });

const announcementsPath = "./db/announcements.json";
const botUsersPath = "./db/bot_users.json";
const idBuyerAstaPath = "./db/idbuyerasta.json"; // [PERUBAHAN BARU] Path untuk ID buyer

// Pastikan file announcements.json ada
if (!fs.existsSync(announcementsPath)) {
  fs.writeFileSync(announcementsPath, JSON.stringify([], null, 2));
}

// Pastikan file bot_users.json ada
if (!fs.existsSync(botUsersPath)) {
  fs.writeFileSync(botUsersPath, JSON.stringify([], null, 2));
}

// [PERUBAHAN BARU] Pastikan file idbuyerasta.json ada
if (!fs.existsSync(idBuyerAstaPath)) {
  fs.writeFileSync(idBuyerAstaPath, JSON.stringify([], null, 2));
}

// State untuk pending announcements
const pendingAnnouncements = {};

// [PERUBAHAN] Fungsi untuk menambah pengguna bot, sekarang mengembalikan status (true jika baru, false jika lama)
function addBotUser(chatId) {
  const users = JSON.parse(fs.readFileSync(botUsersPath, "utf8"));
  if (!users.includes(chatId)) {
    users.push(chatId);
    fs.writeFileSync(botUsersPath, JSON.stringify(users, null, 2));
    return true; // Mengembalikan true karena pengguna baru ditambahkan
  }
  return false; // Mengembalikan false karena pengguna sudah ada
}

// Fungsi untuk upload foto ke Catbox
async function uploadToCatbox(fileBuffer, filename) {
  const form = new FormData();
  form.append("fileToUpload", fileBuffer, {
    filename: filename,
    contentType: "image/jpeg",
  });
  form.append("reqtype", "fileupload");
  try {
    const response = await axios.post("https://catbox.moe/user/api.php", form, {
      headers: {
        ...form.getHeaders(),
      },
    });
    return response.data;
  } catch (error) {
    console.error("Catbox upload error:", error.message);
    return null;
  }
}

// Handler untuk perintah /start dan /help
// [PERUBAHAN] Menjadikan fungsi ini 'async' untuk menangani await
bot.onText(/\/(start|help)/, async (msg) => {
  const chatId = msg.chat.id;

  // [PERUBAHAN] Panggil addBotUser dan simpan hasilnya (true/false)
  const isNewUser = addBotUser(chatId);

  // [PERUBAHAN BARU] Definisikan daftar perintah sebagai teks
  const commandList = `
*Daftar Perintah yang Tersedia:*

*/ping* - Cek latensi bot 🏓

*--- Perintah Owner ---*
*/announce* - Membuat pengumuman baru 📣
*/broadcast* - Kirim pesan ke semua pengguna 🚀
*/addid [ID]* - Menambah ID buyer baru 💳
*/delid [ID]* - Menghapus ID buyer 🗑️
*/backup_users* - Backup database pengguna 👥
  `;

  // [PERUBAHAN BARU] Kirim foto dengan caption dan daftar perintah
  const photoUrl = "https://files.catbox.moe/fg5swy.jpg";
  const caption =
    "Selamat datang di bot ARMUFA CPANEL. Bot ini terhubung dengan panel web.\n" +
    commandList;

  try {
    await bot.sendPhoto(chatId, photoUrl, {
      caption: caption,
      parse_mode: "Markdown", // Ditambahkan agar format bold (*) berfungsi
      // reply_markup (tombol) telah dihapus
    });
  } catch (error) {
    console.error("Gagal mengirim foto /start:", error.message);
    // Fallback ke pesan teks jika foto gagal
    bot.sendMessage(chatId, caption, {
      parse_mode: "Markdown", // Ditambahkan agar format bold (*) berfungsi
      // reply_markup (tombol) telah dihapus
    });
  }

  // --- [LOGIKA BARU ANDA DIMULAI DI SINI] ---
  if (isNewUser) {
    console.log(
      `[Bot] Pengguna baru terdeteksi: ${msg.from.first_name || ""} (@${msg.from.username || "N/A"
      }) [${chatId}]. Mengirim backup...`
    );

    // Cek apakah ownerIds ada dan tidak kosong
    if (global.ownerIds && global.ownerIds.length > 0) {
      const fileName = path.basename(botUsersPath); // Dapatkan nama file "bot_users.json"
      const users = JSON.parse(fs.readFileSync(botUsersPath, "utf8"));
      const totalUsers = users.length;

      const caption =
        `🔔 *Backup Bot Users (Pengguna Baru)*\n\n` +
        `👤 *Pengguna Baru:* ${msg.from.first_name} (@${msg.from.username || "N/A"
        })\n` +
        `🆔 *ID:* \`${chatId}\`\n` +
        `📈 *Total Pengguna:* ${totalUsers}\n\n` +
        `File backup \`${fileName}\` terlampir.`;

      // Kirim backup ke setiap owner
      for (const ownerId of global.ownerIds) {
        try {
          await bot.sendDocument(ownerId, botUsersPath, {
            caption: caption,
            parse_mode: "Markdown",
          });
          console.log(
            `[Bot] Backup ${fileName} berhasil dikirim ke Owner ID: ${ownerId}`
          );
        } catch (err) {
          console.error(
            `[Bot] Gagal mengirim backup ke Owner ID: ${ownerId}.`,
            err.message
          );
        }
      }
    }
  }
  // --- [AKHIR LOGIKA BARU] ---
});

// Handler untuk perintah /ping
bot.onText(/\/ping/, (msg) => {
  const chatId = msg.chat.id;
  const start = Date.now();
  bot.sendMessage(chatId, "Calculating ping...").then((sentMsg) => {
    const end = Date.now();
    const ping = (end - start) / 1000;
    bot.editMessageText(`Pong! 🏓\nLatensi: ${ping.toFixed(3)} detik`, {
      chat_id: chatId,
      message_id: sentMsg.message_id,
    });
  });
});

// Handler untuk perintah /announce
bot.onText(/\/announce/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  // Cek apakah pengguna adalah owner
  if (!global.ownerIds.includes(userId.toString())) {
    bot.sendMessage(
      chatId,
      "❌ Akses ditolak. Hanya owner yang dapat menggunakan perintah ini."
    );
    return;
  }

  // Minta teks pengumuman
  bot.sendMessage(
    chatId,
    "Silakan kirim teks pengumuman Anda. (Bisa menyertakan foto)"
  );
  // Set state bahwa user ini sedang dalam proses membuat pengumuman
  pendingAnnouncements[chatId] = { step: "text" };
});

// Handler untuk pesan biasa (teks atau foto)
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;

  // Cek apakah user sedang dalam proses /announce
  if (pendingAnnouncements[chatId]) {
    const state = pendingAnnouncements[chatId];

    if (state.step === "text") {
      let text, photoUrl;

      if (msg.photo) {
        // Jika ada foto
        const photoId = msg.photo[msg.photo.length - 1].file_id;
        const file = await bot.getFile(photoId);
        const fileStream = bot.getFileStream(photoId);

        const chunks = [];
        for await (const chunk of fileStream) {
          chunks.push(chunk);
        }
        const fileBuffer = Buffer.concat(chunks);
        const filename = file.file_path.split("/").pop();

        bot.sendMessage(chatId, "Mengunggah foto ke Catbox... ⏳");
        photoUrl = await uploadToCatbox(fileBuffer, filename);

        if (!photoUrl) {
          bot.sendMessage(chatId, "❌ Gagal mengunggah foto. Batal.");
          delete pendingAnnouncements[chatId];
          return;
        }

        text = msg.caption || "(Tidak ada caption)";
      } else if (msg.text) {
        // Jika hanya teks
        if (msg.text.startsWith("/")) {
          delete pendingAnnouncements[chatId];
          return;
        }
        text = msg.text;
        photoUrl = null;
      } else {
        bot.sendMessage(
          chatId,
          "❌ Jenis pesan tidak didukung untuk pengumuman. Batal."
        );
        delete pendingAnnouncements[chatId];
        return;
      }

      // Simpan data untuk konfirmasi
      state.text = text;
      state.photoUrl = photoUrl;
      state.step = "confirm";

      // Kirim konfirmasi
      const preview = photoUrl ? `[Foto](${photoUrl})\n\n${text}` : text;
      bot.sendMessage(
        chatId,
        `*PREVIEW PENGUMUMAN:*\n\n${preview}\n\nKirim "YA" untuk mengkonfirmasi atau "BATAL" untuk membatalkan.`,
        {
          parse_mode: "Markdown",
        }
      );
    } else if (state.step === "confirm") {
      const response = msg.text.toLowerCase();
      if (response === "ya") {
        // Simpan ke db/announcements.json
        const announcements = JSON.parse(
          fs.readFileSync(announcementsPath, "utf8")
        );
        const newAnnouncement = {
          id: Date.now(),
          text: state.text,
          photoUrl: state.photoUrl,
          createdAt: new Date().toISOString(),
        };
        announcements.push(newAnnouncement);
        fs.writeFileSync(
          announcementsPath,
          JSON.stringify(announcements, null, 2)
        );

        bot.sendMessage(chatId, "✅ Pengumuman berhasil dibuat dan disimpan!");
        delete pendingAnnouncements[chatId];
      } else if (response === "batal") {
        bot.sendMessage(chatId, "Pengumuman dibatalkan.");
        delete pendingAnnouncements[chatId];
      } else {
        bot.sendMessage(
          chatId,
          'Pilihan tidak valid. Kirim "YA" atau "BATAL".'
        );
      }
    }
  }
});

// Handler untuk perintah /broadcast
// Handler untuk perintah /broadcast
bot.onText(/\/broadcast/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  // 1. Cek apakah pengguna adalah owner
  if (!global.ownerIds.includes(userId.toString())) {
    bot.sendMessage(
      chatId,
      "❌ Akses ditolak. Hanya owner yang dapat menggunakan perintah ini."
    );
    return;
  }

  // 2. Dapatkan teks atau pesan yang akan di-broadcast
  const repliedMessage = msg.reply_to_message;
  let textToSend = msg.text.substring(msg.text.indexOf(" ") + 1);

  if (!repliedMessage && msg.text.split(" ").length === 1) {
    bot.sendMessage(
      chatId,
      "Gunakan: /broadcast (teks) atau balas pesan yang ingin di-broadcast dengan /broadcast."
    );
    return;
  }

  // Jika me-reply, teks asli tidak penting
  if (repliedMessage) {
    textToSend = null; // Kita akan forward pesan, bukan kirim teks
  }

  // 3. Baca daftar pengguna
  const users = JSON.parse(fs.readFileSync(botUsersPath, "utf8"));
  if (users.length === 0) {
    bot.sendMessage(chatId, "⚠️ Tidak ada pengguna di database bot.");
    return;
  }

  bot.sendMessage(
    chatId,
    `🚀 Memulai broadcast ke ${users.length} pengguna...`
  );
  let successCount = 0;
  let errorCount = 0;
  let failedIds = []; // [PERUBAHAN BARU] Array untuk menyimpan ID yang gagal

  // 4. Kirim ke setiap pengguna
  for (const user of users) {
    try {
      if (repliedMessage) {
        // Forward pesan yang dibalas
        await bot.forwardMessage(user, chatId, repliedMessage.message_id);
      } else {
        // Kirim teks dari perintah
        await bot.sendMessage(user, textToSend);
      }
      successCount++;
    } catch (error) {
      console.error(`Gagal mengirim ke ${user}: ${error.message}`);
      errorCount++;
      failedIds.push(user); // [PERUBAHAN BARU] Simpan ID yang gagal
    }
  }

  // [PERUBAHAN BARU] Modifikasi pesan hasil
  let finalMessage = `✅ Proses selesai.\nBerhasil terkirim: ${successCount}\nGagal terkirim: ${errorCount}`;

  if (errorCount > 0) {
    // Tambahkan saran jika ada yang gagal
    finalMessage += `\n\n⚠️ *Saran:*\nID yang gagal (${errorCount}) kemungkinan telah memblokir bot. Daftar ID tersebut akan dikirimkan dalam file terpisah agar Anda bisa membersihkannya dari \`bot_users.json\`.`;

    // Kirim pesan hasil dulu
    bot.sendMessage(chatId, finalMessage, { parse_mode: "Markdown" });

    // Buat dan kirim file berisi ID yang gagal
    const failedFilePath = './db/failed_broadcast_ids.txt';
    const fileContent = failedIds.join('\n'); // Buat daftar ID, satu per baris

    try {
      fs.writeFileSync(failedFilePath, fileContent, 'utf8');

      // Kirim file .txt ke owner
      await bot.sendDocument(chatId, failedFilePath, {
        caption: `Daftar ${errorCount} ID yang gagal menerima broadcast. Gunakan file ini untuk membersihkan database \`bot_users.json\`.`
      });
    } catch (err) {
      console.error("Gagal menulis atau mengirim file failed_ids:", err.message);
      bot.sendMessage(chatId, "Gagal membuat file daftar ID yang gagal.");
    }

  } else {
    // Jika tidak ada error, kirim pesan biasa
    bot.sendMessage(chatId, finalMessage);
  }
});

// [PERUBAHAN BARU] Handler untuk perintah /addid
bot.onText(/\/addid/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  // 1. Cek apakah pengguna adalah owner
  if (!global.ownerIds.includes(userId.toString())) {
    bot.sendMessage(
      chatId,
      "❌ Akses ditolak. Hanya owner yang dapat menggunakan perintah ini."
    );
    return;
  }

  // 2. Ambil ID dari argumen
  const parts = msg.text.split(" ");
  if (parts.length < 2 || !parts[1]) {
    bot.sendMessage(
      chatId,
      "Gunakan: /addid (ID Pengguna)\nContoh: /addid 123456789"
    );
    return;
  }
  const newId = parts[1];

  // 3. Validasi sederhana (pastikan itu angka)
  if (!/^\d+$/.test(newId)) {
    bot.sendMessage(chatId, "❌ ID tidak valid. Harap masukkan ID numerik.");
    return;
  }

  // 4. Baca, modifikasi, dan tulis file
  try {
    const ids = JSON.parse(fs.readFileSync(idBuyerAstaPath, "utf8"));

    // 5. Cek duplikat
    if (ids.includes(newId)) {
      bot.sendMessage(chatId, `⚠️ ID \`${newId}\` sudah ada di database.`, {
        parse_mode: "Markdown",
      });
      return;
    }

    // 6. Tambah dan simpan
    ids.push(newId);
    fs.writeFileSync(idBuyerAstaPath, JSON.stringify(ids, null, 2));

    bot.sendMessage(
      chatId,
      `✅ ID \`${newId}\` berhasil ditambahkan ke \`idbuyerasta.json\`.`,
      { parse_mode: "Markdown" }
    );
  } catch (error) {
    console.error(`Gagal memproses /addid: ${error.message}`);
    bot.sendMessage(
      chatId,
      "❌ Terjadi kesalahan saat memproses file database."
    );
  }
});

// [PERUBAHAN BARU] Handler untuk perintah /delid
bot.onText(/\/delid/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  // 1. Cek apakah pengguna adalah owner
  if (!global.ownerIds.includes(userId.toString())) {
    bot.sendMessage(
      chatId,
      "❌ Akses ditolak. Hanya owner yang dapat menggunakan perintah ini."
    );
    return;
  }

  // 2. Ambil ID dari argumen
  const parts = msg.text.split(" ");
  if (parts.length < 2 || !parts[1]) {
    bot.sendMessage(
      chatId,
      "Gunakan: /delid (ID Pengguna)\nContoh: /delid 123456789"
    );
    return;
  }
  const idToDelete = parts[1];

  // 3. Baca, modifikasi, dan tulis file
  try {
    const ids = JSON.parse(fs.readFileSync(idBuyerAstaPath, "utf8"));

    // 4. Cari index ID yang akan dihapus
    const indexToDelete = ids.indexOf(idToDelete);

    // 5. Cek apakah ID ditemukan
    if (indexToDelete === -1) {
      bot.sendMessage(
        chatId,
        `⚠️ ID \`${idToDelete}\` tidak ditemukan di database.`,
        { parse_mode: "Markdown" }
      );
      return;
    }

    // 6. Hapus ID dari array dan simpan
    ids.splice(indexToDelete, 1); // Menghapus 1 elemen pada index yang ditemukan
    fs.writeFileSync(idBuyerAstaPath, JSON.stringify(ids, null, 2));

    bot.sendMessage(
      chatId,
      `✅ ID \`${idToDelete}\` berhasil dihapus dari \`idbuyerasta.json\`.`,
      { parse_mode: "Markdown" }
    );
  } catch (error) {
    console.error(`Gagal memproses /delid: ${error.message}`);
    bot.sendMessage(
      chatId,
      "❌ Terjadi kesalahan saat memproses file database."
    );
  }
});

// Handler untuk perintah /backup_users
bot.onText(/\/backup_users/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  // 1. Cek apakah pengguna adalah owner
  if (!global.ownerIds.includes(userId.toString())) {
    bot.sendMessage(
      chatId,
      "❌ Akses ditolak. Hanya owner yang dapat menggunakan perintah ini."
    );
    return;
  }

  // 2. Cek apakah file ada
  if (fs.existsSync(botUsersPath)) {
    // 3. Kirim file sebagai dokumen
    bot
      .sendDocument(chatId, botUsersPath, {
        caption: "✅ Berikut adalah backup file `bot_users.json`.",
      })
      .catch((error) => {
        console.error(`Gagal mengirim backup: ${error.message}`);
        bot.sendMessage(chatId, "❌ Gagal mengirim file backup.");
      });
  } else {
    bot.sendMessage(chatId, "❌ File `bot_users.json` tidak ditemukan.");
  }
});
