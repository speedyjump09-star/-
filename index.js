const http = require('http');
const https = require('https');
const SteamUser = require('steam-user');

const REFRESH_TOKEN = process.env.STEAM_REFRESH_TOKEN;
const GAMES = (process.env.STEAM_GAMES || '730')
  .split(',')
  .map((id) => parseInt(id.trim(), 10))
  .filter(Boolean)
  .slice(0, 32);
const PORT = process.env.PORT || 10000;
const SELF_URL = process.env.RENDER_EXTERNAL_URL || 'https://steam-booster-fq2w.onrender.com';

if (!REFRESH_TOKEN) {
  console.error('[Ошибка] Не задана переменная STEAM_REFRESH_TOKEN!');
  process.exit(1);
}

// 1. Защита от случайных падений Node.js при сетевых сбоях Steam
process.on('uncaughtException', (err) => {
  console.error('[Система] Перехвачена ошибка:', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('[Система] Перехвачен сбой промиса:', reason);
});

// 2. HTTP-сервер + самопинг каждые 10 минут (страховка для cron-job.org)
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Steam Booster OK');
}).listen(PORT, () => {
  console.log(`[HTTP] Сервер запущен на порту ${PORT}`);
});

setInterval(() => {
  if (SELF_URL) {
    https.get(SELF_URL, (res) => {
      res.resume();
    }).on('error', (err) => {
      console.error('[Self-Ping] Ошибка:', err.message);
    });
  }
}, 10 * 60 * 1000);

// 3. Клиент Steam с автовосстановлением
const client = new SteamUser({ autoRelogin: true });

let isBlocked = false;
let reconnectTimer = null;

function scheduleRelogin(delayMs) {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (!client.steamID) logIn();
  }, delayMs);
}

function logIn() {
  if (client.steamID) return;
  console.log('[Steam] Вход по сохранённому REFRESH_TOKEN...');
  client.logOn({ refreshToken: REFRESH_TOKEN });
}

client.on('loggedOn', () => {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  console.log(`[Steam] Успешный вход как ${client.steamID.getSteamID64()}`);
  client.setPersona(SteamUser.EPersonaState.Invisible);
  // Не запускаем игры сразу вслепую — ждём ответ сервера в playingState,
  // чтобы не выкинуть тебя из игры на ПК при переподключении
});

client.on('playingState', (blocked) => {
  isBlocked = blocked;
  if (blocked) {
    console.log('[Steam] Пауза: ты сам запустил игру на ПК.');
  } else {
    console.log(`[Steam] Слот свободен. Запущена накрутка для AppID: ${GAMES.join(', ')}`);
    client.gamesPlayed(GAMES);
  }
});

client.on('disconnected', (eresult, msg) => {
  isBlocked = false;
  console.log(`[Steam] Разрыв соединения (${msg || eresult}). Ожидание реконнекта...`);
});

client.on('error', (err) => {
  console.error('[Steam Ошибка]:', err.message);
  if (err.eresult === 6 || err.message.includes('LoggedInElsewhere')) {
    console.log('[Steam] Сессия выбита другим ПК. Перевход в режим ожидания через 60 сек...');
    scheduleRelogin(60000);
  } else {
    scheduleRelogin(30000);
  }
});

// Страховка от зависания сессии после вторничного ТО серверов Valve (раз в 6 часов)
setInterval(() => {
  if (client.steamID && !isBlocked) {
    client.gamesPlayed(GAMES);
  }
}, 6 * 60 * 60 * 1000);

logIn();
