# Classroom Quiz Platform

**Public-facing open-source quiz platform** for classroom and small-team use.
- Real-time classroom MCQ quiz system for **1 teacher + up to 9 teams**, built with Node.js, Express, and Socket.io.

- This app is designed for classroom use on a local network (no internet required after setup).

- Built with Node.js, Express, Socket.io, and static web UI

## 🚀 Quick Start (Public Use)

### 1) Clone repository

```bash
git clone https://github.com/Pon-Ajith-Kumar/exam-repo.git
cd exam-repo/quiz-platform
```

### 2) Install dependencies

```bash
npm install
```

### 3) Start server

```bash
npm start
```

### 4) Open URLs

- Team screen: `http://localhost:3000`
- Teacher panel: `http://localhost:3000/teacher`

For other devices on the same hotspot/LAN:

- Team screen: `http://<host-ip>:3000`
- Teacher panel: `http://<host-ip>:3000/teacher`

The server listens on `0.0.0.0:3000`.

## Teacher Authentication

- Accessing `/teacher` requires a simple prompt password: `1025`.
- Incorrect password redirects users to the team screen.

## 📁 Project Structure

```text
quiz-platform/
├── package.json        # dependencies and start script
├── questions.json      # quiz question bank (stage1/stage2/stage3)
├── server.js           # backend state, Socket.io logic, game event flow
├── INSTRUCTIONS.md
├── README.md
└── public/
    ├── index.html      # Team UI
    ├── team.js
    ├── teacher.html    # Teacher UI
    ├── teacher.js
    └── style.css       # shared styling
```

## 🎮 Gameplay - How the Quiz Works?
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
  - Retry cost: **250** points.
  - Second wrong (after retry) incurs **-350** penalty.

End of Stage 1:

- Top team becomes **Finalist 1**.
- Next teams become semifinalists (up to 8 additional teams).
- Remaining teams are eliminated.

### Stage 2 (Semifinal)

- Only semifinalists play.
- Timer: **30 seconds** per question.
- One attempt per team.
- Speed points:
  - 1st: 2500
  - 2nd: 1500
  - 3rd: 1000

End of Stage 2:

- Top semifinalist becomes **Finalist 2**.
- Finalists proceed to Stage 3.

### Stage 3 (Final)

- Only 2 finalists play.
- No timer limit for this stage.
- Up to 3 attempts:
  - 1st attempt correct: 100
  - 2nd attempt correct: 75
  - 3rd attempt correct: 50
- First correct answer on a question gets additional **+100 bonus**.

### Tie-Breakers

- If top teams tie in a stage, a tie-break question runs.
- Tie-breakers may be loaded from `questions.json` under `tieBreakers`, or use built-in fallback questions.


## Team Screen Features (`/`)

- Join with valid team name (letters/numbers/spaces only, max 30 chars).
- Auto-reconnect with existing team name on refresh/reconnect.
- Live question text, answer options, timer, score, and stage information.
- Answer buttons A/B/C/D with immediate feedback.
- Live leaderboard with competitor times and score changes.
- “Your Progress” table:
  - Stage
  - Question number
  - Answer
  - Time (seconds)
  - Correct/Wrong
  - Points delta

## Teacher Panel Features (`/teacher`)

### Controls

- **Start Question**: starts the current question.
- **End Question**: finalizes and scores the current question.
- **Next Question**: ends if active then advances to next question/stage.
- **Next Round**: force stage transition (Stage1→Stage2→Stage3).
- **Reset Attempts**: clears current question attempts for all teams.
- **Reset All**: resets the full quiz state, all teams and scores.

Keyboard shortcuts:

- `S` = Start Question
- `N` = Next Question
- `R` = Next Round

### Projector behavior

- Active question shows in projector view.
- Stage 1/2: projector hides when question is inactive.
- Stage 3: projector remains visible after question end until Next Question.

### Monitoring views

- Live leaderboard with stage status and rank movement.
- Team answers table for current question:
  - Team name
  - Answer
  - Attempts
  - Timestamp
  - Response time
  - Correct status

## 🛠️ Configure Questions

`questions.json` is loaded at server startup.

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
  "stage3": [],
  "tieBreakers": {
    "stage1": { "id": "TB-S1", "text": "...", "options": ["..."], "correct": "..." },
    "stage2": { "id": "TB-S2", "text": "...", "options": ["..."], "correct": "..." },
    "stage3": { "id": "TB-S3", "text": "...", "options": ["..."], "correct": "..." }
  }
}
```

Rules:

- `correct` must be one of: `A`, `B`, `C`, `D`.
- Exactly 4 options are required.
- Add `tieBreakers` section for stage tie-break questions if desired.
- Restart server after editing `questions.json`.

## 🔧 Development Notes

- Quiz state is in-memory (server restarts clear progress).
- New teams cannot join after quiz activity has started.
- Teams reconnect by using the same team name after disconnect.

### Troubleshooting

### Port already in use

- Stop the process on port `3000` and restart server.

### Phone/device connection issues

- Confirm all devices are on the same Wi-Fi/LAN.
- Use host IP (not `localhost`) from mobile browsers.
- Verify firewall allows traffic on port `3000`.

### Teacher issues

- “Question already completed”: click Next Question to proceed.
- Cannot start a question if another is active (finalize first).

## 🤝 Contribution

1) Fork repository
2) Create feature branch `feature/<name>`
3) Open PR with change description and screenshots