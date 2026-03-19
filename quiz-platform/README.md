# Classroom Quiz Platform

**Public-facing open-source quiz platform** for classroom and small-team use.

- 1 teacher + up to 9 team clients
- Local network operation (works offline after starting)
- Built with Node.js, Express, Socket.io, and static web UI

## 🚀 Quick Start (Public Use)

1) Clone repository

```bash
git clone https://github.com/Pon-Ajith-Kumar/exam-repo.git
cd exam-repo/quiz-platform
```

2) Install dependencies

```bash
npm install
```

3) Start server

```bash
npm start
```

4) Open browsers

- Team screen (any device on LAN): `http://<host-ip>:3000`
- Teacher panel: `http://<host-ip>:3000/teacher`

> Tip: `localhost` works on host machine only; use IP for mobile devices.

## 📁 Project Structure

- `package.json` - dependencies and start script
- `server.js` - backend state, Socket.io logic, game event flow
- `questions.json` - quiz question bank (stage1/stage2/stage3)
- `public/index.html` + `public/team.js` - team UI
- `public/teacher.html` + `public/teacher.js` - teacher UI
- `public/style.css` - shared styling

## 🎮 Gameplay Overview

This quiz platform has 3 auto-managed stages:

- Stage 1: open round, timed answers, speed-based scoring
- Stage 2: semifinal, limited teams, one attempt per question
- Stage 3: final, best-of with multiple attempts and bonuses

### Available features for all users

- Team join with name (letters/numbers/spaces, max 30)
- Real-time leaderboard updates
- Answer timers, response times, attempt history
- Teacher controls: Start Question, Next Question, Next Round
- Projector view of current question from teacher panel

## 🛠️ Configure Questions

`questions.json` format:

```json
{
  "stage1": [{ "id": "S1Q1", "text": "...", "options": ["A","B","C","D"], "correct": "A" }],
  "stage2": [],
  "stage3": []
}
```

- `correct` must be `A`, `B`, `C`, or `D`
- Exactly four options required per question
- Restart server after editing questions

## 🔧 Development Notes

- Max 9 teams (UI + server limits)
- State is in-memory; server restart resets game
- New teams cannot join once the quiz starts
- Reconnect via same name if disconnected

## 🛠️ Troubleshooting

- Port conflicts: stop other process on `3000`, then restart
- Mobile join failures: ensure same Wi-Fi/LAN and correct host IP
- Teacher warning “Question already completed”: click Next Question

## 🤝 Contribution

1) Fork repository
2) Create feature branch `feature/<name>`
3) Open PR with details and screenshots

## 📜 License

MIT License (add file in repo root if not present)

