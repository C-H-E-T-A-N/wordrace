import express from 'express';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import * as G from './game.js';

const PORT = Number(process.env.GAME_PORT || process.env.PORT) || 3001; // PORT is set by hosts like Render
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

// --- round timers (server-driven so both players always see the same flow) ---
function schedule(room, ms, fn) {
  clearTimeout(room.timer);
  room.timer = setTimeout(() => { fn(); broadcast(room); }, ms);
}
function beginRound(room) {
  schedule(room, G.ROUND_MS, () => { G.timeUp(room); afterRound(room); });
}
function afterRound(room) {
  schedule(room, G.RESULT_MS, () => {
    if (room.round < G.ROUNDS) { G.nextRound(room); beginRound(room); }
    else room.phase = 'final';
  });
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
  if (room.phase !== 'lobby') { clearTimeout(room.timer); G.toLobby(room); }
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
  return room.players.length === G.MAX_PLAYERS && room.players.every(p => p.connected);
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
    if (!canStart(room)) return cb({ ok: false, error: 'Waiting for both players to be connected.' });
    G.startGame(room);
    beginRound(room);
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
    if (result.correct) { afterRound(room); broadcast(room); }
    else if (!result.reason) socket.to(room.code).emit('opponent', { type: 'wrong', name: player.name });
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
