# ⚡ Word Race

A real-time multiplayer party game for **2–8 players** on phones and computers, either on the same Wi-Fi or online.
One room, one lobby: the host picks one of four game modes.

| Mode | How it plays |
|---|---|
| 🖼️ **Picture** | Only a picture (emoji). Type what it is, or press 🎤 and **say it**. Stuck? When **every player** presses *Ask for a hint*, a one-line hint appears. 3 words per round. |
| 🔤 **Letters** | No picture, just the word with missing letters. Type straight into the empty boxes. Each round hides more letters (Easy → Medium → Hard), spread over however many rounds you play. 3 words per round. |
| ⚡ **Classic** | Picture + hint + word with missing letters, type it in the box and Submit. 1 word per round, 30 s each; if time runs out nobody scores. |
| 🎨 **Draw & Guess** | Pictionary. Players take turns drawing a secret word on a shared canvas while everyone else guesses. Points for fast guessers and for the drawer. |

**Rounds:** in the lobby the host sets how many rounds the selected mode has (each mode remembers its own):

| Mode | Default | Range | One round is |
|---|---|---|---|
| Picture | 3 | 1–10 | 3 words |
| Letters | 3 | 1–10 | 3 words |
| Classic | 4 | 1–10 | 1 word |
| Draw & Guess | 1 | 1–5 | every player draws once |

In Picture and Letters, a word doesn't skip when its 15 s run out: it pauses (⏸) so everyone can keep guessing,
and the host may skip it. Every finished game is saved to the room's **leaderboard** (wins, games, words guessed,
best Draw & Guess score) and the list of past games, shown in the lobby and on the end screen.

- **client/**: React + Vite
- **server/**: Node.js + Express + Socket.IO. The server is the source of truth: it picks the words, checks every answer, awards points, runs the timers and decides whose turn it is.

## Play online (free hosting)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/C-H-E-T-A-N/wordrace)

`render.yaml` sets this up as a free Render web service. All players open the `https://….onrender.com` URL Render gives you,
from any network. Free instances sleep after 15 minutes idle, so the first visit afterwards takes ~50 s to wake up,
and a restart ends running games and clears room leaderboards (rooms are kept in memory).

## Requirements

- [Node.js](https://nodejs.org) 18 or newer (check with `node -v`; with nvm: `nvm use 22`)
- 2–8 devices on the **same Wi-Fi / LAN** (phones work too)

## Run it

Run these on the host computer, from the `wordrace` folder:

```bash
npm install
npm run dev
```

This starts:
- the game server on port **3001**
- the web app on port **5173**, which forwards `/socket.io` to the server so the browser only needs one address

The terminal prints the address to use, for example:

```
Word Race server listening on 0.0.0.0:3001
Open the game from another device on the same Wi-Fi:
   dev:   http://192.168.1.10:5173      (npm run dev)
```

## Play on two or more devices (same Wi-Fi)

1. **Host computer:** open `http://localhost:5173`, type your name and click **Create Room**.
   The lobby shows a 4-letter room code and the LAN link.
2. **Every other device** (same Wi-Fi): open `http://<host-LAN-IP>:5173` (e.g. `http://192.168.1.10:5173`),
   enter a name and the room code, and click **Join Room**. Or open the `/?room=CODE` link shown in the lobby.
3. The host picks a **game mode** and the number of **Rounds** (everyone sees both) and clicks **Start**. At least 2 connected players are needed.
4. After the game: **Play Again** deals brand-new words in the same mode; the host's **Back to lobby** lets you switch modes.

To test on one computer, open several browser tabs. Each tab is a separate player.

### Draw & Guess on several devices

1. In the lobby the host selects **🎨 Draw & Guess** and, optionally, the number of **Rounds** (1–5).
   Each round everyone draws once, in join order: with 3 players and 2 rounds it's A → B → C → A → B → C.
2. **The drawer** sees *Your word:* and draws it on the canvas with a finger or the mouse:
   4 brush sizes, 8 colours, eraser and clear. Phones work well as drawing pads.
3. **Everyone else** watches the drawing appear live and types guesses below it. Wrong guesses appear in the
   feed for all to see; a correct guess is announced (*🎉 Ana guessed it!*) without revealing the word,
   and that player can't guess again but keeps watching.
4. A turn ends when **everyone has guessed** or after **60 s**. The result card shows the word and the points.

Scoring: 1st correct guesser **+100**, 2nd **+75**, 3rd **+50**, later ones less. The drawer gets up to **+100**,
in proportion to how many guessers got it. If the drawer disconnects, their turn ends at once and the next player draws;
a player who is away when their turn comes up is skipped.

### Voice answers (Picture mode)

🎤 uses the browser's speech recognition (Chrome, Edge, Safari). Browsers only allow the microphone on **https** pages
or `localhost`, so it works on the online (Render) link and on the host computer, but **not** on other devices
using the plain `http://192.168…` LAN address. Those players can type instead. "a penguin", "penguins", "Penguin" all count.

### Finding the host's LAN IP on Windows

The server prints it at startup. To look it up yourself, open **Command Prompt** or **PowerShell** and run:

```bash
ipconfig
```

Find your Wi-Fi adapter ("Wireless LAN adapter Wi-Fi") and use its **IPv4 Address**, e.g. `192.168.1.10`.

(macOS: `ipconfig getifaddr en0` · Linux: `hostname -I`)

### If another device can't connect

- **Windows Firewall:** the first time Node starts, Windows asks whether to allow it. Tick **Private networks** and click Allow.
  If you dismissed the prompt, go to *Windows Security → Firewall & network protection → Allow an app through firewall*
  and allow **Node.js JavaScript Runtime** on Private networks.
- Your Wi-Fi network profile should be **Private**, not Public (*Settings → Network & Internet → Wi-Fi → your network*).
- All devices must be on the same network. Guest Wi-Fi networks often block devices from talking to each other.
- Use `http://`, not `https://`.

## Production-style run (optional)

This builds the client once and serves everything from one port:

```bash
npm run build
npm start
```

Then open `http://<host-LAN-IP>:3001` on every device.

## Tests

```bash
npm test
```

Checks the game rules without a network: the question pools (270 quiz questions, 170 drawing words, all unique),
answer matching, letter patterns, no repeats across many games for both pools, every mode's flow, hint voting,
Draw & Guess rotation / scoring / secrecy / disconnects, and the leaderboard.

With `npm run dev` running, this plays real multiplayer games over Socket.IO with 4 clients
(simultaneous guesses, drawer and guesser disconnects, reconnects, Play Again, secret word never sent to guessers):

```bash
node server/e2e.mjs
```

## How it works

| Topic | Behavior |
|---|---|
| **Rooms** | 4-letter code, 2–8 players, stored in server memory. Mode and rounds are room settings only the host can change, between games. |
| **Word pools** | Quiz modes: 270 questions in 10 categories (`server/questions.js`). Draw & Guess: its own list of easy-to-draw words in 11 categories (`server/drawWords.js`). Each room shuffles each pool once and deals from it in order; `usedItems` / `usedWords` sets reject anything already played. When a pool runs out it reshuffles but still excludes the game just played. |
| **Answers** | Case, spaces, punctuation, a leading "a/an/the" and simple plurals are ignored. In Letters/Classic, typing only the missing letters also counts. Voice input sends the recogniser's alternatives and the server checks each. |
| **Race condition** | Node processes socket events one at a time. The first correct answer locks the word, so later ones get nothing. In Draw & Guess, the order correct guesses arrive in decides 100 / 75 / 50. |
| **Secrets** | Answers are only sent to everyone once a word or turn is over. The Draw & Guess word goes only to the drawer's socket (`draw-game:word`), and to a guesser only in the reply to their own correct guess. |
| **Drawing sync** | The drawer's strokes are small segments `{x, y, px, py, w, c, t}` in 0–1 coordinates (any screen size), batched ~30 times a second (`draw-game:stroke`). The server only accepts them from the current drawer, validates them, relays them to the room and keeps them so a refreshed player gets the picture back (`draw-game:sync`). `draw-game:clear` wipes it. |
| **Timers** | Run on the server; clients get the *remaining* time so device clocks don't matter. Picture/Letters 15 s (then pause), Classic 30 s, Draw & Guess 60 s. |
| **Refresh / reconnect** | Each tab remembers its room and player ID in `sessionStorage` and rejoins automatically. A dropped player keeps their seat for 60 s while the others see "*X disconnected. Waiting for them to reconnect...*". |
| **Leaving** | A game carries on while 2+ players remain; below that it returns to the lobby. If the host leaves, the next player becomes host. |
| **Leaderboard** | Kept per room by player name (survives leaving and rejoining the room), newest 50 games. |
| **Errors** | Invalid room code, full room and duplicate name each show a friendly message. |

Settings are at the top of `server/game.js` (`MODES`, `GUESS_POINTS`, `DRAWER_MAX`, `MAX_PLAYERS`, …). Change the server port with the
`GAME_PORT` environment variable, and update the proxy target in `client/vite.config.js` to match.
