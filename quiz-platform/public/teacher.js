const socket = io();

// DOM Elements
const stageEl = document.getElementById('teacherStage');
const progressEl = document.getElementById('teacherProgress');
const questionLabel = document.getElementById('questionLabel');
const teacherLeaderboard = document.getElementById('teacherLeaderboard');
const answersBody = document.getElementById('answersBody');
const finalistsText = document.getElementById('finalistsText');
const winnerText = document.getElementById('winnerText');
const teacherError = document.getElementById('teacherError');
const teacherTimer = document.getElementById('teacherTimer');

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

let timerInterval;
let answerModalTimeout;
let shownWinners = { stage1: null, stage2: null, champion: null };

function resetTeacherView() {
  teacherError.textContent = '';
  stageEl.textContent = 'Stage 1';
  progressEl.textContent = 'Q1 / 1';
  questionLabel.textContent = 'Current Question: Waiting...';
  teacherLeaderboard.innerHTML = '';
  answersBody.innerHTML = '';
  finalistsText.textContent = 'Finalists not decided yet.';
  winnerText.textContent = 'Stage 1 Winner: - | Stage 2 Winner: -';
  runCountdown(null);
  closeModal();
  closeAnnouncement();
  shownWinners = { stage1: null, stage2: null, champion: null };
}

function renderLeaderboard(leaderboard) {
  if (!leaderboard || leaderboard.length === 0) {
    teacherLeaderboard.innerHTML = '<p style="text-align: center; color: var(--text-muted);">No teams yet</p>';
    return;
  }

  const maxScore = Math.max(...leaderboard.map(l => l.score || 0), 1000);
  
  teacherLeaderboard.innerHTML = leaderboard
    .map((team, index) => {
      const percentage = ((team.score || 0) / maxScore) * 100;
      let barClass = '';
      
      if (team.badge && team.badge.includes('Finalist')) {
        barClass = 'bar-finalist';
      } else if (team.badge && team.badge.includes('semifinal')) {
        barClass = 'bar-semi';
      } else if (team.eliminated) {
        barClass = 'bar-eliminated';
      }

      return `
        <div class="leaderboard-bar">
          <div class="bar-label">${index + 1}. ${team.name}</div>
          <div class="bar-wrapper">
            <div class="bar-fill ${barClass}" style="width: ${percentage}%;">
              <span class="bar-score">${team.score}</span>
            </div>
          </div>
        </div>
      `;
    })
    .join('');
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

  if (type === 'stage1') announcementEmoji.textContent = '🏆✨';
  if (type === 'stage2') announcementEmoji.textContent = '🥈🔥';
  if (type === 'champion') announcementEmoji.textContent = '👑🎉';

  announcementTitle.textContent = title;
  announcementWinner.textContent = winnerName || '';
  announcementMessage.textContent = message;
  announcementModal.classList.add('active');
}

function closeAnnouncement() {
  announcementModal.classList.remove('active');
}

closeAnswerModal.addEventListener('click', closeModal);
closeAnnouncementModal.addEventListener('click', closeAnnouncement);

document.getElementById('startQuestionBtn').addEventListener('click', () => {
  closeModal();
  closeAnnouncement();
  socket.emit('teacher:startQuestion');
});

document.getElementById('nextQuestionBtn').addEventListener('click', () => {
  closeModal();
  closeAnnouncement();
  socket.emit('teacher:nextQuestion');
});

document.getElementById('nextStageBtn').addEventListener('click', () => {
  closeModal();
  closeAnnouncement();
  socket.emit('teacher:nextStage');
});

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

function announceWinners(stageWinners, champion, quizCompleted) {
  if (stageWinners?.stage1 && shownWinners.stage1 !== stageWinners.stage1) {
    shownWinners.stage1 = stageWinners.stage1;
    showAnnouncement('🏆 STAGE 1 FINALIST SELECTED!', `has dominated Round 1 and secures the first finalist spot!`, 'stage1', stageWinners.stage1);
    return;
  }

  if (stageWinners?.stage2 && shownWinners.stage2 !== stageWinners.stage2) {
    shownWinners.stage2 = stageWinners.stage2;
    showAnnouncement('🥈 STAGE 2 FINALIST SELECTED!', `fights through Round 2 and claims the second finalist position!`, 'stage2', stageWinners.stage2);
    return;
  }

  if (quizCompleted && champion && shownWinners.champion !== champion) {
    shownWinners.champion = champion;
    showAnnouncement('👑 GRAND CHAMPION!', `is the ultimate winner of this quiz battle. Congratulations!`, 'champion', champion);
  }
}

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
  champion,
  timerEndsAt,
  quizCompleted
}) => {
  stageEl.textContent = stage.toUpperCase();
  progressEl.textContent = `Q${questionIndex + 1} / ${totalQuestions}`;
  questionLabel.textContent = currentQuestion
    ? `Current Question: ${currentQuestion.text} ${questionActive ? '(Active)' : '(Idle)'}`
    : 'Current Question: N/A';

  renderLeaderboard(leaderboard);

  answersBody.innerHTML = answerRows
    .map((row) => {
      const t = row.ts ? new Date(row.ts).toLocaleTimeString() : '-';
      const correct = row.correct === null ? '-' : row.correct ? '✓ Yes' : '✗ No';
      return `<tr><td>${row.teamName}</td><td>${row.answer || '-'}</td><td>${row.attempts || 0}</td><td>${t}</td><td>${correct}</td></tr>`;
    })
    .join('');

  finalistsText.textContent = finalists.length
    ? `🏆 Finalists: ${finalists.join(' 💪 ')}`
    : 'Finalists not decided yet.';

  winnerText.textContent = `🥇 Stage 1 Winner: ${stageWinners.stage1 || '-'} | 🥈 Stage 2 Winner: ${stageWinners.stage2 || '-'}`;
  
  if (quizCompleted) {
    teacherError.textContent = '🎉 Quiz completed!';
  }

  announceWinners(stageWinners, champion, quizCompleted);
  
  runCountdown(timerEndsAt);
});

socket.on('question:ended', ({ correctAnswer, question }) => {
  if (question) {
    showAnswerModal(question);
  }
});

socket.on('quiz:reset', () => {
  resetTeacherView();
});

socket.emit('teacher:register');

resetTeacherView();
