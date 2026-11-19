const http = require('http');
const SteamUser = require('steam-user');

// 1. HTTP-заглушка для Render + cron-job.org
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Steam Hour Booster is running');
}).listen(PORT, () => {
  console.log(`[HTTP] Сервер запущен на порту ${PORT}`);
});

const USERNAME = process.env.STEAM_USERNAME;
const PASSWORD = process.env.STEAM_PASSWORD;
const REFRESH_TOKEN = process.env.STEAM_REFRESH_TOKEN; // Для авто-входа после первого раза

const GAMES = (process.env.STEAM_GAMES || '730')
  .split(',')
  .map(id => Number(id.trim()))
  .filter(Boolean)
  .slice(0, 32);

const client = new SteamUser();

function logIn() {
  if (REFRESH_TOKEN) {
    console.log('[Steam] Вход по сохранённому REFRESH_TOKEN...');
    client.logOn({ refreshToken: REFRESH_TOKEN });
  } else {
    console.log('[Steam] Вход по логину и паролю... Подтверди вход в приложении Steam на телефоне!');
    client.logOn({
      accountName: USERNAME,
      password: PASSWORD
    });
  }
}

// Сохраняем refreshToken в логи при первом входе, чтобы больше не подтверждать в телефоне
client.on('refreshToken', (token) => {
  console.log('====================================================');
  console.log('[ВАЖНО] Скопируй этот токен и добавь в Render как STEAM_REFRESH_TOKEN:');
  console.log(token);
  console.log('====================================================');
});

client.on('loggedOn', () => {
  console.log(`[Steam] Успешный вход как ${client.steamID.getSteamID64()}`);
  client.setPersona(SteamUser.EPersonaState.Invisible);
  client.gamesPlayed(GAMES);
  console.log(`[Steam] Запущена накрутка часов для AppID: ${GAMES.join(', ')}`);
});

// Автопауза, когда ты сам заходишь в CS2
client.on('playingState', (blocked, playingApp) => {
  if (blocked) {
    console.log(`[Steam] Пауза: ты сам запустил игру (AppID: ${playingApp}). Ждём выхода...`);
  } else {
    console.log('[Steam] Ты вышел из игры. Возобновляем накрутку...');
    client.gamesPlayed(GAMES);
  }
});

client.on('error', (err) => {
  console.error('[Steam Ошибка]:', err.message);
  setTimeout(logIn, 30000);
});

logIn();
