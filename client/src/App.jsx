import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';

// Connect to the same origin the page came from (LAN IP or localhost). In dev, Vite proxies /socket.io to the server.
const socket = io();

// sessionStorage: survives a refresh, but each tab is its own player (handy for testing on one machine).
const session = {
  get: () => { try { return JSON.parse(sessionStorage.getItem('wordrace')); } catch { return null; } },
  set: v => sessionStorage.setItem('wordrace', JSON.stringify(v)),
  clear: () => sessionStorage.removeItem('wordrace'),
};

const DIFFICULTY = ['Easy', 'Medium', 'Hard'];

function useNow() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 200); return () => clearInterval(t); }, []);
  return now;
}

export default function App() {
  const [game, setGame] = useState(null);
  const [me, setMe] = useState(() => session.get()?.playerId);
  const [online, setOnline] = useState(socket.connected);
  const [lanIps, setLanIps] = useState([]);
  const [toast, setToast] = useState(null);
  const [activity, setActivity] = useState(null);

  const flash = text => setToast({ text, id: Date.now() });

  useEffect(() => {
    const rejoin = () => {
      setOnline(true);
      const saved = session.get();
      if (saved) socket.emit('rejoin', saved, res => { if (!res.ok) { session.clear(); setGame(null); flash(res.error); } });
    };
    const handlers = {
      connect: rejoin,
      disconnect: () => setOnline(false),
      // remainingMs is relative, so device clocks don't need to agree
      state: s => setGame({ ...s, endsAt: Date.now() + s.remainingMs }),
      notice: flash,
      lan: setLanIps,
      kicked: msg => { session.clear(); setGame(null); flash(msg); },
      opponent: a => setActivity({ ...a, at: Date.now() }),
    };
    for (const [e, h] of Object.entries(handlers)) socket.on(e, h);
    if (socket.connected) rejoin();
    return () => { for (const [e, h] of Object.entries(handlers)) socket.off(e, h); };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const entered = res => {
    if (!res.ok) return flash(res.error);
    session.set({ code: res.code, playerId: res.playerId });
    setMe(res.playerId);
    history.replaceState(null, '', location.pathname);
  };
  const leave = () => { socket.emit('leave'); session.clear(); setGame(null); };
  const ack = res => res?.ok === false && flash(res.error);

  const away = game?.players.filter(p => p.id !== me && !p.connected).map(p => p.name).join(' & ');

  let screen;
  if (!game) screen = <Home onEnter={entered} />;
  else if (game.phase === 'lobby') screen = <Lobby game={game} me={me} lanIps={lanIps} onLeave={leave} onStart={() => socket.emit('start', ack)} />;
  else if (game.phase === 'final') screen = <Final game={game} me={me} onLeave={leave} onAgain={() => socket.emit('playAgain', ack)} />;
  else screen = <Game game={game} me={me} activity={activity} onSkip={() => socket.emit('skip', ack)} />;

  return (
    <div className="app">
      {!online && <div className="banner bad">Connection lost. Reconnecting…</div>}
      {online && away && <div className="banner warn">{away} disconnected. Waiting for them to reconnect...</div>}
      {screen}
      {toast && <div className="toast" key={toast.id}>{toast.text}</div>}
    </div>
  );
}

function Logo() {
  return <h1 className="logo">Word<span>Race</span></h1>;
}

function Home({ onEnter }) {
  const [name, setName] = useState(() => localStorage.getItem('wordrace-name') || '');
  const [code, setCode] = useState(() => new URLSearchParams(location.search).get('room') || '');
  const saveName = () => localStorage.setItem('wordrace-name', name.trim());
  const create = () => { saveName(); socket.emit('create', { name }, onEnter); };
  const join = e => { e.preventDefault(); saveName(); socket.emit('join', { code, name }, onEnter); };

  return (
    <div className="card home">
      <Logo />
      <p className="tagline">2–3 players. 3 rounds. Name the picture first.</p>
      <label className="field">
        <span>Your name</span>
        <input value={name} maxLength={16} placeholder="e.g. Sam" autoFocus onChange={e => setName(e.target.value)} />
      </label>
      <button className="btn primary" disabled={!name.trim()} onClick={create}>Create Room</button>
      <div className="divider"><span>or join a friend</span></div>
      <form className="join" onSubmit={join}>
        <input className="code-input" value={code} maxLength={4} placeholder="CODE"
          onChange={e => setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))} />
        <button className="btn" disabled={!name.trim() || code.length !== 4}>Join Room</button>
      </form>
    </div>
  );
}

function Lobby({ game, me, lanIps, onLeave, onStart }) {
  const isHost = game.hostId === me;
  const port = location.port ? `:${location.port}` : '';
  // Opened as localhost on the host PC -> show its LAN address. Opened any other way (LAN IP, or deployed online) -> this page's own address.
  const local = ['localhost', '127.0.0.1'].includes(location.hostname);
  const url = local && lanIps.length ? `http://${lanIps[0]}${port}` : location.origin;
  const ready = game.players.length >= game.minPlayers && game.players.every(p => p.connected);
  const full = game.players.length >= game.maxPlayers;
  const slots = Array.from({ length: game.maxPlayers }, (_, i) => game.players[i]);

  return (
    <div className="card lobby">
      <Logo />
      <div className="room-code">
        <span>Room code</span>
        <strong>{game.code}</strong>
      </div>
      <div className="lan">
        On the other device{local ? ' (same Wi-Fi)' : ''} open
        <code>{url}</code>
        and enter the code, or use <code>{url}/?room={game.code}</code>
        {local && lanIps.length > 1 && <small>Other addresses: {lanIps.slice(1).map(ip => `http://${ip}${port}`).join(', ')}</small>}
      </div>
      <ul className="players">
        {slots.map((p, i) => (
          <li key={i} className={p ? '' : 'empty'}>
            <span className={`dot ${p?.connected ? 'on' : ''}`} />
            {p ? <>
              <b>{p.name}</b>
              {p.id === game.hostId && <em>host</em>}
              {p.id === me && <em>you</em>}
              <small>{p.connected ? 'connected' : 'disconnected'}</small>
            </> : <span className="waiting">{i < game.minPlayers ? `Waiting for player ${i + 1}…` : `Player ${i + 1} (optional)`}</span>}
          </li>
        ))}
      </ul>
      {isHost
        ? <button className="btn primary" disabled={!ready} onClick={onStart}>{!ready ? 'Waiting for players…' : full ? 'Start Game' : `Start with ${game.players.length} players`}</button>
        : <p className="muted center">Waiting for the host to start…</p>}
      <button className="btn ghost" onClick={onLeave}>Leave room</button>
    </div>
  );
}

function Scores({ game, me }) {
  return (
    <div className="scores">
      {game.players.map(p => (
        <div key={p.id} className={`score ${p.id === me ? 'me' : ''} ${p.id === game.current?.winnerId && game.phase === 'result' ? 'winner' : ''}`}>
          <span className={`dot ${p.connected ? 'on' : ''}`} />
          <span className="name">{p.name}{p.id === me && ' (you)'}</span>
          <b key={p.score} className="pop">{p.score}</b>
        </div>
      ))}
    </div>
  );
}

// One box per letter. Given letters are fixed; blanks are inputs you type straight into.
// Focus jumps to the next blank, Backspace goes back, and the guess is sent as soon as every blank is filled.
function LetterBoxes({ pattern, answer, open, wordKey, wrongAt, onType, onSubmit }) {
  const [letters, setLetters] = useState({});
  const refs = useRef({});
  const blanks = pattern.flatMap((ch, i) => (ch === '_' ? [i] : []));
  const focus = i => refs.current[i]?.focus();

  useEffect(() => { setLetters({}); setTimeout(() => focus(blanks[0])); }, [wordKey]);
  useEffect(() => { if (wrongAt) { setLetters({}); focus(blanks[0]); } }, [wrongAt]);

  const type = (i, value) => {
    const clean = value.toUpperCase().replace(/[^A-Z]/g, '');
    // Typing over an existing letter: drop the old one and keep what's new.
    const typed = letters[i] && clean.length > 1 ? clean.replace(letters[i], '') : clean;
    const next = { ...letters, [i]: '' };
    // Several letters at once (paste, phone autocomplete) fill this box and the following blanks.
    let pos = blanks.indexOf(i);
    for (const ch of typed) if (pos < blanks.length) next[blanks[pos++]] = ch;
    setLetters(next);
    onType();
    if (!typed) return;
    const empty = blanks.slice(pos).find(b => !next[b]) ?? blanks.find(b => !next[b]);
    if (empty !== undefined) focus(empty);
    else onSubmit(pattern.map((c, k) => (c === '_' ? next[k] : c)).join(''));
  };

  const onKeyDown = (i, e) => {
    const pos = blanks.indexOf(i);
    if (e.key === 'Backspace' && !letters[i] && pos > 0) {
      e.preventDefault();
      setLetters({ ...letters, [blanks[pos - 1]]: '' });
      focus(blanks[pos - 1]);
    } else if (e.key === 'ArrowLeft' && pos > 0) focus(blanks[pos - 1]);
    else if (e.key === 'ArrowRight' && pos < blanks.length - 1) focus(blanks[pos + 1]);
  };

  // Group letters by word so multi-word answers only wrap between words.
  const words = [[]];
  pattern.forEach((ch, i) => (ch === ' ' ? words.push([]) : words.at(-1).push(i)));

  return (
    <div className="word" aria-label={pattern.join(' ')} onClick={() => focus(blanks.find(b => !letters[b]) ?? blanks[0])}>
      {words.map((idxs, w) => (
        <div className="word-part" key={w}>
          {idxs.map(i => pattern[i] !== '_'
            ? <span key={i} className="tile">{pattern[i]}</span>
            : answer
              ? <span key={i} className="tile revealed">{answer[i]}</span>
              : <input key={i} ref={el => (refs.current[i] = el)} className="tile blank" value={letters[i] ?? ''}
                  disabled={!open} onChange={e => type(i, e.target.value)} onKeyDown={e => onKeyDown(i, e)}
                  onFocus={e => e.target.select()} onClick={e => e.stopPropagation()}
                  autoComplete="off" autoCorrect="off" autoCapitalize="characters" spellCheck={false}
                  aria-label={`Letter ${i + 1}`} />)}
        </div>
      ))}
    </div>
  );
}

function Game({ game, me, activity, onSkip }) {
  const now = useNow();
  const [wrong, setWrong] = useState(0);
  const lastTyping = useRef(0);
  const c = game.current;
  const open = game.phase === 'round';
  const isHost = game.hostId === me;
  const secs = Math.max(0, Math.ceil((game.endsAt - now) / 1000));
  const pct = open && !c.overtime ? Math.max(0, (game.endsAt - now) / game.wordMs) * 100 : 0;
  const wordKey = `${game.round}-${game.word}`;
  const roundEnd = game.word === game.wordsPerRound;

  useEffect(() => setWrong(0), [wordKey]);

  const submit = guess => socket.emit('answer', guess, res => { if (!res.correct && !res.reason) setWrong(Date.now()); });
  const onType = () => {
    if (Date.now() - lastTyping.current > 800) { lastTyping.current = Date.now(); socket.emit('typing'); }
  };

  const recent = activity && now - activity.at < 1500 && open;
  const winner = game.players.find(p => p.id === c.winnerId);
  const next = !roundEnd ? `Next word in ${secs}…`
    : game.round < game.rounds ? `Round ${game.round + 1} (${DIFFICULTY[game.round]}) starts in ${secs}…`
    : `Final results in ${secs}…`;

  return (
    <div className="game">
      <header className="topbar">
        <div className="round">
          Round <b>{game.round}</b> / {game.rounds}
          <small>Word {game.word} / {game.wordsPerRound} · <span className={`diff d${game.round}`}>{DIFFICULTY[game.round - 1]}</span></small>
        </div>
        <div className={`timer ${open && !c.overtime && secs <= 5 ? 'urgent' : ''}`}>
          {!open ? '–' : c.overtime ? '⏸' : <>{secs}<small>s</small></>}
        </div>
        <Scores game={game} me={me} />
      </header>
      <div className="timebar"><div style={{ width: `${pct}%` }} /></div>

      <main className="stage">
        <div className="emoji-box" key={wordKey}><span>{c.emoji}</span></div>
        <p className="muted">What's in the picture?</p>
        <div className={now - wrong < 450 ? 'shake' : ''}>
          <LetterBoxes pattern={c.pattern} answer={c.answer} open={open} wordKey={wordKey}
            wrongAt={wrong} onType={onType} onSubmit={submit} />
        </div>
        <div className="activity">
          {open && now - wrong < 2000 ? <span className="bad-text">Not quite, try again!</span>
            : recent ? <span>{activity.type === 'wrong' ? `❌ ${activity.name} guessed wrong` : `✍️ ${activity.name} is typing…`}</span>
            : null}
        </div>
        {open && c.overtime && (
          <div className="overtime">
            <span>⏸ Time's up, but no rush. Keep guessing!</span>
            {isHost
              ? <button className="btn" onClick={onSkip}>Skip word ⏭</button>
              : <small>Only the host can skip this word.</small>}
          </div>
        )}
      </main>

      {game.phase === 'result' && (
        <div className="overlay">
          <div className="card result">
            {roundEnd && <div className="chip">Round {game.round} complete!</div>}
            <h2>{!winner ? '⏭ Word skipped' : winner.id === me ? '🎉 You got it!' : `⚡ ${winner.name} got it first!`}</h2>
            <p className="answer-reveal">{c.emoji} {c.answer}</p>
            <Scores game={game} me={me} />
            <p className="muted">{next}</p>
          </div>
        </div>
      )}
    </div>
  );
}

function WordList({ items }) {
  return <div className="guessed">{items.map(h => <span key={h.answer}>{h.emoji} {h.answer}</span>)}</div>;
}

function Final({ game, me, onLeave, onAgain }) {
  const ranked = [...game.players].sort((a, b) => b.score - a.score);
  const top = ranked.filter(p => p.score === ranked[0].score);
  const tie = top.length > 1;
  const medal = p => ['🥇', '🥈', '🥉'][ranked.filter(o => o.score > p.score).length];
  const ready = game.players.length >= game.minPlayers && game.players.every(p => p.connected);
  const skipped = game.history.filter(h => !h.winnerId);

  return (
    <div className="card final">
      <div className="trophy">{tie ? '🤝' : '🏆'}</div>
      <h2>{tie ? `${top.map(p => p.name).join(' & ')} tie!` : ranked[0].id === me ? 'You win!' : `${ranked[0].name} wins!`}</h2>
      <ol className="podium">
        {ranked.map((p, i) => {
          const words = game.history.filter(h => h.winnerId === p.id);
          return (
            <li key={p.id} className={!tie && i === 0 ? 'first' : ''}>
              <div className="podium-row">
                <span>{medal(p)} {p.name}{p.id === me && ' (you)'}</span>
                <b>{words.length} {words.length === 1 ? 'word' : 'words'}</b>
              </div>
              {words.length > 0 && <WordList items={words} />}
            </li>
          );
        })}
      </ol>
      {skipped.length > 0 && (
        <div className="skipped"><small className="muted">Nobody got</small><WordList items={skipped} /></div>
      )}
      <button className="btn primary" disabled={!ready} onClick={onAgain}>{ready ? 'Play Again' : 'Waiting for everyone to connect…'}</button>
      <p className="muted center">Play Again deals {game.rounds * game.wordsPerRound} brand-new words.</p>
      <button className="btn ghost" onClick={onLeave}>Leave room</button>
    </div>
  );
}
