const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = 3000;
const QUESTION_TIME_SECONDS = 20;
const MAX_TEAMS = 9;

const questions = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'questions.json'), 'utf8')
);

const STAGE_CONFIG = {
  stage1: { total: 10, speedPoints: [1000, 900, 800, 700, 600], retryCost: 250 },
  stage2: { total: 3, speedPoints: [2500, 1500, 1000] },
  stage3: { total: 3 }
};

let quizState = createInitialState();

function createInitialState() {
  return {
    stage: 'stage1',
    questionIndex: 0,
    questionActive: false,
    questionStartTs: null,
    questionEndTs: null,
    timerEndsAt: null,
    currentQuestionId: null,
    finalists: [],
    teams: {},
    socketsByTeam: {},
    answersByQuestion: {},
    stageWinners: { stage1: null, stage2: null },
    teacherSocketId: null
  };
}

function getStageQuestion() {
  const arr = questions[quizState.stage] || [];
  return arr[quizState.questionIndex] || null;
}

function getQuestionKey() {
  return `${quizState.stage}:${quizState.questionIndex}`;
}

function buildLeaderboard() {
  return Object.values(quizState.teams)
    .map((team) => ({
      name: team.teamName,
      score: team.score,
      eliminated: team.eliminated,
      stageQualified: team.stageQualified,
      attemptsUsed: team.attemptsByQuestion[getQuestionKey()] || 0
    }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

function isTeamAllowed(team) {
  if (quizState.stage === 'stage1') return !team.eliminated;
  if (quizState.stage === 'stage2') return !team.eliminated && team.stageQualified === 'semifinal';
  if (quizState.stage === 'stage3') return !team.eliminated && quizState.finalists.includes(team.teamName);
  return false;
}

function emitState() {
  io.emit('leaderboard:update', {
    leaderboard: buildLeaderboard(),
    stage: quizState.stage,
    questionIndex: quizState.questionIndex,
    totalQuestions: STAGE_CONFIG[quizState.stage].total,
    questionActive: quizState.questionActive,
    finalists: quizState.finalists,
    timerEndsAt: quizState.timerEndsAt
  });

  const questionKey = getQuestionKey();
  Object.values(quizState.teams).forEach((team) => {
    io.to(team.socketId).emit('team:state', {
      stage: quizState.stage,
      questionActive: quizState.questionActive,
      questionIndex: quizState.questionIndex,
      totalQuestions: STAGE_CONFIG[quizState.stage].total,
      score: team.score,
      attemptsUsed: team.attemptsByQuestion[questionKey] || 0,
      canAnswer: quizState.questionActive && isTeamAllowed(team),
      finalists: quizState.finalists,
      timerEndsAt: quizState.timerEndsAt,
      waitingMessage: buildWaitingMessage(team)
    });
  });

  const answerRows = Object.entries(quizState.answersByQuestion[questionKey] || {}).map(([name, data]) => ({
    teamName: name,
    answer: data.answer,
    ts: data.ts,
    attempts: data.attempts,
    correct: data.correct
  }));

  io.to(quizState.teacherSocketId).emit('teacher:state', {
    stage: quizState.stage,
    questionIndex: quizState.questionIndex,
    totalQuestions: STAGE_CONFIG[quizState.stage].total,
    questionActive: quizState.questionActive,
    currentQuestion: getStageQuestion(),
    leaderboard: buildLeaderboard(),
    answerRows,
    finalists: quizState.finalists,
    stageWinners: quizState.stageWinners,
    timerEndsAt: quizState.timerEndsAt
  });
}

function buildWaitingMessage(team) {
  if (quizState.stage === 'stage2' && team.stageQualified !== 'semifinal') {
    return 'You are eliminated after Stage 1.';
  }
  if (quizState.stage === 'stage3' && !quizState.finalists.includes(team.teamName)) {
    return 'Only finalists can answer in Stage 3.';
  }
  if (!quizState.questionActive) {
    return 'Waiting for teacher to start the next question.';
  }
  return '';
}

function ensureQuestionBucket() {
  const questionKey = getQuestionKey();
  if (!quizState.answersByQuestion[questionKey]) {
    quizState.answersByQuestion[questionKey] = {};
  }
}

function markSemifinalists() {
  const ranking = buildLeaderboard();
  const stage1Winner = ranking[0];
  quizState.stageWinners.stage1 = stage1Winner ? stage1Winner.name : null;

  const semifinalists = ranking
    .filter((row) => row.name !== quizState.stageWinners.stage1)
    .slice(0, 8)
    .map((row) => row.name);

  Object.values(quizState.teams).forEach((team) => {
    team.stageQualified = semifinalists.includes(team.teamName) ? 'semifinal' : 'eliminated';
    if (team.teamName === quizState.stageWinners.stage1) {
      team.stageQualified = 'finalist1';
      quizState.finalists = [team.teamName];
    }
    if (!semifinalists.includes(team.teamName) && team.teamName !== quizState.stageWinners.stage1) {
      team.eliminated = true;
    }
  });
}

function markFinalistsFromStage2() {
  const semifinalRows = buildLeaderboard().filter(
    (row) => quizState.teams[row.name].stageQualified === 'semifinal'
  );
  const top = semifinalRows[0];
  if (top) {
    quizState.stageWinners.stage2 = top.name;
    quizState.finalists = [quizState.stageWinners.stage1, top.name].filter(Boolean);
    Object.values(quizState.teams).forEach((team) => {
      if (quizState.finalists.includes(team.teamName)) {
        team.stageQualified = 'finalist';
      } else {
        team.eliminated = true;
      }
    });
  }
}

function scoreStage1(correctTeams, correctAnswer) {
  const speedOrder = correctTeams.sort((a, b) => a.ts - b.ts);
  speedOrder.forEach((entry, index) => {
    const points = STAGE_CONFIG.stage1.speedPoints[index] || 500;
    quizState.teams[entry.teamName].score += points;
    entry.pointsAwarded = points;
  });

  const questionKey = getQuestionKey();
  const bucket = quizState.answersByQuestion[questionKey] || {};

  Object.entries(bucket).forEach(([teamName, row]) => {
    if (row.answer !== correctAnswer && row.attempts > 1) {
      // Retry was purchased and failed.
      quizState.teams[teamName].score -= 350;
    }
  });
}

function scoreStage2(correctTeams) {
  const speedOrder = correctTeams.sort((a, b) => a.ts - b.ts);
  speedOrder.forEach((entry, index) => {
    const points = STAGE_CONFIG.stage2.speedPoints[index] || 0;
    quizState.teams[entry.teamName].score += points;
    entry.pointsAwarded = points;
  });
}

function scoreStage3(correctTeams) {
  const speedOrder = correctTeams.sort((a, b) => a.ts - b.ts);
  let firstCorrectGiven = false;

  speedOrder.forEach((entry) => {
    const attempts = entry.attempts;
    let points = 0;
    if (attempts === 1) points = 100;
    else if (attempts === 2) points = 75;
    else if (attempts === 3) points = 50;

    if (!firstCorrectGiven) {
      points += 100;
      firstCorrectGiven = true;
    }

    quizState.teams[entry.teamName].score += points;
    entry.pointsAwarded = points;
  });
}

function finalizeQuestion(correctAnswer) {
  if (!quizState.questionActive) return;

  const questionKey = getQuestionKey();
  const bucket = quizState.answersByQuestion[questionKey] || {};

  const correctTeams = Object.entries(bucket)
    .filter(([, row]) => row.answer === correctAnswer)
    .map(([teamName, row]) => ({ teamName, ts: row.ts, attempts: row.attempts }));

  if (quizState.stage === 'stage1') scoreStage1(correctTeams, correctAnswer);
  if (quizState.stage === 'stage2') scoreStage2(correctTeams);
  if (quizState.stage === 'stage3') scoreStage3(correctTeams);

  Object.values(bucket).forEach((row) => {
    row.correct = row.answer === correctAnswer;
  });

  quizState.questionActive = false;
  quizState.questionEndTs = Date.now();
  quizState.timerEndsAt = null;

  io.emit('question:ended', { correctAnswer, stage: quizState.stage, questionIndex: quizState.questionIndex });
}

function advanceQuestionOrStage() {
  const cfg = STAGE_CONFIG[quizState.stage];
  if (quizState.questionIndex + 1 < cfg.total) {
    quizState.questionIndex += 1;
    return;
  }

  if (quizState.stage === 'stage1') {
    markSemifinalists();
    quizState.stage = 'stage2';
    quizState.questionIndex = 0;
  } else if (quizState.stage === 'stage2') {
    markFinalistsFromStage2();
    quizState.stage = 'stage3';
    quizState.questionIndex = 0;
  } else {
    quizState.stage = 'stage3';
    quizState.questionIndex = 2;
  }
}

function startQuestion() {
  const q = getStageQuestion();
  if (!q) return { ok: false, error: 'No question in this stage index.' };

  ensureQuestionBucket();
  quizState.questionActive = true;
  quizState.questionStartTs = Date.now();
  quizState.currentQuestionId = q.id;
  quizState.timerEndsAt = Date.now() + QUESTION_TIME_SECONDS * 1000;

  const questionKey = getQuestionKey();
  Object.values(quizState.teams).forEach((team) => {
    team.hasAnsweredCurrent = false;
    if (!team.attemptsByQuestion[questionKey]) {
      team.attemptsByQuestion[questionKey] = 0;
    }
  });

  setTimeout(() => {
    if (quizState.questionActive && Date.now() >= quizState.timerEndsAt) {
      finalizeQuestion(null);
      emitState();
    }
  }, QUESTION_TIME_SECONDS * 1000 + 100);

  io.emit('question:started', {
    question: { id: q.id, text: q.text, options: q.options },
    stage: quizState.stage,
    questionIndex: quizState.questionIndex,
    timerEndsAt: quizState.timerEndsAt
  });

  return { ok: true };
}

app.use(express.static(path.join(__dirname, 'public')));

app.get('/teacher', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'teacher.html'));
});

io.on('connection', (socket) => {
  socket.on('team:register', ({ teamName }) => {
    const normalized = (teamName || '').trim();
    if (!normalized) {
      socket.emit('team:error', { message: 'Team name is required.' });
      return;
    }

    if (!quizState.teams[normalized] && Object.keys(quizState.teams).length >= MAX_TEAMS) {
      socket.emit('team:error', { message: 'Maximum 9 teams already registered.' });
      return;
    }

    const existingSocketForName = quizState.socketsByTeam[normalized];
    if (existingSocketForName && existingSocketForName !== socket.id) {
      socket.emit('team:error', { message: 'Duplicate team name. Choose a unique team name.' });
      return;
    }

    if (!quizState.teams[normalized]) {
      quizState.teams[normalized] = {
        teamName: normalized,
        socketId: socket.id,
        score: 500,
        eliminated: false,
        stageQualified: 'stage1',
        hasAnsweredCurrent: false,
        attemptsByQuestion: {},
        answerTimestamps: {},
        retryUsedByQuestion: {}
      };
    } else {
      quizState.teams[normalized].socketId = socket.id;
    }

    quizState.socketsByTeam[normalized] = socket.id;
    socket.data.teamName = normalized;

    socket.emit('team:registered', { teamName: normalized });
    emitState();
  });

  socket.on('teacher:register', () => {
    quizState.teacherSocketId = socket.id;
    emitState();
  });

  socket.on('teacher:startQuestion', () => {
    const result = startQuestion();
    if (!result.ok) socket.emit('teacher:error', { message: result.error });
    emitState();
  });

  socket.on('teacher:endQuestion', ({ correctAnswer }) => {
    finalizeQuestion(correctAnswer || null);
    emitState();
  });

  socket.on('teacher:nextQuestion', () => {
    advanceQuestionOrStage();
    emitState();
  });

  socket.on('teacher:nextStage', () => {
    if (quizState.stage === 'stage1') {
      markSemifinalists();
      quizState.stage = 'stage2';
      quizState.questionIndex = 0;
    } else if (quizState.stage === 'stage2') {
      markFinalistsFromStage2();
      quizState.stage = 'stage3';
      quizState.questionIndex = 0;
    }
    emitState();
  });

  socket.on('teacher:resetAttempts', () => {
    const key = getQuestionKey();
    Object.values(quizState.teams).forEach((team) => {
      team.attemptsByQuestion[key] = 0;
      team.retryUsedByQuestion[key] = false;
      team.hasAnsweredCurrent = false;
    });
    quizState.answersByQuestion[key] = {};
    emitState();
  });

  socket.on('teacher:resetAll', () => {
    quizState = createInitialState();
    emitState();
  });

  socket.on('team:submitAnswer', ({ answer }) => {
    const teamName = socket.data.teamName;
    if (!teamName || !quizState.teams[teamName]) return;

    const team = quizState.teams[teamName];
    if (!quizState.questionActive || !isTeamAllowed(team)) return;

    const questionKey = getQuestionKey();
    ensureQuestionBucket();

    const attemptsUsed = team.attemptsByQuestion[questionKey] || 0;

    if (quizState.stage === 'stage2' && attemptsUsed >= 1) return;
    if (quizState.stage === 'stage1' && attemptsUsed >= 2) return;
    if (quizState.stage === 'stage3' && attemptsUsed >= 3) return;

    const now = Date.now();
    const question = getStageQuestion();
    const isCorrect = question && answer === question.correct;

    if (quizState.stage === 'stage1') {
      if (attemptsUsed === 0) {
        team.attemptsByQuestion[questionKey] = 1;
        quizState.answersByQuestion[questionKey][teamName] = {
          answer,
          ts: now,
          attempts: 1,
          correct: null
        };

        if (!isCorrect) {
          socket.emit('team:retryOption', {
            allowRetry: team.score >= STAGE_CONFIG.stage1.retryCost,
            retryCost: STAGE_CONFIG.stage1.retryCost
          });
        }
      } else if (attemptsUsed === 1 && !team.retryUsedByQuestion[questionKey]) {
        if (team.score < STAGE_CONFIG.stage1.retryCost) {
          socket.emit('team:error', { message: 'Not enough points for retry.' });
          return;
        }
        team.score -= STAGE_CONFIG.stage1.retryCost;
        team.retryUsedByQuestion[questionKey] = true;
        team.attemptsByQuestion[questionKey] = 2;
        quizState.answersByQuestion[questionKey][teamName] = {
          answer,
          ts: now,
          attempts: 2,
          correct: null
        };
      }
    } else {
      team.attemptsByQuestion[questionKey] = attemptsUsed + 1;
      if (isCorrect && !quizState.answersByQuestion[questionKey][teamName]) {
        quizState.answersByQuestion[questionKey][teamName] = {
          answer,
          ts: now,
          attempts: team.attemptsByQuestion[questionKey],
          correct: null
        };
      }

      if (quizState.stage === 'stage2' && !isCorrect) {
        quizState.answersByQuestion[questionKey][teamName] = {
          answer,
          ts: now,
          attempts: 1,
          correct: null
        };
      }
    }

    team.answerTimestamps[questionKey] = now;
    emitState();
  });

  socket.on('disconnect', () => {
    const teamName = socket.data.teamName;
    if (teamName && quizState.socketsByTeam[teamName] === socket.id) {
      delete quizState.socketsByTeam[teamName];
      if (quizState.teams[teamName]) {
        quizState.teams[teamName].socketId = null;
      }
    }
    if (quizState.teacherSocketId === socket.id) {
      quizState.teacherSocketId = null;
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Quiz platform server running at http://localhost:${PORT}`);
  console.log('Teacher panel: http://localhost:3000/teacher');
});
