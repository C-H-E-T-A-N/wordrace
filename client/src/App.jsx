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
  else screen = <Game game={game} me={me} activity={activity} />;

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
      <p className="tagline">2–3 players. Four words. Fastest fingers win.</p>
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

function Game({ game, me, activity }) {
  const now = useNow();
  const [text, setText] = useState('');
  const [wrong, setWrong] = useState(0);
  const lastTyping = useRef(0);
  const c = game.current;
  const open = game.phase === 'round';
  const secs = Math.max(0, Math.ceil((game.endsAt - now) / 1000));
  const pct = open ? Math.max(0, (game.endsAt - now) / game.roundMs) * 100 : 0;

  useEffect(() => { setText(''); setWrong(0); }, [game.round]);

  const submit = e => {
    e.preventDefault();
    if (!open || !text.trim()) return;
    socket.emit('answer', text, res => { if (!res.correct && !res.reason) setWrong(Date.now()); });
  };
  const onChange = e => {
    setText(e.target.value);
    if (Date.now() - lastTyping.current > 800) { lastTyping.current = Date.now(); socket.emit('typing'); }
  };

  const recent = activity && now - activity.at < 1500 && open;
  const winner = game.players.find(p => p.id === c.winnerId);

  return (
    <div className="game">
      <header className="topbar">
        <div className="round">Round <b>{game.round}</b> / {game.rounds}</div>
        <div className={`timer ${open && secs <= 5 ? 'urgent' : ''}`}>{open ? secs : '–'}<small>s</small></div>
        <Scores game={game} me={me} />
      </header>
      <div className="timebar"><div style={{ width: `${pct}%` }} /></div>

      <main className="stage">
        <div className="chip">{c.category}</div>
        <div className="emoji-box" key={game.round}><span>{c.emoji}</span></div>
        <p className="hint">{c.hint}</p>
        <div className="word" aria-label={c.displayPattern}>
          {c.pattern.map((ch, i) => ch === ' '
            ? <span key={i} className="gap" />
            : <span key={i} className={`tile ${ch === '_' ? (c.answer ? 'revealed' : 'blank') : ''}`}>{ch === '_' ? (c.answer?.[i] ?? '') : ch}</span>)}
        </div>

        <form className="answer" onSubmit={submit}>
          <input key={game.round} autoFocus value={text} onChange={onChange} disabled={!open}
            className={now - wrong < 450 ? 'shake' : ''}
            placeholder="Type the word (or just the missing letters)" autoComplete="off" autoCapitalize="characters" spellCheck={false} />
          <button className="btn primary" disabled={!open || !text.trim()}>Submit</button>
        </form>
        <div className="activity">
          {open && now - wrong < 2000 ? <span className="bad-text">Not quite, try again!</span>
            : recent ? <span>{activity.type === 'wrong' ? `❌ ${activity.name} guessed wrong` : `✍️ ${activity.name} is typing…`}</span>
            : null}
        </div>
      </main>

      {game.phase === 'result' && (
        <div className="overlay">
          <div className="card result">
            <h2>{!winner ? "⏰ Time's up!" : winner.id === me ? '🎉 You got it!' : `⚡ ${winner.name} got it first!`}</h2>
            <p className="answer-reveal">{c.emoji} {c.answer}</p>
            <Scores game={game} me={me} />
            <p className="muted">{game.round < game.rounds ? `Round ${game.round + 1} in ${secs}…` : `Final results in ${secs}…`}</p>
          </div>
        </div>
      )}
    </div>
  );
}

function Final({ game, me, onLeave, onAgain }) {
  const ranked = [...game.players].sort((a, b) => b.score - a.score);
  const top = ranked.filter(p => p.score === ranked[0].score);
  const tie = top.length > 1;
  const medal = p => ['🥇', '🥈', '🥉'][ranked.filter(o => o.score > p.score).length];
  const ready = game.players.length >= game.minPlayers && game.players.every(p => p.connected);
  return (
    <div className="card final">
      <div className="trophy">{tie ? '🤝' : '🏆'}</div>
      <h2>{tie ? `${top.map(p => p.name).join(' & ')} tie!` : ranked[0].id === me ? 'You win!' : `${ranked[0].name} wins!`}</h2>
      <ol className="podium">
        {ranked.map((p, i) => (
          <li key={p.id} className={!tie && i === 0 ? 'first' : ''}>
            <span>{medal(p)} {p.name}{p.id === me && ' (you)'}</span><b>{p.score}</b>
          </li>
        ))}
      </ol>
      <button className="btn primary" disabled={!ready} onClick={onAgain}>{ready ? 'Play Again' : 'Waiting for everyone to connect…'}</button>
      <p className="muted center">Play Again deals 4 brand-new words.</p>
      <button className="btn ghost" onClick={onLeave}>Leave room</button>
    </div>
  );
}
