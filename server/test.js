// Self-check for the game rules. Run: npm test
import assert from 'node:assert/strict';
import { POOL } from './questions.js';
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

// Answer normalization
for (const s of ['pizza', 'Pizza', 'PIZZA', ' pizza ', 'pi zza']) assert.equal(G.normalize(s), 'pizza');

// Patterns: same length, first letter + spaces kept, at least one hidden, generated fresh each time
for (const q of POOL) for (const ratio of G.HIDE_BY_ROUND) {
  const p = G.makePattern(q.answer, ratio);
  assert.equal(p.length, q.answer.length);
  assert.equal(p[0], q.answer[0]);
  assert.ok(p.includes('_'));
  p.forEach((c, i) => q.answer[i] === ' ' && assert.equal(c, ' '));
}

// Difficulty: each round hides more letters than the one before
{
  const hidden = G.HIDE_BY_ROUND.map(r => G.makePattern('STRAWBERRY', r).filter(c => c === '_').length);
  assert.ok(hidden[0] < hidden[1] && hidden[1] < hidden[2], `hidden per round: ${hidden}`);
}

// No repetition: within a game, between consecutive games, and not at all until the pool is used up
{
  const room = G.createRoom('TEST');
  const seen = new Set();
  const gamesBeforeRefill = Math.floor(POOL.length / G.WORDS_PER_GAME);
  let prev = [];
  for (let game = 0; game < gamesBeforeRefill * 3; game++) {
    const qs = G.drawQuestions(room);
    const ids = qs.map(q => q.id);
    assert.equal(new Set(ids).size, G.WORDS_PER_GAME, 'repeat inside a game');
    assert.equal(new Set(qs.map(q => q.emoji)).size, G.WORDS_PER_GAME, 'repeat emoji inside a game');
    assert.ok(ids.every(id => !prev.includes(id)), 'repeat from the previous game');
    if (game < gamesBeforeRefill) ids.forEach(id => { assert.ok(!seen.has(id), `${id} reused early`); seen.add(id); });
    prev = ids;
  }
}

// Race: both players send the right answer, only the first gets the point and the round locks
{
  const room = G.createRoom('RACE');
  const a = G.addPlayer(room, 'A');
  const b = G.addPlayer(room, 'B');
  G.startGame(room);
  const answer = room.current.q.answer;
  assert.equal(G.publicState(room).current.answer, null, 'answer leaked while round open');
  assert.deepEqual(G.submitAnswer(room, b.id, 'definitely wrong'), { correct: false });
  assert.equal(G.submitAnswer(room, a.id, answer.toLowerCase()).correct, true);
  assert.equal(G.submitAnswer(room, b.id, answer).correct, false);
  assert.deepEqual([a.score, b.score], [1, 0]);
  assert.equal(room.phase, 'result');
  assert.equal(G.publicState(room).current.answer, answer);

  // Word 2: typing only the missing letters also counts
  G.nextWord(room);
  assert.equal(G.submitAnswer(room, b.id, room.current.missing).correct, true);

  // Word 3: no skip before the time is up; after it the word stays open and can still be won
  G.nextWord(room);
  assert.equal(G.skipWord(room), false);
  G.startOvertime(room);
  assert.equal(room.phase, 'round');
  assert.equal(G.submitAnswer(room, a.id, room.current.q.answer).correct, true);

  // Word 4 (round 2): host skips in overtime -> nobody scores
  G.nextWord(room);
  assert.equal(G.publicState(room).round, 2);
  G.startOvertime(room);
  assert.equal(G.skipWord(room), true);
  assert.equal(G.submitAnswer(room, b.id, room.current.q.answer).correct, false);
  assert.deepEqual([a.score, b.score], [2, 1]);

  // History records who guessed what, for the final screen
  assert.deepEqual(room.history.map(h => h.winnerName), ['A', 'B', 'A', null]);
  assert.equal(room.questions.length, G.WORDS_PER_GAME);
}

// 3 players all answer correctly: exactly one point is handed out
{
  const room = G.createRoom('TRIO');
  const ps = ['A', 'B', 'C'].map(n => G.addPlayer(room, n));
  assert.equal(room.players.length, G.MAX_PLAYERS);
  G.startGame(room);
  const results = ps.map(p => G.submitAnswer(room, p.id, room.current.q.answer).correct);
  assert.deepEqual(results, [true, false, false]);
  assert.deepEqual(ps.map(p => p.score), [1, 0, 0]);
}

console.log(`All checks passed (${POOL.length} questions).`);
