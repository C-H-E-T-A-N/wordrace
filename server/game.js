// Pure game logic, no sockets. The server is the only place answers are checked and points awarded.
import { randomUUID } from 'node:crypto';
import { POOL } from './questions.js';
import { DRAW_POOL } from './drawWords.js';
import { IMPOSTER_POOL } from './imposterPairs.js';
import { CATEGORY_POOL, LETTERS } from './categories.js';

export const MAX_PLAYERS = 8;
export const MIN_PLAYERS = 2;
export const RESULT_MS = 3_000; // pause after each word
export const ROUND_END_MS = 5_000; // longer pause after the last word of a round / after a drawing turn
export const GUESS_POINTS = [100, 75, 50]; // 1st, 2nd, 3rd correct answer in every guessing mode; later ones keep halving
export const LAST_CALL_MS = 5_000; // Picture/Letters: once someone solves a paused word, the others get this long
// Points for the (n+1)-th correct answer: 100, 75, 50, 25, 13, 10, 10…
export const pointsFor = n => GUESS_POINTS[n] ?? Math.max(10, Math.round(GUESS_POINTS.at(-1) / 2 ** (n - GUESS_POINTS.length + 1)));
export const DRAWER_MAX = 100; // Draw & Guess / Relay: (starting) drawer gets this share-weighted by how many guessers got it
// Odd One Out points
export const IMPOSTER_ESCAPES = 3; // imposter not caught
export const IMPOSTER_STEALS = 2; // imposter caught but guesses the crew's word
export const CREW_WIN = 1; // every crew member when the imposter is caught and misses the guess
export const GOOD_VOTE = 1; // anyone who voted for the imposter
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
  // Scattergories-style: each round 1 letter + 1 category; write an answer, review/veto, unique answers score.
  categories: {
    name: 'Categories', rounds: 5, maxRounds: 15, wordsPerRound: 1, overtime: false, input: 'categories',
    writeMs: 30_000, reviewMs: 20_000,
  },
  // A Draw & Guess round = every player draws once, so turns = players x rounds.
  draw: {
    name: 'Draw & Guess', rounds: 1, maxRounds: 5, wordsPerRound: 1, wordMs: 60_000, overtime: false, input: 'draw',
  },
  // One word per round, drawn in 15 s legs by everyone in turn; only the first drawer knows it. Then all guess.
  relay: {
    name: 'Relay Draw', rounds: 3, maxRounds: 8, wordsPerRound: 1, overtime: false, input: 'relay',
    legMs: 15_000, guessMs: 30_000,
  },
  // Clues one by one, then a vote, then (if caught) the imposter's last guess.
  imposter: {
    name: 'Odd One Out', rounds: 3, maxRounds: 8, minPlayers: 3, wordsPerRound: 1, overtime: false, input: 'imposter',
    clueMs: 30_000, voteMs: 45_000, guessMs: 20_000,
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
    decks: { quiz: makeDeck(POOL), draw: makeDeck(DRAW_POOL), imposter: makeDeck(IMPOSTER_POOL), categories: makeDeck(CATEGORY_POOL) },
    imposterOrder: [], // Odd One Out: who is the imposter in which round
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
export const isRelay = room => room.mode === 'relay';
export const usesCanvas = room => isDraw(room) || isRelay(room);
export const minPlayersFor = room => modeOf(room).minPlayers ?? MIN_PLAYERS;
const playerById = (room, id) => room.players.find(p => p.id === id);
const nameOf = (room, id) => playerById(room, id)?.name ?? 'Someone';
const connectedIds = room => room.players.filter(p => p.connected).map(p => p.id);
// Players in join order, starting from the n-th one (n wraps), so each round starts with someone else.
const rotated = (ids, n) => (ids.length ? [...ids.slice(n % ids.length), ...ids.slice(0, n % ids.length)] : []);
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
  room.turns = [];
  if (isDraw(room)) {
    // Deterministic order: join order, repeated per "turns per player". A -> B -> C -> A -> B -> C
    const order = room.players.map(p => p.id);
    room.turns = Array.from({ length: order.length * room.rounds.draw }, (_, i) => order[i % order.length]);
    room.questions = drawFrom(room.decks.draw, room.turns.length);
  } else if (isRelay(room)) {
    room.questions = drawFrom(room.decks.draw, room.rounds.relay);
  } else if (room.mode === 'categories') {
    // A different letter and a different category every round (no repeats within the game).
    // Drawn in one go so nothing repeats inside the game, nor from the previous game.
    const letters = shuffle(LETTERS);
    const cats = drawFrom(room.decks.categories, room.rounds.categories);
    room.questions = cats.map((cat, i) => ({ letter: letters[i % letters.length], categories: [cat.answer] }));
  } else if (room.mode === 'imposter') {
    room.questions = drawFrom(room.decks.imposter, room.rounds.imposter);
    room.imposterOrder = shuffle(room.players.map(p => p.id)); // everyone gets a turn as imposter before anyone repeats
  } else {
    const mode = modeOf(room);
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
  if (isRelay(room) || room.mode === 'imposter' || room.mode === 'categories') {
    if (room.wordNo >= room.questions.length || !connectedIds(room).length) return false;
    const q = room.questions[room.wordNo++];
    ({ relay: startRelay, imposter: startImposter, categories: startCategories })[room.mode](room, q, now);
    return true;
  }
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
    solved: [], // { id, name, points } in the order correct answers arrived
    locked: false,
    overtime: false, // Picture/Letters: time ran out with nobody right; the word waits
    lastCall: false, // ...and then someone got it: the others have LAST_CALL_MS left
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

// ---------- Relay Draw ----------

function startRelay(room, q, now) {
  // Everyone connected draws one leg, starting with the next player in join order each round.
  const chain = rotated(connectedIds(room), room.wordNo - 1);
  room.current = {
    q, // only chain[0] (the starter) is told the word
    starterId: chain[0],
    chain,
    leg: -1,
    step: 'draw', // draw -> guess
    stepMs: 0,
    drawerId: null, // whoever is drawing the current leg
    guessed: [],
    guesses: [],
    strokes: [],
    locked: false,
    drawerPoints: 0,
  };
  room.phase = 'round';
  nextLeg(room, now);
}

// Hand the pen to the next connected player in the chain; after the last leg, everyone guesses.
function nextLeg(room, now) {
  const c = room.current;
  while (++c.leg < c.chain.length) {
    if (playerById(room, c.chain[c.leg])?.connected) {
      c.drawerId = c.chain[c.leg];
      c.stepMs = MODES.relay.legMs;
      room.phaseEndsAt = now + c.stepMs;
      return;
    }
  }
  c.drawerId = null;
  c.step = 'guess';
  c.stepMs = MODES.relay.guessMs;
  room.phaseEndsAt = now + c.stepMs;
  checkAllGuessed(room, now); // nobody left to guess -> ends straight away
}

// ---------- Odd One Out ----------

function startImposter(room, q, now) {
  const swap = Math.random() < 0.5; // which word of the pair the crew gets
  const crewWord = swap ? q.alt : q.answer;
  const impWord = swap ? q.answer : q.alt;
  // Imposter: next in the shuffled order who is here; anyone who joined later is only ever crew.
  const order = room.imposterOrder;
  let imposterId = null;
  for (let i = 0; i < order.length && !imposterId; i++) {
    const id = order[(room.wordNo - 1 + i) % order.length];
    if (playerById(room, id)?.connected) imposterId = id;
  }
  imposterId ??= connectedIds(room)[0];
  room.current = {
    q: { ...q, answer: crewWord }, // history/answer show the crew's word
    crewWord,
    impWord,
    imposterId, // secret until the vote is counted
    step: 'clue', // clue -> vote -> (guess) -> locked
    stepMs: 0,
    clueOrder: rotated(connectedIds(room), room.wordNo - 1),
    clueIdx: -1,
    clues: [], // { id, name, text|null }
    votes: new Map(), // voterId -> targetId, hidden until counted
    accusedId: null,
    caught: false,
    imposterGuess: null,
    outcome: null, // crew-won | imposter-guessed | imposter-escaped | imposter-left
    points: {},
    locked: false,
  };
  room.phase = 'round';
  nextClue(room, now);
}

export const wordFor = (room, playerId) => {
  const c = room.current;
  if (room.mode !== 'imposter' || !c) return null;
  return playerId === c.imposterId ? c.impWord : c.crewWord;
};

function nextClue(room, now) {
  const c = room.current;
  while (++c.clueIdx < c.clueOrder.length) {
    if (playerById(room, c.clueOrder[c.clueIdx])?.connected) {
      c.stepMs = MODES.imposter.clueMs;
      room.phaseEndsAt = now + c.stepMs;
      return;
    }
  }
  c.step = 'vote';
  c.stepMs = MODES.imposter.voteMs;
  room.phaseEndsAt = now + c.stepMs;
}

const clueGiver = c => (c.step === 'clue' ? c.clueOrder[c.clueIdx] : null);

// One word, no spaces, and it can't give your own word away.
export function submitClue(room, playerId, text, now = Date.now()) {
  const c = room.current;
  if (room.mode !== 'imposter' || room.phase !== 'round' || c.locked || clueGiver(c) !== playerId)
    return { ok: false, error: "It's not your turn to give a clue." };
  const clue = String(text ?? '').trim();
  if (!/^[\p{L}\p{N}'-]{1,20}$/u.test(clue)) return { ok: false, error: 'One word only (no spaces, up to 20 letters).' };
  const mine = normalize(wordFor(room, playerId));
  const said = normalize(clue);
  if (said.includes(mine) || (said.length >= 4 && mine.includes(said))) return { ok: false, error: "Your clue can't contain your word!" };
  c.clues.push({ id: playerId, name: nameOf(room, playerId), text: clue });
  nextClue(room, now);
  return { ok: true };
}

const voters = room => room.players.filter(p => p.connected);

export function submitVote(room, playerId, targetId, now = Date.now()) {
  const c = room.current;
  if (room.mode !== 'imposter' || room.phase !== 'round' || c.locked || c.step !== 'vote')
    return { ok: false, error: 'Voting is not open.' };
  if (!playerById(room, playerId)) return { ok: false, error: 'You are not in this game.' };
  if (targetId === playerId || !playerById(room, targetId)) return { ok: false, error: 'Vote for another player.' };
  c.votes.set(playerId, targetId);
  return { ok: true, ended: allVoted(room) && countVotes(room, now) };
}

const allVoted = room => voters(room).every(p => room.current.votes.has(p.id));

// Most votes is accused; a tie (or no votes) accuses nobody. Returns true if the round is over.
function countVotes(room, now) {
  const c = room.current;
  const tally = new Map();
  for (const t of c.votes.values()) tally.set(t, (tally.get(t) ?? 0) + 1);
  const max = Math.max(0, ...tally.values());
  const top = [...tally].filter(([, n]) => n === max).map(([id]) => id);
  c.accusedId = max > 0 && top.length === 1 ? top[0] : null;
  c.caught = c.accusedId === c.imposterId;
  if (c.caught && playerById(room, c.imposterId)?.connected) {
    c.step = 'guess';
    c.stepMs = MODES.imposter.guessMs;
    room.phaseEndsAt = now + c.stepMs;
    return false;
  }
  finishImposter(room, now);
  return true;
}

// The caught imposter's last chance: name the crew's word.
export function submitImposterGuess(room, playerId, text, now = Date.now()) {
  const c = room.current;
  if (room.mode !== 'imposter' || room.phase !== 'round' || c.locked || c.step !== 'guess' || playerId !== c.imposterId)
    return { ok: false, error: 'Only the caught imposter can guess now.' };
  c.imposterGuess = String(text ?? '').trim().slice(0, 40);
  finishImposter(room, now);
  return { ok: true, correct: c.outcome === 'imposter-guessed', ended: true };
}

function finishImposter(room, now, outcome) {
  const c = room.current;
  const add = (id, n) => {
    const p = playerById(room, id);
    if (!p || !n) return;
    p.score += n;
    c.points[id] = (c.points[id] ?? 0) + n;
  };
  c.outcome = outcome
    ?? (!c.caught ? 'imposter-escaped'
      : c.imposterGuess && isCorrect(c.imposterGuess, { q: { answer: c.crewWord } }) ? 'imposter-guessed'
      : 'crew-won');
  if (c.outcome !== 'imposter-left') {
    for (const [voter, target] of c.votes) if (target === c.imposterId) add(voter, GOOD_VOTE);
    if (c.outcome === 'imposter-escaped') add(c.imposterId, IMPOSTER_ESCAPES);
    if (c.outcome === 'imposter-guessed') add(c.imposterId, IMPOSTER_STEALS);
    if (c.outcome === 'crew-won') for (const p of room.players) if (p.id !== c.imposterId) add(p.id, CREW_WIN);
  }
  c.locked = true;
  room.history.push({
    emoji: '🕵️',
    answer: c.crewWord,
    impWord: c.impWord,
    imposterName: nameOf(room, c.imposterId),
    outcome: c.outcome,
  });
  room.phase = 'result';
  room.phaseEndsAt = now + ROUND_END_MS;
}

// ---------- Categories (Scattergories-style) ----------

export const CAT_UNIQUE = 100; // a valid answer nobody else gave
const CAT_RESULT_MS = 6_000;

function startCategories(room, q, now) {
  room.current = {
    q, // { letter, categories }
    step: 'write', // write -> review -> locked
    stepMs: MODES.categories.writeMs,
    answers: new Map(), // playerId -> string[] (latest draft; hidden until review)
    done: new Set(),
    vetoes: new Map(), // "playerId:index" -> Set(voterIds)
    ready: new Set(),
    results: null,
    locked: false,
  };
  room.phase = 'round';
  room.phaseEndsAt = now + MODES.categories.writeMs;
}

// "The Shining", "a Snake" -> checked as "shining", "snake"; plurals match singulars when comparing players.
const catWord = text => String(text ?? '').trim().replace(/^(the|a|an)\s+/i, '');
const catKey = text => normalize(catWord(text));
// Two answers are "the same" if they match exactly or one is a plural of the other (snake/snakes, cherry/cherries).
const sameAnswer = (x, y) => x === y || plurals(x).includes(y) || plurals(y).includes(x);

// Why an answer can't count before anyone votes on it (null = fine so far).
export function catProblem(text, letter) {
  const w = normalize(catWord(text));
  if (!w) return 'empty';
  if (w.length < 2) return 'too short';
  if (w[0] !== letter.toLowerCase()) return `doesn't start with ${letter}`;
  return null;
}

// Drafts are saved as players type, so whatever is there at the deadline counts. `done` locks your sheet.
export function submitCategoryAnswers(room, playerId, { answers, done } = {}, now = Date.now()) {
  const c = room.current;
  if (room.mode !== 'categories' || room.phase !== 'round' || c.locked || c.step !== 'write')
    return { ok: false, error: 'Answers are closed.' };
  if (!playerById(room, playerId)) return { ok: false, error: 'You are not in this game.' };
  if (c.done.has(playerId)) return { ok: false, error: 'You already handed in your answers.' };
  if (!Array.isArray(answers)) return { ok: false, error: 'Bad answers.' };
  c.answers.set(playerId, c.q.categories.map((_, i) => String(answers[i] ?? '').trim().slice(0, 30)));
  if (done) c.done.add(playerId);
  if (done && everyone(room, id => c.done.has(id))) { startReview(room, now); return { ok: true, ended: false }; }
  return { ok: true, ended: false };
}

function startReview(room, now) {
  const c = room.current;
  c.step = 'review';
  c.stepMs = MODES.categories.reviewMs;
  room.phaseEndsAt = now + c.stepMs;
}

// Review: 👎 someone else's answer (again to take it back).
export function vetoCategoryAnswer(room, voterId, { playerId, index } = {}) {
  const c = room.current;
  if (room.mode !== 'categories' || room.phase !== 'round' || c.locked || c.step !== 'review')
    return { ok: false, error: 'Voting is closed.' };
  if (!playerById(room, voterId) || voterId === playerId) return { ok: false, error: "You can't vote on your own answer." };
  const text = c.answers.get(playerId)?.[index];
  if (text === undefined || catProblem(text, c.q.letter)) return { ok: false, error: 'Nothing to vote on there.' };
  const key = `${playerId}:${index}`;
  const set = c.vetoes.get(key) ?? new Set();
  set.has(voterId) ? set.delete(voterId) : set.add(voterId);
  c.vetoes.set(key, set);
  return { ok: true, ended: false };
}

export function readyCategories(room, playerId, now = Date.now()) {
  const c = room.current;
  if (room.mode !== 'categories' || room.phase !== 'round' || c.locked || c.step !== 'review')
    return { ok: false, error: 'Nothing to confirm right now.' };
  if (!playerById(room, playerId)) return { ok: false, error: 'You are not in this game.' };
  c.ready.add(playerId);
  if (everyone(room, id => c.ready.has(id))) { scoreCategories(room, now); return { ok: true, ended: true }; }
  return { ok: true, ended: false };
}

// A vetoed answer is out when at least half of the other connected players 👎 it.
function vetoedOut(room, playerId, index) {
  const others = room.players.filter(p => p.connected && p.id !== playerId).length;
  const votes = room.current.vetoes.get(`${playerId}:${index}`)?.size ?? 0;
  return others > 0 && votes >= Math.ceil(others / 2);
}

function scoreCategories(room, now) {
  const c = room.current;
  const { letter, categories } = c.q;
  const results = {}; // playerId -> [{ text, status: unique|shared|invalid|empty, reason, points }]
  categories.forEach((_, i) => {
    const entries = room.players.map(p => {
      const text = c.answers.get(p.id)?.[i] ?? '';
      const problem = catProblem(text, letter);
      const status = problem === 'empty' ? 'empty' : problem ? 'invalid' : vetoedOut(room, p.id, i) ? 'invalid' : 'ok';
      return { p, text, status, reason: problem && problem !== 'empty' ? problem : status === 'invalid' ? 'voted out' : null };
    });
    const valid = entries.filter(e => e.status === 'ok');
    for (const e of valid) e.shared = valid.some(o => o !== e && sameAnswer(catKey(o.text), catKey(e.text)));
    for (const e of entries) {
      if (e.status === 'ok') e.status = e.shared ? 'shared' : 'unique';
      const points = e.status === 'unique' ? CAT_UNIQUE : 0;
      e.p.score += points;
      (results[e.p.id] ??= []).push({ text: e.text, status: e.status, reason: e.reason, points });
    }
  });
  c.results = results;
  c.locked = true;
  room.history.push({
    emoji: '🔠',
    answer: letter,
    letter,
    players: room.players.map(p => ({ name: p.name, points: (results[p.id] ?? []).reduce((n, r) => n + r.points, 0) })),
  });
  room.phase = 'result';
  room.phaseEndsAt = now + CAT_RESULT_MS;
}

export const categorySync = (room, playerId) =>
  room.mode === 'categories' && room.current ? { answers: room.current.answers.get(playerId) ?? null, done: room.current.done.has(playerId) } : {};

// ---------- shared: someone dropped or left mid-round ----------

// Returns true if this ended the round. Callers re-arm the timer either way (a step may have moved on).
export function playerGone(room, playerId, now = Date.now()) {
  const c = room.current;
  if (room.phase !== 'round' || !c || c.locked) return false;
  const stillHere = !!playerById(room, playerId);
  if (c.solved?.length) {
    // Quiz modes: end the word if everyone still here has now solved it
    if (everyone(room, id => c.solved.some(s => s.id === id))) { endWord(room, now); return true; }
    return false;
  }
  if (room.mode === 'categories') {
    if (c.step === 'write' && everyone(room, id => c.done.has(id))) { startReview(room, now); return false; }
    if (c.step === 'review' && everyone(room, id => c.ready.has(id))) { scoreCategories(room, now); return true; }
    return false;
  }
  if (isDraw(room)) return drawerGone(room, playerId, now) || checkAllGuessed(room, now);
  if (isRelay(room)) {
    if (c.step === 'draw' && c.drawerId === playerId) { nextLeg(room, now); return c.locked; }
    return checkAllGuessed(room, now);
  }
  if (room.mode === 'imposter') {
    if (!stillHere && playerId === c.imposterId) { finishImposter(room, now, 'imposter-left'); return true; }
    if (clueGiver(c) === playerId) { nextClue(room, now); return false; }
    if (c.step === 'vote') {
      if (!stillHere) {
        c.votes.delete(playerId);
        for (const [v, t] of c.votes) if (t === playerId) c.votes.delete(v);
      }
      return allVoted(room) && countVotes(room, now);
    }
    if (c.step === 'guess' && playerId === c.imposterId) { finishImposter(room, now); return true; }
  }
  return false;
}

function endWord(room, now) {
  const c = room.current;
  c.locked = true;
  room.history.push({
    emoji: c.q.emoji,
    answer: c.q.answer,
    solvers: c.solved.map(({ id, name, points }) => ({ id, name, points })),
  });
  room.phase = 'result';
  room.phaseEndsAt = now + (isRoundEnd(room) ? ROUND_END_MS : RESULT_MS);
}

// Correct answer number n (0-based) gets pointsFor(n).
function award(room, player) {
  const c = room.current;
  const points = pointsFor(c.solved.length);
  player.score += points;
  c.solved.push({ id: player.id, name: player.name, points });
  return points;
}
const everyone = (room, has) => room.players.filter(p => p.connected).every(p => has(p.id));

function endTurn(room, now) {
  const c = room.current;
  c.locked = true;
  const artistId = isRelay(room) ? c.starterId : c.drawerId; // who knew the word
  const drawer = playerById(room, artistId);
  const guessedIds = new Set(c.guessed.map(g => g.id));
  const eligible = room.players.filter(p => p.id !== artistId && (p.connected || guessedIds.has(p.id))).length;
  c.drawerPoints = eligible ? Math.round((DRAWER_MAX * c.guessed.length) / eligible) : 0;
  if (drawer) drawer.score += c.drawerPoints;
  room.history.push({
    emoji: c.q.emoji,
    answer: c.q.answer,
    drawerName: isRelay(room) ? c.chain.map(id => nameOf(room, id)).join(' → ') : drawer?.name ?? 'Someone',
    guessers: c.guessed.map(g => g.name),
    drawerPoints: c.drawerPoints,
  });
  room.phase = 'result';
  room.phaseEndsAt = now + ROUND_END_MS;
}

// Picture / Letters / Classic. Node handles socket events one at a time, so correct answers are ranked in the exact
// order they reach the server: 100, 75, 50... Each player scores once per word. The word ends when everyone has it
// (or at the deadline, see wordTimeUp). `guesses` may be one string or several (voice input sends alternatives).
export function submitAnswer(room, playerId, guesses, now = Date.now()) {
  const c = room.current;
  if (!['text', 'boxes'].includes(modeOf(room).input)) return { correct: false, reason: 'closed' };
  if (room.phase !== 'round' || !c || c.locked) return { correct: false, reason: 'closed' };
  const player = room.players.find(p => p.id === playerId);
  if (!player) return { correct: false, reason: 'closed' };
  if (c.solved.some(s => s.id === playerId)) return { correct: false, reason: 'done' };
  const list = (Array.isArray(guesses) ? guesses : [guesses]).slice(0, 5);
  if (!list.some(g => isCorrect(g, c))) return { correct: false };
  const points = award(room, player);
  const word = c.q.answer;
  if (everyone(room, id => c.solved.some(s => s.id === id))) {
    endWord(room, now);
    return { correct: true, points, word, ended: true };
  }
  if (c.overtime && !c.lastCall) { c.lastCall = true; room.phaseEndsAt = now + LAST_CALL_MS; }
  return { correct: true, points, word, ended: false };
}


// Draw & Guess / Relay. Everyone who doesn't know the word can guess until they get it; points shrink with each
// correct guesser. Relay only takes guesses once every leg is drawn.
export function submitDrawGuess(room, playerId, text, now = Date.now()) {
  const c = room.current;
  if (!usesCanvas(room) || room.phase !== 'round' || !c || c.locked) return { correct: false, reason: 'closed' };
  if (isRelay(room) && c.step !== 'guess') return { correct: false, reason: 'closed' };
  if (playerId === (isRelay(room) ? c.starterId : c.drawerId)) return { correct: false, reason: 'drawer' };
  if (c.guessed.some(g => g.id === playerId)) return { correct: false, reason: 'done' };
  const player = room.players.find(p => p.id === playerId);
  const guess = String(text ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
  if (!player || !guess) return { correct: false, reason: 'closed' };
  if (!isCorrect(guess, c)) {
    c.guesses.push({ name: player.name, text: guess, correct: false });
    if (c.guesses.length > 50) c.guesses.shift();
    return { correct: false };
  }
  const points = pointsFor(c.guessed.length);
  player.score += points;
  c.guessed.push({ id: player.id, name: player.name, points });
  c.guesses.push({ name: player.name, text: null, correct: true });
  return { correct: true, points, word: c.q.answer, ended: checkAllGuessed(room, now) };
}

// Ends the turn once every connected guesser has it. Also called when a guesser disconnects or leaves.
export function checkAllGuessed(room, now = Date.now()) {
  const c = room.current;
  if (!usesCanvas(room) || room.phase !== 'round' || c.locked || (isRelay(room) && c.step !== 'guess')) return false;
  const knower = isRelay(room) ? c.starterId : c.drawerId;
  const guessedIds = new Set(c.guessed.map(g => g.id));
  if (!room.players.filter(p => p.id !== knower && p.connected).every(p => guessedIds.has(p.id))) return false;
  endTurn(room, now);
  return true;
}

// The drawer disconnected or left: end their turn right away so the game moves on.
export function drawerGone(room, playerId, now = Date.now()) {
  if (!isDraw(room) || room.phase !== 'round' || room.current.locked || room.current.drawerId !== playerId) return false;
  endTurn(room, now);
  return true;
}

// Timer ran out. Overtime modes keep the word open; Classic and Draw & Guess end it; Relay and Odd One Out move to
// their next step (with a new deadline). Returns true if the round ended.
export function wordTimeUp(room, now = Date.now()) {
  if (room.phase !== 'round') return false;
  const c = room.current;
  if (isDraw(room)) { endTurn(room, now); return true; }
  if (isRelay(room)) {
    if (c.step === 'draw') { nextLeg(room, now); return c.locked; }
    endTurn(room, now);
    return true;
  }
  if (room.mode === 'categories') {
    if (c.step === 'write') { startReview(room, now); return false; }
    scoreCategories(room, now);
    return true;
  }
  if (room.mode === 'imposter') {
    if (c.step === 'clue') {
      c.clues.push({ id: clueGiver(c), name: nameOf(room, clueGiver(c)), text: null }); // ran out of time: no clue
      nextClue(room, now);
      return false;
    }
    if (c.step === 'vote') return countVotes(room, now);
    finishImposter(room, now); // guess step: no answer in time
    return true;
  }
  // Quiz modes: if anyone has it, the word is done. If nobody does, Picture/Letters pause (overtime) and Classic /
  // Character Quiz move on.
  if (c.solved.length || !modeOf(room).overtime) { endWord(room, now); return true; }
  c.overtime = true;
  return false;
}

// Only once the time is up, so a word can't be skipped before anyone had a real go.
export function skipWord(room, now = Date.now()) {
  if (!modeOf(room).overtime || room.phase !== 'round' || !room.current.overtime) return false;
  endWord(room, now);
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

// Canvas: only the current drawer (Relay: whoever has this leg), only while drawing. Coordinates are 0..1 so any
// canvas size works. Returns the cleaned segments to relay, or null to drop the message.
export function addStrokes(room, playerId, segments) {
  const c = room.current;
  if (!usesCanvas(room) || room.phase !== 'round' || c.locked || !c.drawerId || c.drawerId !== playerId || !Array.isArray(segments)) return null;
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

// Relay has no Clear: a leg can't wipe what the others drew.
// What a player may see privately: the drawer (Relay: the starter) and anyone who already guessed it get the word.
export function drawSync(room, playerId) {
  const c = room.current;
  if (!usesCanvas(room) || !c) return { strokes: [], word: null };
  const knows = c.locked || (isRelay(room) ? c.starterId : c.drawerId) === playerId || c.guessed.some(g => g.id === playerId);
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

// Room leaderboard, by player name so it survives leaving and rejoining. Every mode now scores in points.
export function leaderboard(records) {
  const by = new Map();
  for (const r of records) {
    for (const p of r.players) {
      const e = by.get(p.name) ?? { name: p.name, games: 0, wins: 0, points: 0, best: 0 };
      e.games++;
      e.points += p.score;
      e.best = Math.max(e.best, p.score);
      if (r.winners.includes(p.name)) e.wins++;
      by.set(p.name, e);
    }
  }
  return [...by.values()].sort((a, b) => b.wins - a.wins || b.points - a.points || b.best - a.best);
}

export function toLobby(room) {
  room.phase = 'lobby';
  room.wordNo = 0;
  room.current = null;
  room.history = [];
  room.turns = [];
  room.imposterOrder = [];
  room.players.forEach(p => (p.score = 0));
}

function publicCurrent(room) {
  const c = room.current;
  if (!c) return null;
  const counted = c.locked || (c.step && c.step !== 'clue' && c.step !== 'vote');
  if (room.mode === 'categories') {
    const shown = c.step === 'review' || c.locked; // nobody sees anyone's sheet while writing
    const sheets = shown ? Object.fromEntries(room.players.map(p => [p.id, c.answers.get(p.id) ?? c.q.categories.map(() => '')])) : null;
    return {
      step: c.locked ? 'reveal' : c.step,
      stepMs: c.stepMs,
      letter: c.q.letter,
      categories: c.q.categories,
      done: [...c.done],
      ready: [...c.ready],
      answers: sheets,
      problems: shown ? Object.fromEntries(Object.entries(sheets).map(([id, list]) => [id, list.map(t => catProblem(t, c.q.letter))])) : null,
      vetoes: shown ? [...c.vetoes].map(([key, set]) => { const [playerId, index] = key.split(':'); return { playerId, index: +index, by: [...set] }; }) : null,
      results: c.results,
    };
  }
  if (room.mode === 'imposter') {
    return {
      step: c.locked ? 'reveal' : c.step,
      stepMs: c.stepMs,
      clueOrder: c.clueOrder.map(id => ({ id, name: nameOf(room, id) })),
      clueGiverId: clueGiver(c),
      clues: c.clues,
      voted: [...c.votes.keys()], // who has voted, not for whom
      votes: counted ? [...c.votes].map(([from, to]) => ({ from, to })) : null,
      accusedId: counted ? c.accusedId : null,
      // The imposter is revealed once caught (they get their last guess) or at the end of the round.
      imposterId: counted && (c.caught || c.locked) ? c.imposterId : null,
      imposterName: counted && (c.caught || c.locked) ? nameOf(room, c.imposterId) : null,
      crewWord: c.locked ? c.crewWord : null,
      impWord: c.locked ? c.impWord : null,
      imposterGuess: c.locked ? c.imposterGuess : null,
      outcome: c.locked ? c.outcome : null,
      points: c.locked ? c.points : null,
      answer: c.locked ? c.crewWord : null,
    };
  }
  if (isRelay(room)) {
    return {
      step: c.step,
      stepMs: c.stepMs,
      starterId: c.starterId,
      starterName: nameOf(room, c.starterId),
      chain: c.chain.map(id => ({ id, name: nameOf(room, id) })),
      leg: c.leg,
      drawerId: c.drawerId,
      drawerName: c.drawerId ? nameOf(room, c.drawerId) : null,
      guessed: c.guessed,
      guesses: c.guesses.slice(-20),
      drawerPoints: c.locked ? c.drawerPoints : null,
      answer: c.locked ? c.q.answer : null,
      emoji: c.locked ? c.q.emoji : null,
    };
  }
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
    lastCall: c.lastCall,
    solved: c.solved, // who got it, in order, with points (not what they typed)
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
    minPlayers: minPlayersFor(room),
    maxPlayers: MAX_PLAYERS,
    remainingMs: Math.max(0, room.phaseEndsAt - now),
    players: room.players.map(({ id, name, score, connected }) => ({ id, name, score, connected })),
    history: room.history,
    records: room.records.slice(0, 10),
    leaderboard: leaderboard(room.records),
    current: publicCurrent(room),
  };
}
