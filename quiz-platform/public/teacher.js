const socket = io();

const stageEl = document.getElementById('teacherStage');
const progressEl = document.getElementById('teacherProgress');
const teacherLeaderboard = document.getElementById('teacherLeaderboard');
const answersBody = document.getElementById('answersBody');
const leaderboardTopRow = document.getElementById('leaderboardTopRow');
const stage1WinnerTile = document.getElementById('stage1WinnerTile');
const finalVsTile = document.getElementById('finalVsTile');
const stage2WinnerTile = document.getElementById('stage2WinnerTile');
const teacherError = document.getElementById('teacherError');
const teacherTimer = document.getElementById('teacherTimer');
const teacherConnectionStatus = document.getElementById('teacherConnectionStatus');
const projectorQuestionPanel = document.getElementById('projectorQuestionPanel');
const projectorQuestionText = document.getElementById('projectorQuestionText');
const projectorQuestionOptions = document.getElementById('projectorQuestionOptions');

const startQuestionBtn = document.getElementById('startQuestionBtn');
const nextQuestionBtn = document.getElementById('nextQuestionBtn');
const nextStageBtn = document.getElementById('nextStageBtn');

const answerModal = document.getElementById('answerModal');
const correctAnswerLetter = document.getElementById('correctAnswerLetter');
const correctAnswerText = document.getElementById('correctAnswerText');
const answerExplanation = document.getElementById('answerExplanation');
const closeAnswerModal = document.getElementById('closeAnswerModal');
const announcementModal = document.getElementById('announcementModal');
const announcementCard = document.getElementById('announcementCard');
const announcementEmoji = document.getElementById('announcementEmoji');
const announcementTitle = document.getElementById('announcementTitle');
const announcementWinner = document.getElementById('announcementWinner');
const announcementMessage = document.getElementById('announcementMessage');
const closeAnnouncementModal = document.getElementById('closeAnnouncementModal');

let timerInterval;
let answerModalTimeout;
let shownWinners = { stage1: null, stage2: null, champion: null };
let previousRankByStage = { stage1: {}, stage2: {}, stage3: {} };
let cachedProjectorQuestion = null;

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function setConnectionStatus(isConnected) {
  teacherConnectionStatus.textContent = isConnected ? 'Connected' : 'Disconnected';
  teacherConnectionStatus.classList.toggle('connected', isConnected);
  teacherConnectionStatus.classList.toggle('disconnected', !isConnected);
}

function showPopupMessage(message) {
  alert(message);
}

function clearProjectorQuestion() {
  cachedProjectorQuestion = null;
  projectorQuestionPanel.classList.add('hidden');
  projectorQuestionText.textContent = 'Question will appear here';
  projectorQuestionOptions.innerHTML = '';
}

function renderProjectorQuestion(questionActive, currentQuestion, stage) {
  if (questionActive && currentQuestion) {
    cachedProjectorQuestion = {
      stage,
      question: currentQuestion
    };
  }

  const displayQuestion = questionActive && currentQuestion
    ? currentQuestion
    : (stage === 'stage3' && cachedProjectorQuestion?.stage === 'stage3'
      ? cachedProjectorQuestion.question
      : null);

  const shouldShow = Boolean(displayQuestion);

  if (!shouldShow) {
    clearProjectorQuestion();
    return;
  }

  const safeQuestionText = escapeHtml(displayQuestion.text || 'Question');
  const optionsMarkup = ['A', 'B', 'C', 'D']
    .map((label, index) => {
      const value = Array.isArray(displayQuestion.options) ? displayQuestion.options[index] : '';
      const safeValue = escapeHtml(value || '-');
      return `<div class="teacher-option-item"><span class="teacher-option-letter">${label}</span><span class="teacher-option-value">${safeValue}</span></div>`;
    })
    .join('');

  projectorQuestionText.textContent = safeQuestionText;
  projectorQuestionOptions.innerHTML = optionsMarkup;
  projectorQuestionPanel.classList.remove('hidden');
}

function updateControlButtons({ questionActive, questionCompleted, currentQuestion, quizCompleted }) {
  const hasQuestion = Boolean(currentQuestion);
  const hasBeenAsked = Boolean(questionActive || questionCompleted);

  startQuestionBtn.disabled = Boolean(quizCompleted || !hasQuestion || questionActive || questionCompleted);
  nextQuestionBtn.disabled = Boolean(quizCompleted || !hasQuestion || !hasBeenAsked);
  nextStageBtn.disabled = Boolean(quizCompleted);
}

function updateLeaderboardInfo(stage, finalists, stageWinners) {
  leaderboardTopRow.style.display = 'none';
  stage1WinnerTile.style.display = 'none';
  finalVsTile.style.display = 'none';
  stage2WinnerTile.style.display = 'none';

  if (stage === 'stage2') {
    leaderboardTopRow.style.display = 'grid';
    stage1WinnerTile.style.display = 'block';
    stage1WinnerTile.textContent = `🧠 Stage 1 Winner: ${stageWinners.stage1 || '-'}`;
    return;
  }

  if (stage === 'stage3') {
    const leftName = stageWinners.stage1 || finalists[0] || '-';
    const rightName = stageWinners.stage2 || finalists[1] || '-';

    leaderboardTopRow.style.display = 'grid';
    stage1WinnerTile.style.display = 'block';
    finalVsTile.style.display = 'flex';
    stage2WinnerTile.style.display = 'block';

    stage1WinnerTile.textContent = `🧠 ${leftName}`;
    stage2WinnerTile.textContent = `🧩 ${rightName}`;
  }
}

function resetTeacherView() {
  teacherError.textContent = '';
  stageEl.textContent = 'Stage 1';
  progressEl.textContent = 'Q1 / 1';
  teacherLeaderboard.innerHTML = '';
  answersBody.innerHTML = '';
  leaderboardTopRow.style.display = 'none';
  stage1WinnerTile.textContent = '';
  stage2WinnerTile.textContent = '';
  runCountdown(null);
  clearProjectorQuestion();
  closeModal();
  closeAnnouncement();
  shownWinners = { stage1: null, stage2: null, champion: null };
  previousRankByStage = { stage1: {}, stage2: {}, stage3: {} };
  updateControlButtons({
    questionActive: false,
    questionCompleted: false,
    currentQuestion: { id: 'placeholder' },
    quizCompleted: false
  });
}

function renderLeaderboard(leaderboard, stageWinners = { stage1: null, stage2: null }, stageKey = 'stage1') {
  if (!leaderboard || leaderboard.length === 0) {
    teacherLeaderboard.innerHTML = '<p style="text-align: center; color: var(--text-muted);">No teams yet</p>';
    return;
  }

  const maxScore = Math.max(...leaderboard.map((entry) => entry.score || 0), 1000);

  teacherLeaderboard.innerHTML = leaderboard
    .map((team, index) => {
      const percentage = ((team.score || 0) / maxScore) * 100;
      const currentRank = index + 1;
      const stageRanks = previousRankByStage[stageKey] || {};
      const previousRank = stageRanks[team.name] || null;
      const rankDelta = previousRank ? (previousRank - currentRank) : 0;
      let barClass = '';
      let tierClass = '';
      let tierText = '';
      let icon = '📝';
      let rankClass = '';
      let rankText = '';

      const isStage1Winner = Boolean(stageWinners?.stage1 && team.name === stageWinners.stage1);
      const isStage2Winner = Boolean(stageWinners?.stage2 && team.name === stageWinners.stage2);
      const isFinalist = Boolean((team.badge && team.badge.includes('Finalist')) || isStage1Winner || isStage2Winner);

      if (isStage1Winner) {
        barClass = 'bar-stage1';
        tierClass = 'tier-stage1';
        tierText = 'Stage 1 Winner';
        icon = '🧠';
      } else if (isStage2Winner) {
        barClass = 'bar-stage2';
        tierClass = 'tier-stage2';
        tierText = 'Stage 2 Winner';
        icon = '🧩';
      } else if (isFinalist) {
        barClass = 'bar-finalist';
        tierClass = 'tier-finalist';
        tierText = 'Finalist';
        icon = '📘';
      } else if (team.badge && team.badge.includes('semifinal')) {
        barClass = 'bar-semi';
        icon = '✍️';
      } else if (team.eliminated) {
        barClass = 'bar-eliminated';
        icon = '⏳';
      }

      if (rankDelta > 0) {
        rankClass = 'rank-chip-up';
        rankText = `▲ ${rankDelta}`;
      } else if (rankDelta < 0) {
        rankClass = 'rank-chip-down';
        rankText = `▼ ${Math.abs(rankDelta)}`;
      }

      const safeName = escapeHtml(team.name);
      const safeTierText = escapeHtml(tierText);
      const safeRankText = escapeHtml(rankText);

      return `
        <div class="leaderboard-bar ${tierClass} ${rankClass ? 'rank-shift' : ''}">
          <div class="bar-label">
            <span class="bar-label-team">
              <span class="bar-label-main">${currentRank}. ${icon} ${safeName}</span>
              ${tierText ? `<span class="tier-pill">${safeTierText}</span>` : ''}
            </span>
            ${rankText ? `<span class="rank-chip ${rankClass}">${safeRankText}</span>` : ''}
          </div>
          <div class="bar-wrapper">
            <div class="bar-fill ${barClass}" style="width: ${percentage}%;">
              <span class="bar-score">${team.score}</span>
            </div>
          </div>
        </div>
      `;
    })
    .join('');

  previousRankByStage[stageKey] = Object.fromEntries(leaderboard.map((team, index) => [team.name, index + 1]));
}

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

function showAnswerModal(question) {
  if (!question) return;

  const correctLetter = question.correct;
  const correctIndex = correctLetter.charCodeAt(0) - 65;
  const correctText = question.options[correctIndex];
  const explanation = question.explanation || 'Keep practicing to understand this concept better!';

  correctAnswerLetter.textContent = correctLetter;
  correctAnswerText.textContent = correctText;
  answerExplanation.textContent = explanation;

  answerModal.classList.add('active');

  clearTimeout(answerModalTimeout);
  answerModalTimeout = setTimeout(() => {
    closeModal();
  }, 15000);
}

function closeModal() {
  answerModal.classList.remove('active');
  clearTimeout(answerModalTimeout);
}

function showAnnouncement(title, message, type = 'stage1', winnerName = '') {
  closeModal();
  announcementCard.classList.remove('announce-stage1', 'announce-stage2', 'announce-champion', 'announce-welcome');
  announcementCard.classList.add(`announce-${type}`);

  if (type === 'stage1') announcementEmoji.textContent = '🧠📘';
  if (type === 'stage2') announcementEmoji.textContent = '🧩📘';
  if (type === 'champion') announcementEmoji.textContent = '🎓🏅';

  announcementTitle.textContent = title;
  announcementWinner.textContent = winnerName || '';
  announcementMessage.textContent = message;
  announcementModal.classList.add('active');
}

function closeAnnouncement() {
  announcementModal.classList.remove('active');
}

function announceWinners(stageWinners, champion, quizCompleted) {
  if (stageWinners?.stage1 && shownWinners.stage1 !== stageWinners.stage1) {
    shownWinners.stage1 = stageWinners.stage1;
    showAnnouncement('🧠 STAGE 1 WINNER ANNOUNCED!', 'tops Round 1 and secures the first finalist spot!', 'stage1', stageWinners.stage1);
    return;
  }

  if (stageWinners?.stage2 && shownWinners.stage2 !== stageWinners.stage2) {
    shownWinners.stage2 = stageWinners.stage2;
    showAnnouncement('🧩 STAGE 2 WINNER ANNOUNCED!', 'wins Round 2 and claims the second finalist position!', 'stage2', stageWinners.stage2);
    return;
  }

  if (quizCompleted && champion && shownWinners.champion !== champion) {
    shownWinners.champion = champion;
    showAnnouncement('🎓 QUIZ CHAMPION!', 'wins the full quiz challenge. Congratulations!', 'champion', champion);
  }
}

closeAnswerModal.addEventListener('click', closeModal);
closeAnnouncementModal.addEventListener('click', closeAnnouncement);

startQuestionBtn.addEventListener('click', () => {
  closeModal();
  closeAnnouncement();
  socket.emit('teacher:startQuestion');
});

nextQuestionBtn.addEventListener('click', () => {
  clearProjectorQuestion();
  closeModal();
  closeAnnouncement();
  socket.emit('teacher:nextQuestion');
});

nextStageBtn.addEventListener('click', () => {
  closeModal();
  closeAnnouncement();

  if (confirm('Do you want to proceed to the next round?')) {
    socket.emit('teacher:nextStage');
  }
});

document.addEventListener('keydown', (event) => {
  if (event.target && ['INPUT', 'TEXTAREA'].includes(event.target.tagName)) return;

  if ((event.key === 's' || event.key === 'S') && !startQuestionBtn.disabled) {
    socket.emit('teacher:startQuestion');
  } else if ((event.key === 'n' || event.key === 'N') && !nextQuestionBtn.disabled) {
    socket.emit('teacher:nextQuestion');
  } else if ((event.key === 'r' || event.key === 'R') && !nextStageBtn.disabled) {
    if (confirm('Do you want to proceed to the next round?')) {
      socket.emit('teacher:nextStage');
    }
  }
});

answerModal.addEventListener('click', (event) => {
  if (event.target === answerModal) closeModal();
});

announcementModal.addEventListener('click', (event) => {
  if (event.target === announcementModal) closeAnnouncement();
});

socket.on('teacher:error', ({ message }) => {
  teacherError.textContent = message;

  if (typeof message === 'string' && message.includes('already completed')) {
    showPopupMessage('This question is already completed. Please click Next Question.');
  }
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
  champion,
  timerEndsAt,
  questionCompleted,
  quizCompleted
}) => {
  stageEl.textContent = stage.toUpperCase();
  progressEl.textContent = `Q${questionIndex + 1} / ${totalQuestions}`;
  renderProjectorQuestion(questionActive, currentQuestion, stage);

  renderLeaderboard(leaderboard, stageWinners, stage);

  answersBody.innerHTML = answerRows
    .map((row) => {
      const t = row.ts ? new Date(row.ts).toLocaleTimeString() : '-';
      const responseTime = typeof row.responseSeconds === 'number' ? `${row.responseSeconds.toFixed(1)}s` : '-';
      const correct = row.correct === null ? '-' : row.correct ? '✓ Yes' : '✗ No';
      const safeTeamName = escapeHtml(row.teamName || '-');
      const safeAnswer = escapeHtml(row.answer || '-');
      const safeResponseTime = escapeHtml(responseTime);
      const safeCorrect = escapeHtml(correct);
      return `<tr><td>${safeTeamName}</td><td>${safeAnswer}</td><td>${row.attempts || 0}</td><td>${t}</td><td>${safeResponseTime}</td><td>${safeCorrect}</td></tr>`;
    })
    .join('');

  updateLeaderboardInfo(stage, finalists, stageWinners);

  if (quizCompleted) {
    teacherError.textContent = '✅ Quiz completed!';
  }

  announceWinners(stageWinners, champion, quizCompleted);

  updateControlButtons({
    questionActive,
    questionCompleted,
    currentQuestion,
    quizCompleted
  });

  runCountdown(timerEndsAt);
});

socket.on('question:ended', ({ question }) => {
  if (question) showAnswerModal(question);
});

socket.on('quiz:reset', () => {
  resetTeacherView();
});

socket.on('connect', () => {
  setConnectionStatus(true);
  socket.emit('teacher:register');
});

socket.on('disconnect', () => {
  setConnectionStatus(false);
});

socket.on('connect_error', () => {
  setConnectionStatus(false);
});

resetTeacherView();
setConnectionStatus(socket.connected);

if (socket.connected) {
  socket.emit('teacher:register');
}
