const socket = io();

const stageEl = document.getElementById('teacherStage');
const progressEl = document.getElementById('teacherProgress');
const questionLabel = document.getElementById('questionLabel');
const leaderboardBody = document.getElementById('teacherLeaderboardBody');
const answersBody = document.getElementById('answersBody');
const finalistsText = document.getElementById('finalistsText');
const winnerText = document.getElementById('winnerText');
const teacherError = document.getElementById('teacherError');
const teacherTimer = document.getElementById('teacherTimer');

let selectedCorrectAnswer = null;
let timerInterval;

function runCountdown(timerEndsAt) {
  clearInterval(timerInterval);
  if (!timerEndsAt) {
    teacherTimer.textContent = '--';
    return;
  }

  timerInterval = setInterval(() => {
    const sec = Math.max(0, Math.ceil((timerEndsAt - Date.now()) / 1000));
    teacherTimer.textContent = `${sec}s`;
    if (sec <= 0) clearInterval(timerInterval);
  }, 250);
}

document.getElementById('startQuestionBtn').addEventListener('click', () => {
  socket.emit('teacher:startQuestion');
});

document.getElementById('endQuestionBtn').addEventListener('click', () => {
  socket.emit('teacher:endQuestion', { correctAnswer: selectedCorrectAnswer });
});

document.getElementById('nextQuestionBtn').addEventListener('click', () => {
  socket.emit('teacher:nextQuestion');
  selectedCorrectAnswer = null;
});

document.getElementById('nextStageBtn').addEventListener('click', () => {
  socket.emit('teacher:nextStage');
  selectedCorrectAnswer = null;
});

document.getElementById('resetAttemptsBtn').addEventListener('click', () => {
  socket.emit('teacher:resetAttempts');
});

document.querySelectorAll('.correct-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    selectedCorrectAnswer = btn.dataset.correct;
    teacherError.textContent = `Selected correct answer: ${selectedCorrectAnswer}`;
  });
});

socket.on('teacher:error', ({ message }) => {
  teacherError.textContent = message;
});

socket.on('teacher:state', ({
  stage,
  questionIndex,
  totalQuestions,
  questionActive,
  currentQuestion,
  leaderboard,
  answerRows,
  finalists,
  stageWinners,
  timerEndsAt
}) => {
  stageEl.textContent = stage.toUpperCase();
  progressEl.textContent = `Q${questionIndex + 1} / ${totalQuestions}`;
  questionLabel.textContent = currentQuestion
    ? `Current Question: ${currentQuestion.text} ${questionActive ? '(Active)' : '(Idle)'}`
    : 'Current Question: N/A';

  leaderboardBody.innerHTML = leaderboard
    .map((row, i) => `<tr><td>${i + 1}</td><td>${row.name}</td><td>${row.score}</td><td>${row.eliminated ? 'Eliminated' : row.stageQualified || '-'}</td></tr>`)
    .join('');

  answersBody.innerHTML = answerRows
    .map((row) => {
      const t = row.ts ? new Date(row.ts).toLocaleTimeString() : '-';
      const correct = row.correct === null ? '-' : row.correct ? 'Yes' : 'No';
      return `<tr><td>${row.teamName}</td><td>${row.answer || '-'}</td><td>${row.attempts || 0}</td><td>${t}</td><td>${correct}</td></tr>`;
    })
    .join('');

  finalistsText.textContent = finalists.length
    ? `Finalists: ${finalists.join(' vs ')}`
    : 'Finalists not decided yet.';

  winnerText.textContent = `Stage 1 Winner: ${stageWinners.stage1 || '-'} | Stage 2 Winner: ${stageWinners.stage2 || '-'}`;
  runCountdown(timerEndsAt);
});

socket.emit('teacher:register');
