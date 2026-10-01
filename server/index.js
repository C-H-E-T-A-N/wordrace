import express from 'express';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import * as G from './game.js';

// Dev passes 3001 (matches the Vite proxy); hosts like Render set PORT.
const PORT = Number(process.argv[2] || process.env.GAME_PORT || process.env.PORT) || 3001;
const RECONNECT_MS = 60_000; // how long a dropped player keeps their seat

const app = express();
// `npm start` mode: serve the built client from the same port.
app.use(express.static(path.join(path.dirname(fileURLToPath(import.meta.url)), '../client/dist')));
const server = http.createServer(app);
const io = new Server(server);

const rooms = new Map();

const lanIps = () =>
  Object.values(os.networkInterfaces())
    .flat()
    .filter(i => i && (i.family === 'IPv4' || i.family === 4) && !i.internal)
    .map(i => i.address);

function newCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I/O, easy to read aloud
  let code;
  do code = Array.from({ length: 4 }, () => letters[Math.floor(Math.random() * letters.length)]).join('');
  while (rooms.has(code));
  return code;
}

const cleanName = n => String(n ?? '').trim().replace(/\s+/g, ' ').slice(0, 16);
const broadcast = room => io.to(room.code).emit('state', G.publicState(room));
const notice = (room, text) => io.to(room.code).emit('notice', text);

function lookup(socket) {
  const room = rooms.get(socket.data.code);
  return { room, player: room?.players.find(p => p.id === socket.data.playerId) };
}

// --- round timers (server-driven so every player sees the same flow) ---
function schedule(room, ms, fn) {
  clearTimeout(room.timer);
  room.timer = setTimeout(() => { fn(); broadcast(room); }, ms);
}
function beginWord(room) {
  armRoundTimer(room);
  sendSecret(room);
}
// Fires at the current deadline. Picture/Letters: time-up pauses the word (overtime). Classic, Draw & Guess: ends it.
// Relay / Odd One Out: moves to the next leg or step, which sets a new deadline, so the timer is armed again.
function armRoundTimer(room) {
  schedule(room, room.phaseEndsAt - Date.now(), () => {
    if (G.wordTimeUp(room)) afterWord(room);
    else if (room.phase === 'round' && room.phaseEndsAt > Date.now()) armRoundTimer(room);
  });
}
// After a player action or a departure that may have ended the round or moved it to its next step.
function settle(room, ended) {
  if (ended) afterWord(room);
  else if (room.phase === 'round') armRoundTimer(room);
}
function afterWord(room) {
  schedule(room, room.phaseEndsAt - Date.now(), () => {
    if (G.advance(room)) beginWord(room);
    else G.finishGame(room);
  });
}

// Secret words go to individual sockets only, never to the room:
// Draw & Guess -> the drawer, Relay -> the starting drawer, Odd One Out -> every player their own word.
function sendSecret(room) {
  if (room.phase !== 'round') return;
  if (room.mode === 'imposter') {
    for (const p of room.players) if (p.socketId) io.to(p.socketId).emit('imposter:word', { word: G.wordFor(room, p.id), round: room.wordNo });
    return;
  }
  if (!G.usesCanvas(room)) return;
  const knower = room.players.find(p => p.id === (G.isRelay(room) ? room.current.starterId : room.current.drawerId));
  if (knower?.socketId) {
    const { word, emoji } = G.drawSync(room, knower.id);
    io.to(knower.socketId).emit('draw-game:word', { word, emoji, drawerId: knower.id, round: room.wordNo });
  }
}

// A player dropped or left mid-round: the mode decides (end a drawer's turn, skip their leg/clue, recount votes...).
function playerGone(room, playerId) {
  if (room.phase === 'round') settle(room, G.playerGone(room, playerId));
}

// --- connection bookkeeping ---
function attach(socket, room, player) {
  if (player.socketId && player.socketId !== socket.id) {
    const old = io.sockets.sockets.get(player.socketId);
    if (old) { old.leave(room.code); old.data = {}; old.emit('kicked', 'You opened this game in another tab.'); }
  }
  clearTimeout(player.dropTimer);
  player.socketId = socket.id;
  player.connected = true;
  socket.data = { code: room.code, playerId: player.id };
  socket.join(room.code);
  socket.emit('lan', lanIps());
}

function removePlayer(room, playerId, message) {
  const player = room.players.find(p => p.id === playerId);
  if (!player) return;
  clearTimeout(player.dropTimer);
  room.players = room.players.filter(p => p !== player);
  if (!room.players.length) { clearTimeout(room.timer); rooms.delete(room.code); return; }
  if (room.hostId === playerId) room.hostId = room.players[0].id;
  // A game carries on while enough players are left for the mode (2, or 3 for Odd One Out); otherwise back to the lobby.
  if (room.phase !== 'lobby' && room.players.length < G.minPlayersFor(room)) { clearTimeout(room.timer); G.toLobby(room); }
  else if (room.phase !== 'lobby') {
    G.checkHint(room); // the leaver may have been the last one not asking for a hint
    playerGone(room, playerId);
  }
  notice(room, message);
  broadcast(room);
}

function leaveCurrent(socket) {
  const { room, player } = lookup(socket);
  if (room) socket.leave(room.code);
  socket.data = {};
  if (player) removePlayer(room, player.id, `${player.name} left the room.`);
}

function canStart(room) {
  return room.players.length >= G.minPlayersFor(room) && room.players.every(p => p.connected);
}

io.on('connection', socket => {
  socket.data = {};
  socket.emit('lan', lanIps());

  socket.on('create', ({ name } = {}, cb = () => {}) => {
    name = cleanName(name);
    if (!name) return cb({ ok: false, error: 'Enter your name first.' });
    leaveCurrent(socket);
    const room = G.createRoom(newCode());
    rooms.set(room.code, room);
    const player = G.addPlayer(room, name);
    attach(socket, room, player);
    cb({ ok: true, code: room.code, playerId: player.id });
    broadcast(room);
  });

  socket.on('join', ({ code, name } = {}, cb = () => {}) => {
    name = cleanName(name);
    code = String(code ?? '').trim().toUpperCase();
    if (!name) return cb({ ok: false, error: 'Enter your name first.' });
    const room = rooms.get(code);
    if (!room) return cb({ ok: false, error: `Room "${code}" not found. Check the code.` });
    if (room.players.some(p => p.name.toLowerCase() === name.toLowerCase()))
      return cb({ ok: false, error: 'That name is already taken in this room.' });
    if (room.players.length >= G.MAX_PLAYERS) return cb({ ok: false, error: 'That room is full.' });
    leaveCurrent(socket);
    const player = G.addPlayer(room, name);
    attach(socket, room, player);
    cb({ ok: true, code: room.code, playerId: player.id });
    notice(room, `${name} joined the room!`);
    broadcast(room);
  });

  // After a refresh or a dropped connection the client sends back its saved room code + player id.
  socket.on('rejoin', ({ code, playerId } = {}, cb = () => {}) => {
    const room = rooms.get(code);
    const player = room?.players.find(p => p.id === playerId);
    if (!player) return cb({ ok: false, error: 'That game has ended or you were removed after disconnecting.' });
    const wasAway = !player.connected;
    attach(socket, room, player);
    cb({ ok: true, code, playerId });
    if (wasAway) socket.to(room.code).emit('notice', `${player.name} reconnected.`);
    broadcast(room);
  });

  const startHandler = hostOnly => (cb = () => {}) => {
    const { room, player } = lookup(socket);
    if (!room) return cb({ ok: false, error: 'You are not in a room.' });
    if (hostOnly && room.hostId !== player.id) return cb({ ok: false, error: 'Only the host can start.' });
    if (!['lobby', 'final'].includes(room.phase)) return cb({ ok: false, error: 'Game already running.' });
    if (!canStart(room)) return cb({ ok: false, error: `${G.modeOf(room).name} needs at least ${G.minPlayersFor(room)} players, all connected.` });
    G.startGame(room);
    beginWord(room);
    cb({ ok: true });
    broadcast(room);
  };
  socket.on('start', startHandler(true));
  socket.on('playAgain', startHandler(false));

  socket.on('answer', (text, cb = () => {}) => {
    const { room, player } = lookup(socket);
    if (!player) return cb({ correct: false, reason: 'closed' });
    const result = G.submitAnswer(room, player.id, text);
    cb(result);
    if (result.correct) { afterWord(room); broadcast(room); }
    else if (!result.reason) socket.to(room.code).emit('opponent', { type: 'wrong', name: player.name });
  });

  socket.on('skip', (cb = () => {}) => {
    const { room, player } = lookup(socket);
    if (!player || room.hostId !== player.id) return cb({ ok: false, error: 'Only the host can skip a word.' });
    if (!G.skipWord(room)) return cb({ ok: false, error: 'You can skip once the time is up.' });
    cb({ ok: true });
    afterWord(room);
    broadcast(room);
  });

  socket.on('setMode', (mode, cb = () => {}) => {
    const { room, player } = lookup(socket);
    if (!player || room.hostId !== player.id) return cb({ ok: false, error: 'Only the host can pick the mode.' });
    if (!G.setMode(room, mode)) return cb({ ok: false, error: 'The mode can only be changed between games.' });
    cb({ ok: true });
    broadcast(room);
  });

  socket.on('setRounds', (n, cb = () => {}) => {
    const { room, player } = lookup(socket);
    if (!player || room.hostId !== player.id) return cb({ ok: false, error: 'Only the host can change the rounds.' });
    if (!G.setRounds(room, n)) return cb({ ok: false, error: `Rounds must be 1–${G.modeOf(room).maxRounds}, set between games.` });
    cb({ ok: true });
    broadcast(room);
  });

  socket.on('toLobby', (cb = () => {}) => {
    const { room, player } = lookup(socket);
    if (!player || room.hostId !== player.id) return cb({ ok: false, error: 'Only the host can do that.' });
    if (room.phase !== 'final') return cb({ ok: false, error: 'Finish the game first.' });
    G.toLobby(room);
    cb({ ok: true });
    broadcast(room);
  });

  // --- Draw & Guess ---
  socket.on('draw-game:guess', (text, cb = () => {}) => {
    const { room, player } = lookup(socket);
    if (!player) return cb({ correct: false, reason: 'closed' });
    const result = G.submitDrawGuess(room, player.id, text);
    cb(result); // only the guesser learns the word here
    if (result.correct) io.to(room.code).emit('draw-game:correct', { name: player.name, points: result.points });
    if (result.ended) afterWord(room);
    if (!result.reason) broadcast(room); // guess feed and scores changed
  });

  socket.on('draw-game:stroke', segments => {
    const { room, player } = lookup(socket);
    const clean = player && G.addStrokes(room, player.id, segments);
    if (clean) socket.to(room.code).emit('draw-game:stroke', clean);
  });

  socket.on('draw-game:clear', () => {
    const { room, player } = lookup(socket);
    if (player && G.clearStrokes(room, player.id)) socket.to(room.code).emit('draw-game:clear');
  });

  // --- Odd One Out ---
  const imposterAction = fn => (arg, cb = () => {}) => {
    const { room, player } = lookup(socket);
    if (!player) return cb({ ok: false, error: 'You are not in a game.' });
    const result = fn(room, player.id, arg);
    cb(result);
    if (result.ok) { settle(room, result.ended); broadcast(room); }
  };
  socket.on('imposter:clue', imposterAction(G.submitClue));
  socket.on('imposter:vote', imposterAction(G.submitVote));
  socket.on('imposter:guess', imposterAction(G.submitImposterGuess));
  // Your own word, for a player who just (re)loaded the round.
  socket.on('imposter:sync', (_, cb = () => {}) => {
    const { room, player } = lookup(socket);
    cb({ word: player ? G.wordFor(room, player.id) : null });
  });

  // Canvas + (if allowed) the secret word, for a player who just (re)loaded the turn.
  socket.on('draw-game:sync', (_, cb = () => {}) => {
    const { room, player } = lookup(socket);
    cb(player ? G.drawSync(room, player.id) : { strokes: [], word: null });
  });

  socket.on('hint', () => {
    const { room, player } = lookup(socket);
    if (player && G.voteHint(room, player.id)) broadcast(room);
  });

  socket.on('typing', () => {
    const { room, player } = lookup(socket);
    if (room?.phase === 'round') socket.to(room.code).emit('opponent', { type: 'typing', name: player.name });
  });

  socket.on('leave', () => leaveCurrent(socket));

  socket.on('disconnect', () => {
    const { room, player } = lookup(socket);
    if (!player || player.socketId !== socket.id) return;
    player.connected = false;
    player.socketId = null;
    G.checkHint(room); // don't make the others wait for someone who's gone
    playerGone(room, player.id);
    player.dropTimer = setTimeout(
      () => removePlayer(room, player.id, `${player.name} did not come back and was removed.`),
      RECONNECT_MS,
    );
    broadcast(room);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\nWord Race server listening on 0.0.0.0:${PORT}`);
  console.log('Open the game from another device on the same Wi-Fi:');
  for (const ip of lanIps()) console.log(`   dev:   http://${ip}:5173      (npm run dev)\n   built: http://${ip}:${PORT}      (npm start)`);
  console.log();
});
