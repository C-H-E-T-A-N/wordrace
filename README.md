# ⚡ Word Race

A real-time multiplayer party game for **2–8 players** on phones and computers, either on the same Wi-Fi or online.
One room, one lobby: the host picks one of seven game modes.

| Mode | How it plays |
|---|---|
| 🖼️ **Picture** | Only a picture (emoji). Type what it is, or press 🎤 and **say it**. Stuck? When **every player** presses *Ask for a hint*, a one-line hint appears. 3 words per round. |
| 🔤 **Letters** | No picture, just the word with missing letters. Type straight into the empty boxes. Each round hides more letters (Easy → Medium → Hard), spread over however many rounds you play. 3 words per round. |
| ⚡ **Classic** | Picture + hint + word with missing letters, type it in the box and Submit. 1 word per round, 30 s each; if time runs out nobody scores. |
| 🎨 **Draw & Guess** | Pictionary. Players take turns drawing a secret word on a shared canvas while everyone else guesses. Points for fast guessers and for the drawer. |
| 🏃 **Relay Draw** | Only the first artist sees the word. The drawing is passed around: everyone adds a 15 s leg without knowing what it is, then everyone guesses. |
| 🕵️ **Odd One Out** | Everyone gets the same secret word except the imposter, who gets a related one (and doesn't know it). One-word clues, a vote, and a last guess. 3+ players. |
| 🔠 **Categories** | Scattergories-style: a random letter and 6 categories (Animal, Food, Country, Movie…). Write one answer per category starting with that letter. Only answers nobody else gave score. |

**Points in answer order:** in Picture, Letters and Classic (and Draw & Guess / Relay) the 1st correct answer gets
**100**, the 2nd **75**, the 3rd **50**, then 25, 13, 10… A correct answer no longer ends the word: everyone can still
get it until time runs out (and once you have it, your input locks). A word ends early when everyone has it.

**Rounds:** in the lobby the host sets how many rounds the selected mode has (each mode remembers its own):

| Mode | Default | Range | One round is |
|---|---|---|---|
| Picture | 3 | 1–10 | 3 words |
| Letters | 3 | 1–10 | 3 words |
| Classic | 4 | 1–10 | 1 word |
| Draw & Guess | 1 | 1–5 | every player draws once |
| Relay Draw | 3 | 1–8 | one word, passed through every player |
| Odd One Out | 3 | 1–8 | one word pair, a new imposter |
| Categories | 3 | 1–8 | one letter × 6 categories |

In Picture and Letters, a word doesn't skip when its 15 s run out with **nobody** right: it pauses (⏸) so everyone can
keep guessing, and the host may skip it. Once someone gets a paused word, the others get a **5 s last call**. Every finished game is saved to the room's **leaderboard** (wins, games, words guessed,
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

### Relay Draw

1. Each round one player **starts**: only they see the word (⭐ in the drawing order shown on screen).
2. The pen passes along every connected player in **15 s legs**: everyone keeps drawing on the same canvas
   without knowing the word. There's no Clear button, so nobody can wipe the others' work (the eraser still works).
3. After the last leg, everyone except the starter has **30 s to guess**. Scoring is the same as Draw & Guess:
   100 / 75 / 50 for guessers, up to +100 for the starter depending on how many got it.
4. The starter rotates each round. A player who's away when their leg comes up is skipped.

### Odd One Out (3–8 players)

1. Each round everyone is privately given a word. All have the same one (e.g. **PARK**) except the **imposter**,
   who gets a related word (e.g. **GARDEN**). The imposter is **not told** they're the imposter.
2. **Clues:** players take turns typing **one word** (30 s each) describing their word without saying it.
   Clues that contain your own word, or have spaces, are rejected.
3. **Vote** (45 s): everyone votes for who they think has the different word. You can change your vote until
   everyone has voted. Most votes is accused; a tie accuses nobody.
4. If the imposter is caught they learn it and get **one guess at the crew's word** (20 s).
5. **Scoring:** imposter escapes → **+3**; caught but guesses the word → **+2**; caught and wrong → every crew member **+1**.
   Anyone who voted for the imposter also gets **+1**.
6. Everyone takes a turn as imposter before anyone gets a second turn. If the imposter leaves the room, that round ends with no points.

### Categories

1. **Write (60 s):** a letter (e.g. **S**) and 6 categories. Type one answer per category, starting with the letter
   ("the/a/an" are ignored, so *The Shining* counts for S). Answers are saved as you type and stay hidden from the
   others. Press **Done ✔** when finished; the round moves on when everyone is done or time is up.
2. **Review (40 s):** everyone's answers are shown. Wrong-letter answers are crossed out automatically. Press 👎 on any
   answer that doesn't fit its category; if **at least half of the other players** 👎 it, it doesn't count.
   Press **✔ Looks good** when you're happy (the round ends when everyone has).
3. **Scoring:** a valid answer nobody else gave → **+100**. If two or more players wrote the same thing (ignoring
   capitals, spaces and plurals: *Snake* = *snakes*), **none of them** score for it.
4. A new letter each round (hard letters Q, U, V, X, Y, Z are never picked) and categories don't repeat within a game.

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

Checks the game rules without a network: the word pools (270 quiz questions, 170 drawing words, 99 word pairs, 28 categories, all unique),
answer matching, letter patterns, no repeats across many games, every mode's flow, hint voting,
ordered points (100/75/50…), pause + last call, Draw & Guess / Relay rotation, scoring, secrecy and disconnects,
Odd One Out clues, votes, ties and last guesses, Categories drafts, vetoes and unique/shared scoring, and the leaderboard.

With the server running, this plays real multiplayer games over Socket.IO (Draw & Guess with 4 clients, Picture,
Classic with ordered points, Odd One Out with 4, Relay with 3, Categories with 3; simultaneous guesses, disconnects,
reconnects, Play Again, and secret words or drafts never reaching the wrong players). It takes about a minute and a half:

```bash
node server/e2e.mjs
```

## How it works

| Topic | Behavior |
|---|---|
| **Rooms** | 4-letter code, 2–8 players, stored in server memory. Mode and rounds are room settings only the host can change, between games. |
| **Word pools** | Quiz modes: 270 questions in 10 categories (`server/questions.js`). Draw & Guess / Relay: easy-to-draw words in 11 categories (`server/drawWords.js`). Odd One Out: 99 related word pairs (`server/imposterPairs.js`). Each room shuffles each pool once and deals from it in order; `usedItems` / `usedWords` sets reject anything already played. When a pool runs out it reshuffles but still excludes the game just played. |
| **Answers** | Case, spaces, punctuation, a leading "a/an/the" and simple plurals are ignored. In Letters/Classic, typing only the missing letters also counts. Voice input sends the recogniser's alternatives and the server checks each. |
| **Race condition** | Node processes socket events one at a time, so the order correct answers reach the server decides 100 / 75 / 50; two answers at the same instant never get the same place. Each player scores once per word. |
| **Secrets** | Answers are only sent to everyone once a word or turn is over. The Draw & Guess word goes only to the drawer's socket (`draw-game:word`; Relay: the starter's), and to a guesser only in the reply to their own correct guess. In Odd One Out each player's word goes only to their own socket (`imposter:word`); who the imposter is and how people voted stay hidden until the votes are counted. |
| **Drawing sync** | The drawer's strokes are small segments `{x, y, px, py, w, c, t}` in 0–1 coordinates (any screen size), batched ~30 times a second (`draw-game:stroke`). The server only accepts them from the current drawer, validates them, relays them to the room and keeps them so a refreshed player gets the picture back (`draw-game:sync`). `draw-game:clear` wipes it. |
| **Timers** | Run on the server; clients get the *remaining* time so device clocks don't matter. Picture/Letters 15 s (then pause, or a 5 s last call), Classic 30 s, Draw & Guess 60 s, Relay 15 s per leg + 30 s guessing, Odd One Out 30 s per clue / 45 s vote / 20 s last guess, Categories 60 s writing + 40 s review. |
| **Refresh / reconnect** | Each tab remembers its room and player ID in `sessionStorage` and rejoins automatically. A dropped player keeps their seat for 60 s while the others see "*X disconnected. Waiting for them to reconnect...*". |
| **Leaving** | A game carries on while enough players remain (2, or 3 for Odd One Out); otherwise it returns to the lobby. If the host leaves, the next player becomes host. |
| **Leaderboard** | Kept per room by player name (survives leaving and rejoining the room), newest 50 games: wins, games, total points and best single-game score. |
| **Errors** | Invalid room code, full room and duplicate name each show a friendly message. |

Settings are at the top of `server/game.js` (`MODES`, `GUESS_POINTS`, `DRAWER_MAX`, `MAX_PLAYERS`, …). Change the server port with the
`GAME_PORT` environment variable, and update the proxy target in `client/vite.config.js` to match.
