const http = require('http');
const SteamUser = require('steam-user');
const SteamTotp = require('steam-totp');

// 1. HTTP-заглушка для Render + cron-job.org (чтобы контейнер не засыпал)
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Steam Hour Booster is running');
}).listen(PORT, () => {
  console.log(`[HTTP] Сервер запущен на порту ${PORT}`);
});

// 2. Настройки аккаунта (берутся из переменных окружения Render)
const USERNAME = process.env.STEAM_USERNAME;
const PASSWORD = process.env.STEAM_PASSWORD;
const SHARED_SECRET = process.env.STEAM_SHARED_SECRET; // Опционально: если привязан SDA / maFile

// Список AppID игр (максимум 32 штуки). 730 = Counter-Strike 2
const GAMES = (process.env.STEAM_GAMES || '730')
  .split(',')
  .map(id => Number(id.trim()))
  .filter(Boolean)
  .slice(0, 32);

const client = new SteamUser();

function logIn() {
  const logOnOptions = {
    accountName: USERNAME,
    password: PASSWORD,
    promptSteamGuardCode: false
  };

  if (SHARED_SECRET) {
    logOnOptions.twoFactorCode = SteamTotp.generateAuthCode(SHARED_SECRET);
  }

  client.logOn(logOnOptions);
}

client.on('loggedOn', () => {
  console.log(`[Steam] Успешный вход как ${client.steamID.getSteamID64()}`);
  // Ставим статус "Не в сети" (Invisible), чтобы не палиться перед друзьями, при этом часы всё равно идут
  client.setPersona(SteamUser.EPersonaState.Invisible);
  client.gamesPlayed(GAMES);
  console.log(`[Steam] Запущена накрутка для AppID: ${GAMES.join(', ')}`);
});

// Автопауза: если ты сам зашёл в игру на этом аккаунте
client.on('playingState', (blocked, playingApp) => {
  if (blocked) {
    console.log(`[Steam] Пауза: владелец сам запустил игру (AppID: ${playingApp}). Ждём выхода...`);
  } else {
    console.log('[Steam] Владелец вышел из игры. Возобновляем накрутку...');
    client.gamesPlayed(GAMES);
  }
});

// Если требуется код Steam Guard (когда нет SHARED_SECRET)
client.on('steamGuard', (domain, callback) => {
  const code = process.env.STEAM_GUARD_CODE;
  if (code) {
    console.log('[Steam] Использую одноразовый код из STEAM_GUARD_CODE...');
    callback(code);
  } else {
    console.error('[Ошибка] Нужен код Steam Guard! Добавь STEAM_GUARD_CODE в Environment Variables и перезапусти.');
  }
});

client.on('error', (err) => {
  console.error('[Steam Ошибка]:', err.message);
  // Переподключение через 30 секунд при обрыве
  setTimeout(logIn, 30000);
});

if (!USERNAME || !PASSWORD) {
  console.error('[Ошибка] Не заданы STEAM_USERNAME или STEAM_PASSWORD в переменных окружения!');
} else {
  logIn();
}
