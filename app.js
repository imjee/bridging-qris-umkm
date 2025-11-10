// app.js - VERSI RUMAH MAKAN (v9.3) - Fitur Konfirmasi Admin

// Impor library yang kita butuhkan
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const { generateDynamicQrisManual } = require('./qris.js'); // Import QRIS

console.log("Memulai Bot Rumah Makan v9.3 (Konfirmasi Admin)...");

// --- KONFIGURASI UTAMA ---
const ADMIN_PHONE = "paste nomor admin disini"; // GANTI DENGAN NOMOR ADMIN/DAPUR ANDA
const ONGKIR_TETAP = 10000; // Ongkir tetap

// --- KONFIGURASI MENU MAKANAN ---
const MENU = {
    'NS': { nama: 'Nasi Goreng Spesial', harga: 18000 },
    'AY': { nama: 'Ayam Bakar Madu', harga: 22000 },
    'MJ': { nama: 'Mie Jawa Godog', harga: 16000 },
    'SP': { nama: 'Sop Iga Sapi', harga: 35000 },
    'CP': { nama: 'Capcay Seafood', harga: 25000 },
    'ET': { nama: 'Es Teh Manis', harga: 5000 },
    'EJ': { nama: 'Es Jeruk', harga: 7000 },
};
// ---------------------------------

// --- NAMA FILE DATABASE ---
const ORDERS_FILE = './orders.json';
const CUSTOMERS_FILE = './customers.json';

// --- DATABASE (di-load dari file) ---
let orders = [];  
let customers = {};

// --- DATABASE SESI (Tetap di memori) ---
const userSessions = {};
// ----------------------------------------------------

// --- FUNGSI HELPER DATABASE ---
function saveOrders() {
    try {
        fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2));
        console.log('[DB] Database order berhasil disimpan.');
    } catch (err) { console.error('[DB] GAGAL menyimpan order:', err); }
}
function saveCustomers() {
    try {
        fs.writeFileSync(CUSTOMERS_FILE, JSON.stringify(customers, null, 2));
        console.log('[DB] Database customer berhasil disimpan.');
    } catch (err) { console.error('[DB] GAGAL menyimpan customer:', err); }
}
function loadDatabases() {
    try {
        if (fs.existsSync(ORDERS_FILE)) { orders = JSON.parse(fs.readFileSync(ORDERS_FILE)); } 
        else { saveOrders(); }
        console.log(`[DB] Berhasil memuat ${orders.length} order.`);
    } catch (err) { console.error('[DB] GAGAL memuat orders.json:', err); }
    try {
        if (fs.existsSync(CUSTOMERS_FILE)) { customers = JSON.parse(fs.readFileSync(CUSTOMERS_FILE)); } 
        else { saveCustomers(); }
        console.log(`[DB] Berhasil memuat ${Object.keys(customers).length} customer.`);
    } catch (err) { console.error('[DB] GAGAL memuat customers.json:', err); }
}
function formatRupiah(number) {
    if (isNaN(number)) return "Rp 0";
    return 'Rp ' + number.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}
// ============================================
// --- MULAI APLIKASI ---
// ============================================

loadDatabases();

const client = new Client({
    authStrategy: new LocalAuth()
});

client.on('qr', (qr) => {
    console.log('------------------------------------------------------');
    console.log('SCAN QR CODE INI DENGAN APLIKASI WHATSAPP ANDA:');
    qrcode.generate(qr, { small: true });
    console.log('------------------------------------------------------');
});

client.on('ready', () => {
    console.log('======================================================');
    console.log(`BOT RUMAH MAKAN SUDAH TERHUBUNG! Admin Dapur: ${ADMIN_PHONE}`);
    console.log('======================================================');
});

// --- (Fungsi 'message_create' v9.2 - TIDAK BERUBAH) ---
client.on('message_create', async (message) => {
    if (message.fromMe) { return; }
    
    const sender = message.from; 
    const senderNumber = sender.split('@')[0];
    const messageText = message.body;

    // --- DETEKSI BUKTI BAYAR (GAMBAR) - Versi STABIL ---
    if (message.type === 'image' && senderNumber !== ADMIN_PHONE) {
        console.log(`[PEMBAYARAN] Bukti bayar (gambar) diterima dari ${senderNumber}`);
        
        // 1. Balas ke Pelanggan
        await message.reply("Terima kasih atas bukti pembayarannya. 🙏\n\nAdmin akan segera mengecek dan memproses pesanan Anda. Mohon ditunggu.");
        
        const adminChatId = `${ADMIN_PHONE}@c.us`;
        const contact = await message.getContact();
        const customerName = contact.pushname || contact.name || senderNumber;
        
        const lastOrder = orders.slice().reverse().find(
            o => o.customerNumber === senderNumber && o.status === "Pending Payment"
        );
        
        let orderInfo = `(Tidak ada order 'Pending Payment' yang cocok)`;
        if (lastOrder) {
            orderInfo = `(Cocok dengan Order ID: ${lastOrder.orderId}, Total: ${formatRupiah(lastOrder.nominal)})`;
            lastOrder.status = "Completed (Verifying)"; // Status baru: Sedang diverifikasi
            saveOrders();
        }

        try {
            const media = await message.downloadMedia();
            if (media) {
                await client.sendMessage(adminChatId, `🔔 *BUKTI BAYAR DITERIMA* 🔔\n\n` +
                                                    `Dari: ${customerName} (${senderNumber})\n` +
                                                    `Order: ${orderInfo}\n` +
                                                    `Status order diubah ke "Verifying".\n\n` +
                                                    `Jika valid, balas bot dengan:\n` +
                                                    `*!konfirmasi ${senderNumber}*`);
                
                await client.sendMessage(adminChatId, media, { caption: `Bukti bayar dari: ${customerName}` });
            } else {
                throw new Error("Media (gambar) null saat di-download.");
            }
        } catch (err) {
            console.error("GAGAL FORWARD BUKTI BAYAR:", err);
            await client.sendMessage(adminChatId, `🔔 *BUKTI BAYAR (FORWARD GAGAL)* 🔔\n\n` +
                                                `Dari: ${customerName} (${senderNumber})\n` +
                                                `Order: ${orderInfo}\n` +
                                                `Error: ${err.message}. Cek manual chat pelanggan.`);
        }
            
        return; 
    }
    // --- AKHIR DETEKSI GAMBAR ---


    if (message.isStatus || !sender.endsWith('@c.us')) { return; }
    console.log(`[PESAN MASUK] dari ${sender}: "${messageText}"`);

    const contact = await message.getContact();
    const customerName = contact.pushname || contact.name || senderNumber;

    // Kirim ke "Otak" Bot
    const result = await processMessage(senderNumber, messageText, customerName);

    if (result.replyToSender) {
        await message.reply(result.replyToSender);
    }
});

client.on('auth_failure', msg => { console.error('AUTENTIKASI GAGAL:', msg); });
client.on('disconnected', (reason) => { console.log('KLIEN TERPUTUS:', reason); });


/**
 * ============================================
 * LOGIKA INTI BOT
 * ============================================
 */

// --- (Fungsi 'handleForm' v9.2b - TIDAK BERUBAH) ---
async function handleForm(sender, messageText, session, customerName) {
    let response = { replyToSender: null };
    const customerChatId = `${sender}@c.us`; 

    if (messageText.toLowerCase() === 'batal') {
        delete userSessions[sender];
        response.replyToSender = "Oke, Bang. Pesanan dibatalkan. 👍";
        return response;
    }

    try {
        if (session.stage === 'ask_location') {
            session.location = messageText;
            
            if (!customers[sender]) {
                customers[sender] = { name: customerName, reportsAgainst: [] };
                saveCustomers();
            }

            // ALUR 1: PESANAN STANDAR
            if (session.jobType === 'Pesanan Makanan') {
                let totalMakanan = 0;
                let orderSummary = ""; 
                let orderDetailsForDB = []; 

                session.cart.forEach(item => {
                    const subtotal = item.item.harga * item.qty;
                    orderSummary += `- ${item.item.nama} (x${item.qty}) = ${formatRupiah(subtotal)}\n`;
                    orderDetailsForDB.push(`${item.item.nama} (x${item.qty})`);
                    totalMakanan += subtotal;
                });
                
                const totalFinal = totalMakanan + ONGKIR_TETAP;
                
                const orderDetailsText = `[Total Mkn: ${formatRupiah(totalMakanan)}] ${orderDetailsForDB.join(', ')} | Lokasi: ${session.location}`;

                const newOrder = {
                    orderId: 'ORD-' + Date.now(),
                    orderDate: new Date().toISOString(),
                    customerNumber: sender,
                    customerName: customerName,
                    menuChoice: "Pesanan Makanan",
                    orderDetails: orderDetailsText, 
                    nominal: totalFinal,
                    status: "Pending Payment", 
                    complaint: null
                };
                orders.push(newOrder);
                saveOrders(); 

                try {
                    console.log(`[QRIS OTOMATIS] Membuat tagihan ${totalFinal} untuk ${sender}`);
                    const qrDataUrl = await generateDynamicQrisManual(totalFinal);
                    const base64Image = qrDataUrl.split(';base64,').pop();
                    const media = new MessageMedia('image/png', base64Image, `qris-payment-${newOrder.orderId}.png`);
                    
                    const paymentMessage = `Pesanan Anda telah dikonfirmasi. ✅\n\n` +
                                           `*Ringkasan Pesanan:*\n` +
                                           `${orderSummary}\n` +
                                           `*Total Makanan:* ${formatRupiah(totalMakanan)}\n` +
                                           `*Ongkir Tetap:* ${formatRupiah(ONGKIR_TETAP)}\n` +
                                           `*TOTAL TAGIHAN: ${formatRupiah(totalFinal)}*\n\n` +
                                           `Silakan pindai QRIS di atas untuk membayar.\n\n` +
                                           `_Kirim bukti transfer (screenshot). Ketik \`!batalorder\` jika ingin membatalkan pesanan ini._`;
                    
                    await client.sendMessage(customerChatId, media, { caption: paymentMessage });
                    response.replyToSender = "Siap! QRIS telah dikirim ke chat Anda. Silakan selesaikan pembayaran.";

                } catch (err) {
                    console.error("[QRIS OTOMATIS] GAGAL:", err);
                    response.replyToSender = "Maaf, Gagal membuat QRIS otomatis. Hubungi Admin.";
                }

                const adminNotif = `🔔 *ORDERAN BARU (QRIS OTOMATIS TERKIRIM)* 🔔\n\n` +
                                   `Dari: ${customerName} (${sender})\n\n` +
                                   `--- PESANAN ---\n` +
                                   `${orderSummary}\n` +
                                   `Total Makanan: ${formatRupiah(totalMakanan)}\n` +
                                   `Ongkir: ${formatRupiah(ONGKIR_TETAP)}\n` +
                                   `*TOTAL TAGIHAN: ${formatRupiah(totalFinal)}*\n\n` +
                                   `--- LOKASI ANTAR ---\n` +
                                   `${session.location}\n\n` +
                                   `_Bot sudah mengirim QRIS. Status: MENUNGGU PEMBAYARAN._`;
                
                await sendWhatsAppMessage(ADMIN_PHONE, adminNotif);
                delete userSessions[sender]; 
            
            // ALUR 2: PESANAN CUSTOM
            } else if (session.jobType === 'Custom Order') {
                
                const finalOrderDetailsForDB = `[CUSTOM ORDER] ${session.details} | Lokasi: ${session.location}`;

                const newOrder = {
                    orderId: 'ORD-' + Date.now(),
                    orderDate: new Date().toISOString(),
                    customerNumber: sender,
                    customerName: customerName,
                    menuChoice: "Custom Order",
                    orderDetails: finalOrderDetailsForDB,
                    nominal: 0, 
                    status: "Pending (Admin Review)",
                    complaint: null
                };
                orders.push(newOrder);
                saveOrders(); 

                const adminNotif = `🔔 *CUSTOM ORDER BARU (BUTUH HARGA)* 🔔\n\n` +
                                   `Dari: ${customerName} (${sender})\n\n` +
                                   `--- PESANAN ---\n` +
                                   `${session.details}\n\n` +
                                   `--- LOKASI ANTAR ---\n` +
                                   `${session.location}\n\n` +
                                   `Mohon tentukan harga dan balas bot dengan:\n` +
                                   "`!tagih " + sender + " [NOMINAL_TOTAL]`";
                
                await sendWhatsAppMessage(ADMIN_PHONE, adminNotif);
                
                response.replyToSender = "Siap! Pesanan custom Anda telah diteruskan ke Admin.\n\n" +
                                         `*Pesanan:* ${session.details}\n` +
                                         `*Lokasi:* ${session.location}\n\n` +
                                         `Admin akan segera menghitung total dan mengirimkan tagihan QRIS. Mohon ditunggu...`;
                
                delete userSessions[sender]; 
            }
        }

    } catch (e) {
        console.error("Error di handleForm:", e);
        delete userSessions[sender];
        response.replyToSender = "Maaf, terjadi error. Sesi dibatalkan. Coba ulangi.";
    }
    return response;
}
// =======================================================

// --- (Fungsi 'processMessage' v9.2b - ADA REVISI) ---
async function processMessage(senderNumber, messageText, customerName) {
    const sender = senderNumber; 
    const text = messageText.toLowerCase().trim();
    const session = userSessions[sender]; 
    
    let response = { replyToSender: null };

    if (text === 'batal' || text === '!batal') {
        if (session) {
            delete userSessions[sender]; 
            response.replyToSender = "Oke, Bang. Aksi dibatalkan. 👍";
            return response;
        }
    }

    // --- BAGIAN 0: TANGANI SESI PELANGGAN YANG SEDANG BERJALAN ---
    if (session) {
        // (Tidak ada perubahan di sini)
        if (session.stage === 'ordering') {
            if (text.startsWith("!pesan ")) {
                const parts = messageText.split(" "); 
                if (parts.length < 3) {
                    response.replyToSender = "Format salah. Contoh: `!pesan NS 2`"; return response;
                }
                const kode = parts[1].toUpperCase(); 
                const jumlah = parseInt(parts[2], 10);
                if (!MENU[kode]) {
                    response.replyToSender = `Kode menu '${kode}' tidak ditemukan.`; return response;
                }
                if (isNaN(jumlah) || jumlah <= 0) {
                    response.replyToSender = 'Jumlah harus angka dan lebih dari 0.'; return response;
                }
                const itemDiKeranjang = session.cart.find(item => item.kode === kode);
                if (itemDiKeranjang) {
                    itemDiKeranjang.qty += jumlah; 
                } else {
                    session.cart.push({ kode: kode, item: MENU[kode], qty: jumlah }); 
                }
                let total = 0;
                let cartSummary = "🛒 *KERANJANG ANDA SAAT INI* 🛒\n\n";
                for (const pesanan of session.cart) {
                    const subtotal = pesanan.item.harga * pesanan.qty;
                    cartSummary += `*${pesanan.item.nama}*\n`;
                    cartSummary += `  ${pesanan.qty} x ${formatRupiah(pesanan.item.harga)} = ${formatRupiah(subtotal)}\n`;
                    total += subtotal;
                }
                cartSummary += `\n*TOTAL MAKANAN: ${formatRupiah(total)}*`;
                cartSummary += `\n(Belum termasuk ongkir ${formatRupiah(ONGKIR_TETAP)})`;
                response.replyToSender = `✅ *${MENU[kode].nama}* (x${jumlah}) berhasil ditambahkan.\n\n` +
                                         `${cartSummary}\n\n` +
                                         "Ingin tambah order lainnya?\n" +
                                         "Ketik `!pesan [KODE] [JML]` lagi.\n" +
                                         "Ketik `!keranjang` untuk cek ulang.\n" +
                                         "Ketik `!checkout` untuk bayar.";
                return response;
            }
            else if (text === '!keranjang') {
                if (session.cart.length === 0) {
                    response.replyToSender = 'Keranjang Anda masih kosong. Silakan `!pesan [KODE] [JUMLAH]`.'; return response;
                }
                let textKeranjang = '🛒 *KERANJANG ANDA* 🛒\n\n';
                let total = 0;
                for (const pesanan of session.cart) {
                    const subtotal = pesanan.item.harga * pesanan.qty;
                    textKeranjang += `*${pesanan.item.nama}*\n`;
                    textKeranjang += `  ${pesanan.qty} x ${formatRupiah(pesanan.item.harga)} = ${formatRupiah(subtotal)}\n`;
                    total += subtotal;
                }
                textKeranjang += `\n*TOTAL MAKANAN: ${formatRupiah(total)}*`;
                textKeranjang += `\n(Belum termasuk ongkir ${formatRupiah(ONGKIR_TETAP)})`;
                textKeranjang += `\n\nKetik \`!checkout\` untuk lanjut ke pengiriman.\nKetik \`!batal\` untuk batal.`;
                response.replyToSender = textKeranjang;
                return response;
            }
            else if (text === '!checkout') {
                if (session.cart.length === 0) {
                    response.replyToSender = "Keranjang Anda kosong. Silakan `!pesan` dulu.";
                    return response;
                }
                session.stage = 'ask_location'; 
                response.replyToSender = "Oke, pesanan dicatat. 👍\n\nLokasi antarnya di mana, Bang?\n(Mohon kirim alamat lengkap atau share location)\n\n_Ketik `batal` untuk membatalkan._";
                return response;
            }
            else if (text === '!menu') {
                let textMenu = '🍽️ *MENU RUMAH MAKAN* 🍽️\n\n';
                for (const [kode, item] of Object.entries(MENU)) {
                    textMenu += `*${kode}* - ${item.nama} (${formatRupiah(item.harga)})\n`;
                }
                textMenu += '\n(Anda sedang dalam sesi pemesanan)';
                response.replyToSender = textMenu;
                return response;
            }
            else {
                response.replyToSender = "Anda sedang memesan.\n" +
                                         "Gunakan `!pesan [KODE] [JUMLAH]`\n" +
                                         "Ketik `!keranjang` untuk cek.\n" +
                                         "Ketik `!checkout` untuk lanjut.\n" +
                                         "Ketik `!batal` untuk batal.";
                return response;
            }
        }
        else if (session.stage === 'ask_location') {
            return handleForm(sender, messageText, session, customerName);
        }
    }

    // --- BAGIAN 1: LOGIKA ADMIN (DIREVISI) ---
    if (sender === ADMIN_PHONE) { 
        
        // --- REVISI v9.3: Tambah !konfirmasi ke menu ---
        if (text === "!admin") {
            response.replyToSender = "======= 👮‍♂️ MENU ADMIN =======\n\n" +
                                   "1. `!tagih [nomor] [nominal]`\n" +
                                   "   (HANYA untuk CUSTOM ORDER)\n\n" +
                                   "2. `!konfirmasi [nomor]`\n" +
                                   "   (Menyetujui bukti bayar pelanggan)\n\n" +
                                   "3. `!balas [nomor] [pesan]`\n" +
                                   "   (Membalas komplain pelanggan)\n\n" +
                                   "4. `!listorder`\n" +
                                   "   (Melihat 5 order terakhir)";
            return response;
        }

        if (text.startsWith("!tagih ")) {
            // (Logika !tagih tidak berubah)
            const parts = text.split(" ");
            if (parts.length < 3) { response.replyToSender = "Format: `!tagih 628xx NOMINAL`"; return response; }
            const customerNumber = parts[1];
            const nominal = parseInt(parts[2], 10);
            if (isNaN(nominal) || !customerNumber.startsWith("62")) {
                response.replyToSender = "Format salah. Cek nomor / nominal."; return response;
            }
            const orderToUpdate = orders.find(o => o.customerNumber === customerNumber && o.status === "Pending (Admin Review)");
            if (!orderToUpdate) {
                response.replyToSender = `Tidak ada order custom/pending untuk ${customerNumber}. Order standar diproses otomatis.`; return response;
            }
            try {
                console.log(`[QRIS MANUAL] Admin membuat tagihan ${nominal} for ${customerNumber}`);
                const qrDataUrl = await generateDynamicQrisManual(nominal);
                const base64Image = qrDataUrl.split(';base64,').pop();
                const media = new MessageMedia('image/png', base64Image, `qris-payment-${orderToUpdate.orderId}.png`);
                const paymentMessage = `Pesanan Custom Anda siap dibayar. ✅\n\n` +
                                       `Total Tagihan: *${formatRupiah(nominal)}*\n\n` +
                                       `Silakan pindai QRIS di atas untuk membayar.\n\n` +
                                       `_Kirim bukti transfer (screenshot). Ketik \`!batalorder\` jika ingin membatalkan pesanan ini._`;
                await client.sendMessage(`${customerNumber}@c.us`, media, { caption: paymentMessage });
                orderToUpdate.status = "Pending Payment"; 
                orderToUpdate.nominal = nominal;
                saveOrders();
                response.replyToSender = `✅ QRIS Tagihan ${formatRupiah(nominal)} berhasil dikirim ke ${customerNumber}.`;
            } catch (err) {
                console.error("[QRIS MANUAL] GAGAL:", err);
                response.replyToSender = "Gagal membuat QRIS. Cek error di console: " + err.message;
            }
            return response;
        }

        // --- REVISI v9.3: Tambah Perintah !konfirmasi ---
        else if (text.startsWith("!konfirmasi ")) {
            const parts = text.split(" ");
            if (parts.length < 2) { 
                response.replyToSender = "Format: `!konfirmasi 628xxxx`"; 
                return response; 
            }
            const customerNumber = parts[1];
            if (!customerNumber.startsWith("62")) { 
                response.replyToSender = "Format nomor salah: `!konfirmasi 628xxxx`"; 
                return response; 
            }

            // Cari order terakhir dari customer ini yang statusnya "Verifying"
            const orderToConfirm = orders.slice().reverse().find(
                o => o.customerNumber === customerNumber && o.status === "Completed (Verifying)"
            );

            if (!orderToConfirm) {
                response.replyToSender = `Error: Tidak ditemukan order yang perlu dikonfirmasi (status 'Verifying') untuk ${customerNumber}.`;
                return response;
            }

            // Update status
            orderToConfirm.status = "Confirmed & Processed";
            saveOrders();

            // Kirim notifikasi ke Pelanggan
            const customerMsg = `✅ *Pesanan Dikonfirmasi!* ✅\n\n` +
                                `Order Anda (ID: ${orderToConfirm.orderId}) telah dikonfirmasi oleh Admin dan *sedang disiapkan oleh dapur*.\n\n` +
                                `Terima kasih!`;
            await sendWhatsAppMessage(customerNumber, customerMsg);

            // Balas ke Admin
            response.replyToSender = `✅ Berhasil! Order ${orderToConfirm.orderId} untuk ${customerNumber} telah dikonfirmasi & pelanggan telah dinotifikasi.`;
            return response;
        }
        // --- AKHIR REVISI ---

        else if (text.startsWith("!balas ")) {
            // (Logika !balas tidak berubah)
            const parts = text.split(" ");
            if (parts.length < 3) { response.replyToSender = "Format: `!balas 628xx PESAN ANDA`"; return response; }
            const customerNumber = parts[1];
            const pesan = messageText.substring(text.indexOf(customerNumber) + customerNumber.length + 1).trim();
            if (!customerNumber.startsWith("62")) { response.replyToSender = "Nomor salah."; return response; }
            const replyMsg = `🔔 *Pesan dari Admin:*\n\n${pesan}`;
            await sendWhatsAppMessage(customerNumber, replyMsg);
            response.replyToSender = `✅ Pesan balasan terkirim ke ${customerNumber}.`;
            return response;
        }
        
        else if (text === "!listorder") {
            // (Logika !listorder tidak berubah)
             let list = "--- 5 ORDER TERAKHIR ---\n\n";
             const recentOrders = orders.slice(-5).reverse(); 
             if (recentOrders.length === 0) { list = "Belum ada order."; }
             recentOrders.forEach(order => {
                 list += `ID: ${order.orderId}\n` +
                         `Tgl: ${new Date(order.orderDate).toLocaleString('id-ID')}\n` +
                         `Pelanggan: ${order.customerName} (${order.customerNumber})\n` +
                         `Status: *${order.status}*\n` +
                         `Total: *${formatRupiah(order.nominal)}*\n` +
                         `Detail: ${order.orderDetails}\n`;
                 if (order.complaint) {
                     list += `*Komplain: ${order.complaint}*\n`;
                 }
                 list += "----------\n";
             });
             response.replyToSender = list;
             return response;
        }

        response.replyToSender = "Perintah admin tidak dikenal. Ketik `!admin` untuk bantuan.";
        return response;
    }

    // --- BAGIAN 3: LOGIKA PELANGGAN (DIREVISI) ---
    else if (sender !== ADMIN_PHONE) { 
        
        const menuText = (
            "Selamat datang di *Warung Bot*! 🤖\n\n" +
            "Silakan ketik perintah di bawah ini:\n\n" +
            "➡️ `!menu`\n" +
            "   (Untuk melihat daftar menu & mulai memesan)\n\n" +
            "➡️ `!custom [deskripsi pesanan]`\n" +
            "   (Contoh: `!custom Nasi tumpeng 20 orang`)\n\n" +
            "➡️ `!batalorder`\n" +
            "   (Membatalkan pesanan yg menunggu bayar)\n\n" +
            "➡️ `!komplain [pesan Anda]`\n" +
            "   (Untuk komplain order *terakhir* Anda)\n\n" +
            "Ketik `info` untuk melihat daftar ini lagi."
        );

        if (text === "info" || text === "menuawal") { 
            response.replyToSender = menuText; 
            return response; 
        }
        
        if (text === "!menu") {
            // (Logika !menu tidak berubah)
            userSessions[sender] = { 
                stage: 'ordering', 
                jobType: 'Pesanan Makanan',
                customerName: customerName,
                cart: [] 
            };
            let textMenu = '🍽️ *MENU RUMAH MAKAN* 🍽️\n\n';
            textMenu += 'Gunakan format `!pesan [KODE] [JUMLAH]`\n';
            textMenu += 'Contoh: `!pesan NS 2`\n\n';
            for (const [kode, item] of Object.entries(MENU)) {
                textMenu += `*${kode}* - ${item.nama} (${formatRupiah(item.harga)})\n`;
            }
            textMenu += `\n*Ongkir Tetap:* ${formatRupiah(ONGKIR_TETAP)}`;
            textMenu += '\n\nKetik `!keranjang` untuk cek pesanan.\nKetik `!checkout` untuk bayar.\nKetik `!batal` untuk batal.';
            response.replyToSender = textMenu;
            return response;
        }
        
        if (text.startsWith("!custom ")) {
            // (Logika !custom tidak berubah)
            const details = messageText.substring(8).trim();
            if (details.length < 10) {
                response.replyToSender = "Mohon jelaskan pesanan custom Anda lebih detail (minimal 10 karakter).";
                return response;
            }
            userSessions[sender] = { 
                stage: 'ask_location', 
                jobType: 'Custom Order', 
                details: details,
                customerName: customerName,
                cart: [] 
            };
            response.replyToSender = `Oke, pesanan custom Anda: "${details}"\n\nLokasi antarnya di mana, Bang?\n\n_Ketik \`batal\` untuk membatalkan._`;
            return response;
        }
        
        // --- REVISI v9.3: Ubah status !komplain ---
        if (text.startsWith("!komplain ")) {
            const reason = messageText.substring(10).trim();
            if (reason.length < 10) {
                response.replyToSender = "Mohon jelaskan komplain Anda lebih detail (minimal 10 karakter).";
                return response;
            }
            
            // Cek status baru "Confirmed & Processed"
            const lastOrder = orders.slice().reverse().find(
                o => o.customerNumber === sender && 
                     (o.status === "Confirmed & Processed" || o.status === "Completed (Verifying)" || o.status === "Pending Payment")
            );
                
            if (!lastOrder) {
                response.replyToSender = "Tidak ditemukan riwayat order (yang sudah selesai/menunggu bayar) untuk dikomplain.";
                return response;
            }
            
            if (lastOrder.complaint) {
                response.replyToSender = `Anda sudah mengirim komplain untuk order ${lastOrder.orderId}:\n_"${lastOrder.complaint}"_`;
                return response;
            }
            
            lastOrder.complaint = reason;
            saveOrders();
            
            const adminMsg = `🔔 *KOMPLAIN BARU* 🔔\n\n` +
                             `Dari: ${customerName} (${sender})\n` +
                             `Order: ${lastOrder.orderId} (Status: ${lastOrder.status})\n` +
                             `Detail: ${lastOrder.orderDetails}\n\n` +
                             `*Komplain:* ${reason}\n\n` +
                             `Balas dengan: \`!balas ${sender} [pesan balasan]\``;
            await sendWhatsAppMessage(ADMIN_PHONE, adminMsg);
            
            response.replyToSender = `Komplain Anda untuk order ${lastOrder.orderId} telah terkirim ke Admin. Mohon tunggu balasannya.`;
            return response;
        }
        
        if (text === "!batalorder") {
            // (Logika !batalorder tidak berubah)
            const lastOrder = orders.slice().reverse().find(
                o => o.customerNumber === sender && o.status === "Pending Payment"
            );
            
            if (!lastOrder) {
                response.replyToSender = "Tidak ada pesanan yang sedang menunggu pembayaran untuk dibatalkan.";
                return response;
            }
            
            lastOrder.status = "Canceled";
            saveOrders();
            
            const adminMsg = `PELANGGAN BATAL ORDER! ⚠️\n\n` +
                             `Pelanggan: ${lastOrder.customerName} (${sender})\n` +
                             `Order: ${lastOrder.orderId}\n` +
                             `Total: ${formatRupiah(lastOrder.nominal)}\n` +
                             `Status telah diubah menjadi "Canceled".`;
            await sendWhatsAppMessage(ADMIN_PHONE, adminMsg);
            
            response.replyToSender = `Pesanan ${lastOrder.orderId} (Total: ${formatRupiah(lastOrder.nominal)}) telah berhasil dibatalkan.`;
            return response;
        }

        else if (text.length > 0) {
            response.replyToSender = `Maaf, Bang. Perintah tidak dikenal. 😕\n\n${menuText}`;
        }
    }
    
    return response;
}

// Fungsi "Kurir" (Pengirim Pesan)
async function sendWhatsAppMessage(to, message) {
    const chatId = `${to}@c.us`;
    try {
        await client.sendMessage(chatId, message);
        console.log(`[PESAN TERKIRIM] ke ${to}`);
    } catch (err) {
        console.error(`[GAGAL KIRIM] ke ${to}:`, err.message);
    }
}


// Mulai jalankan client
client.initialize();
