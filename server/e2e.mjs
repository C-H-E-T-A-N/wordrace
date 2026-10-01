// End-to-end check against a running server with real Socket.IO clients.
// Start the server first (npm run dev), then: node server/e2e.mjs   (or GAME_URL=http://host:port node server/e2e.mjs)
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../client/package.json', import.meta.url));
const { io } = require('socket.io-client');
const URL_ = process.env.GAME_URL || 'http://localhost:3001';
const sleep = ms => new Promise(r => setTimeout(r, ms));

function client(name) {
  const s = io(URL_, { transports: ['websocket'], forceNew: true });
  const c = { name, s, state: null, words: [], strokes: 0, clears: 0, publicPayloads: [] };
  s.on('state', st => { c.state = st; c.publicPayloads.push(JSON.stringify(st)); });
  s.on('draw-game:word', w => c.words.push(w.word));
  s.on('draw-game:stroke', segs => (c.strokes += segs.length));
  s.on('draw-game:clear', () => c.clears++);
  // every event a player receives from the room, to prove the secret never goes out to guessers
  // private, per-socket messages are excluded on purpose: they're meant for this player only
  s.onAny((ev, payload) => { if (!['draw-game:word', 'imposter:word'].includes(ev)) c.publicPayloads.push(`${ev} ${JSON.stringify(payload ?? null)}`); });
  c.emit = (ev, ...args) => new Promise(res => s.emit(ev, ...args, res));
  return c;
}
const until = async (fn, ms = 5000) => {
  for (const t0 = Date.now(); Date.now() - t0 < ms; await sleep(30)) if (fn()) return;
  throw new Error('timed out waiting');
};

const players = ['Ana', 'Ben', 'Cy', 'Dee'].map(client);
const [host, ...rest] = players;
await until(() => players.every(p => p.s.connected));

const created = await host.emit('create', { name: host.name });
assert.ok(created.ok);
const code = created.code;
for (const p of rest) assert.ok((await p.emit('join', { code, name: p.name })).ok);
assert.equal((await client('Ben').emit('join', { code, name: 'ben' })).error, 'That name is already taken in this room.');
await until(() => host.state?.players.length === 4);

// Only the host picks the mode
assert.equal((await rest[0].emit('setMode', 'draw')).ok, false);
assert.ok((await host.emit('setMode', 'draw')).ok);
assert.ok((await host.emit('setRounds', 1)).ok);
assert.equal((await rest[0].emit('setRounds', 2)).ok, false); // only the host
assert.ok((await host.emit('start')).ok);
await until(() => players.every(p => p.state?.phase === 'round'));
console.log('draw game started with 4 players');

const byId = id => players.find(p => p.state.players.find(x => x.id === id)?.name === p.name);
const drawerOf = () => byId(host.state.current.drawerId);
const order = [];

// ---- Turn 1: secret only to drawer, strokes relayed, simultaneous guesses, early end ----
let drawer = drawerOf();
order.push(drawer.name);
await until(() => drawer.words.length === 1);
const word = drawer.words[0];
const guessers = players.filter(p => p !== drawer);
assert.ok(guessers.every(g => g.words.length === 0), 'secret word sent to a guesser');
assert.ok(guessers.every(g => g.publicPayloads.every(x => !x.includes(word))), 'secret word leaked to a guesser');

drawer.s.emit('draw-game:stroke', [{ x: 0.5, y: 0.5, px: 0.4, py: 0.4, w: 0.01, c: '#ff0000', t: 'pen' }]);
guessers[0].s.emit('draw-game:stroke', [{ x: 0.1, y: 0.1, px: 0, py: 0, w: 0.01, c: '#000000', t: 'pen' }]); // ignored
await until(() => guessers.every(g => g.strokes === 1));
await sleep(200);
assert.equal(drawer.strokes, 0, 'drawer got its own strokes back');
assert.ok(guessers.every(g => g.strokes === 1), 'non-drawer stroke was relayed');
const sync = await guessers[1].emit('draw-game:sync', null);
assert.equal(sync.strokes.length, 1);
assert.equal(sync.word, null);

assert.deepEqual(await guessers[2].emit('draw-game:guess', 'definitely not it'), { correct: false });
assert.equal((await drawer.emit('draw-game:guess', word)).reason, 'drawer');
// Two correct guesses fired at the same time: exactly one 100 and one 75
const [r1, r2] = await Promise.all([guessers[0].emit('draw-game:guess', word.toLowerCase()), guessers[1].emit('draw-game:guess', ` ${word} `)]);
assert.deepEqual([r1.points, r2.points].sort(), [100, 75]);
assert.equal(r1.word, word);
assert.equal((await guessers[0].emit('draw-game:guess', word)).reason, 'done');
const r3 = await guessers[2].emit('draw-game:guess', word);
assert.equal(r3.points, 50);
assert.equal(r3.ended, true);
await until(() => host.state.phase === 'result');
assert.equal(host.state.current.answer, word);
assert.equal(host.state.current.drawerPoints, 100);
console.log(`turn 1: ${drawer.name} drew "${word}", 3 guessers scored 100/75/50, drawer +100, turn ended early`);

// ---- Turn 2: drawer disconnects -> turn ends immediately ----
await until(() => host.state.phase === 'round' && host.state.round === 2, 8000);
drawer = drawerOf();
order.push(drawer.name);
const leaver = drawer;
leaver.s.disconnect();
const watcher = players.find(p => p !== leaver);
await until(() => watcher.state.phase === 'result');
console.log(`turn 2: drawer ${leaver.name} disconnected -> turn ended at once`);

// Reconnect with the same player id (like a refresh)
const saved = { code, playerId: leaver.state.players.find(p => p.name === leaver.name).id };
leaver.s.connect();
await until(() => leaver.s.connected);
assert.ok((await leaver.emit('rejoin', saved)).ok);
console.log(`${leaver.name} reconnected`);

// ---- Turn 3: a guesser disconnects; once everyone left has guessed, the turn ends ----
await until(() => watcher.state.phase === 'round' && watcher.state.round === 3, 8000);
drawer = drawerOf();
order.push(drawer.name);
await until(() => drawer.words.length >= 1 && drawer.words.at(-1) !== word);
const w3 = drawer.words.at(-1);
const [g1, g2, g3] = players.filter(p => p !== drawer);
assert.equal((await g1.emit('draw-game:guess', w3)).correct, true);
assert.equal((await g2.emit('draw-game:guess', w3)).correct, true);
g3.s.disconnect();
await until(() => drawer.state.phase === 'result');
console.log(`turn 3: last guesser ${g3.name} disconnected -> everyone left had guessed -> turn ended`);
g3.s.connect();
await until(() => g3.s.connected);
assert.ok((await g3.emit('rejoin', { code, playerId: g3.state.players.find(p => p.name === g3.name).id })).ok);

// ---- Turn 4 (last): let it time out? 60 s is long, so all guess instead ----
await until(() => host.state.phase === 'round' && host.state.round === 4, 8000);
drawer = drawerOf();
order.push(drawer.name);
await until(() => drawer.words.length >= 1);
const w4 = drawer.words.at(-1);
for (const g of players.filter(p => p !== drawer)) await g.emit('draw-game:guess', w4);
await until(() => host.state.phase === 'final', 8000);
assert.deepEqual([...order].sort(), ['Ana', 'Ben', 'Cy', 'Dee'], 'everyone draws exactly once');
console.log('game over. drawing order:', order.join(' -> '));
console.log('final:', host.state.players.map(p => `${p.name} ${p.score}`).join(', '));
assert.equal(host.state.records[0].mode, 'draw');
assert.equal(host.state.leaderboard.length, 4);

// ---- Play again: fresh words, same players ----
const firstWords = new Set(host.state.history.map(h => h.answer));
assert.ok((await rest[1].emit('playAgain')).ok);
await until(() => host.state.phase === 'round' && host.state.round === 1);
assert.ok(host.state.players.every(p => p.score === 0));
drawer = drawerOf();
await until(() => drawer.words.length >= 1);
assert.ok(!firstWords.has(drawer.words.at(-1)), 'word repeated from last game');
console.log('play again: scores reset, new word');

// ---- Back to lobby needs a finished game; host can't change mode mid-game ----
assert.equal((await host.emit('setMode', 'picture')).ok, false);

// ---- Picture mode quick check with 2 of the players in a new room: hint vote + voice alternatives ----
const p1 = client('Pia');
const p2 = client('Quin');
await until(() => p1.s.connected && p2.s.connected);
const room2 = (await p1.emit('create', { name: 'Pia' })).code;
await p2.emit('join', { code: room2, name: 'Quin' });
assert.ok((await p1.emit('start')).ok); // picture is the default
await until(() => p2.state?.phase === 'round');
assert.equal(p2.state.current.hint, null);
p1.s.emit('hint');
await until(() => p2.state.current.hintVotes.length === 1);
assert.equal(p2.state.current.hint, null);
p2.s.emit('hint');
await until(() => p1.state.current.hint);
console.log('picture mode: hint shown after both players asked:', p1.state.current.hint);
assert.equal((await p2.emit('answer', ['wrong', 'also wrong'])).correct, false);

// ---- Odd One Out with 4 players: private words, clues, vote, last guess ----
const imp = ['Ivy', 'Jon', 'Kai', 'Lu'].map(client);
await until(() => imp.every(p => p.s.connected));
const words = new Map(); // client -> their secret word
for (const p of imp) p.s.on('imposter:word', w => words.set(p, w.word));
const room3 = (await imp[0].emit('create', { name: 'Ivy' })).code;
for (const p of imp.slice(1)) await p.emit('join', { code: room3, name: p.name });
assert.ok((await imp[0].emit('setMode', 'imposter')).ok);
assert.ok((await imp[0].emit('setRounds', 1)).ok);
assert.ok((await imp[0].emit('start')).ok);
await until(() => words.size === 4);
const counts = {};
for (const w of words.values()) counts[w] = (counts[w] ?? 0) + 1;
assert.deepEqual(Object.values(counts).sort(), [1, 3], 'exactly one player should have a different word');
const impWord = Object.keys(counts).find(w => counts[w] === 1);
const crewWord = Object.keys(counts).find(w => counts[w] === 3);
const imposterClient = imp.find(p => words.get(p) === impWord);
for (const p of imp) for (const x of p.publicPayloads) assert.ok(!x.includes(`"${crewWord}"`) && !x.includes(`"${impWord}"`), `pair leaked to the room: ${x.slice(0, 300)}`);
assert.deepEqual((await imp[1].emit('imposter:sync', null)).word, words.get(imp[1]));

// Clues in the server's order; the first try uses the player's own word and is rejected
const st = () => imp[0].state.current;
let first = true;
while (st().step === 'clue') {
  const giver = imp.find(p => p.state.players.find(x => x.id === st().clueGiverId)?.name === p.name);
  if (first) {
    assert.equal((await giver.emit('imposter:clue', words.get(giver))).ok, false);
    first = false;
  }
  assert.ok((await giver.emit('imposter:clue', `clue${imp.indexOf(giver)}`)).ok);
  await until(() => st().clues.length > 0 && (st().step !== 'clue' || st().clues.at(-1).text === `clue${imp.indexOf(giver)}`));
}
assert.equal(st().step, 'vote');
const idOf = p => p.state.players.find(x => x.name === p.name).id;
// Crew all vote for the imposter; the imposter votes for someone else -> caught -> last guess
for (const p of imp.filter(p => p !== imposterClient)) assert.ok((await p.emit('imposter:vote', idOf(imposterClient))).ok);
assert.equal(imp[0].state.current.votes, null, 'votes shown before everyone voted');
assert.ok((await imposterClient.emit('imposter:vote', idOf(imp.find(p => p !== imposterClient)))).ok);
await until(() => st().step === 'guess');
assert.equal(st().imposterName, imposterClient.name);
assert.equal(st().crewWord, null, 'crew word revealed before the last guess');
assert.ok((await imposterClient.emit('imposter:guess', crewWord.toLowerCase())).ok);
await until(() => imp[0].state.phase === 'result');
assert.equal(st().outcome, 'imposter-guessed');
assert.equal(st().crewWord, crewWord);
console.log(`odd one out: ${imposterClient.name} had "${impWord}" vs "${crewWord}", was caught, guessed the word -> +2`);
await until(() => imp[0].state.phase === 'final', 8000);
for (const p of imp) p.s.disconnect();

// ---- Relay Draw with 3 players: only the starter knows, legs pass the pen, guessing at the end ----
const rel = ['Mo', 'Ned', 'Ola'].map(client);
await until(() => rel.every(p => p.s.connected));
const room4 = (await rel[0].emit('create', { name: 'Mo' })).code;
for (const p of rel.slice(1)) await p.emit('join', { code: room4, name: p.name });
assert.ok((await rel[0].emit('setMode', 'relay')).ok);
assert.ok((await rel[0].emit('setRounds', 1)).ok);
assert.ok((await rel[0].emit('start')).ok);
await until(() => rel[0].state?.phase === 'round');
const cur = () => rel[0].state.current;
const relayWord = (await until(() => rel[0].words.length === 1), rel[0].words[0]); // Mo starts round 1
assert.ok(rel.slice(1).every(p => p.words.length === 0), 'non-starter was told the word');
assert.equal((await rel[1].emit('draw-game:sync', null)).word, null);
const seg = { x: 0.5, y: 0.5, px: 0.4, py: 0.4, w: 0.01, c: '#000000', t: 'pen' };
rel[1].s.emit('draw-game:stroke', [seg]); // not Ned's leg yet: ignored
rel[0].s.emit('draw-game:stroke', [seg]);
await until(() => rel[1].strokes === 1);
assert.equal((await rel[1].emit('draw-game:guess', relayWord)).reason, 'closed', 'guessing before the legs are done');
console.log('relay: waiting for 3 legs of 15 s…');
await until(() => cur().drawerId && cur().leg === 1, 20000);
rel[1].s.emit('draw-game:stroke', [seg]); // Ned's leg now
await until(() => rel[2].strokes === 2);
await until(() => cur().step === 'guess', 40000);
assert.equal((await rel[0].emit('draw-game:guess', relayWord)).reason, 'drawer', 'starter cannot guess');
const rg1 = await rel[2].emit('draw-game:guess', relayWord);
assert.equal(rg1.points, 100);
const rg2 = await rel[1].emit('draw-game:guess', relayWord.toLowerCase());
assert.equal(rg2.ended, true);
await until(() => rel[0].state.phase === 'result');
assert.equal(cur().answer, relayWord);
console.log(`relay: "${relayWord}" drawn by ${cur().chain.map(p => p.name).join(' → ')}; guessed by both, starter +${cur().drawerPoints}`);
for (const p of rel) p.s.disconnect();

for (const p of [...players, p1, p2]) p.s.disconnect();
console.log('\nE2E OK');
process.exit(0);
