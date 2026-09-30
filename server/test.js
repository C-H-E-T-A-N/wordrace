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
for (const q of POOL) {
  const p = G.makePattern(q.answer);
  assert.equal(p.length, q.answer.length);
  assert.equal(p[0], q.answer[0]);
  assert.ok(p.includes('_'));
  p.forEach((c, i) => q.answer[i] === ' ' && assert.equal(c, ' '));
}

// No repetition: within a game, between consecutive games, and not at all until the pool is used up
{
  const room = G.createRoom('TEST');
  const seen = new Set();
  const gamesBeforeRefill = Math.floor(POOL.length / G.ROUNDS);
  let prev = [];
  for (let game = 0; game < gamesBeforeRefill * 3; game++) {
    const qs = G.drawQuestions(room);
    const ids = qs.map(q => q.id);
    assert.equal(new Set(ids).size, G.ROUNDS, 'repeat inside a game');
    assert.equal(new Set(qs.map(q => q.emoji)).size, G.ROUNDS, 'repeat emoji inside a game');
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

  // Round 2: typing only the missing letters also counts; time-out gives nobody a point
  G.nextRound(room);
  assert.equal(G.submitAnswer(room, b.id, room.current.missing).correct, true);
  G.nextRound(room);
  G.timeUp(room);
  assert.equal(G.submitAnswer(room, a.id, room.current.q.answer).correct, false);
  assert.deepEqual([a.score, b.score], [1, 1]);
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
