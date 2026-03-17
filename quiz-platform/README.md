# Classroom Quiz Platform

A real-time, offline-capable multiple-choice quiz platform for classroom use — supporting up to **9 teams** and **1 teacher**, built with Node.js, Express, and Socket.io.

---

## Overview

The platform runs a structured three-stage quiz competition where teams answer multiple-choice questions (A/B/C/D) in real time from their own devices. The teacher controls the flow of the quiz from a dedicated control panel. Scoring is speed-based, and teams are progressively eliminated across stages until two finalists compete in a head-to-head final.

---

## Tech Stack

| Layer     | Technology              |
|-----------|-------------------------|
| Server    | Node.js + Express       |
| Realtime  | Socket.io (WebSockets)  |
| Frontend  | Vanilla HTML/CSS/JS     |
| Data      | `questions.json` (flat file) |

---

## Getting Started

```bash
npm install
node server.js
```

| Role    | URL                                   |
|---------|---------------------------------------|
| Teams   | `http://<laptop-ip>:3000`             |
| Teacher | `http://<laptop-ip>:3000/teacher`     |

For local testing:
- `http://localhost:3000`
- `http://localhost:3000/teacher`

The server runs on port **3000** and binds to all network interfaces (`0.0.0.0`), making it accessible over a local hotspot without internet.

---

## Quiz Structure

The quiz runs across **three stages**, each with different rules and scoring.

### Stage 1 — Open Round (10 questions, up to 9 teams)

- All registered teams participate.
- Each team starts with **500 points**.
- **20-second timer** per question.
- Speed-based bonus points for correct answers (awarded to the first 5 correct teams):

  | Rank | Points |
  |------|--------|
  | 1st  | 1000   |
  | 2nd  | 900    |
  | 3rd  | 800    |
  | 4th  | 700    |
  | 5th  | 600    |
  | 6th+ | 500    |

- **Retry mechanic**: If a team answers incorrectly on their first attempt, they may purchase a second attempt for **250 points**. If the retry answer is also wrong, an additional **350 points** are deducted.
- At the end of Stage 1:
  - The **top-scoring team** advances directly as **Finalist 1**.
  - The **next 8 teams** advance to Stage 2 (Semifinal).
  - All remaining teams are eliminated.

### Stage 2 — Semifinal (3 questions, up to 8 teams)

- Only teams that qualified from Stage 1 participate.
- **1 attempt only** per question (no retry).
- Speed-based scoring:

  | Rank | Points |
  |------|--------|
  | 1st  | 2500   |
  | 2nd  | 1500   |
  | 3rd  | 1000   |

- At the end of Stage 2:
  - The **top-scoring semifinalist** advances as **Finalist 2**.
  - All other teams are eliminated.

### Stage 3 — Final (3 questions, 2 teams)

- Only the two finalists compete.
- Up to **3 attempts** per question.
- Points per correct answer scale by attempt used:

  | Attempt | Points |
  |---------|--------|
  | 1st     | 100    |
  | 2nd     | 75     |
  | 3rd     | 50     |

- The **first team to answer correctly** in each question earns an additional **100 bonus points**.
- The finalist with the highest score at the end wins.

---

## Roles

### Team View (`/`)

- Enter a team name to join (max 9 teams).
- See the current question text and answer with buttons A–D.
- Countdown timer shows time remaining.
- Score, attempt count, and feedback messages update in real time.
- Live leaderboard visible at all times.

### Teacher Panel (`/teacher`)

Controls the entire quiz flow:

| Button            | Action                                                    |
|-------------------|-----------------------------------------------------------|
| Start Question    | Activates current question and starts the 20s timer       |
| End Question      | Manually closes the question and triggers scoring         |
| Correct: A/B/C/D  | Selects the correct answer before ending the question     |
| Next Question     | Advances to the next question within the current stage    |
| Move to Next Stage| Triggers end-of-stage elimination logic and moves forward |
| Reset Attempts    | Clears all answers/attempts for the current question      |

The teacher panel also shows:
- The current question text and active/idle status.
- A live table of all team answers, attempt counts, timestamps, and correctness.
- The full leaderboard with each team's score and elimination status.
- The finalists and stage winners when determined.

---

## Questions

Questions are loaded from `questions.json` at startup. The file is structured as three arrays keyed by stage:

```json
{
  "stage1": [ { "id": "S1Q1", "text": "...", "options": ["A. ...", ...], "correct": "A" }, ... ],
  "stage2": [ ... ],
  "stage3": [ ... ]
}
```

To customise the quiz, edit `questions.json` and restart the server. The format requires:
- `id` — unique question identifier
- `text` — question body
- `options` — array of exactly 4 strings (prefixed A–D)
- `correct` — the correct option letter (`"A"`, `"B"`, `"C"`, or `"D"`)

---

## Key Constraints

- Maximum **9 teams** can register.
- Teams can reconnect using the same team name if they lose connection.
- The quiz state lives entirely in server memory; **restarting the server resets everything**.
- The teacher can trigger a full reset at any time via `teacher:resetAll` (Socket.io event).
