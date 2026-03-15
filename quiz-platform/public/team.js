const socket = io();

const joinSection = document.getElementById('joinSection');
const quizSection = document.getElementById('quizSection');
const teamNameInput = document.getElementById('teamName');
const joinBtn = document.getElementById('joinBtn');
const joinError = document.getElementById('joinError');
const questionText = document.getElementById('questionText');
const scoreText = document.getElementById('scoreText');
const attemptStatus = document.getElementById('attemptStatus');
const waitingText = document.getElementById('waitingText');
const feedbackText = document.getElementById('feedbackText');
const leaderboardBody = document.getElementById('leaderboardBody');
const stageBadge = document.getElementById('stageBadge');
const progressText = document.getElementById('progressText');
const timerEl = document.getElementById('timer');
const answerButtons = Array.from(document.querySelectorAll('.answer-btn'));

let registered = false;
let timerInterval;

joinBtn.addEventListener('click', () => {
  const teamName = teamNameInput.value.trim();
  socket.emit('team:register', { teamName });
});

answerButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    socket.emit('team:submitAnswer', { answer: btn.dataset.answer });
  });
});

function setAnswerButtonsEnabled(enabled) {
  answerButtons.forEach((btn) => {
    btn.disabled = !enabled;
  });
}

function runCountdown(timerEndsAt) {
  clearInterval(timerInterval);
  if (!timerEndsAt) {
    timerEl.textContent = '--';
    return;
  }

  timerInterval = setInterval(() => {
    const ms = timerEndsAt - Date.now();
    const sec = Math.max(0, Math.ceil(ms / 1000));
    timerEl.textContent = `${sec}s`;
    if (sec <= 0) clearInterval(timerInterval);
  }, 250);
}

socket.on('team:registered', ({ teamName }) => {
  registered = true;
  joinError.textContent = '';
  joinSection.classList.add('hidden');
  quizSection.classList.remove('hidden');
  waitingText.textContent = `Welcome ${teamName}. Waiting for teacher...`;
});

socket.on('team:error', ({ message }) => {
  if (!registered) joinError.textContent = message;
  else feedbackText.textContent = message;
});

socket.on('team:retryOption', ({ allowRetry, retryCost }) => {
  feedbackText.textContent = allowRetry
    ? `Wrong answer. You may retry once (cost: ${retryCost} points).`
    : 'Wrong answer. Retry unavailable due to insufficient points.';
});

socket.on('question:started', ({ question, stage, questionIndex, timerEndsAt }) => {
  questionText.textContent = question.text;
  feedbackText.textContent = '';
  stageBadge.textContent = stage.toUpperCase();
  progressText.textContent = `Question ${questionIndex + 1}`;
  setAnswerButtonsEnabled(true);
  runCountdown(timerEndsAt);
});

socket.on('question:ended', ({ correctAnswer }) => {
  setAnswerButtonsEnabled(false);
  feedbackText.textContent = correctAnswer
    ? `Question ended. Correct answer: ${correctAnswer}`
    : 'Question ended. Teacher did not set a correct answer.';
  runCountdown(null);
});

socket.on('leaderboard:update', ({ leaderboard }) => {
  leaderboardBody.innerHTML = leaderboard
    .map((row, i) => `<tr><td>${i + 1}</td><td>${row.name}</td><td>${row.score}</td></tr>`)
    .join('');
});

socket.on('team:state', (state) => {
  scoreText.textContent = `Score: ${state.score}`;
  attemptStatus.textContent = `Attempts: ${state.attemptsUsed}`;
  waitingText.textContent = state.waitingMessage || '';
  stageBadge.textContent = state.stage.toUpperCase();
  progressText.textContent = `Question ${state.questionIndex + 1} / ${state.totalQuestions}`;
  setAnswerButtonsEnabled(state.canAnswer);
  runCountdown(state.timerEndsAt);
});
