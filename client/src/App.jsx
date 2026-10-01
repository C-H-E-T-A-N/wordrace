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

const MODE_CARDS = [
  { key: 'picture', icon: '🖼️', name: 'Picture', desc: 'Name the picture: type it or say it 🎤. Stuck? Everyone agrees → hint.' },
  { key: 'letters', icon: '🔤', name: 'Letters', desc: 'No picture. Fill in the missing letters, harder every round.' },
  { key: 'classic', icon: '⚡', name: 'Classic', desc: 'Picture, hint and missing letters. 4 quick rounds.' },
  { key: 'draw', icon: '🎨', name: 'Draw & Guess', desc: 'Take turns drawing a secret word while the others guess.' },
];
const MODE_ICON = Object.fromEntries(MODE_CARDS.map(m => [m.key, m.icon]));
const DIFFICULTY = ['Easy', 'Medium', 'Hard'];
const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;

function useNow() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 200); return () => clearInterval(t); }, []);
  return now;
}

const clock = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

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
  const actions = {
    start: () => socket.emit('start', ack),
    again: () => socket.emit('playAgain', ack),
    lobby: () => socket.emit('toLobby', ack),
    mode: m => socket.emit('setMode', m, ack),
    drawTurns: n => socket.emit('setDrawTurns', n, ack),
    skip: () => socket.emit('skip', ack),
    leave,
  };

  const away = game?.players.filter(p => p.id !== me && !p.connected).map(p => p.name).join(' & ');

  let screen;
  if (!game) screen = <Home onEnter={entered} />;
  else if (game.phase === 'lobby') screen = <Lobby game={game} me={me} lanIps={lanIps} actions={actions} />;
  else if (game.phase === 'final') screen = <Final game={game} me={me} actions={actions} />;
  else if (game.mode === 'draw') screen = <DrawGame key={game.round} game={game} me={me} />;
  else screen = <Game game={game} me={me} activity={activity} actions={actions} />;

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
      <p className="tagline">Party word games for 2–8 players. Guess, spell or draw it first.</p>
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

function ModePicker({ game, isHost, actions }) {
  return (
    <div className="mode-picker">
      <h3>{isHost ? 'Select game mode' : 'Game mode (host picks)'}</h3>
      <div className="modes">
        {MODE_CARDS.map(m => (
          <button key={m.key} className={`mode ${game.mode === m.key ? 'selected' : ''}`} disabled={!isHost}
            onClick={() => actions.mode(m.key)} aria-pressed={game.mode === m.key}>
            <span className="mode-icon">{m.icon}</span>
            <b>{m.name}</b>
            <small>{m.desc}</small>
          </button>
        ))}
      </div>
      {game.mode === 'draw' && (
        <div className="turns">
          <span>Turns per player</span>
          {[1, 2, 3].map(n => (
            <button key={n} className={`pill ${game.drawTurns === n ? 'on' : ''}`} disabled={!isHost} onClick={() => actions.drawTurns(n)}>{n}</button>
          ))}
        </div>
      )}
    </div>
  );
}

function Lobby({ game, me, lanIps, actions }) {
  const isHost = game.hostId === me;
  const port = location.port ? `:${location.port}` : '';
  // Opened as localhost on the host PC -> show its LAN address. Opened any other way (LAN IP, or deployed online) -> this page's own address.
  const local = ['localhost', '127.0.0.1'].includes(location.hostname);
  const url = local && lanIps.length ? `http://${lanIps[0]}${port}` : location.origin;
  const ready = game.players.length >= game.minPlayers && game.players.every(p => p.connected);
  const n = game.players.length;

  return (
    <div className="card lobby wide">
      <Logo />
      <div className="room-code">
        <span>Room code</span>
        <strong>{game.code}</strong>
      </div>
      <div className="lan">
        On the other devices{local ? ' (same Wi-Fi)' : ''} open
        <code>{url}</code>
        and enter the code, or use <code>{url}/?room={game.code}</code>
        {local && lanIps.length > 1 && <small>Other addresses: {lanIps.slice(1).map(ip => `http://${ip}${port}`).join(', ')}</small>}
      </div>
      <ul className="players">
        {game.players.map(p => (
          <li key={p.id}>
            <span className={`dot ${p.connected ? 'on' : ''}`} />
            <b>{p.name}</b>
            {p.id === game.hostId && <em>host</em>}
            {p.id === me && <em>you</em>}
            <small>{p.connected ? 'connected' : 'disconnected'}</small>
          </li>
        ))}
        {n < game.maxPlayers && (
          <li className="empty"><span className="dot" />
            <span className="waiting">{n < game.minPlayers ? `Waiting for player ${n + 1}…` : `Room for ${game.maxPlayers - n} more`}</span>
          </li>
        )}
      </ul>
      <ModePicker game={game} isHost={isHost} actions={actions} />
      {isHost
        ? <button className="btn primary" disabled={!ready} onClick={actions.start}>
            {ready ? `Start ${MODE_ICON[game.mode]} ${game.modeInfo.name}` : 'Waiting for players…'}
          </button>
        : <p className="muted center">Waiting for the host to start…</p>}
      <Leaderboard game={game} me={me} />
      <button className="btn ghost" onClick={actions.leave}>Leave room</button>
    </div>
  );
}

function Scores({ game, me }) {
  const c = game.current;
  return (
    <div className="scores">
      {game.players.map(p => (
        <div key={p.id} className={`score ${p.id === me ? 'me' : ''} ${game.phase === 'result' && c?.winnerId === p.id ? 'winner' : ''}`}>
          <span className={`dot ${p.connected ? 'on' : ''}`} />
          <span className="name">{game.mode === 'draw' && c?.drawerId === p.id && '🎨 '}{p.name}{p.id === me && ' (you)'}</span>
          <b key={p.score} className="pop">{p.score}</b>
        </div>
      ))}
    </div>
  );
}

// Letters mode: one box per letter. Given letters are fixed; blanks are inputs you type straight into.
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

  return (
    <WordTiles pattern={pattern} answer={answer} onClick={() => focus(blanks.find(b => !letters[b]) ?? blanks[0])}
      blank={i => (
        <input key={i} ref={el => (refs.current[i] = el)} className="tile blank" value={letters[i] ?? ''}
          disabled={!open} onChange={e => type(i, e.target.value)} onKeyDown={e => onKeyDown(i, e)}
          onFocus={e => e.target.select()} onClick={e => e.stopPropagation()}
          autoComplete="off" autoCorrect="off" autoCapitalize="characters" spellCheck={false}
          aria-label={`Letter ${i + 1}`} />
      )} />
  );
}

// Letter tiles grouped by word so multi-word answers only wrap between words.
// `blank(i)` renders an open blank (default: an empty dashed tile).
function WordTiles({ pattern, answer, blank = i => <span key={i} className="tile blank" />, onClick }) {
  const words = [[]];
  pattern.forEach((ch, i) => (ch === ' ' ? words.push([]) : words.at(-1).push(i)));
  return (
    <div className="word" aria-label={pattern.join(' ')} onClick={onClick}>
      {words.map((idxs, w) => (
        <div className="word-part" key={w}>
          {idxs.map(i => pattern[i] !== '_'
            ? <span key={i} className="tile">{pattern[i]}</span>
            : answer ? <span key={i} className="tile revealed">{answer[i]}</span> : blank(i))}
        </div>
      ))}
    </div>
  );
}

// Text answer with optional voice input (Web Speech API: Chrome, Edge, Safari; needs https or localhost).
function AnswerBox({ open, wordKey, wrongAt, onSubmit, onType, voice, placeholder }) {
  const [text, setText] = useState('');
  const [listening, setListening] = useState(false);
  const [voiceMsg, setVoiceMsg] = useState('');
  const rec = useRef(null);
  const input = useRef(null);
  const canVoice = voice && Recognition && window.isSecureContext;

  useEffect(() => { setText(''); setVoiceMsg(''); rec.current?.abort(); input.current?.focus(); }, [wordKey]);
  useEffect(() => { if (wrongAt) input.current?.select(); }, [wrongAt]);
  useEffect(() => () => rec.current?.abort(), []);

  const submit = e => { e.preventDefault(); if (open && text.trim()) onSubmit(text); };
  const listen = () => {
    if (listening) return rec.current?.stop();
    const r = new Recognition();
    r.lang = 'en-US';
    r.maxAlternatives = 5;
    r.interimResults = false;
    r.onresult = e => {
      const alts = [...e.results[0]].map(a => a.transcript.trim()).filter(Boolean);
      if (!alts.length) return;
      setText(alts[0]);
      setVoiceMsg(`Heard “${alts[0]}”`);
      onSubmit(alts); // the server checks every alternative the recogniser offered
    };
    r.onerror = e => setVoiceMsg(
      e.error === 'not-allowed' ? 'Microphone blocked: allow it in the browser and try again.'
        : e.error === 'no-speech' ? "Didn't hear anything, try again." : 'Voice input failed, please type instead.');
    r.onend = () => setListening(false);
    rec.current = r;
    r.start();
    setListening(true);
    setVoiceMsg('Listening… say the word');
  };

  return (
    <div className="answer-wrap">
      <form className="answer" onSubmit={submit}>
        <input ref={input} autoFocus value={text} disabled={!open} placeholder={placeholder}
          onChange={e => { setText(e.target.value); onType(); }}
          autoComplete="off" autoCapitalize="characters" spellCheck={false} />
        {canVoice && (
          <button type="button" className={`btn mic ${listening ? 'on' : ''}`} disabled={!open} onClick={listen}
            aria-label={listening ? 'Stop listening' : 'Answer by voice'} title="Answer by voice">🎤</button>
        )}
        <button className="btn primary" disabled={!open || !text.trim()}>Submit</button>
      </form>
      {voiceMsg && <small className="muted">{voiceMsg}</small>}
      {voice && !canVoice && (
        <small className="muted">🎤 Voice answers work in Chrome, Edge or Safari on the https:// link (not over plain LAN http).</small>
      )}
    </div>
  );
}

function HintVote({ c, me, open }) {
  if (c.hint) return <p className="hint-reveal">💡 {c.hint}</p>;
  if (!open) return null;
  const voted = c.hintVotes.includes(me);
  return (
    <button className="btn hint-btn" disabled={voted} onClick={() => socket.emit('hint')}>
      💡 {voted ? 'Waiting for everyone to agree' : 'Ask for a hint'} ({c.hintVotes.length}/{c.hintNeeded})
    </button>
  );
}

// Picture, Letters and Classic modes.
function Game({ game, me, activity, actions }) {
  const now = useNow();
  const [wrong, setWrong] = useState(0);
  const lastTyping = useRef(0);
  const c = game.current;
  const info = game.modeInfo;
  const open = game.phase === 'round';
  const isHost = game.hostId === me;
  const secs = Math.max(0, Math.ceil((game.endsAt - now) / 1000));
  const pct = open && !c.overtime ? Math.max(0, (game.endsAt - now) / info.wordMs) * 100 : 0;
  const wordKey = `${game.round}-${game.word}`;
  const multi = info.wordsPerRound > 1;
  const roundEnd = game.word === info.wordsPerRound;

  useEffect(() => setWrong(0), [wordKey]);

  const submit = guess => socket.emit('answer', guess, res => { if (!res.correct && !res.reason) setWrong(Date.now()); });
  const onType = () => {
    if (Date.now() - lastTyping.current > 800) { lastTyping.current = Date.now(); socket.emit('typing'); }
  };

  const recent = activity && now - activity.at < 1500 && open;
  const winner = game.players.find(p => p.id === c.winnerId);
  const next = !roundEnd ? `Next word in ${secs}…`
    : game.round < info.rounds ? `Round ${game.round + 1}${game.mode === 'letters' ? ` (${DIFFICULTY[game.round]})` : ''} starts in ${secs}…`
    : `Final results in ${secs}…`;

  return (
    <div className="game">
      <header className="topbar">
        <div className="round">
          Round <b>{game.round}</b> / {info.rounds}
          <small>
            {MODE_ICON[game.mode]} {info.name}
            {multi && <> · Word {game.word} / {info.wordsPerRound}</>}
            {game.mode === 'letters' && <> · <span className={`diff d${game.round}`}>{DIFFICULTY[game.round - 1]}</span></>}
          </small>
        </div>
        <div className={`timer ${open && !c.overtime && secs <= 5 ? 'urgent' : ''}`}>
          {!open ? '–' : c.overtime ? '⏸' : <>{secs}<small>s</small></>}
        </div>
        <Scores game={game} me={me} />
      </header>
      <div className="timebar"><div style={{ width: `${pct}%` }} /></div>

      <main className="stage">
        {c.category && <div className="chip">{c.category}</div>}
        {c.emoji && <div className="emoji-box" key={wordKey}><span>{c.emoji}</span></div>}
        <p className="muted">
          {game.mode === 'picture' ? "What's in the picture?" : game.mode === 'letters' ? 'Fill in the missing letters' : ''}
        </p>
        {game.mode === 'classic' && <p className="hint">{c.hint}</p>}

        <div className={now - wrong < 450 ? 'shake' : ''}>
          {info.input === 'boxes'
            ? <LetterBoxes pattern={c.pattern} answer={c.answer} open={open} wordKey={wordKey} wrongAt={wrong} onType={onType} onSubmit={submit} />
            : c.pattern && <WordTiles pattern={c.pattern} answer={c.answer} />}
        </div>
        {info.input === 'text' && (
          <AnswerBox open={open} wordKey={wordKey} wrongAt={wrong} onType={onType} onSubmit={submit}
            voice={game.mode === 'picture'}
            placeholder={game.mode === 'classic' ? 'Type the word (or just the missing letters)' : 'Type what it is…'} />
        )}
        {c.hintVote && <HintVote c={c} me={me} open={open} />}

        <div className="activity">
          {open && now - wrong < 2000 ? <span className="bad-text">Not quite, try again!</span>
            : recent ? <span>{activity.type === 'wrong' ? `❌ ${activity.name} guessed wrong` : `✍️ ${activity.name} is typing…`}</span>
            : null}
        </div>
        {open && c.overtime && (
          <div className="overtime">
            <span>⏸ Time's up, but no rush. Keep guessing!</span>
            {isHost
              ? <button className="btn" onClick={actions.skip}>Skip word ⏭</button>
              : <small>Only the host can skip this word.</small>}
          </div>
        )}
      </main>

      {game.phase === 'result' && (
        <div className="overlay">
          <div className="card result">
            {multi && roundEnd && <div className="chip">Round {game.round} complete!</div>}
            <h2>{!winner ? (info.overtime ? '⏭ Word skipped' : "⏰ Time's up!") : winner.id === me ? '🎉 You got it!' : `⚡ ${winner.name} got it first!`}</h2>
            <p className="answer-reveal">{c.emoji} {c.answer}</p>
            <Scores game={game} me={me} />
            <p className="muted">{next}</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------- Draw & Guess ----------------

const CANVAS_W = 800;
const CANVAS_H = 600;
const BRUSHES = [4, 9, 18, 34]; // px at 800 wide
const COLORS = ['#1a1040', '#ff5d6c', '#ff9f1c', '#ffcb3d', '#3ddc97', '#3b82f6', '#a855f7', '#8b5a2b'];
const clamp01 = v => Math.min(1, Math.max(0, v));

// Strokes travel as small segments in 0..1 coordinates ({x, y, px, py, w, c, t}), batched ~30 times a second.
function DrawCanvas({ canDraw, initial }) {
  const canvas = useRef(null);
  const last = useRef(null);
  const queue = useRef([]);
  const [tool, setTool] = useState('pen');
  const [brush, setBrush] = useState(1);
  const [color, setColor] = useState(COLORS[0]);

  const ctx = () => canvas.current.getContext('2d');
  const paint = s => {
    const g = ctx();
    g.strokeStyle = s.t === 'eraser' ? '#ffffff' : s.c;
    g.lineWidth = s.w * CANVAS_W;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.beginPath();
    g.moveTo(s.px * CANVAS_W, s.py * CANVAS_H);
    g.lineTo(s.x * CANVAS_W, s.y * CANVAS_H);
    g.stroke();
  };
  const wipe = () => { const g = ctx(); g.fillStyle = '#ffffff'; g.fillRect(0, 0, CANVAS_W, CANVAS_H); };

  useEffect(() => { wipe(); initial?.forEach(paint); }, [initial]);

  useEffect(() => {
    const onStroke = segs => segs.forEach(paint);
    const onClear = () => wipe();
    socket.on('draw-game:stroke', onStroke);
    socket.on('draw-game:clear', onClear);
    const flush = setInterval(() => { if (queue.current.length) socket.emit('draw-game:stroke', queue.current.splice(0)); }, 33);
    return () => { socket.off('draw-game:stroke', onStroke); socket.off('draw-game:clear', onClear); clearInterval(flush); };
  }, []);

  const pos = e => {
    const r = canvas.current.getBoundingClientRect();
    return { x: clamp01((e.clientX - r.left) / r.width), y: clamp01((e.clientY - r.top) / r.height) };
  };
  const move = e => {
    if (!canDraw || !last.current) return;
    const p = pos(e);
    const seg = { x: p.x, y: p.y, px: last.current.x, py: last.current.y, w: BRUSHES[brush] / CANVAS_W, c: color, t: tool };
    paint(seg);
    queue.current.push(seg);
    last.current = p;
  };
  const down = e => {
    if (!canDraw) return;
    e.preventDefault();
    try { canvas.current.setPointerCapture(e.pointerId); } catch { /* nice-to-have: keeps the stroke going if the finger leaves the canvas */ }
    last.current = pos(e);
    move(e); // a tap leaves a dot
  };
  const up = () => (last.current = null);
  const clear = () => {
    queue.current.length = 0;
    wipe();
    socket.emit('draw-game:clear');
  };

  return (
    <div className="draw-area">
      <canvas ref={canvas} width={CANVAS_W} height={CANVAS_H} className={`canvas ${canDraw ? 'can-draw' : ''}`}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />
      {canDraw && (
        <div className="tools">
          <div className="tool-group" aria-label="Brush size">
            {BRUSHES.map((b, i) => (
              <button key={b} className={`tool brush ${brush === i ? 'on' : ''}`} onClick={() => setBrush(i)} aria-label={`Brush ${i + 1}`}>
                <span style={{ width: 6 + i * 6, height: 6 + i * 6 }} />
              </button>
            ))}
          </div>
          <div className="tool-group" aria-label="Colour">
            {COLORS.map(c => (
              <button key={c} className={`tool swatch ${tool === 'pen' && color === c ? 'on' : ''}`} style={{ background: c }}
                onClick={() => { setColor(c); setTool('pen'); }} aria-label={`Colour ${c}`} />
            ))}
          </div>
          <div className="tool-group">
            <button className={`tool text ${tool === 'eraser' ? 'on' : ''}`} onClick={() => setTool('eraser')}>🧽 Eraser</button>
            <button className="tool text" onClick={clear}>🗑️ Clear</button>
          </div>
        </div>
      )}
    </div>
  );
}

function DrawGame({ game, me }) {
  const now = useNow();
  const c = game.current;
  const open = game.phase === 'round';
  const isDrawer = c.drawerId === me;
  const [secret, setSecret] = useState(null); // { word, emoji }: only the drawer, or me once I've guessed it
  const [initial, setInitial] = useState(null);
  const [text, setText] = useState('');
  const [wrong, setWrong] = useState(0);
  const [cheer, setCheer] = useState(null);
  const secs = Math.max(0, Math.ceil((game.endsAt - now) / 1000));
  const pct = open ? Math.max(0, (game.endsAt - now) / game.modeInfo.wordMs) * 100 : 0;
  const myGuess = c.guessed.find(g => g.id === me);

  // This component is keyed by turn, so this runs once per turn (and after a refresh/reconnect).
  useEffect(() => {
    socket.emit('draw-game:sync', null, res => {
      setInitial(res.strokes);
      if (res.word) setSecret({ word: res.word, emoji: res.emoji });
    });
    const onWord = w => setSecret(w);
    const onCorrect = g => setCheer({ ...g, at: Date.now() });
    socket.on('draw-game:word', onWord);
    socket.on('draw-game:correct', onCorrect);
    return () => { socket.off('draw-game:word', onWord); socket.off('draw-game:correct', onCorrect); };
  }, []);

  const guess = e => {
    e.preventDefault();
    if (!text.trim()) return;
    socket.emit('draw-game:guess', text, res => {
      if (res.correct) { setSecret({ word: res.word }); setText(''); }
      else if (!res.reason) { setWrong(Date.now()); setText(''); }
    });
  };

  const drawerPlayer = game.players.find(p => p.id === c.drawerId);

  return (
    <div className="game draw-game">
      <header className="topbar">
        <div className="round">
          Turn <b>{game.round}</b> / {game.modeInfo.rounds}
          <small>{isDrawer ? <span className="your-turn">🎨 YOUR TURN</span> : <>🎨 {c.drawerName} is drawing</>}</small>
        </div>
        <div className={`timer ${open && secs <= 10 ? 'urgent' : ''}`}>{open ? clock(secs) : '–'}</div>
        <Scores game={game} me={me} />
      </header>
      <div className="timebar"><div style={{ width: `${pct}%` }} /></div>

      <main className="draw-stage">
        {isDrawer && secret && (
          <div className="secret">Your word: <b>{secret.emoji} {secret.word}</b><small>Draw it! No letters or numbers.</small></div>
        )}
        {!isDrawer && myGuess && secret && (
          <div className="secret got-it">🎉 You guessed it! The word was <b>{secret.word}</b> (+{myGuess.points}). Keep watching!</div>
        )}
        {open && cheer && now - cheer.at < 2000 && <div className="cheer" key={cheer.at}>🎉 {cheer.name} guessed it!</div>}

        <DrawCanvas canDraw={isDrawer && open} initial={initial} />

        {!isDrawer && (
          <form className={`answer ${now - wrong < 450 ? 'shake' : ''}`} onSubmit={guess}>
            <input value={text} onChange={e => setText(e.target.value)} disabled={!open || !!myGuess} autoFocus
              placeholder={myGuess ? 'You got it! Waiting for the others…' : 'What is being drawn?'}
              autoComplete="off" spellCheck={false} enterKeyHint="send" />
            <button className="btn primary" disabled={!open || !!myGuess || !text.trim()}>Guess</button>
          </form>
        )}

        <ul className="feed">
          {[...c.guesses].reverse().map((g, i) => (
            <li key={c.guesses.length - i} className={g.correct ? 'ok' : ''}>
              {g.correct ? <>🎉 <b>{g.name}</b> guessed it!</> : <>❌ <b>{g.name}</b>: {g.text}</>}
            </li>
          ))}
          {!c.guesses.length && <li className="muted">{isDrawer ? 'Guesses will show up here.' : 'No guesses yet. Be the first!'}</li>}
        </ul>
      </main>

      {game.phase === 'result' && (
        <div className="overlay">
          <div className="card result">
            <h2>{c.guessed.length ? `🎉 ${c.guessed.length} ${c.guessed.length === 1 ? 'player' : 'players'} guessed it!` : '😶 Nobody guessed it'}</h2>
            <p className="muted">The word was</p>
            <p className="answer-reveal">{c.emoji} {c.answer}</p>
            <ul className="turn-points">
              {c.guessed.map(g => <li key={g.id}><span>{g.name}</span><b>+{g.points}</b></li>)}
              <li className="drawer-line"><span>🎨 {drawerPlayer?.name ?? c.drawerName} (drawer)</span><b>+{c.drawerPoints}</b></li>
            </ul>
            <Scores game={game} me={me} />
            <p className="muted">{game.round < game.modeInfo.rounds ? `Next turn in ${secs}…` : `Final results in ${secs}…`}</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------- End of game + room history ----------------

function WordList({ items }) {
  return <div className="guessed">{items.map(h => <span key={h.answer}>{h.emoji} {h.answer}</span>)}</div>;
}

function Final({ game, me, actions }) {
  const draw = game.mode === 'draw';
  const ranked = [...game.players].sort((a, b) => b.score - a.score);
  const top = ranked.filter(p => p.score === ranked[0].score);
  const tie = top.length > 1;
  const medal = p => ['🥇', '🥈', '🥉'][ranked.filter(o => o.score > p.score).length] ?? '·';
  const ready = game.players.length >= game.minPlayers && game.players.every(p => p.connected);
  const isHost = game.hostId === me;
  const skipped = game.history.filter(h => !draw && !h.winnerId);

  return (
    <div className="card final wide">
      {draw && <div className="chip">🎨 GAME OVER</div>}
      <div className="trophy">{tie ? '🤝' : '🏆'}</div>
      <h2>{tie ? "It's a tie!" : ranked[0].id === me ? 'You win!' : `${ranked[0].name} wins!`}</h2>
      {tie && <p className="muted center">{top.map(p => p.name).join(' & ')} share the top spot</p>}
      <ol className="podium">
        {ranked.map((p, i) => {
          const words = draw ? [] : game.history.filter(h => h.winnerId === p.id);
          return (
            <li key={p.id} className={!tie && i === 0 ? 'first' : ''}>
              <div className="podium-row">
                <span>{medal(p)} {p.name}{p.id === me && ' (you)'}</span>
                <b>{draw ? `${p.score} pts` : `${words.length} ${words.length === 1 ? 'word' : 'words'}`}</b>
              </div>
              {words.length > 0 && <WordList items={words} />}
            </li>
          );
        })}
      </ol>
      {draw && (
        <ul className="turn-summary">
          {game.history.map((h, i) => (
            <li key={i}>{h.emoji} <b>{h.answer}</b> drawn by {h.drawerName}: {h.guessers.length ? `guessed by ${h.guessers.join(', ')}` : 'nobody got it'}</li>
          ))}
        </ul>
      )}
      {skipped.length > 0 && (
        <div className="skipped"><small className="muted">Nobody got</small><WordList items={skipped} /></div>
      )}
      <button className="btn primary" disabled={!ready} onClick={actions.again}>{ready ? 'Play Again' : 'Waiting for everyone to connect…'}</button>
      <p className="muted center">Play Again deals brand-new {draw ? 'words to draw' : 'words'}.</p>
      {isHost && <button className="btn" onClick={actions.lobby}>Back to lobby (change mode)</button>}
      <Leaderboard game={game} me={me} />
      <button className="btn ghost" onClick={actions.leave}>Leave room</button>
    </div>
  );
}

function Leaderboard({ game, me }) {
  if (!game.records.length) return null;
  const myName = game.players.find(p => p.id === me)?.name;
  return (
    <section className="board">
      <h3>🏆 Room leaderboard</h3>
      <div className="table-wrap">
        <table>
          <thead><tr><th>#</th><th>Player</th><th>Wins</th><th>Games</th><th>Words</th><th>Best 🎨</th></tr></thead>
          <tbody>
            {game.leaderboard.map((e, i) => (
              <tr key={e.name} className={e.name === myName ? 'me' : ''}>
                <td>{['🥇', '🥈', '🥉'][i] ?? i + 1}</td><td>{e.name}</td><td>{e.wins}</td><td>{e.games}</td><td>{e.words}</td><td>{e.drawBest || '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h4>Past games</h4>
      <ul className="records">
        {game.records.map(r => (
          <li key={r.at}>
            <span className="rec-mode">{MODE_ICON[r.mode]}</span>
            <span className="rec-scores">{[...r.players].sort((a, b) => b.score - a.score).map(p => `${p.name} ${p.score}`).join(' · ')}</span>
            <span className="rec-win">{r.winners.length === 1 ? `🏆 ${r.winners[0]}` : r.winners.length ? '🤝 Tie' : '–'}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
