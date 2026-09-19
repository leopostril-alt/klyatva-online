// ==================== КЛЯТВА ЧОТИРЬОХ ОНЛАЙН — СЕРВЕР ====================
// Авторитетний ігровий стан живе тут, на сервері, по кімнатах (roomCode).
// Клієнти — це лише "вікна" в цей стан: вони шлють дії, сервер рахує правила
// й розсилає (а) спільний публічний стан усім у кімнаті і (б) приватний
// зріз (Каста, Приналежність, інвентар, особисті результати) лише тому
// самому гравцю — так приватність гарантується архітектурою, а не UI.

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(__dirname + '/public'));

// ==================== КОНСТАНТИ ПРАВИЛ (перенесено 1:1 з прототипу) ====================
const CASTES = [
  { key: 'air', name: 'Вітрокрилі', ability: 'Підслухати', abilityDesc: 'Обери гравця — побачиш, яке рішення він зараз готує (може ще передумати).' },
  { key: 'fire', name: 'Жаротворці', ability: 'Розпалити', abilityDesc: 'Обери гравця — якщо він цього раунду насправді взяв Слово собі, вогонь це висвітлить усім, і його штраф подвоїться.' },
  { key: 'earth', name: "Кам'яни", ability: 'Прикрити', abilityDesc: "Обери гравця (можна себе) — якщо його спробують Підслухати Вітрокрилі, вони отримають хибну інформацію." },
  { key: 'water', name: 'Плинні', ability: 'Розмити', abilityDesc: 'Обери гравця (можна себе) — якщо його цього раунду намагаються Розпалити, спроба провалюється повністю.' },
];
const ALLEGIANCES = {
  faithful: { key: 'faithful', name: 'Вірний Клятві', desc: 'Ти хочеш, щоб Клятва відновилась. Тримай слово, придивляйся до інших і шукай тих, хто досі мовчки її порушує.' },
  unbound: { key: 'unbound', name: "Розв'язаний", desc: "Ти один з тих, хто вже давно відмовився від Клятви. Приховуй це. Бреши там, де безпечно, підтримуй інших Розв'язаних — і не дай рівновазі відновитись." },
};
const UNBOUND_START_TOKENS = 7;
const RECRUIT_JOIN_BONUS = 3;
const SHOP_ITEMS = [
  { key: 'shield', name: 'Щит Клятви', icon: '🛡', cost: 4, desc: 'Захищає тебе цього раунду від Удару Розбрату, від Розпалити і від Наклепу.' },
  { key: 'strike', name: 'Удар Розбрату', icon: '⚔', cost: 5, desc: 'Обери гравця — його Слово цього раунду згорає дощенту: не рахується ні як чесне, ні як власне.' },
  { key: 'silence', name: 'Кайдани Мовчання', icon: '🔗', cost: 6, desc: 'Обери гравця — цього раунду він не може застосувати здібність своєї Касти.' },
  { key: 'slander', name: 'Наклеп', icon: '🕸', cost: 5, desc: 'Обери гравця — цього розкриття всі побачать його викритим (наче він узяв Слово собі), хай що він насправді зробив. Ніхто не дізнається, що це був Наклеп, а не Розпалити.' },
  { key: 'breath', name: 'Подих Клятви', icon: '🕊', cost: 8, maxOwned: 1, desc: 'Раз за партію: вклади частку себе просто в Рівновагу (+3 до лічильника миттєво). Але Клятва чує лише одне щире Слово за раунд — якщо цього ж раунду Подих вкладе ще хтось, його внесок буде лише символічним.' },
];
const CAUSE_PHRASES = [
  'Раптова злива розмила стежку між таборами',
  'Вітер приніс попіл із чужого вогнища просто в очі',
  'Джерело на межі земель цієї ночі пересохло',
  'Дим від далекої кузні заступив половину неба',
  'Камінь під ногами тріснув і всіх сполохав',
  'Зграя птахів знялась одночасно з усіх дерев',
];
const EVENT_EFFECTS = [
  { key: 'no_ability', text: (x) => `${x} цього разу не може застосувати свою здібність.` },
  { key: 'mirror_event', text: () => `Двоє випадково обраних гравців мусять цього разу зробити ОДНАКОВИЙ вибір — інакше обидва втрачають по Слову.` },
  { key: 'extra_debt', text: (x) => `${x} відчуває подвійний Борг Безладу цього разу.` },
];
const WITNESS_LINES = {
  publicOpen: [
    'Світ затамував подих. Чотири роди знову стоять на порозі Слова.',
    'Я чую, як земля під вами завмерла в очікуванні. Кажіть.',
    'Ще один Раунд, ще одна нагода — чи скажуть діти чотирьох родів правду разом?',
    "Вітрокрилі, Жаротворці, Кам'яни, Плинні — усі чекають, що вийде цього разу.",
    'Я бачив тисячі таких митей. Жодна не була однаковою. Кажіть.',
    'Клятва тримається на волосині. Вирішуйте, тягнути її далі чи обірвати.',
  ],
  revealPos: ['Слово прозвучало щиро. Клятва відчула це.', 'Цього разу правди було більше, ніж брехні. Незвично. Приємно.', 'Щось у повітрі стало трохи спокійнішим.'],
  revealNeg: ['Знову тягнуть на себе. Безлад посміхається.', 'Слова розсипались, не долетівши одне до одного.', 'Я відчув, як рівновага хитнулась ще далі.'],
  revealZero: ['Ніхто нікуди не зрушив цього разу. Навіть байдужість — це вибір.'],
  exposure: ['Вогонь не терпить брехні. Дивіться, кого він щойно освітив.', 'Розпалено. Тепер усі бачать те, що мало лишитись прихованим.'],
  inviteOpen: ['Десь у тіні хтось шепоче іншому пропозицію, якої не було в жодній обіцянці.', 'Я відчуваю змову там, де щойно ще була просто розмова.', 'Хтось наодинці зважує слова, які ніколи не прозвучать уголос.'],
  voteOpen: ['Оберіть, кому з-поміж вас довіряєте найменше. Я лише запишу це.', "Суд — теж своєрідна клятва. Назвіть ім'я."],
  voteResult: ['Голос більшості почуто. Вирок винесено.', 'Натовп обрав. Тепер побачимо, чи мав він рацію.'],
  endRestored: ['Уперше за довгий час чотири роди сказали правду одночасно. Я бачив це на власні очі.', 'Клятва тримається знову. Не назавжди — але сьогодні цього досить.'],
  endChaos: ["Слова знову розсипались, не долетівши одне до одного. Безлад лишається таким, яким був.", "Розв'язані переважили. Я не здивований — я лише сумний."],
};
function witnessLine(key) { const pool = WITNESS_LINES[key] || ['…']; return pool[Math.floor(Math.random() * pool.length)]; }

// ==================== КІМНАТИ ====================
const rooms = {}; // code -> room state
const REG_TIMER_MS = 3 * 60 * 1000;

function makeRoomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // латиниця — легше диктувати по телефону
  let code;
  do { code = Array.from({ length: 4 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join(''); }
  while (rooms[code]);
  return code;
}

function newPlayer(name, socketId) {
  return {
    id: crypto.randomUUID(),
    token: crypto.randomBytes(12).toString('hex'),
    socketId,
    name,
    connected: true,
    caste: null, allegiance: null,
    tokens: 4,
    inventory: { shield: 0, strike: 0, silence: 0, slander: 0, breath: 0 },
    lifetimeBuys: {},
    given: 0, self: 0, alive: true, lastReal: null, history: [],
  };
}

function newRoom(code, hostSocketId) {
  return {
    code, hostSocketId, hostPlayerId: null,
    phase: 'lobby', // lobby | public | secret | reveal | invite | vote | voteResult | end
    players: [],
    round: 0, maxRounds: 8, meter: 50,
    debtPlayers: [], event: null, lastDelta: 0,
    roundActions: {}, privateResults: {},
    exposedThisRound: [], struckThisRound: [],
    voteTally: {}, votesCast: {},
    unboundCap: 1, chaosUnlocked: false,
    pendingInvite: null, inviteAnswer: null,
    result: null,
    regTimerEnd: null, regTimerHandle: null,
    createdAt: Date.now(),
  };
}

function alivePlayers(room) { return room.players.filter(p => p.alive); }
function playerById(room, id) { return room.players.find(p => p.id === id); }
function casteOf(p) { return CASTES.find(c => c.key === p.caste); }
function allegianceOf(p) { return ALLEGIANCES[p.allegiance]; }
function unboundAliveCount(room) { return room.players.filter(p => p.allegiance === 'unbound' && p.alive).length; }

function clearRegTimer(room) {
  if (room.regTimerHandle) { clearInterval(room.regTimerHandle); room.regTimerHandle = null; }
  room.regTimerEnd = null;
}
function startRegTimer(room) {
  room.regTimerEnd = Date.now() + REG_TIMER_MS;
  clearInterval(room.regTimerHandle);
  room.regTimerHandle = setInterval(() => tickRegTimer(room), 1000);
}
function tickRegTimer(room) {
  if (room.phase !== 'lobby' || !room.regTimerEnd) { clearRegTimer(room); return; }
  const remain = room.regTimerEnd - Date.now();
  if (remain <= 0) {
    clearRegTimer(room);
    if (room.players.length >= 4) { startGame(room); }
    else { broadcastToast(room, 'Замало гравців — таймер зупинено, реєстрація триває.'); }
  }
  broadcastPublic(room);
}

function assignCastesAndAllegiance(room) {
  const n = room.players.length;
  // перемішуємо порядок, щоб Каста не завжди залежала від порядку приєднання
  const shuffledIdx = room.players.map((_, i) => i).sort(() => Math.random() - 0.5);
  room.players.forEach((p, i) => {
    p.caste = CASTES[shuffledIdx[i] % 4].key;
    p.allegiance = 'faithful';
    p.tokens = 4;
    p.inventory = { shield: 0, strike: 0, silence: 0, slander: 0, breath: 0 };
    p.lifetimeBuys = {};
    p.given = 0; p.self = 0; p.alive = true; p.lastReal = null; p.history = [];
  });
  const seedCount = Math.max(1, Math.round(n * 0.25));
  const shuffled = room.players.slice().sort(() => Math.random() - 0.5);
  const picked = [];
  for (const p of shuffled) { if (picked.length >= seedCount) break; if (picked.length === 0 || !picked.some(x => x.caste === p.caste)) picked.push(p); }
  for (const p of shuffled) { if (picked.length >= seedCount) break; if (!picked.includes(p)) picked.push(p); }
  picked.forEach(p => { p.allegiance = 'unbound'; p.tokens = UNBOUND_START_TOKENS; });
  room.unboundCap = Math.min(n - 1, Math.max(seedCount + 1, Math.ceil(n * 0.38)));
}

function startGame(room) {
  if (room.players.length < 4) return;
  clearRegTimer(room);
  assignCastesAndAllegiance(room);
  room.round = 0; room.meter = 50; room.chaosUnlocked = false;
  room.pendingInvite = null; room.inviteAnswer = null; room.result = null;
  startRound(room);
}

function startRound(room) {
  room.round++;
  room.roundActions = {}; room.privateResults = {};
  room.exposedThisRound = []; room.struckThisRound = [];
  room.pendingInvite = null;
  room.debtPlayers = alivePlayers(room).filter(() => Math.random() < 0.12).map(p => p.id);
  room.event = null;
  if (Math.random() < 0.3 && alivePlayers(room).length > 0) {
    const effect = EVENT_EFFECTS[Math.floor(Math.random() * EVENT_EFFECTS.length)];
    const cause = CAUSE_PHRASES[Math.floor(Math.random() * CAUSE_PHRASES.length)];
    let extra = {}, target = '';
    if (effect.key === 'no_ability') { const c = CASTES[Math.floor(Math.random() * CASTES.length)]; target = c.name; extra.casteKey = c.key; }
    else if (effect.key === 'extra_debt') { const alive = alivePlayers(room); const pl = alive[Math.floor(Math.random() * alive.length)]; target = pl.name; extra.targetId = pl.id; if (!room.debtPlayers.includes(pl.id)) room.debtPlayers.push(pl.id); }
    else if (effect.key === 'mirror_event') { const alive = alivePlayers(room).slice(); if (alive.length >= 2) { const a = alive.splice(Math.floor(Math.random() * alive.length), 1)[0]; const b = alive.splice(Math.floor(Math.random() * alive.length), 1)[0]; extra.pairIds = [a.id, b.id]; target = `${a.name} та ${b.name}`; } }
    room.event = { text: `${cause} — ${effect.text(target)}`, effectKey: effect.key, ...extra };
  }
  room.phase = 'public';
  room.witnessPublic = witnessLine('publicOpen');
  broadcastPublic(room);
  broadcastAllPrivate(room);
}

function resolveRound(room) {
  const alive = alivePlayers(room);
  const p = (id) => playerById(room, id);

  alive.forEach(pl => {
    const a = room.roundActions[pl.id]; if (!a) return;
    if (a.useShield && pl.inventory.shield > 0) pl.inventory.shield--; else a.useShield = false;
    if (a.strikeTarget && pl.inventory.strike > 0) pl.inventory.strike--; else a.strikeTarget = null;
    if (a.silenceTarget && pl.inventory.silence > 0) pl.inventory.silence--; else a.silenceTarget = null;
    if (a.slanderTarget && pl.inventory.slander > 0) pl.inventory.slander--; else a.slanderTarget = null;
    if (a.breathUsed && pl.inventory.breath > 0) pl.inventory.breath--; else a.breathUsed = false;
  });

  alive.forEach(pl => { const a = room.roundActions[pl.id]; if (!a) return; if (room.debtPlayers.includes(pl.id) && a.realChoice !== 'take') { a.realChoice = 'take'; a._forcedByDebt = true; } });

  let mirrorEventPenalty = [];
  if (room.event && room.event.effectKey === 'mirror_event' && room.event.pairIds) {
    const [aId, bId] = room.event.pairIds;
    const aAct = room.roundActions[aId], bAct = room.roundActions[bId];
    if (aAct && bAct && aAct.realChoice !== bAct.realChoice) mirrorEventPenalty = [aId, bId];
  }

  const silencedIds = new Set();
  alive.forEach(pl => { const a = room.roundActions[pl.id]; if (a && a.silenceTarget) silencedIds.add(a.silenceTarget); });
  const shieldedIds = new Set();
  alive.forEach(pl => { const a = room.roundActions[pl.id]; if (a && a.useShield) shieldedIds.add(pl.id); });
  const struck = new Set();
  alive.forEach(pl => { const a = room.roundActions[pl.id]; if (a && a.strikeTarget && !shieldedIds.has(a.strikeTarget)) struck.add(a.strikeTarget); });
  room.struckThisRound = [...struck];

  const coveredBy = {};
  alive.forEach(pl => { const a = room.roundActions[pl.id]; if (a && a.abilityTarget && casteOf(pl).key === 'earth' && !silencedIds.has(pl.id)) coveredBy[a.abilityTarget] = true; });
  const blurredBy = {};
  alive.forEach(pl => { const a = room.roundActions[pl.id]; if (a && a.abilityTarget && casteOf(pl).key === 'water' && !silencedIds.has(pl.id)) blurredBy[a.abilityTarget] = true; });

  alive.forEach(pl => {
    const a = room.roundActions[pl.id];
    if (a && a.abilityTarget && casteOf(pl).key === 'air' && !silencedIds.has(pl.id)) {
      const targetAct = room.roundActions[a.abilityTarget];
      const targetName = p(a.abilityTarget).name;
      if (!room.privateResults[pl.id]) room.privateResults[pl.id] = [];
      if (coveredBy[a.abilityTarget]) {
        const fake = Math.random() < 0.5 ? 'give' : 'take';
        room.privateResults[pl.id].push(`Ти підслухав ${targetName}: нібито обирає «${fake === 'give' ? 'віддати чесно' : 'взяти собі'}» — але Кам'яни могли тебе обманути.`);
      } else if (targetAct) {
        room.privateResults[pl.id].push(`Ти підслухав ${targetName}: насправді обирає «${targetAct.realChoice === 'give' ? 'віддати чесно' : 'взяти собі'}».`);
      }
    }
  });
  alive.forEach(pl => {
    const a = room.roundActions[pl.id];
    if (a && a.abilityTarget && casteOf(pl).key === 'fire' && !silencedIds.has(pl.id)) {
      const targetId = a.abilityTarget;
      const targetAct = room.roundActions[targetId];
      if (!targetAct) return;
      const tookForSelf = targetAct.realChoice === 'take';
      if (tookForSelf && !blurredBy[targetId] && !shieldedIds.has(targetId)) {
        room.exposedThisRound.push(targetId);
        if (!room.privateResults[pl.id]) room.privateResults[pl.id] = [];
        room.privateResults[pl.id].push(`Твоє Розпалити спрацювало: ${p(targetId).name} було викрито! +2 Жетони.`);
        pl.tokens += 2;
      }
    }
  });
  alive.forEach(pl => {
    const a = room.roundActions[pl.id];
    if (a && a.slanderTarget) {
      const targetId = a.slanderTarget;
      if (!room.privateResults[pl.id]) room.privateResults[pl.id] = [];
      if (!shieldedIds.has(targetId)) {
        if (!room.exposedThisRound.includes(targetId)) room.exposedThisRound.push(targetId);
        room.privateResults[pl.id].push(`Твій Наклеп спрацював: ${p(targetId).name} виглядатиме викритим перед усіма — хоч ти знаєш правду.`);
      } else {
        room.privateResults[pl.id].push(`Твій Наклеп на ${p(targetId).name} не подіяв — його щось захистило.`);
      }
    }
  });

  let rawDelta = 0, engagedCount = 0;
  alive.forEach(pl => {
    const a = room.roundActions[pl.id];
    if (!a) return;
    if (struck.has(pl.id)) { pl.history.push('struck'); pl.lastReal = a.realChoice; return; }
    engagedCount++;
    const exposed = room.exposedThisRound.includes(pl.id);
    const mirrorHit = mirrorEventPenalty.includes(pl.id);
    if (a.realChoice === 'give') { pl.given++; rawDelta += 1; if (mirrorHit) rawDelta -= 1; pl.tokens += 1; }
    else { pl.self++; rawDelta -= 1; if (exposed) rawDelta -= 1; if (mirrorHit) rawDelta -= 1; if (!exposed) pl.tokens += 2; else pl.tokens = Math.max(0, pl.tokens - 1); }
    pl.history.push(a.realChoice); pl.lastReal = a.realChoice;
  });
  const METER_REFERENCE_N = 7;
  let delta = engagedCount > 0 ? Math.round(rawDelta * METER_REFERENCE_N / engagedCount) : 0;

  const breathUsers = alive.filter(pl => { const a = room.roundActions[pl.id]; return a && a.breathUsed; }).sort(() => Math.random() - 0.5);
  if (breathUsers.length) {
    delta += 3;
    if (!room.privateResults[breathUsers[0].id]) room.privateResults[breathUsers[0].id] = [];
    room.privateResults[breathUsers[0].id].push('Ти вклав(ла) Подих Клятви — і саме твій цього разу почула Рівновага. +3 миттєво.');
    breathUsers.slice(1).forEach(pl => { if (!room.privateResults[pl.id]) room.privateResults[pl.id] = []; room.privateResults[pl.id].push('Ти теж вклав(ла) Подих Клятви, але цього разу Рівновага почула когось іншого першим — твій подіяв лише символічно.'); });
  }

  room.meter = Math.max(0, Math.min(100, room.meter + delta));
  room.lastDelta = delta;
  if (room.meter <= 45) room.chaosUnlocked = true;

  room.pendingInvite = null;
  for (const pl of alive) {
    const a = room.roundActions[pl.id];
    if (a && a.inviteTarget && pl.allegiance === 'unbound' && playerById(room, a.inviteTarget) && playerById(room, a.inviteTarget).alive) {
      room.pendingInvite = { fromId: pl.id, targetId: a.inviteTarget };
      break;
    }
  }

  room.phase = 'reveal';
  room.witnessReveal = witnessLine(room.lastDelta > 0 ? 'revealPos' : (room.lastDelta < 0 ? 'revealNeg' : 'revealZero'));
  room.witnessExposure = room.exposedThisRound.length ? witnessLine('exposure') : null;
  broadcastPublic(room);
  broadcastAllPrivate(room);
}

function checkWin(room) {
  const aliveP = alivePlayers(room);
  const unboundAlive = aliveP.filter(p => p.allegiance === 'unbound').length;
  const faithfulAlive = aliveP.length - unboundAlive;
  if (unboundAlive === 0) { room.result = 'faithful'; room.phase = 'end'; return true; }
  if (unboundAlive >= faithfulAlive) { room.result = 'unbound'; room.phase = 'end'; return true; }
  if (room.meter <= 0) { room.result = 'unbound'; room.phase = 'end'; return true; }
  if (room.meter >= 100) { room.result = 'faithful'; room.phase = 'end'; return true; }
  return false;
}
function nextRoundOrEnd(room) {
  if (room.round >= room.maxRounds) { room.result = room.meter > 50 ? 'faithful' : 'unbound'; room.phase = 'end'; broadcastPublic(room); return; }
  startRound(room);
}
function proceedAfterRoundEvents(room) {
  if (room.round % 2 === 0) { startVoteInternal(room); } else { nextRoundOrEnd(room); }
}
function afterReveal(room) {
  if (checkWin(room)) { broadcastPublic(room); return; }
  if (room.pendingInvite) { room.phase = 'invite'; room.inviteAnswer = null; room.witnessInvite = witnessLine('inviteOpen'); broadcastPublic(room); broadcastAllPrivate(room); return; }
  proceedAfterRoundEvents(room);
}
function respondInvite(room, playerId, answer) {
  const inv = room.pendingInvite;
  if (!inv || inv.targetId !== playerId || room.inviteAnswer != null) return;
  room.inviteAnswer = answer;
  if (answer === 'yes') {
    const joined = playerById(room, playerId);
    joined.allegiance = 'unbound'; joined.tokens += RECRUIT_JOIN_BONUS;
  }
  broadcastPublic(room); broadcastAllPrivate(room);
}
function afterInvite(room) {
  room.pendingInvite = null; room.inviteAnswer = null;
  if (checkWin(room)) { broadcastPublic(room); return; }
  proceedAfterRoundEvents(room);
}
function startVoteInternal(room) {
  room.phase = 'vote'; room.voteTally = {}; room.votesCast = {};
  room.witnessVote = witnessLine('voteOpen');
  broadcastPublic(room);
}
function castVote(room, voterId, targetId) {
  if (room.phase !== 'vote') return;
  const voter = playerById(room, voterId);
  if (!voter || !voter.alive) return;
  const prevTarget = room.votesCast[voterId];
  if (prevTarget != null && room.voteTally[prevTarget]) room.voteTally[prevTarget]--;
  room.votesCast[voterId] = targetId;
  room.voteTally[targetId] = (room.voteTally[targetId] || 0) + 1;
  broadcastPublic(room);
  const alive = alivePlayers(room);
  if (alive.every(p => room.votesCast[p.id] != null)) resolveVote(room);
}
function resolveVote(room) {
  let topId = null, topV = -1, tie = false;
  Object.entries(room.voteTally).forEach(([id, v]) => { if (v > topV) { topV = v; topId = id; tie = false; } else if (v === topV) { tie = true; } });
  if (tie) topId = null;
  room.voteResult = topId;
  room.voteWasUnbound = null;
  if (topId != null) {
    const target = playerById(room, topId);
    room.voteWasUnbound = (target.allegiance === 'unbound');
    target.alive = false;
    room.meter = room.voteWasUnbound ? Math.min(100, room.meter + 8) : Math.max(0, room.meter - 8);
  }
  room.phase = 'voteResult';
  room.witnessVoteResult = witnessLine('voteResult');
  broadcastPublic(room); broadcastAllPrivate(room);
}
function afterVoteResult(room) {
  if (checkWin(room)) { broadcastPublic(room); return; }
  nextRoundOrEnd(room);
}
function buyItem(room, playerId, key) {
  const p = playerById(room, playerId);
  const item = SHOP_ITEMS.find(i => i.key === key);
  if (!p || !item) return { ok: false, msg: 'Невідома річ.' };
  if (!p.lifetimeBuys) p.lifetimeBuys = {};
  if (item.maxOwned && (p.lifetimeBuys[key] || 0) >= item.maxOwned) return { ok: false, msg: 'Це можна мати лише раз за партію.' };
  if (p.tokens < item.cost) return { ok: false, msg: 'Недостатньо Жетонів.' };
  p.tokens -= item.cost; p.inventory[key]++; p.lifetimeBuys[key] = (p.lifetimeBuys[key] || 0) + 1;
  return { ok: true, msg: `Куплено: ${item.name}` };
}

// ==================== ТРАНСЛЯЦІЯ СТАНУ ====================
function publicPlayerView(p) {
  return { id: p.id, name: p.name, alive: p.alive, connected: p.connected };
}
function publicRoomState(room) {
  return {
    code: room.code,
    phase: room.phase,
    round: room.round, maxRounds: room.maxRounds, meter: room.meter, lastDelta: room.lastDelta,
    event: room.event,
    players: room.players.map(publicPlayerView),
    hostPlayerId: room.hostPlayerId,
    debtPlayers: room.debtPlayers,
    exposedThisRound: room.exposedThisRound,
    struckThisRound: room.struckThisRound,
    votesCast: room.votesCast, voteTally: room.voteTally,
    voteResult: room.voteResult, voteWasUnbound: room.voteWasUnbound,
    pendingInviteActive: !!room.pendingInvite, inviteAnswer: room.inviteAnswer,
    result: room.result,
    regTimerEnd: room.regTimerEnd,
    decidedIds: Object.keys(room.roundActions),
    witness: { publicOpen: room.witnessPublic, reveal: room.witnessReveal, exposure: room.witnessExposure, invite: room.witnessInvite, vote: room.witnessVote, voteResult: room.witnessVoteResult },
  };
}
function privatePlayerState(room, p) {
  return {
    id: p.id, name: p.name, caste: p.caste, casteName: p.caste ? casteOf(p).name : null,
    ability: p.caste ? casteOf(p).ability : null, abilityDesc: p.caste ? casteOf(p).abilityDesc : null,
    allegiance: p.allegiance, allegianceInfo: p.allegiance ? allegianceOf(p) : null,
    tokens: p.tokens, inventory: p.inventory, lifetimeBuys: p.lifetimeBuys,
    given: p.given, self: p.self, alive: p.alive,
    isHost: room.hostPlayerId === p.id,
    fellowUnbound: p.allegiance === 'unbound' ? room.players.filter(x => x.allegiance === 'unbound' && x.id !== p.id).map(x => x.name) : [],
    casteAllies: p.caste ? room.players.filter(x => x.caste === p.caste && x.id !== p.id && x.alive).map(x => x.name) : [],
    myAction: room.roundActions[p.id] || null,
    myResults: room.privateResults[p.id] || [],
    exposedThisRound: room.exposedThisRound.includes(p.id),
    struckThisRound: room.struckThisRound.includes(p.id),
    isDebt: room.debtPlayers.includes(p.id),
    abilityDisabled: !!(room.event && room.event.effectKey === 'no_ability' && room.event.casteKey === p.caste),
    canRecruit: p.allegiance === 'unbound' && room.chaosUnlocked && unboundAliveCount(room) < room.unboundCap,
    myInviteOffer: (room.pendingInvite && room.pendingInvite.targetId === p.id && room.inviteAnswer == null) ? { fromName: null } : null,
    othersAlive: alivePlayers(room).filter(x => x.id !== p.id).map(x => ({ id: x.id, name: x.name })),
    recruitTargets: (p.allegiance === 'unbound' && room.chaosUnlocked && unboundAliveCount(room) < room.unboundCap) ? alivePlayers(room).filter(x => x.allegiance !== 'unbound' && x.id !== p.id).map(x => ({ id: x.id, name: x.name })) : [],
  };
}
function broadcastPublic(room) { io.to(room.code).emit('publicState', publicRoomState(room)); }
function broadcastAllPrivate(room) {
  room.players.forEach(p => { if (p.connected && p.socketId) io.to(p.socketId).emit('privateState', privatePlayerState(room, p)); });
}
function broadcastToast(room, msg) { io.to(room.code).emit('toast', msg); }

// ==================== SOCKET.IO ====================
io.on('connection', (socket) => {
  socket.on('createRoom', ({ name }, cb) => {
    name = (name || '').trim().slice(0, 24);
    if (!name) return cb({ ok: false, msg: "Введи ім'я." });
    const code = makeRoomCode();
    const room = newRoom(code, socket.id);
    rooms[code] = room;
    const player = newPlayer(name, socket.id);
    room.players.push(player);
    room.hostPlayerId = player.id;
    startRegTimer(room);
    socket.join(code);
    socket.data.roomCode = code; socket.data.playerId = player.id;
    cb({ ok: true, code, playerToken: player.token, playerId: player.id });
    broadcastPublic(room); broadcastAllPrivate(room);
  });

  socket.on('joinRoom', ({ code, name }, cb) => {
    code = (code || '').trim().toUpperCase();
    name = (name || '').trim().slice(0, 24);
    const room = rooms[code];
    if (!room) return cb({ ok: false, msg: 'Кімнату не знайдено. Перевір код.' });
    if (room.phase !== 'lobby') return cb({ ok: false, msg: 'Гра в цій кімнаті вже почалась.' });
    if (!name) return cb({ ok: false, msg: "Введи ім'я." });
    if (room.players.some(p => p.name.toLowerCase() === name.toLowerCase())) return cb({ ok: false, msg: 'Це ім\'я вже зайняте в цій кімнаті.' });
    const wasEmpty = room.players.length === 0;
    const player = newPlayer(name, socket.id);
    room.players.push(player);
    if (wasEmpty && !room.regTimerEnd) startRegTimer(room);
    socket.join(code);
    socket.data.roomCode = code; socket.data.playerId = player.id;
    cb({ ok: true, code, playerToken: player.token, playerId: player.id });
    broadcastPublic(room); broadcastAllPrivate(room);
  });

  socket.on('rejoin', ({ code, playerToken }, cb) => {
    code = (code || '').trim().toUpperCase();
    const room = rooms[code];
    if (!room) return cb({ ok: false, msg: 'Кімната вже не існує.' });
    const player = room.players.find(p => p.token === playerToken);
    if (!player) return cb({ ok: false, msg: 'Гравця не знайдено в цій кімнаті.' });
    player.socketId = socket.id; player.connected = true;
    socket.join(code);
    socket.data.roomCode = code; socket.data.playerId = player.id;
    cb({ ok: true, code, playerToken: player.token, playerId: player.id, phase: room.phase });
    broadcastPublic(room);
    socket.emit('privateState', privatePlayerState(room, player));
  });

  socket.on('hostStartNow', () => {
    const room = rooms[socket.data.roomCode]; if (!room) return;
    if (room.hostPlayerId !== socket.data.playerId) return;
    if (room.players.length < 4) { socket.emit('toast', 'Потрібно щонайменше 4 гравці.'); return; }
    startGame(room);
    broadcastPublic(room); broadcastAllPrivate(room);
  });

  socket.on('removePlayer', ({ targetId }) => {
    const room = rooms[socket.data.roomCode]; if (!room || room.phase !== 'lobby') return;
    if (room.hostPlayerId !== socket.data.playerId && targetId !== socket.data.playerId) return;
    room.players = room.players.filter(p => p.id !== targetId);
    if (room.players.length === 0) clearRegTimer(room);
    broadcastPublic(room);
  });

  socket.on('submitSecretAction', (action) => {
    const room = rooms[socket.data.roomCode]; if (!room || room.phase !== 'secret') return;
    const p = playerById(room, socket.data.playerId); if (!p || !p.alive) return;
    room.roundActions[p.id] = {
      realChoice: action.realChoice === 'take' ? 'take' : 'give',
      abilityTarget: action.abilityTarget || null,
      useShield: !!action.useShield,
      strikeTarget: action.strikeTarget || null,
      silenceTarget: action.silenceTarget || null,
      slanderTarget: action.slanderTarget || null,
      breathUsed: !!action.breathUsed,
      inviteTarget: action.inviteTarget || null,
    };
    broadcastPublic(room);
    socket.emit('privateState', privatePlayerState(room, p));
    if (alivePlayers(room).every(pl => room.roundActions[pl.id])) resolveRound(room);
  });

  socket.on('proceedToSecret', () => {
    const room = rooms[socket.data.roomCode]; if (!room || room.phase !== 'public') return;
    if (room.hostPlayerId !== socket.data.playerId) return;
    room.phase = 'secret';
    broadcastPublic(room); broadcastAllPrivate(room);
  });
  socket.on('proceedAfterReveal', () => {
    const room = rooms[socket.data.roomCode]; if (!room || room.phase !== 'reveal') return;
    if (room.hostPlayerId !== socket.data.playerId) return;
    afterReveal(room);
  });
  socket.on('respondInvite', ({ answer }) => {
    const room = rooms[socket.data.roomCode]; if (!room || room.phase !== 'invite') return;
    respondInvite(room, socket.data.playerId, answer === 'yes' ? 'yes' : 'no');
  });
  socket.on('proceedAfterInvite', () => {
    const room = rooms[socket.data.roomCode]; if (!room || room.phase !== 'invite') return;
    if (room.hostPlayerId !== socket.data.playerId) return;
    if (room.inviteAnswer == null) return;
    afterInvite(room);
  });
  socket.on('castVote', ({ targetId }) => {
    const room = rooms[socket.data.roomCode]; if (!room) return;
    castVote(room, socket.data.playerId, targetId);
  });
  socket.on('proceedAfterVoteResult', () => {
    const room = rooms[socket.data.roomCode]; if (!room || room.phase !== 'voteResult') return;
    if (room.hostPlayerId !== socket.data.playerId) return;
    afterVoteResult(room);
  });
  socket.on('buyItem', ({ key }) => {
    const room = rooms[socket.data.roomCode]; if (!room) return;
    const res = buyItem(room, socket.data.playerId, key);
    const p = playerById(room, socket.data.playerId);
    if (p) socket.emit('privateState', privatePlayerState(room, p));
    socket.emit('toast', res.msg);
  });
  socket.on('newGameSameRoom', () => {
    const room = rooms[socket.data.roomCode]; if (!room) return;
    if (room.hostPlayerId !== socket.data.playerId) return;
    room.phase = 'lobby'; room.round = 0; room.meter = 50; room.result = null;
    room.players.forEach(p => { p.caste = null; p.allegiance = null; p.alive = true; p.tokens = 4; p.inventory = { shield: 0, strike: 0, silence: 0, slander: 0, breath: 0 }; p.lifetimeBuys = {}; p.given = 0; p.self = 0; p.history = []; });
    broadcastPublic(room); broadcastAllPrivate(room);
  });

  socket.on('disconnect', () => {
    const room = rooms[socket.data.roomCode]; if (!room) return;
    const p = playerById(room, socket.data.playerId);
    if (p) { p.connected = false; }
    broadcastPublic(room);
    // прибирання порожніх кімнат за 30 хв бездіяльності
    setTimeout(() => {
      const r = rooms[room.code];
      if (r && r.players.every(pl => !pl.connected)) { clearRegTimer(r); delete rooms[room.code]; }
    }, 30 * 60 * 1000);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Клятва Чотирьох Онлайн: слухаю на порту ${PORT}`));

module.exports = { app, server, io, rooms }; // для тестів
