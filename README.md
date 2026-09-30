# ⚡ Word Race

A 2–3 player, real-time "guess the word" party game for two devices on the same Wi-Fi.
A game has **3 rounds of 3 words**. Each word is just a picture (emoji) over a row of letter boxes with some letters missing.
There's no text hint, only the picture. Type straight into the empty boxes; the first player to fill them in correctly
scores. Each round hides more letters: **Easy**, then **Medium**, then **Hard**. The final screen shows how many words each
player guessed, and which ones. **Play Again** always deals 9 new words.

- **client/**: React + Vite
- **server/**: Node.js + Express + Socket.IO. The server is the source of truth: it picks the questions, checks answers, awards points and runs the timers.

## Play online (free hosting)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/C-H-E-T-A-N/wordrace)

`render.yaml` sets this up as a free Render web service. All players open the `https://….onrender.com` URL Render gives you,
from any network. Free instances sleep after 15 minutes idle, so the first visit afterwards takes ~50 s to wake up,
and a restart ends any running games (rooms are kept in memory).

## Requirements

- [Node.js](https://nodejs.org) 18 or newer (check with `node -v`)
- 2–3 devices on the **same Wi-Fi / LAN** (phones work too)

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

## Play on two devices

1. **Host computer:** open `http://localhost:5173`, type your name and click **Create Room**.
   The lobby shows a 4-letter room code and the LAN link.
2. **Other devices** (on the same Wi-Fi): open `http://<host-LAN-IP>:5173` (e.g. `http://192.168.1.10:5173`),
   enter a name and the room code, and click **Join Room**. You can also open the `/?room=CODE` link shown in the lobby.
3. Once at least 2 players are connected (green), the host clicks **Start Game**. A 3rd player is optional.

To test on one computer, use 2 or 3 browser tabs. Each tab is a separate player.

### Finding the host's LAN IP on Windows

The server prints it at startup. To look it up yourself, open **Command Prompt** or **PowerShell** and run:

```bash
ipconfig
```

Find your Wi-Fi adapter ("Wireless LAN adapter Wi-Fi") and use its **IPv4 Address**, e.g. `192.168.1.10`.

(macOS: `ipconfig getifaddr en0` · Linux: `hostname -I`)

### If the second device can't connect

- **Windows Firewall:** the first time Node starts, Windows asks whether to allow it. Tick **Private networks** and click Allow.
  If you dismissed the prompt, go to *Windows Security → Firewall & network protection → Allow an app through firewall*
  and allow **Node.js JavaScript Runtime** on Private networks.
- Your Wi-Fi network profile should be **Private**, not Public (*Settings → Network & Internet → Wi-Fi → your network*).
- Both devices must be on the same network. Guest Wi-Fi networks often block devices from talking to each other.
- Use `http://`, not `https://`.

## Production-style run (optional)

This builds the client once and serves everything from one port:

```bash
npm run build
npm start
```

Then open `http://<host-LAN-IP>:3001` on both devices.

## Tests

```bash
npm test
```

This checks the question pool (270 questions, all unique), answer normalization, hidden-letter patterns,
no-repeat dealing across 90 games, harder patterns each round, the pause/skip rules, and the race where two or three players answer correctly at nearly the same moment
(only the first gets the point).

## How it works

| Topic | Behavior |
|---|---|
| **Rooms** | 4-letter code, 2–3 players, stored in server memory |
| **Questions** | 270 questions in 10 categories (`server/questions.js`). Each room shuffles the whole pool once and deals from it in order. `usedItems` / `usedWords` sets reject anything already played. When the pool runs out, it reshuffles but still excludes the last game. |
| **Hidden letters** | Generated fresh for each word. Round 1 hides ~35% of the letters, round 2 ~60%, round 3 ~85%. The first letter always stays visible (`HIDE_BY_ROUND` in `server/game.js`). |
| **Letter boxes** | Focus jumps to the next empty box as you type, and Backspace goes back. The guess is sent as soon as every box is filled. A wrong guess shakes and clears the boxes. |
| **Answers** | Case, spaces and punctuation are ignored. Typing the full word or only the missing letters both count. |
| **Race condition** | Node processes socket events one at a time. The first correct answer locks the word, and every later submission is rejected. |
| **Timer** | 15 s per word. When it runs out, the word is **not** skipped: it pauses (⏸) and everyone can keep guessing. Only the host can skip a word, and only after the 15 s are up. After each word there's a 3 s result screen (5 s at the end of a round). The server runs the clock, and clients receive the *remaining* time, so device clocks don't need to match. |
| **Answer secrecy** | The correct word is only sent to browsers after the word is locked |
| **Refresh / reconnect** | Each tab remembers its room and player ID in `sessionStorage` and rejoins automatically. A dropped player keeps their seat for 60 s while the others see "*X disconnected. Waiting for them to reconnect...*". |
| **Leaving** | If a player leaves or doesn't return within 60 s, a 3-player game continues with 2; with fewer than 2 players it returns to the lobby. If the host left, the other player becomes host. |
| **Errors** | Invalid room code, full room and duplicate name each show a friendly message |

Settings are at the top of `server/game.js` (`ROUNDS`, `WORDS_PER_ROUND`, `WORD_MS`, `HIDE_BY_ROUND`, …). Change the server port with the
`GAME_PORT` environment variable, and update the proxy target in `client/vite.config.js` to match.
