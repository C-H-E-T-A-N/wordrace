// Pure game logic, no sockets. The server is the only place answers are checked and points awarded.
import { randomUUID } from 'node:crypto';
import { POOL } from './questions.js';
import { DRAW_POOL } from './drawWords.js';

export const MAX_PLAYERS = 8;
export const MIN_PLAYERS = 2;
export const RESULT_MS = 3_000; // pause after each word
export const ROUND_END_MS = 5_000; // longer pause after the last word of a round / after a drawing turn
export const GUESS_POINTS = [100, 75, 50]; // Draw & Guess: 1st, 2nd, 3rd correct guesser; later ones get the last value / 2
export const DRAWER_MAX = 100; // Draw & Guess: drawer gets this share-weighted by how many guessers got it
const RECORDS_KEPT = 50;
const MAX_STROKES = 20_000;

// rounds / maxRounds: default and upper limit of the host's "Rounds" setting for the mode.
// overtime: when the timer runs out the word pauses and stays open (host may skip) instead of ending.
// hide: share of letters hidden (after the first letter), rising from `from` in round 1 to `to` in the last round;
//       null = no letter pattern at all.
export const MODES = {
  picture: {
    name: 'Picture', rounds: 3, maxRounds: 10, wordsPerRound: 3, wordMs: 15_000, overtime: true,
    showEmoji: true, hide: null, hintVote: true, input: 'text',
  },
  letters: {
    name: 'Letters', rounds: 3, maxRounds: 10, wordsPerRound: 3, wordMs: 15_000, overtime: true,
    showEmoji: false, hide: { from: 0.35, to: 0.65 }, input: 'boxes',
  },
  classic: {
    name: 'Classic', rounds: 4, maxRounds: 10, wordsPerRound: 1, wordMs: 30_000, overtime: false,
    showEmoji: true, hide: { from: 0.4, to: 0.4 }, showHint: true, input: 'text',
  },
  // A Draw & Guess round = every player draws once, so turns = players x rounds.
  draw: {
    name: 'Draw & Guess', rounds: 1, maxRounds: 5, wordsPerRound: 1, wordMs: 60_000, overtime: false, input: 'draw',
  },
};

// Share of letters hidden in `round` of `rounds` (rounds = 1 sits in the middle).
export function hideRatio(mode, round, rounds) {
  const { from, to } = mode.hide;
  return from + (to - from) * (rounds === 1 ? 0.5 : (round - 1) / (rounds - 1));
}
const difficulty = ratio => (ratio < 0.45 ? 'Easy' : ratio < 0.58 ? 'Medium' : 'Hard');

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

// Lenient on what people type or say: "a penguin", "Penguins", "PENGUIN", or (with a pattern) just the missing letters.
export function isCorrect(text, current) {
  const answer = normalize(current.q.answer);
  const guess = normalize(String(text ?? '').trim().replace(/^(a|an|the)\s+/i, ''));
  if (!guess) return false;
  if (guess === answer || (current.missing && guess === normalize(current.missing))) return true;
  if (guess.length < 3) return false;
  return plurals(answer).includes(guess) || plurals(guess).includes(answer);
}
// "taco" -> tacos, "box" -> boxes, "cherry" -> cherries
const plurals = w => [w + 's', w + 'es', ...(w.endsWith('y') ? [w.slice(0, -1) + 'ies'] : [])];

// A shuffled pool dealt in order. Anything dealt is "used" until the pool runs dry; the refill still
// excludes the game just played, so Play Again never repeats the previous game's words.
const makeDeck = pool => ({ pool, cards: shuffle(pool), usedItems: new Set(), usedWords: new Set(), last: [] });

export function drawFrom(deck, count) {
  const picked = [];
  for (let refills = 0; picked.length < count; ) {
    const q = deck.cards.pop();
    if (!q) {
      if (++refills > 1) throw new Error('Question pool too small');
      const keep = [...deck.last, ...picked];
      deck.usedItems = new Set(keep.map(q => q.id));
      deck.usedWords = new Set(keep.map(q => normalize(q.answer)));
      deck.cards = shuffle(deck.pool.filter(q => !deck.usedItems.has(q.id)));
      continue;
    }
    if (deck.usedItems.has(q.id) || deck.usedWords.has(normalize(q.answer))) continue;
    deck.usedItems.add(q.id);
    deck.usedWords.add(normalize(q.answer));
    picked.push(q);
  }
  deck.last = picked;
  return picked;
}

export function createRoom(code) {
  return {
    code,
    hostId: null,
    mode: 'picture',
    rounds: Object.fromEntries(Object.entries(MODES).map(([k, m]) => [k, m.rounds])), // host's setting, per mode
    players: [],
    phase: 'lobby', // lobby | round | result | final
    wordNo: 0, // words (or drawing turns) dealt so far this game
    questions: [],
    turns: [], // Draw & Guess: drawer id for each turn, in order
    current: null,
    history: [], // finished words/turns this game, for the final screen
    records: [], // finished games in this room, newest first
    phaseEndsAt: 0,
    decks: { quiz: makeDeck(POOL), draw: makeDeck(DRAW_POOL) },
    timer: null,
  };
}

export function addPlayer(room, name) {
  const player = { id: randomUUID(), name, score: 0, connected: false, socketId: null, dropTimer: null };
  room.players.push(player);
  room.hostId ??= player.id;
  return player;
}

export const modeOf = room => MODES[room.mode];
export const isDraw = room => room.mode === 'draw';
const totalRounds = room => (isDraw(room) ? room.turns.length || room.players.length * room.rounds.draw : room.rounds[room.mode]);
export const roundOf = room => Math.ceil(room.wordNo / modeOf(room).wordsPerRound);
const isRoundEnd = room => room.wordNo % modeOf(room).wordsPerRound === 0;
const between = room => ['lobby', 'final'].includes(room.phase);

export function setMode(room, mode) {
  if (!MODES[mode] || !between(room)) return false;
  room.mode = mode;
  return true;
}

export function setRounds(room, n) {
  if (!Number.isInteger(n) || n < 1 || n > modeOf(room).maxRounds || !between(room)) return false;
  room.rounds[room.mode] = n;
  return true;
}

export function startGame(room, now = Date.now()) {
  if (isDraw(room)) {
    // Deterministic order: join order, repeated per "turns per player". A -> B -> C -> A -> B -> C
    const order = room.players.map(p => p.id);
    room.turns = Array.from({ length: order.length * room.rounds.draw }, (_, i) => order[i % order.length]);
    room.questions = drawFrom(room.decks.draw, room.turns.length);
  } else {
    const mode = modeOf(room);
    room.turns = [];
    room.questions = drawFrom(room.decks.quiz, room.rounds[room.mode] * mode.wordsPerRound);
  }
  room.players.forEach(p => (p.score = 0));
  room.history = [];
  room.wordNo = 0;
  advance(room, now);
}

// Start the next word / drawing turn. Returns false when the game is over.
// Draw & Guess skips turns whose drawer has left or is currently disconnected.
export function advance(room, now = Date.now()) {
  if (!isDraw(room)) {
    if (room.wordNo >= room.questions.length) return false;
    nextWord(room, now);
    return true;
  }
  while (room.wordNo < room.turns.length) {
    const q = room.questions[room.wordNo];
    const drawer = room.players.find(p => p.id === room.turns[room.wordNo] && p.connected);
    room.wordNo++;
    if (drawer) { startTurn(room, drawer, q, now); return true; }
  }
  return false;
}

export function nextWord(room, now = Date.now()) {
  const mode = modeOf(room);
  const q = room.questions[room.wordNo++];
  const ratio = mode.hide && hideRatio(mode, roundOf(room), room.rounds[room.mode]);
  const pattern = mode.hide && makePattern(q.answer, ratio);
  room.current = {
    q,
    pattern,
    missing: pattern ? pattern.map((c, i) => (c === '_' ? q.answer[i] : '')).join('') : null,
    difficulty: mode.hide ? difficulty(ratio) : null,
    winnerId: null,
    locked: false,
    overtime: false,
    hintVotes: new Set(),
    hintShown: false,
  };
  room.phase = 'round';
  room.phaseEndsAt = now + mode.wordMs;
}

function startTurn(room, drawer, q, now) {
  room.current = {
    q, // q.answer is the secret word: it never goes into publicState while the turn is open
    drawerId: drawer.id,
    guessed: [], // { id, name, points } in the order they got it
    guesses: [], // feed of { name, text, correct }; correct guesses carry no text
    strokes: [], // kept so a refreshed/reconnected player can redraw the canvas
    locked: false,
    drawerPoints: 0,
  };
  room.phase = 'round';
  room.phaseEndsAt = now + MODES.draw.wordMs;
}

function endWord(room, winner, now) {
  const c = room.current;
  c.locked = true;
  c.winnerId = winner?.id ?? null;
  if (winner) winner.score++;
  room.history.push({ emoji: c.q.emoji, answer: c.q.answer, winnerId: c.winnerId, winnerName: winner?.name ?? null });
  room.phase = 'result';
  room.phaseEndsAt = now + (isRoundEnd(room) ? ROUND_END_MS : RESULT_MS);
}

function endTurn(room, now) {
  const c = room.current;
  c.locked = true;
  const drawer = room.players.find(p => p.id === c.drawerId);
  const guessedIds = new Set(c.guessed.map(g => g.id));
  const eligible = room.players.filter(p => p.id !== c.drawerId && (p.connected || guessedIds.has(p.id))).length;
  c.drawerPoints = eligible ? Math.round((DRAWER_MAX * c.guessed.length) / eligible) : 0;
  if (drawer) drawer.score += c.drawerPoints;
  room.history.push({
    emoji: c.q.emoji,
    answer: c.q.answer,
    drawerName: drawer?.name ?? 'Someone',
    guessers: c.guessed.map(g => g.name),
    drawerPoints: c.drawerPoints,
  });
  room.phase = 'result';
  room.phaseEndsAt = now + ROUND_END_MS;
}

// Quiz modes. Node handles socket events one at a time, so the first correct submission to reach here locks the word
// and any later one (even milliseconds later) sees locked = true.
// `guesses` may be one string or several (voice input sends the recogniser's alternatives).
export function submitAnswer(room, playerId, guesses, now = Date.now()) {
  const c = room.current;
  if (isDraw(room) || room.phase !== 'round' || !c || c.locked) return { correct: false, reason: 'closed' };
  const player = room.players.find(p => p.id === playerId);
  if (!player) return { correct: false, reason: 'closed' };
  const list = (Array.isArray(guesses) ? guesses : [guesses]).slice(0, 5);
  if (!list.some(g => isCorrect(g, c))) return { correct: false };
  endWord(room, player, now);
  return { correct: true };
}

// Draw & Guess. Everyone except the drawer can guess until they get it; points shrink with each correct guesser.
export function submitDrawGuess(room, playerId, text, now = Date.now()) {
  const c = room.current;
  if (!isDraw(room) || room.phase !== 'round' || !c || c.locked) return { correct: false, reason: 'closed' };
  if (playerId === c.drawerId) return { correct: false, reason: 'drawer' };
  if (c.guessed.some(g => g.id === playerId)) return { correct: false, reason: 'done' };
  const player = room.players.find(p => p.id === playerId);
  const guess = String(text ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
  if (!player || !guess) return { correct: false, reason: 'closed' };
  if (!isCorrect(guess, c)) {
    c.guesses.push({ name: player.name, text: guess, correct: false });
    if (c.guesses.length > 50) c.guesses.shift();
    return { correct: false };
  }
  const n = c.guessed.length;
  const points = GUESS_POINTS[n] ?? Math.max(10, Math.round(GUESS_POINTS.at(-1) / 2 ** (n - GUESS_POINTS.length + 1)));
  player.score += points;
  c.guessed.push({ id: player.id, name: player.name, points });
  c.guesses.push({ name: player.name, text: null, correct: true });
  return { correct: true, points, word: c.q.answer, ended: checkAllGuessed(room, now) };
}

// Ends the turn once every connected guesser has it. Also called when a guesser disconnects or leaves.
export function checkAllGuessed(room, now = Date.now()) {
  const c = room.current;
  if (!isDraw(room) || room.phase !== 'round' || c.locked) return false;
  const guessedIds = new Set(c.guessed.map(g => g.id));
  if (!room.players.filter(p => p.id !== c.drawerId && p.connected).every(p => guessedIds.has(p.id))) return false;
  endTurn(room, now);
  return true;
}

// The drawer disconnected or left: end their turn right away so the game moves on.
export function drawerGone(room, playerId, now = Date.now()) {
  if (!isDraw(room) || room.phase !== 'round' || room.current.locked || room.current.drawerId !== playerId) return false;
  endTurn(room, now);
  return true;
}

// Timer ran out. Overtime modes keep the word open; Classic and Draw & Guess end it. Returns true if it ended.
export function wordTimeUp(room, now = Date.now()) {
  if (room.phase !== 'round') return false;
  if (isDraw(room)) { endTurn(room, now); return true; }
  if (modeOf(room).overtime) { room.current.overtime = true; return false; }
  endWord(room, null, now);
  return true;
}

// Only once the time is up, so a word can't be skipped before anyone had a real go.
export function skipWord(room, now = Date.now()) {
  if (isDraw(room) || room.phase !== 'round' || !room.current.overtime) return false;
  endWord(room, null, now);
  return true;
}

// Picture mode: the hint line appears once every connected player has asked for it.
export function voteHint(room, playerId) {
  const c = room.current;
  if (!modeOf(room).hintVote || room.phase !== 'round' || !c) return false;
  c.hintVotes.add(playerId);
  checkHint(room);
  return true;
}
export function checkHint(room) {
  const c = room.current;
  if (c?.hintVotes && !c.hintShown && room.players.filter(p => p.connected).every(p => c.hintVotes.has(p.id))) c.hintShown = true;
}

// Draw & Guess canvas: only the drawer, only during their turn. Coordinates are 0..1 so any canvas size works.
// Returns the cleaned segments to relay, or null to drop the message.
export function addStrokes(room, playerId, segments) {
  const c = room.current;
  if (!isDraw(room) || room.phase !== 'round' || c.drawerId !== playerId || !Array.isArray(segments)) return null;
  const unit = v => Number.isFinite(v) && v >= 0 && v <= 1;
  const clean = segments.slice(0, 200).filter(s =>
    s && [s.x, s.y, s.px, s.py].every(unit) && Number.isFinite(s.w) && s.w > 0 && s.w <= 0.2 &&
    ['pen', 'eraser'].includes(s.t) && (s.t === 'eraser' || /^#[0-9a-f]{6}$/i.test(s.c)))
    .map(({ x, y, px, py, w, c: color, t }) => ({ x, y, px, py, w, c: t === 'eraser' ? null : color, t }));
  if (c.strokes.length + clean.length <= MAX_STROKES) c.strokes.push(...clean);
  return clean.length ? clean : null;
}

export function clearStrokes(room, playerId) {
  const c = room.current;
  if (!isDraw(room) || room.phase !== 'round' || c.drawerId !== playerId) return false;
  c.strokes = [];
  return true;
}

// What a player may see privately: the drawer (and anyone who already guessed it) gets the secret word.
export function drawSync(room, playerId) {
  const c = room.current;
  if (!isDraw(room) || !c) return { strokes: [], word: null };
  const knows = c.locked || c.drawerId === playerId || c.guessed.some(g => g.id === playerId);
  return { strokes: c.strokes, word: knows ? c.q.answer : null, emoji: knows ? c.q.emoji : null };
}

export function finishGame(room, now = Date.now()) {
  room.phase = 'final';
  const players = room.players.map(p => ({ name: p.name, score: p.score }));
  const top = Math.max(...players.map(p => p.score));
  room.records.unshift({
    mode: room.mode,
    at: now,
    players,
    winners: top > 0 ? players.filter(p => p.score === top).map(p => p.name) : [],
  });
  room.records.length = Math.min(room.records.length, RECORDS_KEPT);
}

// Room leaderboard, by player name so it survives leaving and rejoining.
// words = words won in the quiz modes; drawBest = best Draw & Guess score (points, so kept apart).
export function leaderboard(records) {
  const by = new Map();
  for (const r of records) {
    for (const p of r.players) {
      const e = by.get(p.name) ?? { name: p.name, games: 0, wins: 0, words: 0, best: 0, drawBest: 0 };
      e.games++;
      if (r.mode === 'draw') e.drawBest = Math.max(e.drawBest, p.score);
      else { e.words += p.score; e.best = Math.max(e.best, p.score); }
      if (r.winners.includes(p.name)) e.wins++;
      by.set(p.name, e);
    }
  }
  return [...by.values()].sort((a, b) => b.wins - a.wins || b.words - a.words || b.drawBest - a.drawBest);
}

export function toLobby(room) {
  room.phase = 'lobby';
  room.wordNo = 0;
  room.current = null;
  room.history = [];
  room.turns = [];
  room.players.forEach(p => (p.score = 0));
}

function publicCurrent(room) {
  const c = room.current;
  if (!c) return null;
  if (isDraw(room)) {
    const drawer = room.players.find(p => p.id === c.drawerId);
    return {
      drawerId: c.drawerId,
      drawerName: drawer?.name ?? 'Someone',
      guessed: c.guessed,
      guesses: c.guesses.slice(-20),
      drawerPoints: c.locked ? c.drawerPoints : null,
      // The secret word is revealed to everyone only after the turn; before that it goes to the drawer's socket only.
      answer: c.locked ? c.q.answer : null,
      emoji: c.locked ? c.q.emoji : null,
    };
  }
  const mode = modeOf(room);
  return {
    // Only what the mode allows: Letters hides the picture until the word is over, hints only when earned.
    emoji: mode.showEmoji || c.locked ? c.q.emoji : null,
    category: mode.showHint ? c.q.category : null,
    hint: mode.showHint || c.hintShown ? c.q.hint : null,
    hintVote: !!mode.hintVote,
    hintVotes: [...c.hintVotes],
    hintNeeded: room.players.filter(p => p.connected).length,
    pattern: c.pattern,
    difficulty: c.difficulty,
    displayPattern: c.pattern?.join(' ') ?? null,
    overtime: c.overtime,
    winnerId: c.winnerId,
    answer: c.locked ? c.q.answer : null, // never sent while the word is open
  };
}

export function publicState(room, now = Date.now()) {
  const mode = modeOf(room);
  return {
    code: room.code,
    hostId: room.hostId,
    mode: room.mode,
    roundsSetting: room.rounds[room.mode], // what the host picked for the selected mode
    roundsMax: mode.maxRounds,
    modeInfo: {
      name: mode.name, rounds: totalRounds(room), wordsPerRound: mode.wordsPerRound,
      wordMs: mode.wordMs, overtime: mode.overtime, input: mode.input,
    },
    phase: room.phase,
    round: roundOf(room),
    word: ((room.wordNo - 1) % mode.wordsPerRound) + 1, // word number inside the round
    minPlayers: MIN_PLAYERS,
    maxPlayers: MAX_PLAYERS,
    remainingMs: Math.max(0, room.phaseEndsAt - now),
    players: room.players.map(({ id, name, score, connected }) => ({ id, name, score, connected })),
    history: room.history,
    records: room.records.slice(0, 10),
    leaderboard: leaderboard(room.records),
    current: publicCurrent(room),
  };
}
