# Classroom Quiz Platform

Real-time classroom MCQ quiz system for **1 teacher + up to 9 teams**, built with Node.js, Express, and Socket.io.

This app is designed for classroom/projector use on a local network (no internet required after setup).

## What’s New (Latest Updates)

- Team and teacher views now show **response time in seconds** for answers.
- Team side now shows competitor response times in the live leaderboard.
- Team “Your Progress” table now includes per-question answer time.
- Teacher panel includes a **projector question panel** (question + options, read-only).
- In **Stage 3 only**, projector question stays visible after a question ends and disappears only after clicking **Next Question**.

## Quick Start

### 1) Install dependencies

```bash
npm install
```

### 2) Start server

```bash
npm start
```

### 3) Open URLs

- Team screen: `http://localhost:3000`
- Teacher panel: `http://localhost:3000/teacher`

For other devices on the same hotspot/LAN:

- Team screen: `http://<host-ip>:3000`
- Teacher panel: `http://<host-ip>:3000/teacher`

The server listens on `0.0.0.0:3000`.

## Project Structure

```text
quiz-platform/
├── package.json
├── questions.json
├── server.js
└── public/
    ├── index.html      # Team UI
    ├── team.js
    ├── teacher.html    # Teacher UI
    ├── teacher.js
    └── style.css
```

## How the Quiz Works

The quiz has 3 stages with different rules.

### Stage 1 (Open Round)

- All teams play.
- Start score: **500** per team.
- Timer: **20 seconds** per question.
- Correct answers are speed-ranked:
  - 1st: 1000
  - 2nd: 900
  - 3rd: 800
  - 4th: 700
  - 5th: 600
  - 6th+ correct: 500
- First wrong attempt can use one paid retry:
  - Retry cost: **250** points
  - If retry is wrong: extra **-350** penalty

End of Stage 1:

- Top team becomes **Finalist 1**.
- Next teams continue as semifinalists.
- Others are eliminated.

### Stage 2 (Semifinal)

- Only semifinalists play.
- Timer: **30 seconds** per question.
- One attempt only.
- Speed points:
  - 1st: 2500
  - 2nd: 1500
  - 3rd: 1000

End of Stage 2:

- Top semifinalist becomes **Finalist 2**.

### Stage 3 (Final)

- Only 2 finalists play.
- No timer limit.
- Up to 3 attempts:
  - 1st attempt correct: 100
  - 2nd attempt correct: 75
  - 3rd attempt correct: 50
- First correct team for that question gets **+100 bonus**.

Highest score at the end wins.

### Tie-Breakers

If needed, built-in tie-break questions are used for stages 1/2/3.

## Team Screen Features (`/`)

- Join with team name (letters/numbers/spaces only, max 30 chars).
- Auto-reconnect with saved team name.
- Live question + answer buttons A/B/C/D.
- Live timer, score, attempts, feedback.
- Live leaderboard with rank movement.
- Competitor and self response times shown during active questions.
- “Your Progress” table includes:
  - Stage
  - Question number
  - Answer
  - Time (seconds)
  - Correct/Wrong
  - Points delta

## Teacher Panel Features (`/teacher`)

### Controls

- **Start Question**: activates current question.
- **Next Question**: finalizes active question if needed, then moves forward.
- **Next Round**: moves to next stage (with confirmation).

Keyboard shortcuts:

- `S` = Start Question
- `N` = Next Question
- `R` = Next Round

### Projector Panel (Read-only)

- Appears below the 3 control buttons when a question is active.
- Displays current question and options for projector audience.
- Not answerable from teacher panel.
- Stage behavior:
  - Stage 1/2: hides when question is inactive.
  - Stage 3: stays visible after question end; hides on **Next Question**.

### Monitoring Views

- Live leaderboard with stage highlights and rank changes.
- Team Answers table for current question:
  - Team name
  - Answer
  - Attempt count
  - Timestamp
  - Response time (seconds)
  - Correct status

## Questions Configuration

Questions are loaded from `questions.json` at server start.

Expected format:

```json
{
  "stage1": [
    {
      "id": "S1Q1",
      "text": "Question text",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "correct": "A",
      "explanation": "Optional explanation"
    }
  ],
  "stage2": [],
  "stage3": []
}
```

Rules:

- `correct` must be one of: `A`, `B`, `C`, `D`.
- Each question should include exactly 4 options.
- Restart server after changing `questions.json`.

## Important Notes

- Max teams: **9**.
- Quiz state is in-memory; restarting server resets running quiz.
- New teams cannot join after quiz has started.
- Reconnecting with the same team name is supported.

## Troubleshooting

### Port already in use

- Stop old process using port 3000, then run `npm start` again.

### Teams cannot connect from phones

- Ensure all devices are on same Wi-Fi/hotspot.
- Use host machine IP (not localhost) on phones.
- Check firewall allows port `3000`.

### “Question already completed” in teacher panel

- Click **Next Question** to move forward.
