// Pure game logic, no sockets. The server is the only place answers are checked and points awarded.
import { randomUUID } from 'node:crypto';
import { POOL } from './questions.js';

export const ROUNDS = 3;
export const WORDS_PER_ROUND = 3;
export const WORDS_PER_GAME = ROUNDS * WORDS_PER_ROUND;
export const WORD_MS = 15_000; // after this the word stays open ("overtime") until solved or skipped by the host
export const RESULT_MS = 3_000; // pause after each word
export const ROUND_END_MS = 5_000; // longer pause after the last word of a round
export const HIDE_BY_ROUND = [0.35, 0.6, 0.85]; // share of letters hidden (after the first) in rounds 1, 2, 3
export const MAX_PLAYERS = 3;
export const MIN_PLAYERS = 2;

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

// Hide `ratio` of the letters (never the first one, always at least one). Returns an array of chars, "_" = hidden.
export function makePattern(answer, ratio) {
  const candidates = [...answer].map((c, i) => (i > 0 && /[A-Z]/.test(c) ? i : -1)).filter(i => i >= 0);
  const hidden = new Set(shuffle(candidates).slice(0, Math.max(1, Math.round(candidates.length * ratio))));
  return [...answer].map((c, i) => (hidden.has(i) ? '_' : c));
}

export function createRoom(code) {
  return {
    code,
    hostId: null,
    players: [],
    phase: 'lobby', // lobby | round | result | final
    wordNo: 0, // 1..WORDS_PER_GAME while playing
    questions: [],
    current: null,
    history: [], // finished words this game: { emoji, answer, winnerId, winnerName }
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

// Take the next 9 questions from the shuffled deck, skipping anything already played in this room.
// When the pool runs dry, start a fresh cycle that still excludes the game just played.
export function drawQuestions(room) {
  const picked = [];
  for (let refills = 0; picked.length < WORDS_PER_GAME; ) {
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

export const roundOf = wordNo => Math.ceil(wordNo / WORDS_PER_ROUND);
const isRoundEnd = wordNo => wordNo % WORDS_PER_ROUND === 0;

export function startGame(room) {
  room.questions = drawQuestions(room);
  room.players.forEach(p => (p.score = 0));
  room.history = [];
  room.wordNo = 0;
  nextWord(room);
}

export function nextWord(room, now = Date.now()) {
  const q = room.questions[room.wordNo++];
  const pattern = makePattern(q.answer, HIDE_BY_ROUND[roundOf(room.wordNo) - 1]);
  room.current = {
    q,
    pattern,
    missing: pattern.map((c, i) => (c === '_' ? q.answer[i] : '')).join(''),
    winnerId: null,
    locked: false,
    overtime: false,
  };
  room.phase = 'round';
  room.phaseEndsAt = now + WORD_MS;
}

function endWord(room, winner, now) {
  const c = room.current;
  c.locked = true;
  c.winnerId = winner?.id ?? null;
  if (winner) winner.score++;
  room.history.push({ emoji: c.q.emoji, answer: c.q.answer, winnerId: c.winnerId, winnerName: winner?.name ?? null });
  room.phase = 'result';
  room.phaseEndsAt = now + (isRoundEnd(room.wordNo) ? ROUND_END_MS : RESULT_MS);
}

// Node handles socket events one at a time, so the first correct submission to reach here locks the word
// and any later one (even milliseconds later) sees locked = true.
export function submitAnswer(room, playerId, text, now = Date.now()) {
  const c = room.current;
  if (room.phase !== 'round' || !c || c.locked) return { correct: false, reason: 'closed' };
  const guess = normalize(text);
  if (!guess || (guess !== normalize(c.q.answer) && guess !== normalize(c.missing))) return { correct: false };
  const player = room.players.find(p => p.id === playerId);
  if (!player) return { correct: false, reason: 'closed' };
  endWord(room, player, now);
  return { correct: true };
}

// 15 s are up: the word stays open, players keep guessing.
export function startOvertime(room) {
  if (room.phase === 'round') room.current.overtime = true;
}

// Only allowed once the 15 s are up, so a word can't be skipped before anyone had a real go.
export function skipWord(room, now = Date.now()) {
  if (room.phase !== 'round' || !room.current.overtime) return false;
  endWord(room, null, now);
  return true;
}

export function toLobby(room) {
  room.phase = 'lobby';
  room.wordNo = 0;
  room.current = null;
  room.history = [];
  room.players.forEach(p => (p.score = 0));
}

export function publicState(room, now = Date.now()) {
  const c = room.current;
  return {
    code: room.code,
    hostId: room.hostId,
    phase: room.phase,
    round: roundOf(room.wordNo),
    rounds: ROUNDS,
    word: ((room.wordNo - 1) % WORDS_PER_ROUND) + 1, // word number inside the round
    wordsPerRound: WORDS_PER_ROUND,
    wordMs: WORD_MS,
    minPlayers: MIN_PLAYERS,
    maxPlayers: MAX_PLAYERS,
    remainingMs: Math.max(0, room.phaseEndsAt - now),
    players: room.players.map(({ id, name, score, connected }) => ({ id, name, score, connected })),
    history: room.history,
    // Only the picture and the pattern: no text hint, the picture is the clue.
    current: c && {
      emoji: c.q.emoji,
      pattern: c.pattern,
      displayPattern: c.pattern.join(' '),
      overtime: c.overtime,
      winnerId: c.winnerId,
      answer: c.locked ? c.q.answer : null, // never sent while the word is open
    },
  };
}
