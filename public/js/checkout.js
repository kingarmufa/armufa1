(function () {
  const ladder = document.getElementById('ladder');
  const modal = document.getElementById('checkout-modal');
  const body = document.getElementById('checkout-body');
  const closeBtn = document.getElementById('checkout-close');

  let pollTimer = null;
  let currentRole = null;

  function fmtRupiah(n) {
    return 'Rp ' + Number(n).toLocaleString('id-ID');
  }

  function closeModal() {
    modal.style.display = 'none';
    if (pollTimer) clearInterval(pollTimer);
  }
  closeBtn.addEventListener('click', closeModal);
  window.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  // ---------- Render daftar harga ----------
  async function loadRoles() {
    try {
      const res = await fetch('/api/roles');
      const data = await res.json();
      if (!data.status || !data.roles.length) {
        ladder.innerHTML = '<p class="subtitle">Belum ada role yang tersedia untuk dibeli langsung.</p>';
        return;
      }
      ladder.innerHTML = data.roles
        .map((r, i) => {
          const num = String(i + 1).padStart(2, '0');
          return `
          <div class="rung ${r.featured ? 'featured' : ''}">
            <div class="rung-node">${num}</div>
            <div class="rung-card">
              <div class="rung-top">
                <span class="rung-name">${r.name}</span>
                <span class="rung-price">${fmtRupiah(r.price)}<small>/PERMANEN</small></span>
              </div>
              <span class="rung-tag">${r.tag || ''}</span>
              <ul class="rung-unlocks">
                ${r.desc.map((d) => `<li>${d}</li>`).join('')}
              </ul>
              <button class="cta-button primary buy-btn" data-key="${r.key}" data-name="${r.name}" data-price="${r.price}">
                Beli ${r.name}
              </button>
            </div>
          </div>`;
        })
        .join('');

      ladder.querySelectorAll('.buy-btn').forEach((btn) => {
        btn.addEventListener('click', () => openCheckoutForm({
          key: btn.dataset.key,
          name: btn.dataset.name,
          price: btn.dataset.price,
        }));
      });
    } catch (e) {
      ladder.innerHTML = '<p class="subtitle">Gagal memuat daftar harga. Coba refresh halaman.</p>';
    }
  }

  // ---------- Step 1: form data akun ----------
  function openCheckoutForm(role) {
    currentRole = role;
    body.innerHTML = `
      <h3>Beli ${role.name}</h3>
      <p class="subtitle">${fmtRupiah(role.price)} · Permanen</p>
      <form id="checkout-form" class="checkout-form">
        <label>Username akun baru
          <input type="text" name="username" placeholder="contoh: budi123" required minlength="3" maxlength="20" pattern="[a-zA-Z0-9_]+" />
        </label>
        <label>Password <span class="opt">(kosongin buat dibuatin otomatis)</span>
          <input type="text" name="password" placeholder="opsional" minlength="4" maxlength="32" />
        </label>
        <label>Kirim detail akun lewat
          <select name="deliveryMethod" id="deliveryMethod">
            <option value="bot">Bot Telegram</option>
            <option value="wa">WhatsApp (link wa.me)</option>
          </select>
        </label>
        <label id="field-telegram">ID Telegram kamu
          <input type="text" name="telegramId" placeholder="contoh: 123456789" />
        </label>
        <label id="field-wa" style="display:none;">Nomor WhatsApp kamu
          <input type="text" name="waNumber" placeholder="contoh: 6281234567890" />
        </label>
        <div id="checkout-error" class="checkout-error"></div>
        <button type="submit" class="cta-button primary">Lanjut Bayar QRIS</button>
      </form>
    `;
    modal.style.display = 'block';

    const deliverySelect = body.querySelector('#deliveryMethod');
    const fieldTelegram = body.querySelector('#field-telegram');
    const fieldWa = body.querySelector('#field-wa');
    deliverySelect.addEventListener('change', () => {
      const isBot = deliverySelect.value === 'bot';
      fieldTelegram.style.display = isBot ? '' : 'none';
      fieldWa.style.display = isBot ? 'none' : '';
    });

    body.querySelector('#checkout-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const payload = {
        roleKey: role.key,
        username: fd.get('username').trim(),
        password: fd.get('password').trim(),
        deliveryMethod: fd.get('deliveryMethod'),
        telegramId: fd.get('telegramId').trim(),
        waNumber: fd.get('waNumber').trim(),
      };
      const errBox = body.querySelector('#checkout-error');
      errBox.textContent = '';

      const submitBtn = e.target.querySelector('button[type=submit]');
      submitBtn.disabled = true;
      submitBtn.textContent = 'Memproses...';

      try {
        const res = await fetch('/api/checkout/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!data.status) {
          errBox.textContent = data.message || 'Gagal membuat transaksi.';
          submitBtn.disabled = false;
          submitBtn.textContent = 'Lanjut Bayar QRIS';
          return;
        }
        showQrScreen(data);
      } catch (err) {
        errBox.textContent = 'Terjadi kesalahan jaringan. Coba lagi.';
        submitBtn.disabled = false;
        submitBtn.textContent = 'Lanjut Bayar QRIS';
      }
    });
  }

  // ---------- Step 2: tampilkan QR & polling status ----------
  function showQrScreen(data) {
    body.innerHTML = `
      <h3>Scan QRIS buat bayar</h3>
      <p class="subtitle">${data.roleName} · ${fmtRupiah(data.totalPayment || data.amount)}</p>
      <div class="qr-wrap">
        <img src="${data.qrImage}" alt="QRIS" class="qr-image" />
      </div>
      <p class="qr-status" id="qr-status">⏳ Menunggu pembayaran...</p>
      <p class="qr-order">Order ID: <code>${data.orderId}</code></p>
    `;

    const statusEl = body.querySelector('#qr-status');
    if (pollTimer) clearInterval(pollTimer);

    pollTimer = setInterval(async () => {
      try {
        const res = await fetch(`/api/checkout/status/${data.orderId}`);
        const result = await res.json();
        if (result.status && result.paid) {
          clearInterval(pollTimer);
          showSuccessScreen(result);
        }
      } catch (e) {
        statusEl.textContent = '⚠️ Gagal cek status, mencoba lagi...';
      }
    }, 5000);
  }

  // ---------- Step 3: sukses ----------
  function showSuccessScreen(result) {
    body.innerHTML = `
      <h3>🎉 Pembayaran Berhasil!</h3>
      <p class="subtitle">Akun kamu sudah aktif. Simpan detail berikut baik-baik:</p>
      <div class="cred-box">
        <div><span>Username</span><b>${result.username}</b></div>
        <div><span>Password</span><b>${result.password}</b></div>
      </div>
      ${result.waLink
        ? `<a href="${result.waLink}" target="_blank" class="cta-button primary" style="width:100%;box-sizing:border-box;">Buka WhatsApp & Kirim ke Diri Sendiri</a>`
        : '<p class="subtitle">Detail akun juga sudah dikirim lewat Bot Telegram.</p>'}
      <a href="/login" class="cta-button secondary" style="width:100%;box-sizing:border-box;margin-top:10px;">Masuk ke Panel</a>
    `;
  }

  loadRoles();
})();
