// File: qris.js (Sudah diisi dengan string Anda)

const { crc16ccitt } = require('crc');
const qrcode = require('qrcode');

/**
 * Fungsi untuk membuat QRIS Dinamis secara manual dengan menghitung CRC16
 * @param {number} amount - Nominal yang harus dibayar
 * @returns {Promise<string>} - String Base64 dari gambar QR Code (Data URL)
 */
async function generateDynamicQrisManual(amount) {
  // -----------------------------------------------------------------
  // STRING QRIS STATIS ANDA SUDAH DIMASUKKAN DI BAWAH INI
  const baseQrisString = "input basestring qris disini";
  // -----------------------------------------------------------------

  // Tag 53 (Kode Mata Uang: 360 = IDR)
  const tagCurrency = "5303360";
  
  // Tag 54 (Nominal)
  const amountString = amount.toString();
  const amountLength = amountString.length.toString().padStart(2, '0');
  const tagAmount = `54${amountLength}${amountString}`;
  
  // 1. Gabungkan semua string data + Tag/Length untuk CRC (6304)
  const stringUntukDiCrc = 
    baseQrisString + 
    tagCurrency + 
    tagAmount + 
    "6304"; 

  // 2. Hitung CRC16-CCITT-FALSE
  const crcValue = crc16ccitt(stringUntukDiCrc);
  
  // 3. Ubah hasil CRC (desimal) menjadi 4-digit Heksadesimal (uppercase)
  const crcHex = crcValue.toString(16).toUpperCase().padStart(4, '0');
  
  // 4. Buat String QRIS Final
  const stringFinal = stringUntukDiCrc + crcHex;

  // 5. Generate gambar QR Code (Data URL Base64)
  try {
    const qrDataUrl = await qrcode.toDataURL(stringFinal);
    return qrDataUrl;
  } catch (err) {
    console.error('Gagal membuat QR Code:', err);
    throw err;
  }
}

// Ekspor fungsi agar bisa dipakai di app.js
module.exports = { generateDynamicQrisManual };
