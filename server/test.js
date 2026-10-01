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
  for (const [mode, n, words] of [['picture', 5, 15], ['letters', 1, 3], ['classic', 7, 7], ['draw', 2, 6], ['categories', 4, 4]]) {
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

  // Points in answer order: B wrong (0), A right (100, word stays open for B), A again (no double score), B right (75)
  const answer = room.current.q.answer;
  assert.deepEqual(G.submitAnswer(room, b.id, 'definitely wrong'), { correct: false });
  const ra = G.submitAnswer(room, a.id, ['something else', 'the ' + answer.toLowerCase()]);
  assert.deepEqual([ra.correct, ra.points, ra.word, ra.ended], [true, 100, answer, false]);
  assert.equal(room.phase, 'round', 'first correct answer must not end the word any more');
  assert.equal(G.publicState(room).current.answer, null, 'answer revealed to the others after the first solve');
  assert.deepEqual(G.publicState(room).current.solved.map(x => [x.name, x.points]), [['A', 100]]);
  assert.equal(G.submitAnswer(room, a.id, answer).reason, 'done');
  const rb = G.submitAnswer(room, b.id, answer);
  assert.deepEqual([rb.points, rb.ended], [75, true], 'everyone solved -> word over');
  assert.deepEqual([a.score, b.score], [100, 75]);

  // Word 2: the hint also appears when the only player not asking disconnects; time up with a solver ends the word
  G.nextWord(room);
  G.voteHint(room, a.id);
  b.connected = false;
  G.checkHint(room);
  assert.ok(G.publicState(room).current.hint);
  b.connected = true;
  assert.equal(G.submitAnswer(room, a.id, room.current.q.answer).ended, false);
  assert.equal(G.wordTimeUp(room), true, 'someone has it -> time up ends the word');

  // Word 3: nobody by the deadline -> paused; a solve during the pause gives the others a 5 s last call
  G.nextWord(room);
  assert.equal(G.skipWord(room), false);
  assert.equal(G.wordTimeUp(room, 1000), false);
  assert.equal(room.phase, 'round');
  assert.equal(G.publicState(room).current.overtime, true);
  assert.equal(G.submitAnswer(room, b.id, room.current.q.answer, 5000).ended, false);
  assert.equal(room.phaseEndsAt, 5000 + G.LAST_CALL_MS);
  assert.equal(G.publicState(room).current.lastCall, true);
  assert.equal(G.wordTimeUp(room), true, 'last call over -> word ends');

  // Word 4 (round 2): skipped in overtime -> nobody scores
  G.nextWord(room);
  assert.equal(G.publicState(room).round, 2);
  G.wordTimeUp(room);
  assert.equal(G.skipWord(room), true);
  assert.deepEqual([a.score, b.score], [200, 175]); // A: 100 + 100, B: 75 + 100
  assert.deepEqual(room.history.map(h => h.solvers.map(x => x.name).join()), ['A,B', 'A', 'B', '']);
}

// Letters mode: pattern but no picture until the word is over; hints can't be requested
{
  const { room, ps: [a, b] } = newGame('letters');
  const s = G.publicState(room).current;
  assert.ok(s.pattern.includes('_'));
  assert.equal(s.emoji, null, 'picture shown in Letters mode');
  assert.equal(G.voteHint(room, a.id), false);
  assert.equal(G.submitAnswer(room, a.id, room.current.missing).points, 100);
  assert.equal(G.publicState(room).current.emoji, null, 'picture shown while B is still guessing');
  assert.equal(G.submitAnswer(room, b.id, room.current.q.answer).points, 75);
  assert.ok(G.publicState(room).current.emoji, 'picture revealed after the word');
}

// Classic mode: 4 rounds of 1 word, hint + category shown, time-up with nobody right ends the word with no points
{
  const { room, ps: [a] } = newGame('classic');
  assert.equal(room.questions.length, 4);
  const s = G.publicState(room).current;
  assert.ok(s.hint && s.category && s.pattern && s.emoji);
  assert.equal(G.wordTimeUp(room), true);
  assert.equal(room.phase, 'result');
  assert.equal(G.submitAnswer(room, a.id, room.current.q.answer).correct, false);
  assert.equal(a.score, 0);
  G.nextWord(room);
  assert.equal(G.publicState(room).round, 2);
}

// 4 players answer correctly in a row: 100, 75, 50, 25 (the server's arrival order decides)
{
  const { room, ps } = newGame('classic', ['A', 'B', 'C', 'D']);
  const answer = room.current.q.answer;
  const pts = [ps[2], ps[0], ps[3], ps[1]].map(p => G.submitAnswer(room, p.id, answer).points);
  assert.deepEqual(pts, [100, 75, 50, 25]);
  assert.deepEqual(ps.map(p => p.score), [75, 25, 100, 50]);
  assert.equal(room.phase, 'result');
  assert.deepEqual([4, 5, 6, 9].map(G.pointsFor), [13, 10, 10, 10]);
}

// A quiz player who leaves can't hold the word open: if everyone left has it, it ends
{
  const { room, ps: [a, b, c] } = newGame('picture', ['A', 'B', 'C']);
  G.submitAnswer(room, a.id, room.current.q.answer);
  G.submitAnswer(room, b.id, room.current.q.answer);
  room.players = room.players.filter(p => p !== c);
  assert.equal(G.playerGone(room, c.id), true);
  assert.equal(room.phase, 'result');
}

// Categories: letter + category, private drafts, auto checks, vetoes, first valid answer wins
{
  const { CATEGORY_POOL, LETTERS } = await import('./categories.js');
  assert.ok(CATEGORY_POOL.length >= 2 * G.MODES.categories.maxRounds && !LETTERS.includes('Q') && !LETTERS.includes('X'));
  const { room, ps: [a, b, c] } = newGame('categories', ['A', 'B', 'C']);
  G.setMode(room, 'categories');
  assert.equal(room.questions.length, 5); // default 5 rounds
  assert.equal(new Set(room.questions.map(q => q.letter)).size, 5, 'letter repeated');
  assert.ok(room.questions.every(q => q.categories.length === 1), 'one category per round');
  const allCats = room.questions.flatMap(q => q.categories);
  assert.equal(new Set(allCats).size, allCats.length, 'category repeated within the game');
  // Long games back to back (15 rounds each): never a repeat inside a game, nor from the game before
  {
    const r2 = G.createRoom('LONG');
    ['A', 'B'].forEach(n => (G.addPlayer(r2, n).connected = true));
    G.setMode(r2, 'categories');
    assert.ok(G.setRounds(r2, 15));
    let prev = [];
    for (let game = 0; game < 6; game++) {
      G.startGame(r2);
      const cats = r2.questions.map(q => q.categories[0]);
      const letters = r2.questions.map(q => q.letter);
      assert.equal(new Set(cats).size, 15, `game ${game}: category repeated`);
      assert.equal(new Set(letters).size, 15, `game ${game}: letter repeated`);
      assert.ok(cats.every(x => !prev.includes(x)), `game ${game}: category from the previous game`);
      prev = cats;
      G.toLobby(r2);
    }
  }
  assert.equal(G.catProblem('  the Shining', 'S'), null);
  assert.equal(G.catProblem('Pizza', 'S'), "doesn't start with S");
  assert.equal(G.catProblem('', 'S'), 'empty');

  // Plays one round with a fixed letter/category. `hand` = [player, answer, done?] in arrival order.
  const round = (hand, vetoes = []) => {
    const cur = room.current;
    cur.q = { letter: 'S', categories: ['Animal'] };
    for (const [p, text, done = true] of hand) assert.ok(G.submitCategoryAnswers(room, p.id, { answers: [text], done }).ok);
    if (cur.step === 'write') assert.equal(G.wordTimeUp(room), false); // deadline: move to review
    assert.equal(cur.step, 'review');
    for (const [from, to] of vetoes) assert.ok(G.vetoCategoryAnswer(room, from.id, { playerId: to.id, index: 0 }).ok);
    const ready = [a, b, c].filter(p => p.connected).map(p => G.readyCategories(room, p.id));
    assert.equal(ready.at(-1).ended, true, 'everyone ready -> scored');
    return id => cur.results[id][0].status;
  };

  // Round 1: drafts are private; hand-in order is public, the answers are not.
  assert.ok(G.submitCategoryAnswers(room, c.id, { answers: ['Seal'] }).ok); // C only drafts
  assert.equal(G.publicState(room).current.answers, null, 'answers visible while writing');
  assert.ok(!JSON.stringify(G.publicState(room)).includes('Seal'));
  assert.equal(G.submitCategoryAnswers(room, b.id, { answers: ['Snake'], done: true }).place, 1);
  assert.equal(G.submitCategoryAnswers(room, b.id, { answers: ['x'] }).ok, false, 'edited after handing in');
  assert.deepEqual(G.publicState(room).current.done, [b.id]);
  let st = round([[a, 'Spider'], [c, 'Seal', false]]);
  // B was first with a valid answer -> only B scores; A was valid but slower; C never handed in -> ranked last
  assert.deepEqual([st(b.id), st(a.id), st(c.id)], ['winner', 'slower', 'slower']);
  assert.deepEqual([a.score, b.score, c.score], [0, G.CAT_WIN, 0]);
  assert.deepEqual(G.publicState(room).current.order.map(o => [o.id, o.late]), [[b.id, false], [a.id, false], [c.id, true]]);
  assert.equal(G.publicState(room).current.winnerId, b.id);
  assert.equal(room.history[0].winnerName, 'B');

  // Round 2: the fastest answer has the wrong letter, the 2nd is voted out (1 of 2 other players = half) -> the 3rd wins
  assert.ok(G.advance(room));
  st = round([[a, 'Python'], [b, 'Sloth'], [c, 'Swan']], [[c, b]]);
  assert.deepEqual([st(a.id), st(b.id), st(c.id)], ['invalid', 'invalid', 'winner']);
  assert.equal(room.current.results[b.id][0].reason, 'voted out');
  assert.deepEqual([a.score, b.score, c.score], [0, G.CAT_WIN, G.CAT_WIN]);

  // Round 3: a 👎 taken back doesn't count; nobody valid -> nobody scores
  assert.ok(G.advance(room));
  st = round([[a, 'Zebra'], [b, ''], [c, 'Shark']], [[a, c], [a, c]]);
  assert.deepEqual([st(a.id), st(b.id), st(c.id)], ['invalid', 'empty', 'winner']);
  assert.equal(G.vetoCategoryAnswer(room, a.id, { playerId: a.id, index: 0 }).ok, false, 'veto own answer');

  // Round 4: one player drops while writing -> once everyone still here has handed in, review starts
  assert.ok(G.advance(room));
  c.connected = false;
  G.submitCategoryAnswers(room, a.id, { answers: [], done: true });
  G.submitCategoryAnswers(room, b.id, { answers: [], done: true });
  assert.equal(room.current.step, 'review');
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
  assert.equal(G.leaderboard(room.records).find(e => e.name === 'C').best, room.records[0].players.find(p => p.name === 'C').score);

  // Play Again: none of the previous game's words come back
  const before = new Set(room.questions.map(q => q.id));
  G.startGame(room);
  assert.ok(room.questions.every(q => !before.has(q.id)));
}

// Odd One Out word pairs: every word used once
{
  const { IMPOSTER_POOL } = await import('./imposterPairs.js');
  const words = IMPOSTER_POOL.flatMap(q => [q.answer, q.alt]);
  assert.ok(IMPOSTER_POOL.length >= 80, `only ${IMPOSTER_POOL.length} pairs`);
  assert.equal(new Set(words).size, words.length, 'a word appears in two pairs');
}

function party(mode, names) {
  const room = G.createRoom(mode.toUpperCase());
  const ps = names.map(n => G.addPlayer(room, n));
  ps.forEach(p => (p.connected = true));
  assert.ok(G.setMode(room, mode));
  return { room, ps };
}

// Relay Draw: chain of legs, only the starter knows the word, no guessing until the end, no clearing
{
  const { room, ps: [a, b, c] } = party('relay', ['A', 'B', 'C']);
  G.setRounds(room, 3);
  G.startGame(room);
  assert.equal(room.questions.length, 3);
  let cur = room.current;
  assert.deepEqual(cur.chain, [a.id, b.id, c.id]);
  const word = cur.q.answer;
  assert.equal(G.drawSync(room, a.id).word, word, 'starter knows');
  assert.equal(G.drawSync(room, b.id).word, null, 'next drawer must not know');
  assert.ok(!JSON.stringify(G.publicState(room)).includes(word), 'word leaked');

  const seg = { x: 0.5, y: 0.5, px: 0.4, py: 0.4, w: 0.01, c: '#000000', t: 'pen' };
  assert.ok(G.addStrokes(room, a.id, [seg]), 'leg 1: A draws');
  assert.equal(G.addStrokes(room, b.id, [seg]), null, 'B waits for their leg');
  assert.equal(G.clearStrokes(room, a.id), false, 'no clearing in relay');
  assert.equal(G.submitDrawGuess(room, b.id, word).reason, 'closed', 'no guessing while drawing');

  assert.equal(G.wordTimeUp(room), false); // leg 1 over -> B
  assert.equal(cur.drawerId, b.id);
  assert.ok(G.addStrokes(room, b.id, [seg]));
  // C disconnects before their leg: B's leg ends -> C skipped -> guessing
  c.connected = false;
  assert.equal(G.wordTimeUp(room), false);
  assert.equal(cur.step, 'guess');
  assert.equal(cur.drawerId, null);
  assert.equal(G.addStrokes(room, b.id, [seg]), null, 'no drawing while guessing');
  assert.equal(G.submitDrawGuess(room, a.id, word).reason, 'drawer', 'starter cannot guess');
  const r = G.submitDrawGuess(room, b.id, word);
  assert.equal(r.points, 100);
  assert.equal(r.ended, true, 'only connected guesser got it -> round over');
  assert.equal(cur.drawerPoints, 100);
  assert.equal(room.history[0].drawerName, 'A → B → C');
  c.connected = true;

  // Round 2 starts with B; the starter gone mid-leg moves to the next leg
  assert.ok(G.advance(room));
  cur = room.current;
  assert.deepEqual(cur.chain, [b.id, c.id, a.id]);
  b.connected = false;
  assert.equal(G.playerGone(room, b.id), false);
  assert.equal(cur.drawerId, c.id);
  b.connected = true;
  // Guess timer runs out -> round ends
  G.wordTimeUp(room); // C's leg -> A
  G.wordTimeUp(room); // A's leg -> guessing
  assert.equal(cur.step, 'guess');
  assert.equal(G.wordTimeUp(room), true);
  assert.equal(room.phase, 'result');
}

// Odd One Out: secret words, clue rules, vote outcomes, last guess, scoring, departures
{
  const { room, ps } = party('imposter', ['A', 'B', 'C', 'D']);
  assert.equal(G.publicState(room).minPlayers, 3);
  G.setRounds(room, 4);
  G.startGame(room);
  assert.equal(room.questions.length, 4);
  const byId = id => ps.find(p => p.id === id);
  const playRound = () => {
    const c = room.current;
    const imp = byId(c.imposterId);
    const crew = ps.filter(p => p !== imp);
    return { c, imp, crew };
  };

  // Round 1: words are private and differ only for the imposter
  let { c, imp, crew } = playRound();
  assert.notEqual(c.crewWord, c.impWord);
  for (const p of crew) assert.equal(G.wordFor(room, p.id), c.crewWord);
  assert.equal(G.wordFor(room, imp.id), c.impWord);
  const pub = JSON.stringify(G.publicState(room));
  assert.ok(!pub.includes(c.crewWord) && !pub.includes(c.impWord), 'a word leaked');
  assert.equal(G.publicState(room).current.imposterId, null, 'imposter revealed early');

  // Clues: in order, one word, can't contain your word
  const giver = () => c.clueOrder[c.clueIdx];
  const notGiver = ps.find(p => p.id !== giver());
  assert.equal(G.submitClue(room, notGiver.id, 'hello').ok, false);
  assert.equal(G.submitClue(room, giver(), 'two words').ok, false);
  assert.equal(G.submitClue(room, giver(), G.wordFor(room, giver()).toLowerCase() + 's').ok, false);
  assert.ok(G.submitClue(room, giver(), 'tasty').ok);
  assert.equal(G.wordTimeUp(room), false); // 2nd clue-giver ran out of time
  assert.equal(c.clues[1].text, null);
  while (c.step === 'clue') assert.ok(G.submitClue(room, giver(), 'thing').ok);
  assert.equal(c.step, 'vote');

  // Vote: no self-votes; everyone votes the imposter -> caught -> last guess; wrong guess -> crew wins
  assert.equal(G.submitVote(room, crew[0].id, crew[0].id).ok, false);
  assert.equal(G.publicState(room).current.votes, null, 'votes visible before counting');
  for (const p of crew) assert.ok(G.submitVote(room, p.id, imp.id).ok);
  const last = G.submitVote(room, imp.id, crew[0].id);
  assert.equal(last.ended, false, 'caught -> guess step, not over yet');
  assert.equal(c.step, 'guess');
  assert.equal(G.publicState(room).current.imposterId, imp.id, 'caught imposter is revealed for the last guess');
  assert.equal(G.publicState(room).current.crewWord, null, "crew word not revealed during the imposter's guess");
  assert.equal(G.submitImposterGuess(room, crew[0].id, 'x').ok, false);
  assert.equal(G.submitImposterGuess(room, imp.id, 'zzzz').correct, false);
  assert.equal(c.outcome, 'crew-won');
  for (const p of crew) assert.equal(p.score, G.CREW_WIN + G.GOOD_VOTE);
  assert.equal(imp.score, 0);
  assert.equal(G.publicState(room).current.crewWord, c.crewWord);

  // Round 2: caught but guesses the crew word -> imposter +2
  assert.ok(G.advance(room));
  ({ c, imp, crew } = playRound());
  while (c.step === 'clue') G.wordTimeUp(room);
  for (const p of ps) G.submitVote(room, p.id, p === imp ? crew[0].id : imp.id);
  const before = imp.score;
  assert.equal(G.submitImposterGuess(room, imp.id, ' the ' + c.crewWord.toLowerCase()).correct, true);
  assert.equal(c.outcome, 'imposter-guessed');
  assert.equal(imp.score, before + G.IMPOSTER_STEALS);

  // Round 3: tie vote (2-2) -> nobody caught -> imposter escapes +3; vote timer counts partial votes
  assert.ok(G.advance(room));
  ({ c, imp, crew } = playRound());
  while (c.step === 'clue') G.wordTimeUp(room);
  G.submitVote(room, crew[0].id, crew[1].id);
  G.submitVote(room, crew[1].id, crew[0].id);
  G.submitVote(room, imp.id, crew[0].id);
  G.submitVote(room, crew[2].id, crew[1].id);
  assert.equal(c.accusedId, null);
  assert.equal(c.outcome, 'imposter-escaped');
  assert.equal(G.publicState(room).current.imposterId, imp.id, 'revealed at the end');

  // Round 4: the imposter leaves the room mid-clues -> round ends, no points
  assert.ok(G.advance(room));
  ({ c, imp } = playRound());
  const scores = ps.map(p => p.score);
  room.players = room.players.filter(p => p !== imp);
  assert.equal(G.playerGone(room, imp.id), true);
  assert.equal(c.outcome, 'imposter-left');
  assert.deepEqual(ps.map(p => p.score), scores);
  assert.equal(G.advance(room), false, 'game over after 4 rounds');

  // Everyone was imposter once in 4 rounds of 4 players (shuffled order, no repeats)
  assert.equal(new Set(room.history.map(h => h.imposterName)).size, 4);
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
    { name: 'Ben', games: 4, wins: 2, points: 9, best: 4 },
    { name: 'Ann', games: 4, wins: 2, points: 8, best: 5 },
  ]);
  assert.equal(G.setMode(room, 'nope'), false);
}

console.log(`All checks passed (${POOL.length} questions).`);
