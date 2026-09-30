// Pure game logic, no sockets. The server is the only place answers are checked and points awarded.
import { randomUUID } from 'node:crypto';
import { POOL } from './questions.js';

export const ROUNDS = 4;
export const ROUND_MS = 30_000;
export const RESULT_MS = 4_000;
export const MAX_PLAYERS = 2;

// "  Pizza ", "PIZZA", "pi-zza" -> "pizza"
export const normalize = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Hide ~40% of the letters (never the first one, always at least one). Returns an array of chars, "_" = hidden.
export function makePattern(answer) {
  const candidates = [...answer].map((c, i) => (i > 0 && /[A-Z]/.test(c) ? i : -1)).filter(i => i >= 0);
  const hidden = new Set(shuffle(candidates).slice(0, Math.max(1, Math.round(candidates.length * 0.4))));
  return [...answer].map((c, i) => (hidden.has(i) ? '_' : c));
}

export function createRoom(code) {
  return {
    code,
    hostId: null,
    players: [],
    phase: 'lobby', // lobby | round | result | final
    round: 0,
    questions: [],
    current: null,
    phaseEndsAt: 0,
    deck: shuffle(POOL), // the whole pool, consumed sequentially
    usedItems: new Set(), // question ids already played in this room
    usedWords: new Set(),
    lastGame: [],
    timer: null,
  };
}

export function addPlayer(room, name) {
  const player = { id: randomUUID(), name, score: 0, connected: false, socketId: null, dropTimer: null };
  room.players.push(player);
  room.hostId ??= player.id;
  return player;
}

// Take the next 4 questions from the shuffled deck, skipping anything already played in this room.
// When the pool runs dry, start a fresh cycle that still excludes the game just played.
export function drawQuestions(room) {
  const picked = [];
  for (let refills = 0; picked.length < ROUNDS; ) {
    const q = room.deck.pop();
    if (!q) {
      if (++refills > 1) throw new Error('Question pool too small');
      const keep = [...room.lastGame, ...picked];
      room.usedItems = new Set(keep.map(q => q.id));
      room.usedWords = new Set(keep.map(q => normalize(q.answer)));
      room.deck = shuffle(POOL.filter(q => !room.usedItems.has(q.id)));
      continue;
    }
    if (room.usedItems.has(q.id) || room.usedWords.has(normalize(q.answer))) continue;
    room.usedItems.add(q.id);
    room.usedWords.add(normalize(q.answer));
    picked.push(q);
  }
  room.lastGame = picked;
  return picked;
}

export function startGame(room) {
  room.questions = drawQuestions(room);
  room.players.forEach(p => (p.score = 0));
  room.round = 0;
  nextRound(room);
}

export function nextRound(room, now = Date.now()) {
  const q = room.questions[room.round++];
  const pattern = makePattern(q.answer);
  room.current = {
    q,
    pattern,
    missing: pattern.map((c, i) => (c === '_' ? q.answer[i] : '')).join(''),
    winnerId: null,
    locked: false,
  };
  room.phase = 'round';
  room.phaseEndsAt = now + ROUND_MS;
}

// Node handles socket events one at a time, so the first correct submission to reach here locks the round
// and any later one (even milliseconds later) sees locked = true.
export function submitAnswer(room, playerId, text, now = Date.now()) {
  const c = room.current;
  if (room.phase !== 'round' || !c || c.locked) return { correct: false, reason: 'closed' };
  const guess = normalize(text);
  if (!guess || (guess !== normalize(c.q.answer) && guess !== normalize(c.missing))) return { correct: false };
  const player = room.players.find(p => p.id === playerId);
  if (!player) return { correct: false, reason: 'closed' };
  c.locked = true;
  c.winnerId = playerId;
  player.score++;
  room.phase = 'result';
  room.phaseEndsAt = now + RESULT_MS;
  return { correct: true };
}

export function timeUp(room, now = Date.now()) {
  if (room.phase !== 'round') return;
  room.current.locked = true;
  room.phase = 'result';
  room.phaseEndsAt = now + RESULT_MS;
}

export function toLobby(room) {
  room.phase = 'lobby';
  room.round = 0;
  room.current = null;
  room.players.forEach(p => (p.score = 0));
}

export function publicState(room, now = Date.now()) {
  const c = room.current;
  return {
    code: room.code,
    hostId: room.hostId,
    phase: room.phase,
    round: room.round,
    rounds: ROUNDS,
    roundMs: ROUND_MS,
    remainingMs: Math.max(0, room.phaseEndsAt - now),
    players: room.players.map(({ id, name, score, connected }) => ({ id, name, score, connected })),
    current: c && {
      emoji: c.q.emoji,
      hint: c.q.hint,
      category: c.q.category,
      pattern: c.pattern,
      displayPattern: c.pattern.join(' '),
      winnerId: c.winnerId,
      answer: c.locked ? c.q.answer : null, // never sent while the round is open
    },
  };
}
