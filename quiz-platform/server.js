const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = 3000;
const HOST = '0.0.0.0';
const QUESTION_TIME_SECONDS = 20;
const MAX_TEAMS = 9; // 9 team phones + 1 teacher laptop on hotspot

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
    timerEndsAt: null,
    finalists: [],
    teams: {},
    socketsByTeam: {},
    answersByQuestion: {},
    stageWinners: { stage1: null, stage2: null },
    teacherSocketId: null
  };
}

function getQuestionKey() {
  return `${quizState.stage}:${quizState.questionIndex}`;
}

function getCurrentQuestion() {
  const stageQuestions = questions[quizState.stage] || [];
  return stageQuestions[quizState.questionIndex] || null;
}

function ensureQuestionBucket() {
  const key = getQuestionKey();
  if (!quizState.answersByQuestion[key]) {
    quizState.answersByQuestion[key] = {};
  }
  return quizState.answersByQuestion[key];
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

function getWaitingMessage(team) {
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

function emitState() {
  const leaderboard = buildLeaderboard();
  const key = getQuestionKey();
  const answerRows = Object.entries(quizState.answersByQuestion[key] || {}).map(([teamName, row]) => ({
    teamName,
    answer: row.answer,
    ts: row.ts,
    attempts: row.attempts,
    correct: row.correct
  }));

  io.emit('leaderboard:update', {
    leaderboard,
    stage: quizState.stage,
    questionIndex: quizState.questionIndex,
    totalQuestions: STAGE_CONFIG[quizState.stage].total,
    questionActive: quizState.questionActive,
    timerEndsAt: quizState.timerEndsAt,
    finalists: quizState.finalists
  });

  Object.values(quizState.teams).forEach((team) => {
    if (!team.socketId) return;
    io.to(team.socketId).emit('team:state', {
      stage: quizState.stage,
      questionIndex: quizState.questionIndex,
      totalQuestions: STAGE_CONFIG[quizState.stage].total,
      questionActive: quizState.questionActive,
      score: team.score,
      attemptsUsed: team.attemptsByQuestion[key] || 0,
      canAnswer: quizState.questionActive && isTeamAllowed(team),
      timerEndsAt: quizState.timerEndsAt,
      waitingMessage: getWaitingMessage(team),
      finalists: quizState.finalists
    });
  });

  if (quizState.teacherSocketId) {
    io.to(quizState.teacherSocketId).emit('teacher:state', {
      stage: quizState.stage,
      questionIndex: quizState.questionIndex,
      totalQuestions: STAGE_CONFIG[quizState.stage].total,
      questionActive: quizState.questionActive,
      currentQuestion: getCurrentQuestion(),
      leaderboard,
      answerRows,
      timerEndsAt: quizState.timerEndsAt,
      finalists: quizState.finalists,
      stageWinners: quizState.stageWinners
    });
  }
}

function markSemifinalists() {
  const ranking = buildLeaderboard();
  const winner = ranking[0] ? ranking[0].name : null;
  quizState.stageWinners.stage1 = winner;

  const semifinalists = ranking
    .filter((row) => row.name !== winner)
    .slice(0, 8)
    .map((row) => row.name);

  quizState.finalists = winner ? [winner] : [];

  Object.values(quizState.teams).forEach((team) => {
    if (team.teamName === winner) {
      team.stageQualified = 'finalist1';
      team.eliminated = false;
    } else if (semifinalists.includes(team.teamName)) {
      team.stageQualified = 'semifinal';
      team.eliminated = false;
    } else {
      team.stageQualified = 'eliminated';
      team.eliminated = true;
    }
  });
}

function markFinalistsFromStage2() {
  const semifinalRows = buildLeaderboard().filter(
    (row) => quizState.teams[row.name] && quizState.teams[row.name].stageQualified === 'semifinal'
  );

  const winner = semifinalRows[0] ? semifinalRows[0].name : null;
  quizState.stageWinners.stage2 = winner;
  quizState.finalists = [quizState.stageWinners.stage1, winner].filter(Boolean);

  Object.values(quizState.teams).forEach((team) => {
    if (quizState.finalists.includes(team.teamName)) {
      team.stageQualified = 'finalist';
      team.eliminated = false;
    } else {
      team.stageQualified = 'eliminated';
      team.eliminated = true;
    }
  });
}

function scoreStage1(correctAnswer) {
  const key = getQuestionKey();
  const bucket = quizState.answersByQuestion[key] || {};

  const speedCorrectWithoutRetry = Object.values(bucket)
    .filter((row) => row.usedRetry === false && row.answer === correctAnswer)
    .sort((a, b) => a.ts - b.ts);

  speedCorrectWithoutRetry.forEach((row, index) => {
    const pts = STAGE_CONFIG.stage1.speedPoints[index] || 500;
    const team = quizState.teams[row.teamName];
    if (team) team.score += pts;
    row.pointsAwarded = pts;
  });

  Object.values(bucket).forEach((row) => {
    const team = quizState.teams[row.teamName];
    if (!team || !row.usedRetry) return;

    if (row.answer === correctAnswer) {
      // Retry success is fixed +500 (retry cost already deducted on submission).
      team.score += 500;
      row.pointsAwarded = (row.pointsAwarded || 0) + 500;
    } else {
      // Retry failure gets additional -350 (retry cost already deducted).
      team.score -= 350;
      row.pointsAwarded = (row.pointsAwarded || 0) - 350;
    }
  });
}

function scoreStage2(correctAnswer) {
  const key = getQuestionKey();
  const bucket = quizState.answersByQuestion[key] || {};

  const speedCorrect = Object.values(bucket)
    .filter((row) => row.answer === correctAnswer)
    .sort((a, b) => a.ts - b.ts);

  speedCorrect.forEach((row, index) => {
    const pts = STAGE_CONFIG.stage2.speedPoints[index] || 0;
    const team = quizState.teams[row.teamName];
    if (team) team.score += pts;
    row.pointsAwarded = pts;
  });
}

function scoreStage3(correctAnswer) {
  const key = getQuestionKey();
  const bucket = quizState.answersByQuestion[key] || {};

  const speedCorrect = Object.values(bucket)
    .filter((row) => row.answer === correctAnswer)
    .sort((a, b) => a.ts - b.ts);

  let firstBonusGiven = false;

  speedCorrect.forEach((row) => {
    let pts = 0;
    if (row.attempts === 1) pts = 100;
    else if (row.attempts === 2) pts = 75;
    else if (row.attempts === 3) pts = 50;

    if (!firstBonusGiven) {
      pts += 100;
      firstBonusGiven = true;
    }

    const team = quizState.teams[row.teamName];
    if (team) team.score += pts;
    row.pointsAwarded = pts;
  });
}

function finalizeQuestion(correctAnswer) {
  if (!quizState.questionActive) return;

  const key = getQuestionKey();
  const bucket = quizState.answersByQuestion[key] || {};

  if (correctAnswer) {
    if (quizState.stage === 'stage1') scoreStage1(correctAnswer);
    if (quizState.stage === 'stage2') scoreStage2(correctAnswer);
    if (quizState.stage === 'stage3') scoreStage3(correctAnswer);
  }

  Object.values(bucket).forEach((row) => {
    row.correct = correctAnswer ? row.answer === correctAnswer : null;
  });

  quizState.questionActive = false;
  quizState.timerEndsAt = null;

  io.emit('question:ended', {
    correctAnswer: correctAnswer || null,
    stage: quizState.stage,
    questionIndex: quizState.questionIndex
  });
}

function moveToNextQuestionOrStage() {
  const total = STAGE_CONFIG[quizState.stage].total;

  if (quizState.questionIndex + 1 < total) {
    quizState.questionIndex += 1;
    return;
  }

  if (quizState.stage === 'stage1') {
    markSemifinalists();
    quizState.stage = 'stage2';
    quizState.questionIndex = 0;
    return;
  }

  if (quizState.stage === 'stage2') {
    markFinalistsFromStage2();
    quizState.stage = 'stage3';
    quizState.questionIndex = 0;
  }
}

function startQuestion() {
  if (quizState.questionActive) {
    return { ok: false, message: 'Question already active.' };
  }

  const question = getCurrentQuestion();
  if (!question) {
    return { ok: false, message: 'No question available for this stage/index.' };
  }

  ensureQuestionBucket();
  const key = getQuestionKey();

  quizState.questionActive = true;
  quizState.timerEndsAt = Date.now() + QUESTION_TIME_SECONDS * 1000;

  Object.values(quizState.teams).forEach((team) => {
    if (!team.attemptsByQuestion[key]) team.attemptsByQuestion[key] = 0;
    if (!team.retryUsedByQuestion[key]) team.retryUsedByQuestion[key] = false;
    team.firstAnswerWasWrongByQuestion[key] = false;
  });

  io.emit('question:started', {
    stage: quizState.stage,
    questionIndex: quizState.questionIndex,
    timerEndsAt: quizState.timerEndsAt,
    question: {
      id: question.id,
      text: question.text,
      options: question.options
    }
  });

  setTimeout(() => {
    if (!quizState.questionActive) return;
    if (Date.now() < quizState.timerEndsAt) return;
    finalizeQuestion(null);
    emitState();
  }, QUESTION_TIME_SECONDS * 1000 + 120);

  return { ok: true };
}

app.use(express.static(path.join(__dirname, 'public')));

app.get('/teacher', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'teacher.html'));
});

io.on('connection', (socket) => {
  socket.on('teacher:register', () => {
    quizState.teacherSocketId = socket.id;
    emitState();
  });

  socket.on('teacher:startQuestion', () => {
    const result = startQuestion();
    if (!result.ok) {
      socket.emit('teacher:error', { message: result.message });
    }
    emitState();
  });

  socket.on('teacher:endQuestion', ({ correctAnswer }) => {
    finalizeQuestion((correctAnswer || '').trim().toUpperCase() || null);
    emitState();
  });

  socket.on('teacher:nextQuestion', () => {
    if (quizState.questionActive) {
      socket.emit('teacher:error', { message: 'End current question before moving forward.' });
      return;
    }
    moveToNextQuestionOrStage();
    emitState();
  });

  socket.on('teacher:nextStage', () => {
    if (quizState.questionActive) {
      socket.emit('teacher:error', { message: 'End current question before changing stage.' });
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
    }

    emitState();
  });

  socket.on('teacher:resetAttempts', () => {
    const key = getQuestionKey();
    quizState.answersByQuestion[key] = {};
    Object.values(quizState.teams).forEach((team) => {
      team.attemptsByQuestion[key] = 0;
      team.retryUsedByQuestion[key] = false;
      team.firstAnswerWasWrongByQuestion[key] = false;
    });
    emitState();
  });

  socket.on('team:register', ({ teamName }) => {
    const normalized = (teamName || '').trim();
    if (!normalized) {
      socket.emit('team:error', { message: 'Team name is required.' });
      return;
    }

    const existingSocket = quizState.socketsByTeam[normalized];
    if (existingSocket && existingSocket !== socket.id) {
      socket.emit('team:error', { message: 'Duplicate team name. Choose a unique name.' });
      return;
    }

    if (!quizState.teams[normalized] && Object.keys(quizState.teams).length >= MAX_TEAMS) {
      socket.emit('team:error', { message: 'Maximum 9 teams allowed.' });
      return;
    }

    if (!quizState.teams[normalized]) {
      quizState.teams[normalized] = {
        teamName: normalized,
        socketId: socket.id,
        score: 500,
        eliminated: false,
        stageQualified: 'stage1',
        attemptsByQuestion: {},
        retryUsedByQuestion: {},
        firstAnswerWasWrongByQuestion: {},
        answerTimestamps: {}
      };
    } else {
      quizState.teams[normalized].socketId = socket.id;
    }

    quizState.socketsByTeam[normalized] = socket.id;
    socket.data.teamName = normalized;

    socket.emit('team:registered', { teamName: normalized });
    emitState();
  });

  socket.on('team:submitAnswer', ({ answer }) => {
    const teamName = socket.data.teamName;
    const team = quizState.teams[teamName];
    if (!teamName || !team) return;
    if (!quizState.questionActive || !isTeamAllowed(team)) return;

    const normalizedAnswer = (answer || '').trim().toUpperCase();
    if (!['A', 'B', 'C', 'D'].includes(normalizedAnswer)) return;

    const question = getCurrentQuestion();
    if (!question) return;

    const key = getQuestionKey();
    const bucket = ensureQuestionBucket();

    const attemptsUsed = team.attemptsByQuestion[key] || 0;
    const now = Date.now();
    const isCorrect = normalizedAnswer === question.correct;

    if (quizState.stage === 'stage1') {
      if (attemptsUsed === 0) {
        team.attemptsByQuestion[key] = 1;
        team.answerTimestamps[key] = now;

        bucket[teamName] = {
          teamName,
          answer: normalizedAnswer,
          ts: now,
          attempts: 1,
          usedRetry: false,
          correct: null
        };

        if (!isCorrect) {
          team.firstAnswerWasWrongByQuestion[key] = true;
          socket.emit('team:retryOption', {
            allowRetry: team.score >= STAGE_CONFIG.stage1.retryCost,
            retryCost: STAGE_CONFIG.stage1.retryCost
          });
        }

        emitState();
        return;
      }

      // Stage 1 retry: only once, only after first answer was wrong.
      if (attemptsUsed === 1 && !team.retryUsedByQuestion[key] && team.firstAnswerWasWrongByQuestion[key]) {
        if (team.score < STAGE_CONFIG.stage1.retryCost) {
          socket.emit('team:error', { message: 'Not enough points for retry.' });
          return;
        }

        team.score -= STAGE_CONFIG.stage1.retryCost;
        team.retryUsedByQuestion[key] = true;
        team.attemptsByQuestion[key] = 2;
        team.answerTimestamps[key] = now;

        bucket[teamName] = {
          teamName,
          answer: normalizedAnswer,
          ts: now,
          attempts: 2,
          usedRetry: true,
          correct: null
        };

        emitState();
      }

      return;
    }

    if (quizState.stage === 'stage2') {
      if (attemptsUsed >= 1) return; // no retries

      team.attemptsByQuestion[key] = 1;
      team.answerTimestamps[key] = now;
      bucket[teamName] = {
        teamName,
        answer: normalizedAnswer,
        ts: now,
        attempts: 1,
        usedRetry: false,
        correct: null
      };

      emitState();
      return;
    }

    if (quizState.stage === 'stage3') {
      if (attemptsUsed >= 3) return;

      const nextAttempt = attemptsUsed + 1;
      team.attemptsByQuestion[key] = nextAttempt;
      team.answerTimestamps[key] = now;

      // Keep earliest correct timestamp; if never correct yet, keep latest wrong state.
      const prev = bucket[teamName];
      if (isCorrect) {
        if (!prev || prev.answer !== question.correct) {
          bucket[teamName] = {
            teamName,
            answer: normalizedAnswer,
            ts: now,
            attempts: nextAttempt,
            usedRetry: false,
            correct: null
          };
        }
      } else if (!prev) {
        bucket[teamName] = {
          teamName,
          answer: normalizedAnswer,
          ts: now,
          attempts: nextAttempt,
          usedRetry: false,
          correct: null
        };
      } else {
        prev.attempts = nextAttempt;
      }

      emitState();
    }
  });

  socket.on('disconnect', () => {
    const teamName = socket.data.teamName;
    if (teamName && quizState.socketsByTeam[teamName] === socket.id) {
      delete quizState.socketsByTeam[teamName];
      if (quizState.teams[teamName]) quizState.teams[teamName].socketId = null;
    }

    if (quizState.teacherSocketId === socket.id) {
      quizState.teacherSocketId = null;
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Quiz platform server running at http://localhost:${PORT}`);
  console.log('Teacher panel: http://localhost:3000/teacher');
  console.log('Hotspot usage: connect teacher laptop + up to 9 team phones, then open http://<laptop-ip>:3000');
});
