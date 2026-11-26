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

// 3. Клиент Steam (autoRelogin: false, чтобы не конфликтовал с нашим дебаунсером и Watchdog)
const client = new SteamUser({ autoRelogin: false });

let isBlocked = false;
let isLoggingIn = false;
let reconnectTimer = null;
let loginTimeout = null;

function clearTimers() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (loginTimeout) {
    clearTimeout(loginTimeout);
    loginTimeout = null;
  }
}

function scheduleRelogin(delayMs) {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    logIn();
  }, delayMs);
}

function logIn() {
  if (client.steamID || isLoggingIn) return;
  isLoggingIn = true;
  console.log('[Steam] Вход по сохранённому REFRESH_TOKEN...');

  // Сброс флага, если сервер Steam завис и не ответил за 25 секунд
  if (loginTimeout) clearTimeout(loginTimeout);
  loginTimeout = setTimeout(() => {
    if (isLoggingIn && !client.steamID) {
      console.log('[Steam] Таймаут входа. Сброс состояния...');
      isLoggingIn = false;
    }
  }, 25000);

  try {
    client.logOn({ refreshToken: REFRESH_TOKEN });
  } catch (err) {
    isLoggingIn = false;
    console.error('[Steam] Ошибка вызова logOn:', err.message);
    scheduleRelogin(30000);
  }
}

client.on('loggedOn', () => {
  isLoggingIn = false;
  clearTimers();
  console.log(`[Steam] Успешный вход как ${client.steamID.getSteamID64()}`);
  client.setPersona(SteamUser.EPersonaState.Invisible);
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
  isLoggingIn = false;
  isBlocked = false;
  if (loginTimeout) {
    clearTimeout(loginTimeout);
    loginTimeout = null;
  }
  console.log(`[Steam] Разрыв соединения (${msg || eresult}). Реконнект через 30 сек...`);
  scheduleRelogin(30000);
});

client.on('error', (err) => {
  isLoggingIn = false;
  if (loginTimeout) {
    clearTimeout(loginTimeout);
    loginTimeout = null;
  }
  console.error('[Steam Ошибка]:', err.message);

  if (err.eresult === 6 || err.message.includes('LoggedInElsewhere')) {
    console.log('[Steam] Сессия выбита другим ПК. Перевход в режим ожидания через 60 сек...');
    scheduleRelogin(60000);
  } else if (err.eresult === 84 || err.message.includes('RateLimitExceeded')) {
    console.log('[Steam] Лимит запросов (RateLimit). Пауза 20 минут...');
    scheduleRelogin(20 * 60 * 1000);
  } else if (err.eresult === 5 || err.eresult === 15 || err.message.includes('InvalidPassword')) {
    console.error('[Критично] REFRESH_TOKEN истёк или отозван! Обнови STEAM_REFRESH_TOKEN в настройках Render.');
  } else {
    scheduleRelogin(30000);
  }
});

// Watchdog: каждые 5 минут проверяет, не завис ли бот в офлайне после ТО серверов Valve
setInterval(() => {
  if (!client.steamID && !isLoggingIn && !reconnectTimer) {
    console.log('[Watchdog] Бот не в сети. Принудительный вход...');
    logIn();
  } else if (client.steamID && !isBlocked) {
    client.gamesPlayed(GAMES);
  }
}, 5 * 60 * 1000);

logIn();
