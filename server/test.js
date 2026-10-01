// Self-check for the game rules. Run: npm test
import assert from 'node:assert/strict';
import { POOL } from './questions.js';
import { DRAW_POOL } from './drawWords.js';
import * as G from './game.js';

// Pool: big, unique, well-formed
assert.ok(POOL.length >= 200, `pool has ${POOL.length} questions`);
for (const key of ['id', 'answer', 'emoji', 'hint'])
  assert.equal(new Set(POOL.map(q => q[key])).size, POOL.length, `duplicate ${key} in pool`);
for (const q of POOL) {
  assert.match(q.answer, /^[A-Z]+( [A-Z]+)*$/, q.id);
  assert.ok(q.answer.replace(/ /g, '').length >= 3, `${q.id} too short`);
  assert.ok(!q.hint.toUpperCase().includes(q.answer), `${q.id} hint gives the answer away`);
}

// Answer matching: case/spacing, articles and plurals from voice input, missing letters, but not near-misses
{
  const c = { q: { answer: 'FIRE TRUCK' }, missing: 'RU' };
  for (const ok of ['fire truck', 'FIRETRUCK', ' Fire-Truck ', 'a fire truck', 'the fire trucks', 'ru'])
    assert.ok(G.isCorrect(ok, c), ok);
  for (const bad of ['fire', 'truck', '', 'fire tuck']) assert.ok(!G.isCorrect(bad, c), bad);
  assert.ok(!G.isCorrect('bu', { q: { answer: 'BUS' }, missing: null }), 'plural leniency must not accept "bu"');
  assert.ok(G.isCorrect('sock', { q: { answer: 'SOCKS' }, missing: null }));
  assert.ok(G.isCorrect('cherries', { q: { answer: 'CHERRY' }, missing: null }));
  assert.ok(G.isCorrect('cherry', { q: { answer: 'CHERRIES' }, missing: null }));
}

// Patterns: same length, first letter + spaces kept, at least one hidden
for (const q of POOL) for (const ratio of [0.35, 0.5, 0.65, 0.4]) {
  const p = G.makePattern(q.answer, ratio);
  assert.equal(p.length, q.answer.length);
  assert.equal(p[0], q.answer[0]);
  assert.ok(p.includes('_'));
  p.forEach((c, i) => q.answer[i] === ' ' && assert.equal(c, ' '));
}

// Letters mode gets harder each round, whatever the number of rounds; Classic stays level
{
  const L = G.MODES.letters;
  const hidden = [1, 2, 3].map(r => G.makePattern('STRAWBERRY', G.hideRatio(L, r, 3)).filter(c => c === '_').length);
  assert.ok(hidden[0] < hidden[1] && hidden[1] < hidden[2], `hidden per round: ${hidden}`);
  const r6 = [1, 2, 3, 4, 5, 6].map(r => G.hideRatio(L, r, 6));
  assert.ok(r6.every((v, i) => i === 0 || v > r6[i - 1]) && r6[0] === 0.35 && Math.abs(r6[5] - 0.65) < 1e-9);
  assert.equal(G.hideRatio(L, 1, 1), 0.5);
  assert.equal(G.hideRatio(G.MODES.classic, 7, 10), 0.4);
}

// Rounds setting: per mode, host-chosen, bounded, only between games, and it sizes the game
{
  const room = G.createRoom('RNDS');
  const ps = ['A', 'B', 'C'].map(n => G.addPlayer(room, n));
  ps.forEach(p => (p.connected = true));
  for (const [mode, n, words] of [['picture', 5, 15], ['letters', 1, 3], ['classic', 7, 7], ['draw', 2, 6]]) {
    G.setMode(room, mode);
    assert.equal(G.setRounds(room, 0), false);
    assert.equal(G.setRounds(room, G.MODES[mode].maxRounds + 1), false);
    assert.equal(G.setRounds(room, 2.5), false);
    assert.ok(G.setRounds(room, n));
    assert.equal(G.publicState(room).modeInfo.rounds, mode === 'draw' ? 6 : n);
    G.startGame(room);
    assert.equal(room.questions.length, words, mode);
    assert.equal(G.setRounds(room, 1), false, 'changed mid-game');
    G.toLobby(room);
  }
  // each mode remembers its own setting
  G.setMode(room, 'picture');
  assert.equal(G.publicState(room).roundsSetting, 5);
  G.setMode(room, 'classic');
  assert.equal(G.publicState(room).roundsSetting, 7);
}

// Draw & Guess word list: unique, drawable-length words
assert.ok(DRAW_POOL.length >= 150, `draw pool has ${DRAW_POOL.length} words`);
assert.equal(new Set(DRAW_POOL.map(q => q.answer)).size, DRAW_POOL.length, 'duplicate draw word');
for (const q of DRAW_POOL) assert.match(q.answer, /^[A-Z]{3,}( [A-Z]+)*$/, q.id);

// No repetition: within a game, between consecutive games, and not at all until the pool is used up (both decks)
for (const [deckName, perGame] of [['quiz', [9, 4]], ['draw', [6, 3]]]) {
  const room = G.createRoom('TEST');
  const deck = room.decks[deckName];
  const seen = new Set();
  const gamesBeforeRefill = Math.floor(deck.pool.length / Math.max(...perGame));
  let prev = [];
  for (let game = 0; game < gamesBeforeRefill * 3; game++) {
    const qs = G.drawFrom(deck, perGame[game % 2]);
    const ids = qs.map(q => q.id);
    assert.equal(new Set(ids).size, ids.length, `${deckName}: repeat inside a game`);
    assert.ok(ids.every(id => !prev.includes(id)), `${deckName}: repeat from the previous game`);
    if (game < gamesBeforeRefill) ids.forEach(id => { assert.ok(!seen.has(id), `${id} reused early`); seen.add(id); });
    prev = ids;
  }
}

function newGame(mode, names = ['A', 'B']) {
  const room = G.createRoom(mode.toUpperCase());
  const ps = names.map(n => G.addPlayer(room, n));
  ps.forEach(p => (p.connected = true));
  assert.ok(G.setMode(room, mode));
  G.startGame(room);
  return { room, ps };
}

// Picture mode: no pattern, answer hidden, voice alternatives, hint only when everyone asks, overtime + skip
{
  const { room, ps: [a, b] } = newGame('picture');
  assert.equal(room.questions.length, 9);
  const s = G.publicState(room).current;
  assert.equal(s.pattern, null);
  assert.equal(s.answer, null, 'answer leaked while word open');
  assert.equal(s.hint, null);
  assert.ok(s.emoji);

  G.voteHint(room, a.id);
  assert.equal(G.publicState(room).current.hint, null, 'hint shown before everyone agreed');
  G.voteHint(room, b.id);
  assert.equal(G.publicState(room).current.hint, room.current.q.hint);

  // Race: B wrong, then A and B both right -> only A scores
  assert.deepEqual(G.submitAnswer(room, b.id, 'definitely wrong'), { correct: false });
  assert.equal(G.submitAnswer(room, a.id, ['something else', 'the ' + room.current.q.answer.toLowerCase()]).correct, true);
  assert.equal(G.submitAnswer(room, b.id, room.current.q.answer).correct, false);
  assert.deepEqual([a.score, b.score], [1, 0]);

  // Word 2: the hint also appears when the only player not asking disconnects
  G.nextWord(room);
  G.voteHint(room, a.id);
  b.connected = false;
  G.checkHint(room);
  assert.ok(G.publicState(room).current.hint);
  b.connected = true;
  assert.equal(G.submitAnswer(room, a.id, room.current.q.answer).correct, true);

  // Word 3: time up -> paused, not ended; still winnable. Skip not allowed before time is up.
  G.nextWord(room);
  assert.equal(G.skipWord(room), false);
  assert.equal(G.wordTimeUp(room), false);
  assert.equal(room.phase, 'round');
  assert.equal(G.submitAnswer(room, b.id, room.current.q.answer).correct, true);

  // Word 4 (round 2): skipped in overtime -> nobody scores
  G.nextWord(room);
  assert.equal(G.publicState(room).round, 2);
  G.wordTimeUp(room);
  assert.equal(G.skipWord(room), true);
  assert.deepEqual([a.score, b.score], [2, 1]);
  assert.deepEqual(room.history.map(h => h.winnerName), ['A', 'A', 'B', null]);
}

// Letters mode: pattern but no picture until the word is over; hints can't be requested
{
  const { room, ps: [a] } = newGame('letters');
  const s = G.publicState(room).current;
  assert.ok(s.pattern.includes('_'));
  assert.equal(s.emoji, null, 'picture shown in Letters mode');
  assert.equal(G.voteHint(room, a.id), false);
  assert.equal(G.submitAnswer(room, a.id, room.current.missing).correct, true);
  assert.ok(G.publicState(room).current.emoji, 'picture revealed after the word');
}

// Classic mode: 4 rounds of 1 word, hint + category shown, time-up ends the word with no point
{
  const { room, ps: [a] } = newGame('classic');
  assert.equal(room.questions.length, 4);
  const s = G.publicState(room).current;
  assert.ok(s.hint && s.category && s.pattern && s.emoji);
  assert.equal(G.wordTimeUp(room), true);
  assert.equal(room.phase, 'result');
  assert.equal(G.submitAnswer(room, a.id, room.current.q.answer).correct, false);
  G.nextWord(room);
  assert.equal(G.publicState(room).round, 2);
}

// 3 players all answer correctly: exactly one point is handed out
{
  const { room, ps } = newGame('picture', ['A', 'B', 'C']);
  const results = ps.map(p => G.submitAnswer(room, p.id, room.current.q.answer).correct);
  assert.deepEqual(results, [true, false, false]);
  assert.deepEqual(ps.map(p => p.score), [1, 0, 0]);
}

// Draw & Guess: rotation, secret word only for the drawer, scoring, early end, disconnects
{
  const { room, ps: [a, b, c, d] } = (() => {
    const room = G.createRoom('DRAW');
    const ps = ['A', 'B', 'C', 'D'].map(n => G.addPlayer(room, n));
    ps.forEach(p => (p.connected = true));
    assert.ok(G.setMode(room, 'draw'));
    assert.ok(G.setRounds(room, 2));
    assert.equal(G.setRounds(room, 6), false);
    G.startGame(room);
    return { room, ps };
  })();
  // A -> B -> C -> D -> A -> B -> C -> D
  assert.deepEqual(room.turns, [a, b, c, d, a, b, c, d].map(p => p.id));
  assert.equal(room.questions.length, 8);
  assert.equal(G.publicState(room).modeInfo.rounds, 8);

  // Turn 1, A draws. Nothing public reveals the word; only the drawer's sync does.
  const word = room.current.q.answer;
  assert.ok(!JSON.stringify(G.publicState(room)).includes(word), 'secret word in public state');
  assert.equal(G.drawSync(room, a.id).word, word);
  assert.equal(G.drawSync(room, b.id).word, null);

  // Strokes: only the drawer, cleaned; junk dropped
  assert.equal(G.addStrokes(room, b.id, [{ x: 0.1, y: 0.1, px: 0, py: 0, w: 0.01, c: '#000000', t: 'pen' }]), null);
  assert.equal(G.addStrokes(room, a.id, [{ x: 2, y: 0, px: 0, py: 0, w: 0.01, c: '#000000', t: 'pen' }]), null);
  assert.equal(G.addStrokes(room, a.id, [{ x: 0.5, y: 0.5, px: 0.4, py: 0.4, w: 0.01, c: '#ff0000', t: 'pen', extra: 'x' }]).length, 1);
  assert.equal(room.current.strokes.length, 1);
  assert.ok(G.clearStrokes(room, a.id));
  assert.equal(room.current.strokes.length, 0);

  // Guessing: drawer can't; wrong goes to the feed; 1st/2nd get 100/75; can't guess twice; text not leaked
  assert.equal(G.submitDrawGuess(room, a.id, word).reason, 'drawer');
  assert.deepEqual(G.submitDrawGuess(room, b.id, 'zzzz'), { correct: false });
  assert.equal(G.submitDrawGuess(room, c.id, ` ${word.toLowerCase()} `).points, 100);
  assert.equal(G.drawSync(room, c.id).word, word, 'correct guesser may now see the word');
  assert.equal(G.submitDrawGuess(room, c.id, word).reason, 'done');
  assert.equal(G.submitDrawGuess(room, b.id, word).points, 75);
  assert.ok(!JSON.stringify(G.publicState(room).current.guesses).includes(word), 'correct guess text leaked');
  // D is the last guesser: when D disconnects, everyone left has guessed -> turn ends.
  // Drawer share counts only guessers still there (2 of 2) -> full 100.
  d.connected = false;
  assert.equal(G.checkAllGuessed(room), true);
  assert.equal(room.phase, 'result');
  assert.equal(G.publicState(room).current.answer, word);
  assert.deepEqual([a.score, b.score, c.score, d.score], [100, 75, 100, 0]);

  // Turn 2 (B draws) — D is still away. B disconnects -> turn ends at once with no points.
  assert.ok(G.advance(room));
  assert.equal(room.current.drawerId, b.id);
  assert.equal(G.drawerGone(room, b.id), true);
  assert.equal(room.current.drawerPoints, 0);

  // Turn 3 C draws; turn 4 is D's, but D is away -> skipped straight to A
  b.connected = true;
  assert.ok(G.advance(room));
  assert.equal(room.current.drawerId, c.id);
  assert.equal(G.wordTimeUp(room), true); // timer runs out: turn ends
  assert.ok(G.advance(room));
  assert.equal(room.current.drawerId, a.id);
  assert.equal(room.wordNo, 5);

  // Play the rest out; the game ends and is recorded
  while (G.wordTimeUp(room) && G.advance(room));
  G.finishGame(room);
  assert.equal(room.records[0].mode, 'draw');
  assert.equal(G.leaderboard(room.records).find(e => e.name === 'C').drawBest, 100);

  // Play Again: none of the previous game's words come back
  const before = new Set(room.questions.map(q => q.id));
  G.startGame(room);
  assert.ok(room.questions.every(q => !before.has(q.id)));
}

// Room records + leaderboard across games (by name): ties give both a win, all-zero gives none
{
  const room = G.createRoom('LEAD');
  const [a, b] = ['Ann', 'Ben'].map(n => G.addPlayer(room, n));
  const play = (sa, sb) => { a.score = sa; b.score = sb; G.finishGame(room); };
  play(5, 3);
  play(2, 2);
  play(0, 0);
  play(1, 4);
  assert.equal(room.records.length, 4);
  assert.deepEqual(room.records[1].winners, []); // newest first: the 0-0 game
  assert.deepEqual(room.records[2].winners, ['Ann', 'Ben']);
  assert.deepEqual(G.leaderboard(room.records), [
    { name: 'Ben', games: 4, wins: 2, words: 9, best: 4, drawBest: 0 },
    { name: 'Ann', games: 4, wins: 2, words: 8, best: 5, drawBest: 0 },
  ]);
  assert.equal(G.setMode(room, 'nope'), false);
}

console.log(`All checks passed (${POOL.length} questions).`);
