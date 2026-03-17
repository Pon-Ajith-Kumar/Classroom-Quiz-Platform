const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = 3000;
const MAX_TEAMS = 9;
const TEAM_NAME_MAX_LENGTH = 30;
const ANSWER_OPTIONS = new Set(['A', 'B', 'C', 'D']);

const questions = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'questions.json'), 'utf8')
);

function getStageQuestions(stage) {
  return Array.isArray(questions[stage]) ? questions[stage] : [];
}

const STAGE_CONFIG = {
  stage1: {
    total: getStageQuestions('stage1').length,
    maxAttempts: 2,
    timeLimitSeconds: 20,
    speedPoints: [1000, 900, 800, 700, 600],
    retryCost: 250
  },
  stage2: {
    total: getStageQuestions('stage2').length,
    maxAttempts: 1,
    timeLimitSeconds: 30,
    speedPoints: [2500, 1500, 1000]
  },
  stage3: {
    total: getStageQuestions('stage3').length,
    maxAttempts: 3,
    timeLimitSeconds: null
  }
};

const TIE_BREAK_QUESTIONS = {
  stage1: {
    id: 'TB-S1',
    text: 'Tie-Breaker: Which number is prime?',
    options: ['111', '121', '131', '141'],
    correct: 'C',
    explanation: '131 is prime. The others are composite numbers.'
  },
  stage2: {
    id: 'TB-S2',
    text: 'Tie-Breaker: Which planet has the most moons?',
    options: ['Earth', 'Mars', 'Jupiter', 'Venus'],
    correct: 'C',
    explanation: 'Jupiter has the highest known number of moons.'
  },
  stage3: {
    id: 'TB-S3',
    text: 'Final Tie-Breaker: Which language runs in the browser natively?',
    options: ['Python', 'Java', 'JavaScript', 'C++'],
    correct: 'C',
    explanation: 'JavaScript is the native language executed directly by browsers.'
  }
};

let questionTimer = null;
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
    completedQuestionKeys: {},
    questionHistory: [],
    stageWinners: { stage1: null, stage2: null },
    tieBreakResolvedWinnerByStage: { stage1: null, stage2: null, stage3: null },
    tieBreak: {
      active: false,
      stage: null,
      participants: [],
      question: null
    },
    teacherSocketId: null,
    quizCompleted: false
  };
}

function normalizeTeamName(teamName) {
  return (teamName || '').trim().replace(/\s+/g, ' ');
}

function validateTeamName(teamName) {
  if (!teamName) {
    return 'Team name is required.';
  }

  if (teamName.length > TEAM_NAME_MAX_LENGTH) {
    return `Team name must be ${TEAM_NAME_MAX_LENGTH} characters or fewer.`;
  }

  if (!/^[a-zA-Z0-9 ]+$/.test(teamName)) {
    return 'Team name can only contain letters, numbers, and spaces.';
  }

  return null;
}

function findStoredTeamName(inputName) {
  const normalized = normalizeTeamName(inputName).toLowerCase();
  if (!normalized) return null;

  return Object.keys(quizState.teams).find(
    (teamName) => teamName.toLowerCase() === normalized
  ) || null;
}

function getStageQuestion(stage = quizState.stage, questionIndex = quizState.questionIndex) {
  return getStageQuestions(stage)[questionIndex] || null;
}

function getCurrentQuestion(stage = quizState.stage, questionIndex = quizState.questionIndex) {
  if (quizState.tieBreak.active && stage === quizState.stage && questionIndex === quizState.questionIndex) {
    return quizState.tieBreak.question;
  }

  return getStageQuestion(stage, questionIndex);
}

function getQuestionKey(stage = quizState.stage, questionIndex = quizState.questionIndex) {
  if (quizState.tieBreak.active && stage === quizState.stage && questionIndex === quizState.questionIndex) {
    return `${stage}:TB`;
  }

  return `${stage}:${questionIndex}`;
}

function sanitizeQuestion(question) {
  if (!question) return null;

  return {
    id: question.id,
    text: question.text,
    options: Array.isArray(question.options) ? question.options : []
  };
}

function hasQuizStarted() {
  return quizState.stage !== 'stage1'
    || quizState.questionIndex > 0
    || quizState.questionActive
    || Object.keys(quizState.answersByQuestion).length > 0;
}

function clearQuestionTimer() {
  if (questionTimer) {
    clearTimeout(questionTimer);
    questionTimer = null;
  }
}

function ensureQuestionBucket(questionKey = getQuestionKey()) {
  if (!quizState.answersByQuestion[questionKey]) {
    quizState.answersByQuestion[questionKey] = {};
  }

  return quizState.answersByQuestion[questionKey];
}

function getQuestionBucket(questionKey = getQuestionKey()) {
  return quizState.answersByQuestion[questionKey] || {};
}

function getAnswerRow(teamName, questionKey = getQuestionKey()) {
  return getQuestionBucket(questionKey)[teamName] || null;
}

function hasSubmittedCorrectAnswer(teamName, questionKey = getQuestionKey(), question = getCurrentQuestion()) {
  const row = getAnswerRow(teamName, questionKey);
  return Boolean(row && question && row.answer === question.correct);
}

function buildLeaderboard() {
  const questionKey = getQuestionKey();
  const stage1FinalistName = quizState.stage === 'stage2' ? quizState.stageWinners.stage1 : null;
  const teams = Object.values(quizState.teams).filter((team) => {
    if (quizState.stage !== 'stage3') return true;
    return quizState.finalists.includes(team.teamName);
  });

  return teams
    .map((team) => {
      let badge = team.eliminated ? 'Eliminated' : team.stageQualified || '-';
      if (quizState.stage === 'stage2' && quizState.finalists.includes(team.teamName)) {
        badge = 'Finalist (Stage 1)';
      }
      return {
        name: team.teamName,
        score: team.score,
        eliminated: team.eliminated,
        stageQualified: team.stageQualified,
        badge: badge,
        attemptsUsed: team.attemptsByQuestion[questionKey] || 0
      };
    })
    .sort((a, b) => {
      if (stage1FinalistName) {
        if (a.name === stage1FinalistName && b.name !== stage1FinalistName) return -1;
        if (b.name === stage1FinalistName && a.name !== stage1FinalistName) return 1;
      }

      return b.score - a.score || a.name.localeCompare(b.name);
    });
}

function buildTeamScoreSheet(teamName) {
  return quizState.questionHistory
    .filter((entry) => entry.teamName === teamName)
    .map((entry) => ({
      stage: entry.stage,
      questionNumber: entry.questionIndex + 1,
      questionId: entry.questionId,
      answer: entry.answer,
      attempts: entry.attempts,
      correct: entry.correct,
      pointsAdded: entry.pointsAdded,
      pointsReduced: entry.pointsReduced,
      pointsDelta: entry.pointsDelta,
      totalScore: entry.totalScore,
      endedAt: entry.endedAt
    }));
}

function ensureTeamQuestionDelta(team, questionKey) {
  if (!team.scoreDeltaByQuestion[questionKey]) {
    team.scoreDeltaByQuestion[questionKey] = {
      added: 0,
      reduced: 0,
      net: 0
    };
  }

  return team.scoreDeltaByQuestion[questionKey];
}

function applyScoreDelta(team, questionKey, delta) {
  if (!delta) return;

  team.score += delta;
  const bucket = ensureTeamQuestionDelta(team, questionKey);

  if (delta > 0) {
    bucket.added += delta;
  } else {
    bucket.reduced += Math.abs(delta);
  }

  bucket.net += delta;
}

function recordQuestionHistory(stage, questionIndex, questionId, correctAnswer, endedAt) {
  const questionKey = getQuestionKey(stage, questionIndex);
  const bucket = getQuestionBucket(questionKey);

  Object.values(quizState.teams).forEach((team) => {
    const row = bucket[team.teamName] || null;
    const delta = team.scoreDeltaByQuestion[questionKey] || { added: 0, reduced: 0, net: 0 };

    quizState.questionHistory.push({
      stage,
      questionIndex,
      questionId,
      correctAnswer,
      teamName: team.teamName,
      answer: row ? row.answer : null,
      attempts: row ? row.attempts : 0,
      correct: Boolean(row && row.answer === correctAnswer),
      pointsAdded: delta.added,
      pointsReduced: delta.reduced,
      pointsDelta: delta.net,
      totalScore: team.score,
      endedAt
    });
  });
}

function isTeamAllowed(team) {
  if (!team || quizState.quizCompleted) return false;
  if (quizState.tieBreak.active) {
    return quizState.tieBreak.participants.includes(team.teamName);
  }
  if (quizState.stage === 'stage1') return !team.eliminated;
  if (quizState.stage === 'stage2') return !team.eliminated && team.stageQualified === 'semifinal';
  if (quizState.stage === 'stage3') return !team.eliminated && quizState.finalists.includes(team.teamName);
  return false;
}

function canUseStage1Retry(team, questionKey, question) {
  const attemptsUsed = team.attemptsByQuestion[questionKey] || 0;
  if (attemptsUsed !== 1) return false;
  if (team.retryUsedByQuestion[questionKey]) return false;
  if (team.score < STAGE_CONFIG.stage1.retryCost) return false;
  if (hasSubmittedCorrectAnswer(team.teamName, questionKey, question)) return false;
  return true;
}

function canTeamAnswer(team, questionKey = getQuestionKey(), question = getCurrentQuestion()) {
  if (!quizState.questionActive || !isTeamAllowed(team) || !question) return false;
  if (hasSubmittedCorrectAnswer(team.teamName, questionKey, question)) return false;

  const attemptsUsed = team.attemptsByQuestion[questionKey] || 0;

  if (quizState.stage === 'stage1') {
    if (attemptsUsed === 0) return true;
    return canUseStage1Retry(team, questionKey, question);
  }

  return attemptsUsed < STAGE_CONFIG[quizState.stage].maxAttempts;
}

function buildWaitingMessage(team) {
  if (quizState.quizCompleted) {
    return 'Quiz completed.';
  }

  if (quizState.tieBreak.active && !quizState.tieBreak.participants.includes(team.teamName)) {
    return 'Tie-break question in progress. Only tied teams can answer.';
  }

  if (quizState.stage === 'stage2' && team.stageQualified === 'finalist1') {
    return 'You are already qualified for the final. Waiting for Stage 3.';
  }

  if (quizState.stage === 'stage2' && team.stageQualified !== 'semifinal') {
    return 'You are eliminated after Stage 1.';
  }

  if (quizState.stage === 'stage3' && !quizState.finalists.includes(team.teamName)) {
    return 'Only finalists can answer in Stage 3.';
  }

  if (!quizState.questionActive) {
    return 'Waiting for teacher to start the next question.';
  }

  const questionKey = getQuestionKey();
  const question = getCurrentQuestion();

  if (hasSubmittedCorrectAnswer(team.teamName, questionKey, question)) {
    return 'Correct answer locked in. Waiting for question to end.';
  }

  const attemptsUsed = team.attemptsByQuestion[questionKey] || 0;

  if (quizState.stage === 'stage1' && attemptsUsed === 1) {
    return canUseStage1Retry(team, questionKey, question)
      ? `First attempt was wrong. You may buy one retry for ${STAGE_CONFIG.stage1.retryCost} points.`
      : `First attempt was wrong. Retry unavailable because your score is below ${STAGE_CONFIG.stage1.retryCost}.`;
  }

  if (!canTeamAnswer(team, questionKey, question) && attemptsUsed > 0) {
    if (quizState.stage === 'stage2') return 'You have already used your only attempt for this question.';
    if (quizState.stage === 'stage3') return 'You have used all attempts for this question.';
    return 'No attempts remaining for this question.';
  }

  return '';
}

function emitState() {
  const question = sanitizeQuestion(getCurrentQuestion());
  const questionKey = getQuestionKey();
  const questionCompleted = Boolean(quizState.completedQuestionKeys[questionKey]);
  const leaderboard = buildLeaderboard();
  const champion = quizState.quizCompleted && leaderboard.length ? leaderboard[0].name : null;

  io.emit('leaderboard:update', {
    leaderboard,
    stage: quizState.stage,
    questionIndex: quizState.questionIndex,
    totalQuestions: STAGE_CONFIG[quizState.stage].total,
    questionActive: quizState.questionActive,
    finalists: quizState.finalists,
    stageWinners: quizState.stageWinners,
    champion,
    timerEndsAt: quizState.timerEndsAt,
    quizCompleted: quizState.quizCompleted
  });

  Object.values(quizState.teams).forEach((team) => {
    if (!team.socketId) return;

    io.to(team.socketId).emit('team:state', {
      stage: quizState.stage,
      questionActive: quizState.questionActive,
      questionIndex: quizState.questionIndex,
      totalQuestions: STAGE_CONFIG[quizState.stage].total,
      score: team.score,
      attemptsUsed: team.attemptsByQuestion[questionKey] || 0,
      canAnswer: canTeamAnswer(team, questionKey, getCurrentQuestion()),
      finalists: quizState.finalists,
      stageWinners: quizState.stageWinners,
      champion,
      timerEndsAt: quizState.timerEndsAt,
      waitingMessage: buildWaitingMessage(team),
      currentQuestion: quizState.questionActive ? question : null,
      tieBreakActive: quizState.tieBreak.active,
      quizCompleted: quizState.quizCompleted,
      teamScoreSheet: buildTeamScoreSheet(team.teamName)
    });
  });

  if (quizState.teacherSocketId) {
    const answerRows = Object.entries(getQuestionBucket(questionKey)).map(([name, data]) => ({
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
      currentQuestion: question,
      leaderboard,
      answerRows,
      finalists: quizState.finalists,
      stageWinners: quizState.stageWinners,
      champion,
      timerEndsAt: quizState.timerEndsAt,
      tieBreakActive: quizState.tieBreak.active,
      questionCompleted,
      quizCompleted: quizState.quizCompleted,
      consolidatedHistory: quizState.questionHistory
    });
  }
}

function markSemifinalists(forcedWinner = null) {
  const ranking = buildLeaderboard();
  const stage1Winner = forcedWinner || (ranking[0] ? ranking[0].name : null);

  quizState.stageWinners.stage1 = stage1Winner;
  quizState.finalists = stage1Winner ? [stage1Winner] : [];

  const semifinalists = ranking
    .filter((row) => row.name !== stage1Winner)
    .slice(0, 8)
    .map((row) => row.name);

  Object.values(quizState.teams).forEach((team) => {
    if (team.teamName === stage1Winner) {
      team.stageQualified = 'finalist1';
      team.eliminated = false;
      return;
    }

    if (semifinalists.includes(team.teamName)) {
      team.stageQualified = 'semifinal';
      team.eliminated = false;
      return;
    }

    team.stageQualified = 'eliminated';
    team.eliminated = true;
  });
}

function markFinalistsFromStage2(forcedWinner = null) {
  const semifinalRows = buildLeaderboard().filter(
    (row) => quizState.teams[row.name] && quizState.teams[row.name].stageQualified === 'semifinal'
  );
  const topSemifinalist = forcedWinner || (semifinalRows[0] ? semifinalRows[0].name : null);

  quizState.stageWinners.stage2 = topSemifinalist;
  quizState.finalists = [quizState.stageWinners.stage1, topSemifinalist].filter(Boolean);

  Object.values(quizState.teams).forEach((team) => {
    if (quizState.finalists.includes(team.teamName)) {
      team.stageQualified = 'finalist';
      team.eliminated = false;
      return;
    }

    team.stageQualified = 'eliminated';
    team.eliminated = true;
  });

  const finalistsSet = new Set(quizState.finalists);
  Object.values(quizState.teams).forEach((team) => {
    if (finalistsSet.has(team.teamName)) {
      team.score = 0;
    }
    team.scoreDeltaByQuestion = {};
  });

  quizState.questionHistory = [];
}

function getTieParticipantsForStage(stage) {
  if (stage === 'stage1') {
    const ranking = buildLeaderboard();
    if (!ranking.length) return [];
    const topScore = ranking[0].score;
    return ranking.filter((row) => row.score === topScore).map((row) => row.name);
  }

  if (stage === 'stage2') {
    const semifinalRows = buildLeaderboard().filter(
      (row) => quizState.teams[row.name] && quizState.teams[row.name].stageQualified === 'semifinal'
    );
    if (!semifinalRows.length) return [];
    const topScore = semifinalRows[0].score;
    return semifinalRows.filter((row) => row.score === topScore).map((row) => row.name);
  }

  if (stage === 'stage3') {
    const finalistRows = buildLeaderboard();
    if (!finalistRows.length) return [];
    const topScore = finalistRows[0].score;
    return finalistRows.filter((row) => row.score === topScore).map((row) => row.name);
  }

  return [];
}

function startTieBreakForStage(stage) {
  if (quizState.tieBreakResolvedWinnerByStage[stage]) return false;

  const participants = getTieParticipantsForStage(stage);
  if (participants.length <= 1) return false;

  const question = TIE_BREAK_QUESTIONS[stage];
  if (!question) return false;

  quizState.tieBreak.active = true;
  quizState.tieBreak.stage = stage;
  quizState.tieBreak.participants = participants;
  quizState.tieBreak.question = question;

  return true;
}

function resolveTieBreakWinner(correctAnswer, questionKey) {
  const participants = quizState.tieBreak.participants || [];
  const bucket = getQuestionBucket(questionKey);

  const correctRows = participants
    .map((teamName) => ({ teamName, row: bucket[teamName] || null }))
    .filter((entry) => entry.row && entry.row.answer === correctAnswer)
    .sort((a, b) => a.row.ts - b.row.ts);

  if (correctRows.length) return correctRows[0].teamName;

  const attemptedRows = participants
    .map((teamName) => ({ teamName, row: bucket[teamName] || null }))
    .filter((entry) => entry.row)
    .sort((a, b) => a.row.ts - b.row.ts);

  if (attemptedRows.length) return attemptedRows[0].teamName;

  const rankedByScore = participants
    .map((teamName) => quizState.teams[teamName])
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || a.teamName.localeCompare(b.teamName));

  return rankedByScore[0] ? rankedByScore[0].teamName : null;
}

function resolveTieBreakAndAdvance(correctAnswer, questionKey) {
  const stage = quizState.tieBreak.stage;
  const winner = resolveTieBreakWinner(correctAnswer, questionKey);

  if (winner && quizState.teams[winner]) {
    applyScoreDelta(quizState.teams[winner], questionKey, 1);
  }

  if (stage === 'stage3') {
    quizState.tieBreakResolvedWinnerByStage.stage3 = winner;
    quizState.quizCompleted = true;
  } else {
    quizState.tieBreakResolvedWinnerByStage[stage] = winner;
  }

  quizState.tieBreak.active = false;
  quizState.tieBreak.stage = null;
  quizState.tieBreak.participants = [];
  quizState.tieBreak.question = null;
}

function scoreStage1(correctTeams, correctAnswer) {
  const questionKey = getQuestionKey();
  const speedOrder = correctTeams.sort((a, b) => a.ts - b.ts);

  speedOrder.forEach((entry, index) => {
    const points = STAGE_CONFIG.stage1.speedPoints[index] || 500;
    applyScoreDelta(quizState.teams[entry.teamName], questionKey, points);
  });

  Object.entries(getQuestionBucket()).forEach(([teamName, row]) => {
    if (row.answer !== correctAnswer && row.attempts > 1) {
      applyScoreDelta(quizState.teams[teamName], questionKey, -350);
    }
  });
}

function scoreStage2(correctTeams) {
  const questionKey = getQuestionKey();
  const speedOrder = correctTeams.sort((a, b) => a.ts - b.ts);

  speedOrder.forEach((entry, index) => {
    const points = STAGE_CONFIG.stage2.speedPoints[index] || 0;
    applyScoreDelta(quizState.teams[entry.teamName], questionKey, points);
  });
}

function scoreStage3(correctTeams) {
  const questionKey = getQuestionKey();
  const speedOrder = correctTeams.sort((a, b) => a.ts - b.ts);
  let firstCorrectGiven = false;

  speedOrder.forEach((entry) => {
    let points = 0;

    if (entry.attempts === 1) points = 100;
    else if (entry.attempts === 2) points = 75;
    else if (entry.attempts === 3) points = 50;

    if (!firstCorrectGiven) {
      points += 100;
      firstCorrectGiven = true;
    }

    applyScoreDelta(quizState.teams[entry.teamName], questionKey, points);
  });
}

function resolveCorrectAnswer(selectedCorrectAnswer) {
  const question = getCurrentQuestion();
  if (!question) {
    return { ok: false, error: 'No question available for scoring.' };
  }

  const provided = typeof selectedCorrectAnswer === 'string'
    ? selectedCorrectAnswer.trim().toUpperCase()
    : null;

  if (provided && !ANSWER_OPTIONS.has(provided)) {
    return { ok: false, error: 'Correct answer must be one of A, B, C, or D.' };
  }

  if (provided && provided !== question.correct) {
    return {
      ok: true,
      correctAnswer: question.correct,
      warning: `Selected answer ${provided} does not match the configured answer ${question.correct}. Using the configured answer.`
    };
  }

  return { ok: true, correctAnswer: question.correct };
}

function finalizeQuestion(selectedCorrectAnswer) {
  if (!quizState.questionActive) {
    return { ok: false, error: 'No active question to end.' };
  }

  const resolved = resolveCorrectAnswer(selectedCorrectAnswer);
  if (!resolved.ok) return resolved;

  const stageAtFinalize = quizState.stage;
  const questionIndexAtFinalize = quizState.questionIndex;
  const questionAtFinalize = getCurrentQuestion(stageAtFinalize, questionIndexAtFinalize);
  const questionIdAtFinalize = questionAtFinalize ? questionAtFinalize.id : null;
  const correctAnswer = resolved.correctAnswer;
  const questionKeyAtFinalize = getQuestionKey(stageAtFinalize, questionIndexAtFinalize);

  const bucket = getQuestionBucket();
  const correctTeams = Object.entries(bucket)
    .filter(([, row]) => row.answer === correctAnswer)
    .map(([teamName, row]) => ({
      teamName,
      ts: row.ts,
      attempts: row.attempts
    }));

  if (quizState.stage === 'stage1') scoreStage1(correctTeams, correctAnswer);
  if (quizState.stage === 'stage2') scoreStage2(correctTeams);
  if (quizState.stage === 'stage3') scoreStage3(correctTeams);

  Object.values(bucket).forEach((row) => {
    row.correct = row.answer === correctAnswer;
  });

  clearQuestionTimer();
  quizState.questionActive = false;
  quizState.questionEndTs = Date.now();
  quizState.timerEndsAt = null;

  recordQuestionHistory(
    stageAtFinalize,
    questionIndexAtFinalize,
    questionIdAtFinalize,
    correctAnswer,
    quizState.questionEndTs
  );

  quizState.completedQuestionKeys[questionKeyAtFinalize] = true;

  io.emit('question:ended', {
    correctAnswer,
    stage: quizState.stage,
    questionIndex: quizState.questionIndex,
    question: questionAtFinalize
  });

  if (quizState.tieBreak.active) {
    resolveTieBreakAndAdvance(correctAnswer, questionKeyAtFinalize);
  }

  return { ok: true, warning: resolved.warning || null };
}

function advanceQuestionOrStage() {
  if (quizState.questionActive) {
    return { ok: false, error: 'Wait for the active question to finish before moving forward.' };
  }

  if (quizState.quizCompleted) {
    return { ok: false, error: 'The quiz is already complete.' };
  }

  const cfg = STAGE_CONFIG[quizState.stage];
  if (quizState.questionIndex + 1 < cfg.total) {
    quizState.questionIndex += 1;
    return { ok: true };
  }

  if (quizState.stage === 'stage1') {
    if (!quizState.tieBreakResolvedWinnerByStage.stage1 && startTieBreakForStage('stage1')) {
      return { ok: true };
    }
    markSemifinalists(quizState.tieBreakResolvedWinnerByStage.stage1);
    quizState.tieBreakResolvedWinnerByStage.stage1 = null;
    quizState.stage = 'stage2';
    quizState.questionIndex = 0;
    return { ok: true };
  }

  if (quizState.stage === 'stage2') {
    if (!quizState.tieBreakResolvedWinnerByStage.stage2 && startTieBreakForStage('stage2')) {
      return { ok: true };
    }
    markFinalistsFromStage2(quizState.tieBreakResolvedWinnerByStage.stage2);
    quizState.tieBreakResolvedWinnerByStage.stage2 = null;
    quizState.stage = 'stage3';
    quizState.questionIndex = 0;
    return { ok: true };
  }

  if (startTieBreakForStage('stage3')) {
    return { ok: true };
  }

  quizState.quizCompleted = true;
  return { ok: false, error: 'The final question has already been completed.' };
}

function moveToNextStageManually() {
  if (quizState.questionActive) {
    return { ok: false, error: 'Wait for the active question to finish before changing stage.' };
  }

  if (quizState.quizCompleted) {
    return { ok: false, error: 'The quiz is already complete.' };
  }

  if (quizState.stage === 'stage1') {
    if (!quizState.tieBreakResolvedWinnerByStage.stage1 && startTieBreakForStage('stage1')) {
      return { ok: true };
    }
    markSemifinalists(quizState.tieBreakResolvedWinnerByStage.stage1);
    quizState.tieBreakResolvedWinnerByStage.stage1 = null;
    quizState.stage = 'stage2';
    quizState.questionIndex = 0;
    return { ok: true };
  }

  if (quizState.stage === 'stage2') {
    if (!quizState.tieBreakResolvedWinnerByStage.stage2 && startTieBreakForStage('stage2')) {
      return { ok: true };
    }
    markFinalistsFromStage2(quizState.tieBreakResolvedWinnerByStage.stage2);
    quizState.tieBreakResolvedWinnerByStage.stage2 = null;
    quizState.stage = 'stage3';
    quizState.questionIndex = 0;
    return { ok: true };
  }

  if (startTieBreakForStage('stage3')) {
    return { ok: true };
  }

  quizState.quizCompleted = true;
  return { ok: false, error: 'Stage 3 is the final stage.' };
}

function shouldAutoFinalizeStage3(question, questionKey) {
  if (quizState.stage !== 'stage3' || !quizState.questionActive || !question) return false;

  const activeFinalists = quizState.finalists.filter((teamName) => {
    const team = quizState.teams[teamName];
    return Boolean(team && isTeamAllowed(team));
  });

  if (activeFinalists.length < 2) return false;

  return activeFinalists.every((teamName) => {
    const team = quizState.teams[teamName];
    const row = getAnswerRow(teamName, questionKey);
    const answeredCorrect = Boolean(row && row.answer === question.correct);
    const attemptsUsed = team.attemptsByQuestion[questionKey] || 0;
    const attemptsExhausted = attemptsUsed >= STAGE_CONFIG.stage3.maxAttempts;

    return answeredCorrect || attemptsExhausted;
  });
}

function startQuestion() {
  if (quizState.quizCompleted) {
    return { ok: false, error: 'The quiz is already complete.' };
  }

  if (quizState.questionActive) {
    return { ok: false, error: 'A question is already active.' };
  }

  const question = getCurrentQuestion();
  if (!question) {
    return { ok: false, error: 'No question found for the current stage.' };
  }

  const questionKey = getQuestionKey();
  if (quizState.completedQuestionKeys[questionKey]) {
    return { ok: false, error: 'This question is already completed. Please move to the next question.' };
  }

  ensureQuestionBucket();
  clearQuestionTimer();

  quizState.questionActive = true;
  quizState.questionStartTs = Date.now();
  quizState.questionEndTs = null;
  quizState.currentQuestionId = question.id;
  const timeLimitSeconds = STAGE_CONFIG[quizState.stage].timeLimitSeconds;
  quizState.timerEndsAt = typeof timeLimitSeconds === 'number'
    ? Date.now() + timeLimitSeconds * 1000
    : null;

  Object.values(quizState.teams).forEach((team) => {
    if (typeof team.attemptsByQuestion[questionKey] !== 'number') {
      team.attemptsByQuestion[questionKey] = 0;
    }

    ensureTeamQuestionDelta(team, questionKey);
  });

  if (typeof timeLimitSeconds === 'number') {
    questionTimer = setTimeout(() => {
      if (!quizState.questionActive) return;

      const result = finalizeQuestion();
      if (result.warning && quizState.teacherSocketId) {
        io.to(quizState.teacherSocketId).emit('teacher:error', { message: result.warning });
      }
      emitState();
    }, timeLimitSeconds * 1000 + 100);
  }

  io.emit('question:started', {
    question: sanitizeQuestion(question),
    stage: quizState.stage,
    questionIndex: quizState.questionIndex,
    timerEndsAt: quizState.timerEndsAt
  });

  return { ok: true };
}

function resetCurrentQuestionAttempts() {
  const questionKey = getQuestionKey();

  Object.values(quizState.teams).forEach((team) => {
    team.attemptsByQuestion[questionKey] = 0;
    team.retryUsedByQuestion[questionKey] = false;
    delete team.answerTimestamps[questionKey];
    team.scoreDeltaByQuestion[questionKey] = { added: 0, reduced: 0, net: 0 };
  });

  quizState.answersByQuestion[questionKey] = {};
}

function isTeacherSocket(socket) {
  return Boolean(quizState.teacherSocketId && socket.id === quizState.teacherSocketId);
}

app.use(express.static(path.join(__dirname, 'public')));

app.get('/teacher', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'teacher.html'));
});

io.on('connection', (socket) => {
  socket.on('team:register', ({ teamName }) => {
    const normalized = normalizeTeamName(teamName);
    const teamNameError = validateTeamName(normalized);

    if (teamNameError) {
      socket.emit('team:error', { message: teamNameError });
      return;
    }

    const existingTeamName = findStoredTeamName(normalized);
    const storedTeamName = existingTeamName || normalized;

    if (!existingTeamName && hasQuizStarted()) {
      socket.emit('team:error', { message: 'New teams cannot join after the quiz has started.' });
      return;
    }

    if (!existingTeamName && Object.keys(quizState.teams).length >= MAX_TEAMS) {
      socket.emit('team:error', { message: `Maximum ${MAX_TEAMS} teams already registered.` });
      return;
    }

    const existingSocketForName = quizState.socketsByTeam[storedTeamName];
    if (existingSocketForName && existingSocketForName !== socket.id) {
      socket.emit('team:error', { message: 'Duplicate team name. Choose a unique team name.' });
      return;
    }

    if (!quizState.teams[storedTeamName]) {
      quizState.teams[storedTeamName] = {
        teamName: storedTeamName,
        socketId: socket.id,
        score: 500,
        eliminated: false,
        stageQualified: 'stage1',
        attemptsByQuestion: {},
        answerTimestamps: {},
        retryUsedByQuestion: {},
        scoreDeltaByQuestion: {}
      };
    } else {
      quizState.teams[storedTeamName].socketId = socket.id;
    }

    quizState.socketsByTeam[storedTeamName] = socket.id;
    socket.data.teamName = storedTeamName;

    socket.emit('team:registered', { teamName: storedTeamName });
    emitState();
  });

  socket.on('teacher:register', () => {
    quizState.teacherSocketId = socket.id;
    socket.data.isTeacher = true;
    emitState();
  });

  socket.on('teacher:startQuestion', () => {
    if (!isTeacherSocket(socket)) return;

    const result = startQuestion();
    if (!result.ok) {
      socket.emit('teacher:error', { message: result.error });
    }
    emitState();
  });

  socket.on('teacher:endQuestion', ({ correctAnswer } = {}) => {
    if (!isTeacherSocket(socket)) return;

    const result = finalizeQuestion(correctAnswer || null);
    if (!result.ok) {
      socket.emit('teacher:error', { message: result.error });
    } else if (result.warning) {
      socket.emit('teacher:error', { message: result.warning });
    }
    emitState();
  });

  socket.on('teacher:nextQuestion', () => {
    if (!isTeacherSocket(socket)) return;

    if (quizState.questionActive) {
      const finalizeResult = finalizeQuestion();
      if (!finalizeResult.ok) {
        socket.emit('teacher:error', { message: finalizeResult.error });
        emitState();
        return;
      }
    }

    const result = advanceQuestionOrStage();
    if (!result.ok && result.error !== 'The final question has already been completed.') {
      socket.emit('teacher:error', { message: result.error });
    }
    emitState();
  });

  socket.on('teacher:nextStage', () => {
    if (!isTeacherSocket(socket)) return;

    if (quizState.questionActive) {
      const finalizeResult = finalizeQuestion();
      if (!finalizeResult.ok) {
        socket.emit('teacher:error', { message: finalizeResult.error });
        emitState();
        return;
      }
    }

    const result = moveToNextStageManually();
    if (!result.ok) {
      socket.emit('teacher:error', { message: result.error });
    }
    emitState();
  });

  socket.on('teacher:resetAttempts', () => {
    if (!isTeacherSocket(socket)) return;

    resetCurrentQuestionAttempts();
    emitState();
  });

  socket.on('teacher:resetAll', () => {
    if (!isTeacherSocket(socket)) return;

    clearQuestionTimer();
    quizState = createInitialState();
    quizState.teacherSocketId = socket.id;
    io.emit('quiz:reset');
    emitState();
  });

  socket.on('team:submitAnswer', ({ answer } = {}) => {
    const teamName = socket.data.teamName;
    if (!teamName || !quizState.teams[teamName]) return;

    const team = quizState.teams[teamName];
    const question = getCurrentQuestion();
    const questionKey = getQuestionKey();
    const normalizedAnswer = typeof answer === 'string' ? answer.trim().toUpperCase() : '';

    if (!ANSWER_OPTIONS.has(normalizedAnswer)) {
      socket.emit('team:error', { message: 'Answer must be one of A, B, C, or D.' });
      return;
    }

    if (!question || !canTeamAnswer(team, questionKey, question)) {
      return;
    }

    ensureQuestionBucket(questionKey);

    const attemptsUsed = team.attemptsByQuestion[questionKey] || 0;
    const now = Date.now();
    const isCorrect = normalizedAnswer === question.correct;

    if (quizState.stage === 'stage1') {
      if (attemptsUsed === 0) {
        team.attemptsByQuestion[questionKey] = 1;
        quizState.answersByQuestion[questionKey][teamName] = {
          answer: normalizedAnswer,
          ts: now,
          attempts: 1,
          correct: null
        };

        if (!isCorrect) {
          socket.emit('team:retryOption', {
            allowRetry: canUseStage1Retry(team, questionKey, question),
            retryCost: STAGE_CONFIG.stage1.retryCost
          });
        }
      } else if (canUseStage1Retry(team, questionKey, question)) {
        applyScoreDelta(team, questionKey, -STAGE_CONFIG.stage1.retryCost);
        team.retryUsedByQuestion[questionKey] = true;
        team.attemptsByQuestion[questionKey] = 2;
        quizState.answersByQuestion[questionKey][teamName] = {
          answer: normalizedAnswer,
          ts: now,
          attempts: 2,
          correct: null
        };
      } else {
        socket.emit('team:error', { message: 'No retry is available for this question.' });
        return;
      }
    } else {
      const nextAttempt = attemptsUsed + 1;
      team.attemptsByQuestion[questionKey] = nextAttempt;
      quizState.answersByQuestion[questionKey][teamName] = {
        answer: normalizedAnswer,
        ts: now,
        attempts: nextAttempt,
        correct: null
      };
    }

    team.answerTimestamps[questionKey] = now;

    if (shouldAutoFinalizeStage3(question, questionKey)) {
      const finalizeResult = finalizeQuestion();
      if (!finalizeResult.ok && quizState.teacherSocketId) {
        io.to(quizState.teacherSocketId).emit('teacher:error', { message: finalizeResult.error });
      }
      if (finalizeResult.warning && quizState.teacherSocketId) {
        io.to(quizState.teacherSocketId).emit('teacher:error', { message: finalizeResult.warning });
      }
    }

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
  console.log(`Teacher panel: http://localhost:${PORT}/teacher`);
});
