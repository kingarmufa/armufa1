// lib/pakasir.js
// Helper integrasi Pakasir (https://pakasir.com) buat QRIS
const axios = require('axios');

const BASE_URL = 'https://app.pakasir.com/api';

function getConfig() {
  const { slug, apiKey } = global.pakasir || {};
  if (!slug || !apiKey || slug.includes('SLUG_PROJECT') || apiKey.includes('API_KEY_PAKASIR')) {
    throw new Error('Konfigurasi Pakasir (slug/apiKey) belum diisi di setting.js (global.pakasir).');
  }
  return { slug, apiKey };
}

// Bikin transaksi QRIS baru di Pakasir
async function createQrisTransaction(orderId, amount) {
  const { slug, apiKey } = getConfig();
  const { data } = await axios.post(`${BASE_URL}/transactioncreate/qris`, {
    project: slug,
    order_id: orderId,
    amount,
    api_key: apiKey,
  });
  if (!data || !data.payment) {
    throw new Error('Respons Pakasir tidak valid saat membuat transaksi.');
  }
  return data.payment; // { payment_number, total_payment, fee, ... }
}

// Cek status transaksi ke Pakasir (lebih valid daripada cuma andalin webhook)
async function checkTransactionStatus(orderId, amount) {
  const { slug, apiKey } = getConfig();
  const { data } = await axios.get(`${BASE_URL}/transactiondetail`, {
    params: { project: slug, amount, order_id: orderId, api_key: apiKey },
  });
  if (!data || !data.transaction) {
    throw new Error('Respons Pakasir tidak valid saat cek status transaksi.');
  }
  return data.transaction; // { status: 'pending' | 'completed' | ... }
}

module.exports = { createQrisTransaction, checkTransactionStatus };
