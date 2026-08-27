# CONTRACT // HITMAN

A turn-based elimination card game. Phases 1 to 3 of 5 are built: the **rules
engine** with its tests, a **single-player game against bots**, and **real-time
multiplayer** with private rooms and invite codes. Matchmaking and chat are
Phase 4; polish and the App Store builds are Phase 5.

## Playing it

Two things have to be running. Open two terminals in this folder.

Terminal one, the game server:

```
npm run server
```

Terminal two, the website:

```
npm run dev
```

Then open the address the second one prints (usually http://localhost:5173).
Works on a phone in portrait, which is what it is designed for.

## Playing against other people

- **PLAY THE BOTS** needs no server and no internet. Offline, instant.
- **CREATE A PRIVATE ROOM** gives you a 4-character invite code and a link.
  Anyone with either can sit down. The host can fill spare seats with bots.
- **JOIN** takes a code from a friend.

To test it yourself, open the site in two browser tabs. Each tab is a separate
player - identity is stored per tab, not per browser, exactly so this works.

## Deploying it

The server is a plain Node app that serves the website and the game from one
address. `Dockerfile` and `render.yaml` are both here, so any host that takes a
container or a Node repo will run it. It listens on `PORT` and answers
`/healthz`.

## Checking that the rules work

Open a terminal in this folder and run:

```
npm run check
```

It prints one line per rule in plain English, and a total at the end. If
anything is wrong it says so and tells you exactly which rule broke.

## What is in here

| Folder | What it holds |
|---|---|
| `src/config/balance.ts` | **Every tunable number.** Deck sizes, timers, hand size. Nothing else in the project hard-codes a game number. |
| `src/engine/` | The rules. Pure logic, no graphics, so it can be reused by a phone app later. |
| `src/engine/__tests__/` | The rule checks. |
| `src/bots/` | The computer opponents, plus a test that plays hundreds of whole matches end to end. |
| `src/client/` | The screen: layout, styling, and both match drivers - offline and networked. |
| `src/server/` | Rooms, invite codes, disconnects, and the WebSocket server. |
| `src/shared/` | The message shapes the browser and server agree on. |
| `scripts/plain-report.ts` | Turns the test output into plain English. |

## The numbers as they stand

Deck size grows with the player count: `count = base + floor(perExtraPlayer × (players − 2))`.

| Players | Cards to draw from | Hitman cards | Hitman density |
|---|---|---|---|
| 2 | 21 | 1 | 4.8% |
| 5 | 37 | 4 | 10.8% |
| 10 | 77 | 9 | 11.7% |

Hitman cards are never seeded in the top 40% of the deck, so a match opens safe
and turns lethal as the deck thins.

Other current settings: 15-second turn clock, 2-second quick-card window,
5-second choice prompts, 4 dealt cards plus 1 free Angel, 45-second disconnect
grace, response chains capped at 3, hand ceiling 20, maximum 12 players.

**These are first guesses and will change after real people play.**

## Rules decided where the brief was silent

- **Angel** is never played by hand. It is consumed automatically the moment you
  draw a Hitman, and it is gone afterwards. The next Hitman kills you.
- **Response chains** cap at 3 responses. Cards resolve last-played-first.
- **Mirror** re-triggers the last non-quick card played. Mirroring another quick
  card does nothing, which keeps chains bounded. It can never produce an Angel:
  an Angel firing is a reaction to a draw, not a card anyone played, so it never
  becomes "the last card played". Drawing a Hitman opens no reflex window
  either, so there is no moment to play a Mirror into.
- **Burn** destroys the card it was played on plus every copy of that type in
  every hand. The deck and discard pile are untouched.
- **Lock offers no choice.** It bans the type of the card played immediately
  before it, for exactly 3 player-turns, counted down visibly. Hitman and Angel
  can never be banned because neither is ever played from a hand. If nothing has
  been played yet, Lock cannot be played. *(This departs from the brief, which
  had the player choose the type. Changed on Mr K's instruction.)*
- **Bottom Pull** replaces your end-of-turn draw with one from the bottom.
- **Every clock freezes** while any player is making a choice.
- **Steal, Attack, Mimic** cannot target yourself or an eliminated player.
- **Mimic is a swap, not a windfall.** You throw your whole hand away, Angel
  and all, and take a copy of theirs in its place. They keep theirs. Copying a
  hoarder can hand you two spare lives; copying someone empty-handed costs you
  everything for nothing. *(The brief had Mimic as a free copy on top of your
  existing hand. Changed on Mr K's instruction.)*
- **Mimic never copies another Mimic.** If it did, one Mimic would become two,
  then four, and hands would grow without limit until the game locked up. This
  was found by playing hundreds of bot matches, not by reading the brief.
- **Hand ceiling of 20**, purely so a hand stays readable on a phone. With the
  Mimic rule above it almost never bites.
- **A dropped player does not stop the table.** They keep their seat and their
  hand for 45 seconds, their turns auto-draw while they are gone, and they are
  put straight back if they return. After 45 seconds they forfeit.
- **Walking out mid-match is a forfeit**, not a pause.
- **Identity is per browser tab**, not per browser, so two tabs on one machine
  are two different players.
