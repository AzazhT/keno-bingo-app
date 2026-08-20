const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const { Server } = require('socket.io');
const http = require('http');
const path = require('path');

// የቦት ቶከንዎን እዚህ ያስገቡ
const TOKEN = 'YOUR_TELEGRAM_BOT_TOKEN';
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
let bingoTakenNumbers = {};      // { number: tgId } -> ቢንጎ ላይ የተያዙ ቁጥሮች
let bingoDrawnNumbers = [];      // ቢንጎ ላይ የወጡ ቁጥሮች
let bingoTimer = 30;             // የቢንጎ 30 ሰከንድ ቆጣሪ

const activeKenoTickets = [];    // የኬኖ ቲኬቶች
let kenoDrawnNumbers = [];       // የኬኖ የወጡ ቁጥሮች
let kenoTimer = 60;              // የኬኖ ቆጣሪ

// --- 1. /start ትዕዛዝ ሲላክ ---
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const welcomeText = "እንኳን ወደ ኬኖ እና ቢንጎ ጨዋታ በደህና መጡ! ከታች ያለውን በመጫን ይጫወቱ።";

  const options = {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "🎮 ኬኖ ጨዋታ (Play Keno)", web_app: { url: "https://የእርስዎ-ሰርቨር-ሊንክ.onrender.com/keno.html" } },
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

// የቦት አዝራሮች ምላሽ
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

// --- 2. የቢንጎ 30 ሰከንድ ቆጣሪ ---
setInterval(() => {
  bingoTimer--;
  if (bingoTimer <= 0) {
    bingoTimer = 30;
    bingoTakenNumbers = {}; 
    bingoDrawnNumbers = [];
    io.emit('bingoGameReset');
  }

  let nextNum;
  do {
    nextNum = Math.floor(Math.random() * 75) + 1;
  } while (bingoDrawnNumbers.includes(nextNum));

  bingoDrawnNumbers.push(nextNum);
  io.emit('bingoNewNumberCall', { number: nextNum, drawnList: bingoDrawnNumbers, timer: bingoTimer });
}, 30000);

// --- 3. የኬኖ 60 ሰከንድ ቆጣሪ ---
setInterval(() => {
  kenoTimer--;
  if (kenoTimer <= 0) {
    kenoTimer = 60;
    kenoDrawnNumbers = [];
    activeKenoTickets.length = 0;
    io.emit('kenoGameReset');
  }
  io.emit('kenoTimerUpdate', kenoTimer);
}, 1000);

// --- 4. Socket.io ግንኙነት ---
io.on('connection', (socket) => {
  console.log('ተጫዋች ተገናኝቷል:', socket.id);

  socket.on('registerUser', (userData) => {
    if (!userData || !userData.id) return;
    const tgId = String(userData.id);

    if (!registeredUsers[tgId]) {
      registeredUsers[tgId] = {
        id: tgId,
        name: userData.first_name || "ተጫዋች",
        balance: 100.00 // የመጀመሪያ ቦነስ
      };
    }

    socket.emit('userData', {
      user: registeredUsers[tgId],
      bingoTakenNumbers,
      bingoDrawnNumbers,
      kenoDrawnNumbers,
      activeKenoTickets
    });
  });

  // ቢንጎ ላይ ቁጥር ሲይዙ (ለምሳሌ 66) ለሌሎች ማሳየት
  socket.on('selectBingoNumber', (data) => {
    const { tgId, number } = data;
    const user = registeredUsers[String(tgId)];
    if (!user) return socket.emit('errorMsg', 'መጀመሪያ ይመዝገቡ!');

    if (bingoTakenNumbers[number]) {
      return socket.emit('errorMsg', 'ይህ ቁጥር ቀድሞ ተይዟል!');
    }

    bingoTakenNumbers[number] = String(tgId);
    io.emit('bingoNumberTaken', { number, tgId: String(tgId), userName: user.name, takenNumbersMap: bingoTakenNumbers });
  });

  // ኬኖ ቲኬት መግዛት
  socket.on('buyTicket', (data) => {
    const user = registeredUsers[String(data.userId)];
    if (!user || user.balance < data.bet) return socket.emit('errorMsg', 'ባላንስ በቂ አይደለም!');

    user.balance -= data.bet;
    socket.emit('balanceUpdated', user.balance);

    activeKenoTickets.push({ userId: user.id, userName: user.name, numbers: data.numbers, bet: data.bet, maxWin: data.maxWin, hitsCount: 0 });
    socket.emit('ticketBoughtSuccess');
    io.emit('updateActiveKenoTickets', activeKenoTickets);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
