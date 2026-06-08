/* ============================================================
   刷题助手 PWA — 同等学力英语
   完全离线可用 · IndexedDB 存储 · iOS 主屏幕安装
   ============================================================ */

// ===================== IndexedDB =====================

const DB_NAME = 'QuizAppDB', DB_VER = 1;
let db = null;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = (e) => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('records')) {
        const rs = d.createObjectStore('records', { keyPath: 'id', autoIncrement: true });
        rs.createIndex('qid', 'qid', { unique: false });
        rs.createIndex('answeredAt', 'answeredAt', { unique: false });
      }
      if (!d.objectStoreNames.contains('favorites')) {
        d.createObjectStore('favorites', { keyPath: 'qid' });
      }
      if (!d.objectStoreNames.contains('settings')) {
        d.createObjectStore('settings', { keyPath: 'key' });
      }
    };
    req.onsuccess = (e) => { db = e.target.result; resolve(db); };
    req.onerror = () => reject(req.error);
  });
}

function idbPut(store, data) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(data);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function idbGetAll(store) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbGet(store, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbDelete(store, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function idbClear(store) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ===================== Data Layer =====================

// Global ID counter (preset questions use negative IDs, user-added use positive)
let _nextId = 1;
const Q_CACHE = new Map(); // id -> question object

function qKey(catName, idx) { return `${catName}::${idx}`; }

function loadAllQuestions() {
  // Load all preset data into cache
  for (const preset of PRESET_DATA) {
    const catName = preset.name;
    for (let i = 0; i < preset.questions.length; i++) {
      const q = preset.questions[i];
      const id = -(1000000 + Q_CACHE.size + 1); // negative IDs for preset questions
      const entry = {
        id, catName, catIdx: i,
        isExamPaper: preset.is_exam_paper || false,
        paperYear: preset.paper_year || '',
        type: q.type || 'single',
        content: q.content || '',
        optionA: q.option_a || '',
        optionB: q.option_b || '',
        optionC: q.option_c || '',
        optionD: q.option_d || '',
        optionE: q.option_e || '',
        optionF: q.option_f || '',
        correctAnswer: (q.correct_answer || q.answer || '').trim().toUpperCase(),
        explanation: q.explanation || '',
        source: preset.name,
      };
      Q_CACHE.set(id, entry);
    }
  }
}

function getQuestion(id) { return Q_CACHE.get(id); }

function getCategories() {
  const map = new Map(); // name -> { name, description, isExamPaper, paperYear, count }
  for (const [id, q] of Q_CACHE) {
    const key = q.catName;
    if (!map.has(key)) {
      map.set(key, {
        name: q.catName,
        description: '',
        isExamPaper: q.isExamPaper,
        paperYear: q.paperYear,
        count: 0,
      });
    }
    map.get(key).count++;
  }
  return [...map.values()];
}

function getQuestionsByCategory(catName) {
  const result = [];
  for (const [id, q] of Q_CACHE) {
    if (q.catName === catName) result.push({ id, ...q });
  }
  return result;
}

function getRandomQuestions(count, catName) {
  let pool;
  if (catName) {
    pool = getQuestionsByCategory(catName);
  } else {
    pool = [...Q_CACHE.entries()].map(([id, q]) => ({ id, ...q }));
  }
  // Fisher-Yates shuffle
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, Math.min(count, pool.length));
}

// ===================== Answer Records =====================

async function recordAnswer(qid, userAnswer, timeSpent = 0) {
  const q = getQuestion(qid);
  const isCorrect = userAnswer.trim().toUpperCase() === q.correctAnswer;
  await idbPut('records', {
    qid, userAnswer: userAnswer.trim().toUpperCase(),
    isCorrect, timeSpent,
    answeredAt: Date.now(),
  });
  return isCorrect;
}

async function getWrongQuestions() {
  // Get latest wrong answer per question
  const allRecords = await idbGetAll('records');
  const latestByQid = {};
  for (const r of allRecords) {
    if (!r.isCorrect) {
      if (!latestByQid[r.qid] || r.answeredAt > latestByQid[r.qid].answeredAt) {
        latestByQid[r.qid] = r;
      }
    }
  }
  return Object.values(latestByQid).sort((a, b) => b.answeredAt - a.answeredAt);
}

async function isFavorited(qid) {
  return !!(await idbGet('favorites', qid));
}

async function toggleFavorite(qid) {
  const existing = await idbGet('favorites', qid);
  if (existing) {
    await idbDelete('favorites', qid);
    return false;
  } else {
    await idbPut('favorites', { qid, createdAt: Date.now() });
    return true;
  }
}

async function getFavorites() {
  const favs = await idbGetAll('favorites');
  return favs.sort((a, b) => b.createdAt - a.createdAt);
}

async function getStats() {
  const allRecords = await idbGetAll('records');
  const total = allRecords.length;
  const correct = allRecords.filter(r => r.isCorrect).length;

  // Daily stats (last 14 days)
  const daily = {};
  const now = Date.now();
  for (let i = 0; i < 14; i++) {
    const d = new Date(now - i * 86400000);
    const key = `${d.getMonth() + 1}-${String(d.getDate()).padStart(2, '0')}`;
    daily[key] = { total: 0, correct: 0 };
  }
  for (const r of allRecords) {
    const d = new Date(r.answeredAt);
    const key = `${d.getMonth() + 1}-${String(d.getDate()).padStart(2, '0')}`;
    if (daily[key]) {
      daily[key].total++;
      if (r.isCorrect) daily[key].correct++;
    }
  }

  // Streak
  let streak = 0;
  for (let i = 0; i < 365; i++) {
    const d = new Date(now - i * 86400000);
    const key = `${d.getMonth() + 1}-${String(d.getDate()).padStart(2, '0')}`;
    if (daily[key] && daily[key].total > 0) streak++;
    else break;
  }

  // Category stats
  const catStats = {};
  for (const r of allRecords) {
    const q = getQuestion(r.qid);
    const cn = q ? q.catName : '未知';
    if (!catStats[cn]) catStats[cn] = { total: 0, correct: 0 };
    catStats[cn].total++;
    if (r.isCorrect) catStats[cn].correct++;
  }

  return {
    totalQuestions: Q_CACHE.size,
    totalRecords: total,
    correctCount: correct,
    wrongCount: total - correct,
    accuracy: total > 0 ? Math.round(correct / total * 1000) / 10 : 0,
    streakDays: streak,
    daily: Object.entries(daily).reverse().map(([date, v]) => ({
      date,
      total: v.total,
      correct: v.correct,
      accuracy: v.total > 0 ? Math.round(v.correct / v.total * 1000) / 10 : 0,
    })),
    catStats: Object.entries(catStats).map(([cat, v]) => ({
      category: cat,
      total: v.total,
      correct: v.correct,
      accuracy: v.total > 0 ? Math.round(v.correct / v.total * 1000) / 10 : 0,
    })),
  };
}

async function clearWrongRecord(qid) {
  const allRecords = await idbGetAll('records');
  for (const r of allRecords) {
    if (r.qid === qid) await idbDelete('records', r.id);
  }
}

// ===================== UI Router =====================

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

const el = {
  get header() { return $('#header'); },
  get backBtn() { return $('#backBtn'); },
  get headerTitle() { return $('#headerTitle'); },
  get content() { return $('#content'); },
  get bottomNav() { return $('#bottomNav'); },
  get toast() { return $('#toast'); },
};

let currentTab = 'home';
let navStack = []; // for back button navigation within a tab
let examTimer = null;

function showToast(msg) {
  const t = el.toast;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timeout);
  t._timeout = setTimeout(() => t.classList.remove('show'), 2000);
}

function showContent(html) {
  el.content.innerHTML = html;
}

function setHeader(title, showBack = false, backAction = null) {
  el.headerTitle.textContent = title;
  if (showBack) {
    el.backBtn.style.visibility = 'visible';
    el.backBtn.onclick = backAction || goBack;
  } else {
    el.backBtn.style.visibility = 'hidden';
    el.backBtn.onclick = null;
  }
}

function setTab(tabName) {
  currentTab = tabName;
  navStack = [];
  $$('.bottom-nav .tab').forEach(t => t.classList.remove('active'));
  const tabEl = $(`.bottom-nav .tab[data-tab="${tabName}"]`);
  if (tabEl) tabEl.classList.add('active');
}

function goBack() {
  if (navStack.length > 0) {
    const prev = navStack.pop();
    prev();
    return;
  }
  // Default: go to tab home
  navigate('home');
}

function pushNav(fn) { navStack.push(fn); }

function navigate(tab, subPage, ...args) {
  setTab(tab);
  switch (tab) {
    case 'home': renderHome(); break;
    case 'practice': subPage ? renderPracticeSub(subPage, ...args) : renderPractice(); break;
    case 'wrong': renderWrongBook(); break;
    case 'stats': renderStats(); break;
  }
}

// Listen for tab clicks
document.addEventListener('DOMContentLoaded', () => {
  el.bottomNav.addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    const tabName = tab.dataset.tab;
    if (tabName) navigate(tabName);
  });
});

// ===================== Render: Home =====================

async function renderHome() {
  setHeader('同等学力英语');
  setTab('home');

  const stats = await getStats();
  const cats = getCategories();
  const chapters = cats.filter(c => !c.isExamPaper);
  const papers = cats.filter(c => c.isExamPaper);

  let html = '';

  // Stats overview
  html += '<div class="stats-grid">';
  html += `<div class="stat-card"><div class="num">${stats.totalQuestions}</div><div class="label">题库总数</div></div>`;
  html += `<div class="stat-card"><div class="num green">${stats.totalRecords}</div><div class="label">答题次数</div></div>`;
  html += `<div class="stat-card"><div class="num">${stats.accuracy}%</div><div class="label">正确率</div></div>`;
  html += `<div class="stat-card"><div class="num orange">${stats.streakDays}</div><div class="label">连续天数</div></div>`;
  html += '</div>';

  // Quick actions
  html += '<div class="grid-2" style="display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:0 16px;margin:8px 0;">';
  html += `<button class="btn btn-primary btn-block" onclick="App.navigate('practice')">📝 开始练习</button>`;
  html += `<button class="btn btn-outline btn-block" onclick="App.navigate('practice','examSetup')">⏱ 模拟考试</button>`;
  html += '</div>';

  // Chapters
  if (chapters.length > 0) {
    html += '<div class="section-title">📚 章节练习</div>';
    for (const c of chapters) {
      html += `<div class="list-item" onclick="App.navigate('practice','chapter',${esc(JSON.stringify(c.name))})">`;
      html += `<div class="item-info"><div class="item-title">${escHtml(c.name)}</div></div>`;
      html += `<div class="item-right"><span class="count-badge">${c.count}题</span><span class="arrow">›</span></div>`;
      html += '</div>';
    }
  }

  // Exam papers
  if (papers.length > 0) {
    html += '<div class="section-title">📋 历年真题</div>';
    for (const c of papers) {
      html += `<div class="list-item" onclick="App.navigate('practice','chapter',${esc(JSON.stringify(c.name))})">`;
      html += `<div class="item-info"><div class="item-title">${escHtml(c.name)}</div></div>`;
      html += `<div class="item-right"><span class="count-badge">${c.count}题</span><span class="arrow">›</span></div>`;
      html += '</div>';
    }
  }

  // Wrong book & favorites shortcuts
  html += '<div class="section-title">🔧 工具</div>';
  html += `<div class="list-item" onclick="App.navigate('wrong')">`;
  html += `<div class="item-info"><div class="item-title">📖 错题本</div><div class="item-desc">${stats.wrongCount > 0 ? stats.wrongCount + '道错题待复习' : '暂无错题'}</div></div>`;
  html += '<span class="arrow">›</span></div>';
  html += `<div class="list-item" onclick="App.navigate('practice','favorites')">`;
  html += '<div class="item-info"><div class="item-title">⭐ 我的收藏</div></div>';
  html += '<span class="arrow">›</span></div>';

  showContent(html);
}

// ===================== Render: Practice =====================

function renderPractice() {
  setHeader('选择章节', false);
  setTab('practice');

  const cats = getCategories();
  let html = '';
  html += `<div class="section-title">🎯 随机练习</div>`;
  html += `<div class="list-item" onclick="App.startPractice()">`;
  html += `<div class="item-info"><div class="item-title">全部题库随机</div><div class="item-desc">${Q_CACHE.size}道题随机出题</div></div>`;
  html += '<span class="arrow">›</span></div>';

  const chapters = cats.filter(c => !c.isExamPaper);
  const papers = cats.filter(c => c.isExamPaper);

  if (chapters.length > 0) {
    html += '<div class="section-title">📚 章节练习</div>';
    for (const c of chapters) {
      html += `<div class="list-item" onclick="App.startPractice(${esc(JSON.stringify(c.name))})">`;
      html += `<div class="item-info"><div class="item-title">${escHtml(c.name)}</div></div>`;
      html += `<div class="item-right"><span class="count-badge">${c.count}题</span><span class="arrow">›</span></div>`;
      html += '</div>';
    }
  }

  if (papers.length > 0) {
    html += '<div class="section-title">📋 历年真题</div>';
    for (const c of papers) {
      html += `<div class="list-item" onclick="App.startPractice(${esc(JSON.stringify(c.name))})">`;
      html += `<div class="item-info"><div class="item-title">${escHtml(c.name)}</div></div>`;
      html += `<div class="item-right"><span class="count-badge">${c.count}题</span><span class="arrow">›</span></div>`;
      html += '</div>';
    }
  }

  html += '<div class="section-title">⚙️ 其他</div>';
  html += `<div class="list-item" onclick="App.navigate('practice','examSetup')">`;
  html += `<div class="item-info"><div class="item-title">⏱ 模拟考试</div><div class="item-desc">限时答题，检验水平</div></div>`;
  html += '<span class="arrow">›</span></div>';
  html += `<div class="list-item" onclick="App.navigate('practice','favorites')">`;
  html += '<div class="item-info"><div class="item-title">⭐ 我的收藏</div></div>';
  html += '<span class="arrow">›</span></div>';

  // Add an "about/info" section at the bottom so the content doesn't get hidden by the tab bar
  html += `<div style="text-align:center;padding:24px;color:var(--text3);font-size:12px;">同等学力英语刷题助手 · PWA离线版</div>`;

  showContent(html);
}

function renderPracticeSub(subPage, ...args) {
  switch (subPage) {
    case 'chapter': renderChapterPractice(args[0]); break;
    case 'question': renderPracticeQuestion(args[0], args[1], args[2], args[3]); break;
    case 'result': renderPracticeResult(...args); break;
    case 'examSetup': renderExamSetup(); break;
    case 'exam': renderExamPage(...args); break;
    case 'examResult': renderExamResult(...args); break;
    case 'favorites': renderFavorites(); break;
  }
}

// ===================== Practice Flow =====================

async function startPractice(catName) {
  const title = catName || '全部题库';
  const count = catName
    ? getQuestionsByCategory(catName).length
    : Q_CACHE.size;
  const qs = getRandomQuestions(Math.min(count, 50), catName);
  if (qs.length === 0) {
    showToast('没有题目');
    return;
  }

  pushNav(() => renderPractice());
  setTab('practice');

  const qids = qs.map(q => q.id);
  renderPracticeQuestion(qids, 0, 0, Date.now());
}

function renderPracticeQuestion(qids, idx, correct, startTime, errorCount = 0) {
  setHeader(`练习 ${idx + 1}/${qids.length}`, idx > 0, () => {
    // Go back to practice list
    navigate('practice');
  });
  setTab('practice');

  const qid = qids[idx];
  const q = getQuestion(qid);
  if (!q) { renderPracticeResult(qids.length, correct, Date.now() - startTime); return; }

  const options = [];
  for (const letter of ['A','B','C','D','E','F']) {
    const val = q[`option${letter}`];
    if (val && val.trim()) options.push({ letter, text: val });
  }
  const typeLabel = q.type === 'multi' ? '多选题' : '单选题';

  let html = '';
  html += '<div class="question-card">';
  html += '<div class="question-meta">';
  html += `<span class="q-type-badge single">${typeLabel}</span>`;
  html += `<span class="q-counter">${idx + 1} / ${qids.length}</span>`;
  html += '</div>';
  html += `<div class="question-text">${escHtml(q.content)}</div>`;
  html += '<div class="options-group" id="optionsArea">';
  for (const opt of options) {
    html += `<button class="opt-btn" data-letter="${opt.letter}" onclick="App.selectOption(this, '${opt.letter}')">`;
    html += `<span class="opt-letter">${opt.letter}</span>`;
    html += `<span class="opt-text">${escHtml(opt.text)}</span>`;
    html += '</button>';
  }
  html += '</div>';
  html += '<div class="explanation-box" id="explanationArea" style="display:none">';
  html += '<div class="exp-title">💡 解析</div>';
  html += `<div id="explanationText">${escHtml(q.explanation || '暂无解析')}</div>`;
  html += '<div style="margin-top:4px;font-size:12px;">正确答案：' + q.correctAnswer + '</div>';
  html += '</div>';
  html += '<div class="q-actions">';
  html += `<button class="btn btn-outline btn-sm" onclick="App.toggleFav(${qid}, this)">⭐ 收藏</button>`;
  html += '<button class="btn btn-primary btn-sm" id="nextBtn" style="display:none" onclick="App.nextQuestion()">下一题 →</button>';
  html += '</div>';
  html += '</div>';

  // Progress
  html += '<div class="progress-bar"><div class="fill" style="width:' + (idx / qids.length * 100) + '%"></div></div>';

  showContent(html);

  // Store state
  window._pq = { qids, idx, correct, startTime, errorCount, qid, selectedAnswer: null, answered: false };
}

function selectOption(btn, letter) {
  if (window._pq.answered) return;
  window._pq.selectedAnswer = letter;

  // Visual: clear all, mark selected
  $$('#optionsArea .opt-btn').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
}

async function submitAnswer() {
  if (window._pq.answered) return;
  const { qid, selectedAnswer } = window._pq;
  if (!selectedAnswer) { showToast('请先选择一个选项'); return; }

  window._pq.answered = true;
  const isCorrect = await recordAnswer(qid, selectedAnswer);
  const q = getQuestion(qid);

  // Show correct/wrong
  const correctLetter = q.correctAnswer;
  $$('#optionsArea .opt-btn').forEach(b => {
    b.classList.add('disabled');
    const l = b.dataset.letter;
    if (l === correctLetter) b.classList.add('correct');
    else if (l === selectedAnswer && !isCorrect) b.classList.add('wrong');
  });

  // Update selection visual
  if (isCorrect) {
    window._pq.correct++;
  } else {
    window._pq.errorCount++;
  }

  // Show explanation
  const expArea = $('#explanationArea');
  if (expArea) expArea.style.display = 'block';

  // Show next button
  const nextBtn = $('#nextBtn');
  if (nextBtn) {
    nextBtn.style.display = 'block';
    if (window._pq.idx >= window._pq.qids.length - 1) {
      nextBtn.textContent = '查看结果';
    }
  }

  // Auto-scroll
  el.content.scrollTop = el.content.scrollHeight;
}

async function nextQuestion() {
  const pq = window._pq;
  if (pq.idx >= pq.qids.length - 1) {
    renderPracticeResult(pq.qids.length, pq.correct, Date.now() - pq.startTime);
    return;
  }
  renderPracticeQuestion(pq.qids, pq.idx + 1, pq.correct, pq.startTime, pq.errorCount);
  el.content.scrollTop = 0;
}

function renderPracticeResult(total, correct, elapsed) {
  setHeader('练习结果', true, () => navigate('practice'));
  setTab('practice');

  const accuracy = total > 0 ? Math.round(correct / total * 100) : 0;
  const cls = accuracy >= 80 ? 'result-great' : accuracy >= 50 ? 'result-good' : 'result-poor';
  const emoji = accuracy >= 80 ? '🎉' : accuracy >= 50 ? '💪' : '📚';
  const mins = Math.floor(elapsed / 60000);
  const secs = Math.floor((elapsed % 60000) / 1000);

  let html = '<div class="card result-section">';
  html += `<div class="result-circle ${cls}">${accuracy}%</div>`;
  html += `<h3>${emoji} ${accuracy >= 80 ? '很棒！' : accuracy >= 50 ? '继续加油' : '多加练习'}</h3>`;
  html += `<p>正确 ${correct} / ${total} 题 &nbsp;|&nbsp; 用时 ${mins}分${secs}秒</p>`;
  html += '</div>';

  html += '<div class="form-actions" style="text-align:center;padding:16px;">';
  html += `<button class="btn btn-primary" onclick="App.startPractice()">再来一轮</button>`;
  html += `<button class="btn btn-outline" style="margin-left:8px;" onclick="App.navigate('practice')">返回列表</button>`;
  html += '</div>';

  showContent(html);
}

// ===================== Favorite Toggle =====================

async function toggleFav(qid, btn) {
  const fav = await toggleFavorite(qid);
  btn.textContent = fav ? '⭐ 已收藏' : '☆ 收藏';
  showToast(fav ? '已收藏' : '已取消收藏');
}

async function renderFavorites() {
  setHeader('我的收藏', true, () => navigate('practice'));
  setTab('practice');
  pushNav(() => renderPractice());

  const favs = await getFavorites();
  if (favs.length === 0) {
    showContent('<div class="empty-state"><div class="empty-icon">⭐</div><p>还没有收藏题目<br>练习时点击⭐收藏即可</p></div>');
    return;
  }

  let html = `<div class="section-title">共 ${favs.length} 道收藏</div>`;
  for (const fav of favs) {
    const q = getQuestion(fav.qid);
    if (!q) continue;
    html += `<div class="list-item" onclick="App.practiceFav(${fav.qid})">`;
    html += `<div class="item-info"><div class="item-title">${escHtml(q.content.substring(0, 60))}...</div>`;
    html += `<div class="item-desc">${q.catName}</div></div>`;
    html += '<span class="arrow">›</span></div>';
  }
  showContent(html);
}

async function practiceFav(qid) {
  // Start practice from a single favorited question + related ones
  const q = getQuestion(qid);
  if (!q) return;
  const related = getRandomQuestions(Math.min(20, Q_CACHE.size), q.catName);
  const qids = related.map(q => q.id);
  pushNav(() => renderFavorites());
  setTab('practice');
  renderPracticeQuestion(qids, 0, 0, Date.now());
}

// ===================== Exam Mode =====================

function renderExamSetup() {
  setHeader('模拟考试', true, () => navigate('practice'));
  setTab('practice');
  pushNav(() => renderPractice());

  const cats = getCategories();
  let html = '<div class="card">';
  html += '<h3>⏱ 考试设置</h3>';

  // Category picker
  html += '<div class="form-group">';
  html += '<label>选题范围</label>';
  html += `<select id="examCat">`;
  html += `<option value="">全部题库 (${Q_CACHE.size}题)</option>`;
  for (const c of cats) {
    const val = escHtml(c.name);
    html += `<option value="${val}">${escHtml(c.name)} (${c.count}题)</option>`;
  }
  html += '</select></div>';

  // Question count
  html += '<div class="form-group">';
  html += '<label>题目数量</label>';
  html += '<select id="examCount">';
  [10, 15, 20, 25, 30].forEach(n => {
    html += `<option value="${n}" ${n === 20 ? 'selected' : ''}>${n} 题</option>`;
  });
  html += '</select></div>';

  // Time limit
  html += '<div class="form-group">';
  html += '<label>时间限制 (分钟)</label>';
  html += '<select id="examTime">';
  [10, 15, 20, 25, 30, 45, 60].forEach(n => {
    html += `<option value="${n}" ${n === 30 ? 'selected' : ''}>${n} 分钟</option>`;
  });
  html += '</select></div>';

  html += `<button class="btn btn-primary btn-block" onclick="App.startExam()">开始考试</button>`;
  html += '</div>';

  showContent(html);
}

async function startExam() {
  const catEl = $('#examCat');
  const countEl = $('#examCount');
  const timeEl = $('#examTime');
  if (!catEl || !countEl || !timeEl) return;

  const catName = catEl.value || null;
  const count = parseInt(countEl.value);
  const timeLimit = parseInt(timeEl.value) * 60; // seconds

  const qs = getRandomQuestions(count, catName);
  if (qs.length === 0) { showToast('没有题目'); return; }

  setTab('practice');
  renderExamPage(qs.map(q => q.id), timeLimit, Date.now());
}

function renderExamPage(qids, timeLimit, startTime) {
  setHeader('考试中');
  setTab('practice');

  // Initialize answers
  const answers = {};
  let currentIdx = 0;
  let submitted = false;

  function renderExamSheet() {
    let html = '<div style="padding:8px 16px;display:flex;align-items:center;justify-content:space-between;">';
    html += `<span style="font-size:13px;color:var(--text2);">${currentIdx + 1} / ${qids.length}</span>`;
    html += `<span class="timer" id="examTimer">${formatTime(timeLimit)}</span>`;
    html += '</div>';

    // Answer sheet grid
    html += '<div class="answer-sheet" id="answerSheet">';
    for (let i = 0; i < qids.length; i++) {
      const qid = qids[i];
      const cls = [];
      if (answers[qid]) cls.push('answered');
      if (i === currentIdx) cls.push('current');
      html += `<div class="cell ${cls.join(' ')}" onclick="App.examGoTo(${i})">${i + 1}</div>`;
    }
    html += '</div>';

    // Current question
    const qid = qids[currentIdx];
    const q = getQuestion(qid);
    if (q) {
      const options = [];
      for (const letter of ['A','B','C','D','E','F']) {
        const val = q[`option${letter}`];
        if (val && val.trim()) options.push({ letter, text: val });
      }
      html += '<div class="question-card">';
      html += '<div class="question-meta">';
      html += '<span class="q-type-badge single">单选题</span>';
      html += `<span class="q-counter">#${currentIdx + 1}</span>`;
      html += '</div>';
      html += `<div class="question-text">${escHtml(q.content)}</div>`;
      html += '<div class="options-group" id="examOptions">';
      for (const opt of options) {
        const sel = answers[qid] === opt.letter ? ' selected' : '';
        html += `<button class="opt-btn${sel}" data-letter="${opt.letter}" onclick="App.examSelect(${currentIdx}, '${opt.letter}')">`;
        html += `<span class="opt-letter">${opt.letter}</span>`;
        html += `<span class="opt-text">${escHtml(opt.text)}</span>`;
        html += '</button>';
      }
      html += '</div>';
      html += '</div>';
    }

    // Navigation buttons
    html += '<div style="display:flex;gap:8px;padding:12px 16px;">';
    html += `<button class="btn btn-outline btn-sm" ${currentIdx === 0 ? 'disabled' : ''} onclick="App.examGoTo(${currentIdx - 1})">← 上一题</button>`;
    html += `<button class="btn btn-outline btn-sm" style="margin-left:auto;" ${currentIdx >= qids.length - 1 ? 'disabled' : ''} onclick="App.examGoTo(${currentIdx + 1})">下一题 →</button>`;
    html += '</div>';

    // Submit
    html += '<div style="padding:0 16px 24px;">';
    const unanswered = qids.filter(q => !answers[q]).length;
    html += `<button class="btn btn-primary btn-block" onclick="App.examSubmit()">交卷 (${unanswered}题未答)</button>`;
    html += '</div>';

    showContent(html);

    // Update answer sheet after render
    updateAnswerSheet();
  }

  function updateAnswerSheet() {
    const cells = $$('#answerSheet .cell');
    cells.forEach((cell, i) => {
      const qid = qids[i];
      cell.className = 'cell';
      if (answers[qid]) cell.classList.add('answered');
      if (i === currentIdx) cell.classList.add('current');
    });
  }

  // Timer
  let remaining = timeLimit;
  const timerEl = document.getElementById('examTimer') || null;
  function tick() {
    remaining--;
    const t = $('#examTimer');
    if (t) {
      t.textContent = formatTime(remaining);
      if (remaining < 60) t.classList.add('warning');
    }
    if (remaining <= 0) {
      clearInterval(window._examInterval);
      submitExam();
    }
  }
  clearInterval(window._examInterval);
  window._examInterval = setInterval(tick, 1000);

  // Go to question
  window.examGoTo = function(idx) {
    currentIdx = idx;
    renderExamSheet();
  };

  // Select answer
  window.examSelect = function(idx, letter) {
    const qid = qids[idx];
    answers[qid] = letter;
    // Re-render options to show selection
    renderExamSheet();
  };

  // Submit
  window.examSubmit = function() {
    if (submitted) return;
    const unanswered = qids.filter(q => !answers[q]).length;
    if (unanswered > 0) {
      showConfirm(`还有 ${unanswered} 题未作答，确认交卷吗？`, submitExam);
    } else {
      submitExam();
    }
  };

  function submitExam() {
    submitted = true;
    clearInterval(window._examInterval);
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    renderExamResult(qids, answers, elapsed);
  }

  function formatTime(s) {
    if (s < 0) s = 0;
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${String(sec).padStart(2, '0')}`;
  }

  // Initial render
  renderExamSheet();
}

function renderExamResult(qids, answers, elapsed) {
  setHeader('考试结果', false);
  setTab('practice');

  let correct = 0;
  const details = [];

  for (const qid of qids) {
    const q = getQuestion(qid);
    const ua = (answers[qid] || '').trim().toUpperCase();
    const isCorrect = ua === q.correctAnswer;
    if (isCorrect) correct++;
    details.push({ q, userAnswer: ua, isCorrect });
    recordAnswer(qid, ua); // async, no need to await
  }

  const accuracy = qids.length > 0 ? Math.round(correct / qids.length * 100) : 0;
  const cls = accuracy >= 80 ? 'result-great' : accuracy >= 50 ? 'result-good' : 'result-poor';
  const emoji = accuracy >= 80 ? '🎉' : accuracy >= 50 ? '💪' : '📚';

  let html = '<div class="card result-section">';
  html += `<div class="result-circle ${cls}">${accuracy}%</div>`;
  html += `<h3>${emoji} 正确 ${correct}/${qids.length}</h3>`;
  html += `<p>用时 ${Math.floor(elapsed / 60)}分${elapsed % 60}秒</p>`;
  html += '</div>';

  // Detail list
  html += '<div class="section-title">📋 答题详情</div>';
  html += '<div class="result-detail">';
  for (let i = 0; i < details.length; i++) {
    const d = details[i];
    const q = d.q;
    html += '<div class="rd-item">';
    html += '<div class="rd-header">';
    html += `<span class="rd-idx">#${i + 1}</span>`;
    html += `<span class="rd-status ${d.isCorrect ? 'ok' : 'fail'}">${d.isCorrect ? '✓ 正确' : '✗ 错误'}</span>`;
    html += '</div>';
    html += `<div class="rd-content">${escHtml(q.content.substring(0, 80))}...</div>`;
    html += `<div class="rd-answer">你的答案: ${d.userAnswer || '未作答'} &nbsp;|&nbsp; 正确答案: ${q.correctAnswer}</div>`;
    if (!d.isCorrect && q.explanation) {
      html += `<div class="rd-answer" style="color:var(--warning)">💡 ${escHtml(q.explanation.substring(0, 100))}</div>`;
    }
    html += '</div>';
  }
  html += '</div>';

  // Actions
  html += '<div style="text-align:center;padding:16px;">';
  html += `<button class="btn btn-primary" onclick="App.navigate('practice','examSetup')">再来一场</button>`;
  html += `<button class="btn btn-outline" style="margin-left:8px;" onclick="App.navigate('practice')">返回练习</button>`;
  html += '</div>';

  showContent(html);
}

// ===================== Wrong Book =====================

async function renderWrongBook() {
  setHeader('错题本', false);
  setTab('wrong');

  const wrongs = await getWrongQuestions();
  if (wrongs.length === 0) {
    showContent('<div class="empty-state"><div class="empty-icon">📖</div><p>暂无错题 ✨<br>继续保持！</p></div>');
    return;
  }

  let html = `<div class="summary-bar">共 <b>${wrongs.length}</b> 道错题 · <a href="#" onclick="App.clearAllWrong()" style="color:var(--danger);font-size:12px;">清空全部</a></div>`;

  for (const w of wrongs) {
    const q = getQuestion(w.qid);
    if (!q) continue;
    const date = new Date(w.answeredAt);
    const dateStr = `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;

    html += '<div class="card" style="margin:8px 16px;">';
    html += '<div style="display:flex;justify-content:space-between;align-items:flex-start;">';
    html += `<div style="flex:1;"><p style="font-size:14px;margin-bottom:4px;">${escHtml(q.content.substring(0, 80))}...</p>`;
    html += `<span style="font-size:11px;color:var(--text3);">${q.catName} · ${dateStr}</span></div>`;
    html += `<button class="btn btn-sm btn-outline" style="margin-left:8px;white-space:nowrap;" onclick="App.redoWrong(${w.qid})">重做</button>`;
    html += '</div>';
    html += `<div style="margin-top:8px;font-size:12px;color:var(--text2);">你的答案: <span style="color:var(--danger);">${w.userAnswer || '-'}</span> &nbsp; 正确答案: <span style="color:var(--success);">${q.correctAnswer}</span></div>`;
    html += `<div style="margin-top:4px;">`;
    html += `<button class="btn btn-sm btn-outline" style="font-size:11px;" onclick="App.toggleFav(${q.id}, this)">⭐ 收藏</button>`;
    html += `<button class="btn btn-sm btn-outline" style="font-size:11px;margin-left:4px;color:var(--danger);border-color:var(--danger);" onclick="App.removeWrong(${q.id})">🗑 移除</button>`;
    html += '</div>';
    html += '</div>';
  }

  showContent(html);
}

async function removeWrong(qid) {
  await clearWrongRecord(qid);
  showToast('已移除');
  renderWrongBook();
}

async function clearAllWrong() {
  showConfirm('确定清空所有错题记录？', async () => {
    await idbClear('records');
    renderWrongBook();
    showToast('已清空');
  });
}

async function redoWrong(qid) {
  const q = getQuestion(qid);
  if (!q) return;
  const related = getRandomQuestions(Math.min(20, Q_CACHE.size), q.catName);
  // Ensure this question is in the list
  if (!related.find(rq => rq.id === qid)) {
    related[0] = { id: qid, ...q };
  }
  const qids = related.map(rq => rq.id);
  pushNav(() => renderWrongBook());
  setTab('wrong');
  renderPracticeQuestion(qids, 0, 0, Date.now());
}

// ===================== Stats =====================

async function renderStats() {
  setHeader('学习统计', false);
  setTab('stats');

  const stats = await getStats();

  let html = '';
  html += '<div class="stats-grid">';
  html += `<div class="stat-card"><div class="num">${stats.totalRecords}</div><div class="label">总答题数</div></div>`;
  html += `<div class="stat-card"><div class="num green">${stats.correctCount}</div><div class="label">正确</div></div>`;
  html += `<div class="stat-card"><div class="num red">${stats.wrongCount}</div><div class="label">错误</div></div>`;
  html += `<div class="stat-card"><div class="num">${stats.accuracy}%</div><div class="label">正确率</div></div>`;
  html += '</div>';

  // Daily chart
  html += '<div class="section-title">📅 近14天学习</div>';
  html += '<div class="chart-bar">';
  let maxTotal = 1;
  for (const d of stats.daily) { if (d.total > maxTotal) maxTotal = d.total; }
  for (const d of stats.daily) {
    const pct = maxTotal > 0 ? Math.round(d.total / maxTotal * 100) : 0;
    const color = d.accuracy >= 80 ? 'var(--success)' : d.accuracy >= 50 ? 'var(--warning)' : 'var(--danger)';
    html += '<div class="bar-row">';
    html += `<span class="bar-label">${d.date}</span>`;
    html += '<span class="bar-track">';
    html += `<span class="bar-fill" style="width:${pct}%;background:${color};"></span>`;
    html += '</span>';
    html += `<span class="bar-val">${d.total}题</span>`;
    html += '</div>';
  }
  html += '</div>';

  // Category stats
  if (stats.catStats.length > 0) {
    html += '<div class="section-title">📊 分类正确率</div>';
    for (const cs of stats.catStats) {
      html += '<div class="list-item" style="cursor:default;">';
      html += `<div class="item-info"><div class="item-title">${escHtml(cs.category)}</div>`;
      html += `<div class="item-desc">${cs.total}题 · 正确${cs.correct}题</div></div>`;
      html += `<span style="font-size:16px;font-weight:600;color:${cs.accuracy >= 80 ? 'var(--success)' : cs.accuracy >= 50 ? 'var(--warning)' : 'var(--danger)'};">${cs.accuracy}%</span>`;
      html += '</div>';
    }
  }

  html += '<div style="text-align:center;padding:24px;color:var(--text3);font-size:12px;">';
  html += `连续学习 ${stats.streakDays} 天 🔥<br>题库共 ${stats.totalQuestions} 题`;
  html += '</div>';

  showContent(html);
}

// ===================== Confirm Dialog =====================

function showConfirm(msg, onConfirm) {
  const overlay = document.createElement('div');
  overlay.className = 'confirm-overlay';
  overlay.innerHTML = `
    <div class="confirm-box">
      <p>${msg}</p>
      <div class="btn-row">
        <button class="btn btn-outline btn-sm cancel">取消</button>
        <button class="btn btn-danger btn-sm ok">确认</button>
      </div>
    </div>`;
  overlay.querySelector('.cancel').onclick = () => overlay.remove();
  overlay.querySelector('.ok').onclick = () => { overlay.remove(); onConfirm(); };
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}

// ===================== Helpers =====================

function escHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function esc(s) {
  return JSON.stringify(s);
}

// ===================== Init =====================

async function init() {
  loadAllQuestions();
  await openDB();

  // Register Service Worker
  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('sw.js');
      console.log('SW registered');
    } catch (e) {
      console.log('SW registration failed:', e);
    }
  }

  // First run: show home
  renderHome();

  // Periodically check for updates
  setInterval(async () => {
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      // SW handles updates automatically
    }
  }, 3600000);
}

// ===================== Public API (exposed to onclick handlers) =====================

window.App = {
  navigate,
  startPractice,
  selectOption,
  nextQuestion,
  submitAnswer,
  toggleFav,
  examGoTo: (idx) => window.examGoTo && window.examGoTo(idx),
  examSelect: (idx, letter) => window.examSelect && window.examSelect(idx, letter),
  examSubmit: () => window.examSubmit && window.examSubmit(),
  startExam,
  removeWrong,
  clearAllWrong,
  redoWrong,
  practiceFav,
  showConfirm,
};

// ===================== Start =====================

document.addEventListener('DOMContentLoaded', init);

// Handle answer submission via double-tap on mobile
document.addEventListener('dblclick', (e) => {
  const btn = e.target.closest('.opt-btn');
  if (btn && window._pq && !window._pq.answered) {
    submitAnswer();
  }
});

// Auto-submit on answer selection (single tap on option = select + submit)
document.addEventListener('click', (e) => {
  const btn = e.target.closest('#optionsArea .opt-btn');
  if (btn && window._pq && !window._pq.answered) {
    // Small delay so visual selection shows first
    setTimeout(() => submitAnswer(), 150);
  }
});
