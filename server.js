const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const { Server } = require('socket.io');
const http = require('http');
const path = require('path');

// የተሰጡዎት የቦት ቶከን እና የቻናል/አስተዳዳሪ መረጃዎች
const TOKEN = '8698997396:AAHbZrYI9p-zJaKCee5d8fUlSuVbizAcOOM';
const ADMIN_ID = '686733543';

const bot = new TelegramBot(TOKEN, { polling: true });

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

// Static files (Frontend ፋይሎችን ከ public ማህደር ለማንበብ)
app.use(express.static(path.join(__dirname, 'public')));

// የውሂብ ማከማቻዎች
const registeredUsers = {};      // { tgId: { id, name, balance } }
let kenoTimer = 60;              // የኬኖ ቆጣሪ
let activeKenoTickets = [];    // የኬኖ ቲኬቶች
let kenoDrawnNumbers = [];       // የኬኖ የወጡ ቁጥሮች

// ኬኖ ፔይቴብል (Paytable)
const PAYTABLE = {
  1: { 1: 3.5 },
  2: { 2: 10, 1: 1 },
  3: { 3: 50, 2: 2 },
  4: { 4: 100, 3: 5, 2: 1 },
  5: { 5: 300, 4: 15, 3: 2 },
  6: { 6: 1000, 5: 50, 4: 5, 3: 1 },
  7: { 7: 2000, 6: 100, 5: 12, 4: 2 },
  8: { 8: 5000, 7: 300, 6: 40, 5: 8, 4: 1 },
  9: { 9: 10000, 8: 1000, 7: 150, 6: 20, 5: 3 },
  10: { 10: 25000, 9: 2000, 8: 400, 7: 50, 6: 10, 5: 2 }
};

// --- 1. /start ትዕዛዝ ሲላክ ---
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const welcomeText = "እንኳን ወደ ኬኖ እና ቢንጎ ጨዋታ በደህና መጡ! ከታች ያለውን በመጫን ይጫወቱ።";

  const options = {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "🎮 ኬኖ ጨዋታ (Play Keno)", web_app: { url: "https://የእርስዎ-ሰርቨር-ሊንክ.onrender.com/index.html" } },
          { text: "🎯 ቢንጎ ጨዋታ (Play Bingo)", web_app: { url: "https://የእርስዎ-ሰርቨር-ሊንክ.onrender.com/bingo.html" } }
        ],
        [
          { text: "💰 ባላንስ ማረጋገጫ", callback_data: "balance" },
          { text: "💸 ገንዘብ ማስገባት (Deposit)", callback_data: "deposit" }
        ]
      ]
    }
  };
  bot.sendMessage(chatId, welcomeText, options);
});

bot.on('callback_query', (query) => {
  const chatId = query.message.chat.id;
  const userId = query.from.id;
  const data = query.data;

  if (data === 'balance') {
    const user = registeredUsers[userId];
    const bal = user ? user.balance : 100.00;
    bot.sendMessage(chatId, `💰 የሒሳብዎ መጠን: ${bal.toFixed(2)} ETB`);
  } else if (data === 'deposit') {
    bot.sendMessage(chatId, "📥 ገንዘብ ለማስገባት የቴሌብር ቁጥር: 0915503379 (Mulualem Shewel)");
  }
  bot.answerCallbackQuery(query.id);
});

// --- 2. የኬኖ 60 ሰከንድ ቆጣሪ እና ቁጥር ማውጣት ---
setInterval(() => {
  kenoTimer--;
  if (kenoTimer <= 0) {
    kenoTimer = 60;
    kenoDrawnNumbers = [];
    activeKenoTickets = [];
    io.emit('gameReset');
  } else {
    if (kenoDrawnNumbers.length < 20) {
      let rand;
      do {
        rand = Math.floor(Math.random() * 80) + 1;
      } while (kenoDrawnNumbers.includes(rand));
      
      kenoDrawnNumbers.push(rand);

      activeKenoTickets.forEach(t => {
        t.hitsCount = t.numbers.filter(n => kenoDrawnNumbers.includes(n)).length;
      });

      io.emit('newDrawnNumber', { number: rand, drawnList: kenoDrawnNumbers });
      io.emit('updateActiveTickets', activeKenoTickets);
    }
  }
  io.emit('timerUpdate', kenoTimer);
}, 1000);

// --- 3. Socket.io ግንኙነት ---
io.on('connection', (socket) => {
  console.log('ተጫዋች ተገናኝቷል:', socket.id);

  socket.on('registerUser', (userData) => {
    if (!userData || !userData.id) return;
    const tgId = String(userData.id);

    if (!registeredUsers[tgId]) {
      registeredUsers[tgId] = {
        id: tgId,
        name: userData.first_name || "ተጫዋች",
        balance: 500.00 // የመጀመሪያ ቦነስ
      };
    }

    socket.emit('userData', {
      user: registeredUsers[tgId],
      drawnNumbers: kenoDrawnNumbers,
      activeTickets: activeKenoTickets,
      totalPlayersCount: 4325
    });
  });

  socket.on('buyTicket', (data) => {
    const user = registeredUsers[String(data.userId)];
    if (!user) return socket.emit('errorMsg', 'መጀመሪያ ይመዝገቡ!');
    if (user.balance < data.bet) return socket.emit('errorMsg', 'ባላንስ በቂ አይደለም!');

    user.balance -= data.bet;
    socket.emit('balanceUpdated', user.balance);

    const newTicket = {
      userId: user.id,
      userName: user.name,
      numbers: data.numbers,
      bet: data.bet,
      maxWin: data.maxWin,
      hitsCount: 0
    };

    activeKenoTickets.push(newTicket);
    socket.emit('ticketBoughtSuccess');
    io.emit('updateActiveTickets', activeKenoTickets);
  });

  socket.on('verifyAndDeposit', (data) => {
    const user = registeredUsers[String(data.userId)];
    if (user) {
      user.balance += parseFloat(data.amount || 0);
      socket.emit('balanceUpdated', user.balance);
      socket.emit('infoMsg', 'ገንዘብዎ ወደ አካውንትዎ ገብቷል!');
      
      // ለፖስተር/አስተዳዳሪ ማሳወቂያ መላክ ከፈለጉ
      bot.sendMessage(ADMIN_ID, `📥 አዲስ የዲፖዚት ጥያቄ!\nተጠቃሚ: ${user.name}\nመጠን: ${data.amount} ETB\nSMS: ${data.smsText}`);
    }
  });

  socket.on('requestWithdraw', (data) => {
    const user = registeredUsers[String(data.userId)];
    if (user && user.balance >= data.amount) {
      user.balance -= data.amount;
      socket.emit('balanceUpdated', user.balance);
      socket.emit('infoMsg', 'የወጪ ጥያቄዎ ተልኳል!');
      
      bot.sendMessage(ADMIN_ID, `📤 አዲስ የወጪ ጥያቄ!\nተጠቃሚ: ${user.name}\nመጠን: ${data.amount} ETB`);
    } else {
      socket.emit('errorMsg', 'በቂ ባላንስ የለዎትም!');
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
