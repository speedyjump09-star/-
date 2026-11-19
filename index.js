const http = require('http');
const SteamUser = require('steam-user');

const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Steam Hour Booster is running');
}).listen(PORT, () => {
  console.log(`[HTTP] Сервер запущен на порту ${PORT}`);
});

const USERNAME = process.env.STEAM_USERNAME;
const PASSWORD = process.env.STEAM_PASSWORD;
const REFRESH_TOKEN = process.env.STEAM_REFRESH_TOKEN;

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
    console.log('[Steam] Вход по логину и паролю...');
    client.logOn({
      accountName: USERNAME,
      password: PASSWORD,
      promptSteamGuardCode: false
    });
  }
}

client.on('steamGuard', (domain, callback) => {
  const code = process.env.STEAM_GUARD_CODE;
  if (code) {
    console.log(`[Steam] Ввожу код Steam Guard: ${code}`);
    callback(code.trim());
  } else {
    console.log('[Steam] Жду пуш-подтверждение в телефоне ИЛИ добавь свежий код в STEAM_GUARD_CODE...');
  }
});

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

client.on('playingState', (blocked, playingApp) => {
  if (blocked) {
    console.log(`[Steam] Пауза: ты сам запустил игру (AppID: ${playingApp}).`);
  } else {
    console.log('[Steam] Ты вышел из игры. Возобновляем накрутку...');
    client.gamesPlayed(GAMES);
  }
});

client.on('error', (err) => {
  console.error('[Steam Ошибка]:', err.message);
});

logIn();
