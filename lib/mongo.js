// lib/mongo.js
// Koneksi MongoDB yang di-cache biar gak connect ulang tiap request
// (penting buat serverless/Vercel, dan tetep aman dipakai di VPS biasa)
const { MongoClient } = require('mongodb');

let cachedClient = null;
let cachedDb = null;

async function getDb() {
  if (cachedDb) return cachedDb;

  const uri = global.mongoUri;
  if (!uri || uri.includes('USER:PASSWORD')) {
    throw new Error('MONGODB_URI belum diatur dengan benar di setting.js (global.mongoUri).');
  }

  if (!cachedClient) {
    cachedClient = new MongoClient(uri);
  }
  if (!cachedClient.topology || !cachedClient.topology.isConnected()) {
    await cachedClient.connect();
  }

  cachedDb = cachedClient.db('armufa_cpanel');
  return cachedDb;
}

async function getTransactionsCollection() {
  const db = await getDb();
  return db.collection('qris_transactions');
}

async function getBuyerAccountsCollection() {
  const db = await getDb();
  return db.collection('buyer_luar_accounts');
}

module.exports = { getDb, getTransactionsCollection, getBuyerAccountsCollection };
