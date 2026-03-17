const socket = io();

// DOM Elements
const joinSection = document.getElementById('joinSection');
const quizSection = document.getElementById('quizSection');
const scoreSheetSection = document.getElementById('scoreSheetSection');
const teamNameInput = document.getElementById('teamName');
const teamDisplayName = document.getElementById('teamDisplayName');
const joinBtn = document.getElementById('joinBtn');
const joinError = document.getElementById('joinError');
const connectionStatus = document.getElementById('connectionStatus');
const questionText = document.getElementById('questionText');
const scoreText = document.getElementById('scoreText');
const attemptStatus = document.getElementById('attemptStatus');
const waitingText = document.getElementById('waitingText');
const feedbackText = document.getElementById('feedbackText');
const leaderboard = document.getElementById('leaderboard');
const stageBadge = document.getElementById('stageBadge');
const progressText = document.getElementById('progressText');
const timerEl = document.getElementById('timer');
const answerButtons = Array.from(document.querySelectorAll('.answer-btn'));
const scoreSheetBody = document.getElementById('scoreSheetBody');

// Modal Elements
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

let registered = false;
let registeredTeamName = '';
let timerInterval;
let answerModalTimeout;
let shownWinners = { stage1: null, stage2: null, champion: null };
let latestStageWinners = { stage1: null, stage2: null };
let previousRankByStage = { stage1: {}, stage2: {}, stage3: {} };
const TEAM_NAME_STORAGE_KEY = 'quiz.teamName';

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function setConnectionStatus(isConnected) {
  connectionStatus.textContent = isConnected ? 'Connected' : 'Disconnected';
  connectionStatus.classList.toggle('connected', isConnected);
  connectionStatus.classList.toggle('disconnected', !isConnected);
}

function setInstructionTone(element, tone) {
  element.classList.remove('instruction-waiting', 'instruction-wrong', 'instruction-correct');
  element.classList.add(`instruction-${tone}`);
}

function getWaitingTone(message) {
  const text = String(message || '').toLowerCase();
  if (!text) return 'waiting';
  if (text.includes('correct answer locked in')) return 'correct';
  if (text.includes('wrong') || text.includes('retry unavailable') || text.includes('used your only attempt') || text.includes('used all attempts') || text.includes('no attempts remaining')) {
    return 'wrong';
  }
  return 'waiting';
}

function renderQuestion(question) {
  if (!question) {
    questionText.textContent = 'Waiting for question...';
    answerButtons.forEach((btn, index) => {
      btn.textContent = String.fromCharCode(65 + index);
    });
    return;
  }

  questionText.textContent = question.text || 'Waiting for question...';
  answerButtons.forEach((btn, index) => {
    btn.textContent = question.options[index] || String.fromCharCode(65 + index);
  });
}

function resetTeamView() {
  registered = false;
  joinSection.classList.remove('hidden');
  quizSection.classList.add('hidden');
  scoreSheetSection.style.display = 'none';
  teamNameInput.value = '';
  joinError.textContent = '';
  feedbackText.textContent = '';
  waitingText.textContent = 'Waiting for teacher to start the next question.';
  setInstructionTone(waitingText, 'waiting');
  setInstructionTone(feedbackText, 'waiting');
  scoreText.textContent = 'Score: 500';
  attemptStatus.textContent = 'Attempts: 0';
  stageBadge.textContent = 'Stage 1';
  progressText.textContent = '';
  leaderboard.innerHTML = '';
  previousRankByStage = { stage1: {}, stage2: {}, stage3: {} };
  registeredTeamName = '';
  teamDisplayName.textContent = '';
  teamDisplayName.classList.add('hidden');
  renderScoreSheet([]);
  renderQuestion(null);
  setAnswerButtonsEnabled(false);
  runCountdown(null);
  closeModal();
  closeAnnouncement();
  shownWinners = { stage1: null, stage2: null, champion: null };
  latestStageWinners = { stage1: null, stage2: null };
}

function renderLeaderboard(leaderboardData, stageWinners = latestStageWinners, stageKey = 'stage1') {
  if (!leaderboardData || leaderboardData.length === 0) {
    leaderboard.innerHTML = '<p style="text-align: center; color: var(--text-muted);">No teams yet</p>';
    return;
  }

  const maxScore = Math.max(...leaderboardData.map(l => l.score || 0), 1000);
  
  leaderboard.innerHTML = leaderboardData
    .map((team, index) => {
      const percentage = ((team.score || 0) / maxScore) * 100;
      const isSelf = registeredTeamName && team.name === registeredTeamName;
      const currentRank = index + 1;
      const stageRanks = previousRankByStage[stageKey] || {};
      const previousRank = stageRanks[team.name] || null;
      const rankDelta = previousRank ? (previousRank - currentRank) : 0;
      let barClass = '';
      let icon = '📝';
      let rankClass = '';
      let rankText = '';
      let tierClass = '';
      let tierText = '';

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
        <div class="leaderboard-bar ${isSelf ? 'leaderboard-self' : ''} ${rankClass ? 'rank-shift' : ''} ${tierClass}">
          <div class="bar-label ${isSelf ? 'bar-label-self' : ''}">
            <span class="bar-label-team">
              <span class="bar-label-main">${isSelf ? '🎯' : icon} ${safeName}</span>
              ${tierText ? `<span class="tier-pill">${safeTierText}</span>` : ''}
            </span>
            ${rankText ? `<span class="rank-chip ${rankClass}">${safeRankText}</span>` : ''}
          </div>
          <div class="bar-wrapper ${isSelf ? 'bar-wrapper-self' : ''}">
            <div class="bar-fill ${barClass} ${isSelf ? 'bar-self' : ''}" style="width: ${percentage}%;">
              <span class="bar-score">${team.score}</span>
            </div>
          </div>
        </div>
      `;
    })
    .join('');

  previousRankByStage[stageKey] = Object.fromEntries(leaderboardData.map((team, index) => [team.name, index + 1]));
}

function renderScoreSheet(rows) {
  if (!rows || !rows.length) {
    scoreSheetBody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 20px;">No completed questions yet.</td></tr>';
    return;
  }

  scoreSheetSection.style.display = 'block';
  scoreSheetBody.innerHTML = rows
    .map((row) => {
      const correctStatus = row.answer ? (row.correct ? '✓ Correct' : '✗ Wrong') : '-';
      const pointsText = row.pointsDelta >= 0 ? `+${row.pointsDelta}` : `${row.pointsDelta}`;
      const pointsClass = row.pointsDelta >= 0 ? 'success-text' : 'error';
      const safeStage = escapeHtml(String(row.stage || '').toUpperCase());
      const safeAnswer = escapeHtml(row.answer || '-');
      const safeCorrectStatus = escapeHtml(correctStatus);
      return `<tr>
        <td>${safeStage}</td>
        <td>Q${row.questionNumber}</td>
        <td>${safeAnswer}</td>
        <td>${safeCorrectStatus}</td>
        <td class="${pointsClass}">${pointsText}</td>
      </tr>`;
    })
    .join('');
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
  
  // Auto-close modal after minimum 15 seconds
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
  if (type === 'welcome') announcementEmoji.textContent = '📝✨';

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
    showAnnouncement('🧠 STAGE 1 WINNER ANNOUNCED!', `tops Round 1 and secures the first finalist spot!`, 'stage1', stageWinners.stage1);
    return;
  }

  if (stageWinners?.stage2 && shownWinners.stage2 !== stageWinners.stage2) {
    shownWinners.stage2 = stageWinners.stage2;
    showAnnouncement('🧩 STAGE 2 WINNER ANNOUNCED!', `wins Round 2 and claims the second finalist position!`, 'stage2', stageWinners.stage2);
    return;
  }

  if (quizCompleted && champion && shownWinners.champion !== champion) {
    shownWinners.champion = champion;
    showAnnouncement('🎓 QUIZ CHAMPION!', `wins the full quiz challenge. Congratulations!`, 'champion', champion);
  }
}

function tryRegister(teamName) {
  const normalized = String(teamName || '').trim();
  if (!normalized) {
    joinError.textContent = 'Team name is required.';
    return;
  }

  joinError.textContent = '';
  socket.emit('team:register', { teamName: normalized });
}

function attemptAutoReconnect() {
  if (registered) return;
  const savedTeamName = localStorage.getItem(TEAM_NAME_STORAGE_KEY) || '';
  if (!savedTeamName) return;

  teamNameInput.value = savedTeamName;
  tryRegister(savedTeamName);
}

joinBtn.addEventListener('click', () => {
  tryRegister(teamNameInput.value);
});

teamNameInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    tryRegister(teamNameInput.value);
  }
});

answerButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    socket.emit('team:submitAnswer', { answer: btn.dataset.answer });
  });
});

closeAnswerModal.addEventListener('click', closeModal);
closeAnnouncementModal.addEventListener('click', closeAnnouncement);

// Close modal on click outside
answerModal.addEventListener('click', (e) => {
  if (e.target === answerModal) {
    closeModal();
  }
});

announcementModal.addEventListener('click', (e) => {
  if (e.target === announcementModal) {
    closeAnnouncement();
  }
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
  registeredTeamName = teamName;
  localStorage.setItem(TEAM_NAME_STORAGE_KEY, teamName);
  teamDisplayName.textContent = `Team ${teamName}`;
  teamDisplayName.classList.remove('hidden');
  joinError.textContent = '';
  joinSection.classList.add('hidden');
  quizSection.classList.remove('hidden');
  waitingText.textContent = `Welcome ${teamName}! 🎉 Waiting for teacher...`;
  setInstructionTone(waitingText, 'waiting');
  feedbackText.textContent = '';
  setInstructionTone(feedbackText, 'waiting');
  showAnnouncement('🎉 WELCOME TO THE QUIZ!', 'Get ready to compete. Watch leaderboard shifts and answer fast!', 'welcome', teamName);
});

socket.on('team:error', ({ message }) => {
  if (typeof message === 'string' && message.includes('cannot join after the quiz has started')) {
    localStorage.removeItem(TEAM_NAME_STORAGE_KEY);
  }

  if (!registered) joinError.textContent = message;
  else {
    feedbackText.textContent = message;
    setInstructionTone(feedbackText, 'wrong');
  }
});

socket.on('team:retryOption', ({ allowRetry, retryCost }) => {
  feedbackText.textContent = allowRetry
    ? `❌ Wrong answer. You may retry once (cost: ${retryCost} points).`
    : '❌ Wrong answer. Retry unavailable due to insufficient points.';
  setInstructionTone(feedbackText, 'wrong');
});

socket.on('question:started', ({ question, stage, questionIndex, timerEndsAt }) => {
  renderQuestion(question);
  feedbackText.textContent = '';
  setInstructionTone(feedbackText, 'waiting');
  stageBadge.textContent = stage.toUpperCase();
  progressText.textContent = `Question ${questionIndex + 1}`;
  setAnswerButtonsEnabled(true);
  runCountdown(timerEndsAt);
  closeModal();
  closeAnnouncement();
});

socket.on('question:ended', ({ correctAnswer, question }) => {
  renderQuestion(null);
  setAnswerButtonsEnabled(false);
  
  if (question) {
    showAnswerModal(question);
  }
  
  runCountdown(null);
});

socket.on('leaderboard:update', ({ leaderboard: leaderboardData, stageWinners, stage }) => {
  latestStageWinners = stageWinners || { stage1: null, stage2: null };
  renderLeaderboard(leaderboardData, latestStageWinners, stage || 'stage1');
});

socket.on('team:state', (state) => {
  renderQuestion(state.currentQuestion);
  scoreText.textContent = `Score: ${state.score}`;
  attemptStatus.textContent = state.attemptsUsed ? `Attempts Used: ${state.attemptsUsed}` : 'Attempts: Available';
  waitingText.textContent = state.waitingMessage || '';
  setInstructionTone(waitingText, getWaitingTone(state.waitingMessage));
  stageBadge.textContent = state.stage.toUpperCase();
  progressText.textContent = `Question ${state.questionIndex + 1} / ${state.totalQuestions}`;
  setAnswerButtonsEnabled(state.canAnswer && !state.quizCompleted);
  runCountdown(state.timerEndsAt);
  renderScoreSheet(state.teamScoreSheet || []);
  announceWinners(state.stageWinners, state.champion, state.quizCompleted);
});

socket.on('quiz:reset', () => {
  resetTeamView();
  localStorage.removeItem(TEAM_NAME_STORAGE_KEY);
});

socket.on('connect', () => {
  setConnectionStatus(true);
  attemptAutoReconnect();
});

socket.on('disconnect', () => {
  setConnectionStatus(false);
});

socket.on('connect_error', () => {
  setConnectionStatus(false);
});

resetTeamView();
setConnectionStatus(socket.connected);
attemptAutoReconnect();
