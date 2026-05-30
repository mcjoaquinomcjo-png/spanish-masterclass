import './style.css';
import chaptersData from './data/chapters.json';

// State Management
let currentChapterIndex = 0;
let activeTab = 'learn'; // 'learn' | 'practice' | 'answers'
let searchQuery = '';
let exerciseScores = {}; // e.g., { "1.1": { correct: 5, total: 8 } }
let userAnswers = {}; // e.g., { "1.1": { "1": "yo" } }

// Load Progress from localStorage
function loadProgress() {
  try {
    const scores = localStorage.getItem('es_exercise_scores');
    if (scores) exerciseScores = JSON.parse(scores);

    const answers = localStorage.getItem('es_user_answers');
    if (answers) userAnswers = JSON.parse(answers);
  } catch (e) {
    console.error('Error loading progress from localStorage:', e);
  }
}

// Save Progress to localStorage
function saveProgress() {
  try {
    localStorage.setItem('es_exercise_scores', JSON.stringify(exerciseScores));
    localStorage.setItem('es_user_answers', JSON.stringify(userAnswers));
  } catch (e) {
    console.error('Error saving progress to localStorage:', e);
  }
}

// Text-to-Speech Functionality
function speakSpanish(text) {
  if ('speechSynthesis' in window) {
    // Cancel currently speaking voices
    window.speechSynthesis.cancel();
    
    // Create utterance
    const cleanText = text.replace(/^[0-9]+[.\u00B7\s]\s*/, '').replace(/___+/g, '...');
    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.lang = 'es-ES'; // Castilian Spanish. Use es-MX as fallback if needed.
    
    // Try to find a Spanish voice
    const voices = window.speechSynthesis.getVoices();
    const spanishVoice = voices.find(voice => voice.lang.startsWith('es-'));
    if (spanishVoice) {
      utterance.voice = spanishVoice;
    }
    
    window.speechSynthesis.speak(utterance);
  } else {
    alert('La síntesis de voz no es compatible con este navegador.');
  }
}

// Ensure voices are loaded (necessary for Chrome/Safari)
if ('speechSynthesis' in window) {
  window.speechSynthesis.getVoices();
  if (window.speechSynthesis.onvoiceschanged !== undefined) {
    window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
  }
}

// Normalizer for answer grading
function normalizeStr(str) {
  if (!str) return '';
  return str.toLowerCase()
    .trim()
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()¡?¿]/g, "") // Remove punctuation
    .replace(/\s+/g, " "); // Normalize whitespace
}

function removeAccents(str) {
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function getAcceptedAnswers(answerText) {
  if (!answerText) return [];

  // Support datasets that provide multiple valid answers in one field
  // such as "Nosotros / Nosotras" or "él o ella".
  return answerText
    .split(/\s*\/\s*|\s+o\s+|;/i)
    .map(part => normalizeStr(part))
    .filter(Boolean);
}

// Clean residual PDF artifacts from text
function cleanDisplayText(text) {
  let clean = text;
  // Remove PDF page markers like "-- 14 of 208 --"
  clean = clean.replace(/^\s*--\s*\d+\s+of\s+\d+\s*--\s*$/gmi, '');
  // Strip leftover page numbers on own line
  clean = clean.replace(/^\s*\d{1,3}\s*$/gm, '');
  // Strip ·N· chapter markers
  clean = clean.replace(/^\s*[·.]\d+[·.]\s*$/gm, '');
  // Strip "Practice Makes Perfect" header lines
  clean = clean.replace(/^.*Practice Makes Perfect.*$/gm, '');
  clean = clean.replace(/^.*Intermediate Spanish Grammar.*$/gm, '');
  clean = clean.replace(/^This page intentionally left blank$/gmi, '');
  // Rejoin words split by PDF line-break hyphenation (e.g., con-\ntext)
  clean = clean.replace(/([A-Za-zÁÉÍÓÚÜÑáéíóúüñ])-\n([A-Za-zÁÉÍÓÚÜÑáéíóúüñ])/g, '$1$2');
  // Collapse excessive blank lines
  clean = clean.replace(/\n{3,}/g, '\n\n');
  return clean.trim();
}

function normalizeLessonLines(rawLines) {
  const lines = [];
  const shouldMerge = (current, next) => {
    if (!current || !next) return false;
    if (current.includes('\t') || next.includes('\t')) return false;
    if (/^[◆•\-*]/.test(next.trim())) return false;
    if (/^(yo|tú|tu|usted|él\/ella|él|ella|nosotros|nosotras|vosotros|vosotras|ustedes|ellos|ellas)\b/i.test(next.trim())) return false;
    if (/[:.;!?)]$/.test(current.trim())) return false;
    return /^[a-záéíóúüñ(]/i.test(next.trim());
  };

  let i = 0;
  while (i < rawLines.length) {
    let line = rawLines[i].trim();
    if (!line) {
      lines.push('');
      i++;
      continue;
    }

    while (i + 1 < rawLines.length && shouldMerge(line, rawLines[i + 1])) {
      line = `${line} ${rawLines[i + 1].trim()}`;
      i++;
    }

    lines.push(line);
    i++;
  }

  return lines;
}

function scoreLanguageHints(text, hints) {
  const lower = text.toLowerCase();
  let score = 0;
  hints.forEach(hint => {
    const escaped = hint.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`\\b${escaped}\\b`, 'i');
    if (re.test(lower)) score++;
  });
  return score;
}

function detectSentenceLanguage(sentence) {
  const spanishHints = ['el', 'la', 'los', 'las', 'de', 'y', 'en', 'que', 'no', 'es', 'son', 'yo', 'tu', 'tú', 'usted', 'ustedes', 'ella', 'él', 'nosotros', 'ellas', 'ellos'];
  const englishHints = ['the', 'and', 'is', 'are', 'to', 'of', 'in', 'now', 'here', 'my', 'your', 'they', 'he', 'she', 'we', 'it'];

  const spanishScore = scoreLanguageHints(sentence, spanishHints);
  const englishScore = scoreLanguageHints(sentence, englishHints);
  if (/[áéíóúñ¿¡]/i.test(sentence)) return 'es';
  if (spanishScore >= englishScore + 1) return 'es';
  if (englishScore >= spanishScore + 1) return 'en';
  return 'unknown';
}

function extractBilingualPairs(line) {
  if (!line || line.length < 20) return null;
  const sentences = line.split(/(?<=[.!?])\s+/).filter(Boolean);
  if (sentences.length < 2) return [];

  const labels = sentences.map(detectSentenceLanguage);

  // Pattern 1: alternating ES/EN sentence-by-sentence
  const alternatingPairs = [];
  for (let i = 0; i < sentences.length - 1; i += 2) {
    const a = labels[i];
    const b = labels[i + 1];
    if ((a === 'es' || a === 'unknown') && (b === 'en' || b === 'unknown')) {
      alternatingPairs.push({ es: sentences[i], en: sentences[i + 1] });
    } else {
      alternatingPairs.length = 0;
      break;
    }
  }
  if (alternatingPairs.length > 0 && alternatingPairs.length * 2 === sentences.length) {
    return alternatingPairs;
  }

  // Pattern 2: block of ES sentences followed by block EN sentences
  for (let splitAt = 1; splitAt < sentences.length; splitAt++) {
    const leftSentences = sentences.slice(0, splitAt);
    const rightSentences = sentences.slice(splitAt);
    if (leftSentences.length === 0 || rightSentences.length === 0) continue;

    const leftLooksSpanish = leftSentences.every((s, idx) => ['es', 'unknown'].includes(labels[idx]));
    const rightLooksEnglish = rightSentences.every((s, idx) => ['en', 'unknown'].includes(labels[splitAt + idx]));
    if (!leftLooksSpanish || !rightLooksEnglish) continue;

    if (leftSentences.length === rightSentences.length) {
      return leftSentences.map((es, idx) => ({ es, en: rightSentences[idx] }));
    }

    return [{
      es: leftSentences.join(' ').trim(),
      en: rightSentences.join(' ').trim(),
    }];
  }

  return [];
}

// Format Lesson Text into Premium HTML (Conjugations, Tables, Lists)
function formatLessonHTML(rawText) {
  const text = cleanDisplayText(rawText);
  const lines = normalizeLessonLines(text.split('\n'));
  let html = '';
  let inList = false;
  let inTable = false;
  let tableRows = [];
  let paragraphBuffer = []; // Collect consecutive plain lines into one <p>
  
  let translationBuffer = []; // Buffer consecutive translation pairs into one group box

  function flushTranslations() {
    if (translationBuffer.length === 0) return;
    if (translationBuffer.length === 1) {
      // Single pair — still wrap in group (red box)
      const { es, en } = translationBuffer[0];
      html += `
      <div class="translation-group">
        <div class="translation-example">
          <span class="spanish-text">${es}</span>
          <span class="english-text">${en}</span>
          <button class="tts-btn" title="Escuchar pronunciación" data-speak="${es}">
            <span class="material-icons-round">volume_up</span>
          </button>
        </div>
      </div>`;
    } else {
      html += `<div class="translation-group">`;
      translationBuffer.forEach(({ es, en }) => {
        html += `
        <div class="translation-example">
          <span class="spanish-text">${es}</span>
          <span class="english-text">${en}</span>
          <button class="tts-btn" title="Escuchar pronunciación" data-speak="${es}">
            <span class="material-icons-round">volume_up</span>
          </button>
        </div>`;
      });
      html += `</div>`;
    }
    translationBuffer = [];
  }

  function flushParagraph() {
    if (paragraphBuffer.length > 0) {
      flushTranslations();
      html += `<p class="book-style-paragraph">${paragraphBuffer.join(' ')}</p>`;
      paragraphBuffer = [];
    }
  }

  function isPronounTableLine(line) {
    const l = line.toLowerCase();
    if (l.includes('singular') && l.includes('plural')) return true;
    return /^(yo|tú|tu|usted|ud\.?|él\/ella|él|ella|nosotros|nosotras|vosotros|vosotras|ustedes|uds\.?|ellos|ellas)\b/i.test(line);
  }
  
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();
    
    // Skip empty lines (flush any accumulated paragraph)
    if (!line) {
      flushParagraph();
      flushTranslations();
      if (inList) { html += '</ul>'; inList = false; }
      if (inTable) { html += renderTable(tableRows); inTable = false; tableRows = []; }
      continue;
    }
    
    // Skip residual page numbers or very short numeric-only lines
    if (/^\d{1,3}$/.test(line)) continue;
    
    // Check if line looks like a conjugation/pronoun table row or table header
    const tableRowRegex = /^(yo|tú|usted|él\/ella|nosotros|vosotros|ustedes|ellos\/ellas)\s+(\w+)\s+(\w+)?\s*(\w+)?/i;
    const isTableHeader = line.toLowerCase().includes('to think') || 
                          line.toLowerCase().includes('to love') || 
                          line.toLowerCase().includes('to spend') || 
                          line.toLowerCase().includes('to sell') || 
                          line.toLowerCase().includes('to open') ||
                          (line.includes('Singular') && line.includes('Plural'));
    const looksLikePronounTableRow = isPronounTableLine(line) && (line.includes('\t') || /\s{2,}/.test(line));
    
    if (tableRowRegex.test(line) || isTableHeader || looksLikePronounTableRow) {
      flushParagraph();
      flushTranslations();
      if (inList) { html += '</ul>'; inList = false; }
      inTable = true;
      tableRows.push(line);
      continue;
    }
    
    if (inTable && !tableRowRegex.test(line) && !isTableHeader && !looksLikePronounTableRow) {
      html += renderTable(tableRows);
      inTable = false;
      tableRows = [];
    }
    
    // Check list item (starts with ◆ or standard bullets)
    if (line.startsWith('◆') || line.startsWith('•') || line.startsWith('-') || line.startsWith('*')) {
      flushParagraph();
      flushTranslations();
      if (!inList) { html += '<ul>'; inList = true; }
      const content = line.replace(/^[◆•\-*]\s*/, '');
      html += `<li>${content}</li>`;
      continue;
    }
    
    if (inList) { flushParagraph(); html += '</ul>'; inList = false; }
    
    // Check for subsection sub-headings
    if (line.startsWith('Stem change') || 
        line.startsWith('Spelling changes') || 
        line.startsWith('Uses of') || 
        line.startsWith('Vocabulario') || 
        line.startsWith('Vocabulary') ||
        line.startsWith('Expressions with')) {
      flushParagraph();
      flushTranslations();
      html += `<h3>${line}</h3>`;
      continue;
    }
    
    // Check side-by-side translation (separated by tab or multiple spaces)
    const parts = line.split(/\t|\s{2,}/);
    if (parts.length >= 2 && parts[0].length > 3 && parts[1].length > 3) {
      const es = parts[0].trim();
      const en = parts[1].trim();
      if (!es.toLowerCase().includes('practice makes perfect') && !en.toLowerCase().includes('practice makes perfect')) {
        flushParagraph();
        translationBuffer.push({ es, en });
        continue;
      }
    }

    // Detect bilingual lines that were collapsed into one sentence block:
    // "Spanish... English..."
    const bilingualPairs = extractBilingualPairs(line);
    if (bilingualPairs.length > 0) {
      flushParagraph();
      bilingualPairs.forEach(pair => {
        translationBuffer.push({ es: pair.es, en: pair.en });
      });
      continue;
    }
    
    // Accumulate into paragraph buffer (joins broken lines)
    flushTranslations();
    paragraphBuffer.push(line);
  }
  
  // Flush any remaining state
  flushParagraph();
  flushTranslations();
  if (inList) html += '</ul>';
  if (inTable) html += renderTable(tableRows);
  
  return html;
}

function renderTable(rows) {
  let html = '<table>';
  let isFirst = true;
  for (const r of rows) {
    const cols = r.split(/\t|\s{2,}/).filter(c => c.trim().length > 0);
    html += '<tr>';
    for (const c of cols) {
      if (isFirst) {
        html += `<th>${c}</th>`;
      } else {
        html += `<td>${c}</td>`;
      }
    }
    html += '</tr>';
    isFirst = false;
  }
  html += '</table>';
  return html;
}

function getChapterExercises(chapter) {
  return chapter.sections.filter(section => section.type === 'exercise');
}

// Render the entire sidebar menu of chapters
function renderSidebar() {
  const navList = document.getElementById('chapters-nav-list');
  navList.innerHTML = '';
  
  let filteredChapters = chaptersData;
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    filteredChapters = chaptersData.filter(ch => {
      // Match title, chapter number, or section contents
      const titleMatch = ch.title.toLowerCase().includes(q);
      const numMatch = `capítulo ${ch.number}`.includes(q) || `${ch.number}` === q;
      const contentMatch = ch.sections.some(s => s.content && s.content.toLowerCase().includes(q));
      return titleMatch || numMatch || contentMatch;
    });
  }
  
  if (filteredChapters.length === 0) {
    navList.innerHTML = '<div class="loading-placeholder">No se encontraron temas</div>';
    return;
  }
  
  filteredChapters.forEach((ch, idx) => {
    const isActive = chaptersData[currentChapterIndex].number === ch.number;
    
    const item = document.createElement('button');
    item.className = `chapter-item ${isActive ? 'active' : ''}`;
    item.innerHTML = `
      <span class="chapter-item-num">${ch.number.toString().padStart(2, '0')}</span>
      <span class="chapter-item-title" title="${ch.title}">${ch.title}</span>
    `;
    
    item.addEventListener('click', () => {
      // Find the index in the original data array
      const origIndex = chaptersData.findIndex(origCh => origCh.number === ch.number);
      if (origIndex !== -1) {
        currentChapterIndex = origIndex;
        // Close mobile sidebar if open
        document.getElementById('sidebar').classList.remove('open');
        document.getElementById('sidebar-overlay').classList.remove('show');
        loadChapter();
      }
    });
    
    navList.appendChild(item);
  });
}


// Load and render active chapter details
function loadChapter() {
  const ch = chaptersData[currentChapterIndex];
  
  // Header
  document.getElementById('header-chapter-num').textContent = `Capítulo ${ch.number.toString().padStart(2, '0')}`;
  document.getElementById('header-chapter-title').textContent = ch.title;
  const isLastChapter = currentChapterIndex === chaptersData.length - 1;
  
  // Prev/Next chapter control status
  document.getElementById('prev-chapter').disabled = currentChapterIndex === 0;
  document.getElementById('next-chapter').disabled = isLastChapter;
  
  // Redraw sidebar items to update active styling
  renderSidebar();
  
  // Render tabs content
  renderTabContent();
}

function renderTabContent() {
  const ch = chaptersData[currentChapterIndex];
  
  // Hide all panels
  document.querySelectorAll('.tab-pane').forEach(el => el.classList.remove('active'));
  
  // Get active container
  const containerId = `tab-content-${activeTab}`;
  const container = document.getElementById(containerId);
  container.classList.add('active');
  container.innerHTML = '';
  
  if (activeTab === 'learn') {
    // 1. Learn (Discussion) Tab Rendering
    const discussions = ch.sections.filter(s => s.type === 'discussion');
    if (discussions.length === 0) {
      container.innerHTML = '<div class="loading-placeholder">Este capítulo no tiene lecciones adicionales. Ve a la sección de Ejercicios.</div>';
      return;
    }
    
    discussions.forEach(d => {
      const block = document.createElement('div');
      block.className = 'discussion-block';
      block.innerHTML = `
        <h2>${d.title}</h2>
        <div class="discussion-body">${formatLessonHTML(d.content)}</div>
      `;
      container.appendChild(block);
    });
    
    // Add TTS event handlers inside formatting
    container.querySelectorAll('.tts-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        speakSpanish(btn.getAttribute('data-speak'));
      });
    });
    
  } else if (activeTab === 'practice') {
    // 2. Practice (Assessments) Tab Rendering
    const exercises = ch.sections.filter(s => s.type === 'exercise');
    if (exercises.length === 0) {
      container.innerHTML = '<div class="loading-placeholder">No hay ejercicios para este capítulo.</div>';
      return;
    }
    
    exercises.forEach(ex => {
      const card = document.createElement('div');
      card.className = 'exercise-card';
      card.id = `exercise-card-${ex.id}`;
      
      let titleHtml = `<span class="exercise-num-badge">${ex.id}</span>`;
      titleHtml += `<h2>${ex.title || 'Ejercicio'}</h2>`;
      
      let instrHtml = `<p class="exercise-instructions">${ex.instructions}</p>`;
      
      // Render vocabulary useful boxes if any (extracted from instruction text)
      let vocabHtml = '';
      if (ex.instructions.toLowerCase().includes('vocabulario útil') || ex.instructions.toLowerCase().includes('vocabulario')) {
        // Render styled vocabulary cards inside practice if we find it
      }
      
      let questionsHtml = '<div class="questions-list">';
      
      if (ex.questions.length === 1 && ex.questions[0].num === 1 && ex.questions[0].text.length > 100 && ex.answers.length === 1) {
        // Translation Paragraph Exercise (e.g. 1.5, 1.8)
        const q = ex.questions[0];
        const savedAnswer = (userAnswers[ex.id] && userAnswers[ex.id]['1']) || '';
        
        questionsHtml += `
          <div class="paragraph-question">
            <div class="paragraph-text">
              ${q.text.replace(/\n/g, '<br>')}
            </div>
            <textarea class="paragraph-textarea" 
                      data-ex-id="${ex.id}" 
                      data-q-num="1" 
                      placeholder="Escribe la traducción aquí..."
            >${savedAnswer}</textarea>
            <div class="feedback-area" id="feedback-para-${ex.id}-1"></div>
          </div>
        `;
      } else {
        // List of Fill in the blanks/Individual sentences
        ex.questions.forEach(q => {
          const savedVal = (userAnswers[ex.id] && userAnswers[ex.id][q.num]) || '';
          
          let textWithInput = q.text;
          const inputMarkup = `
            <input type="text" 
                   class="exercise-input" 
                   data-ex-id="${ex.id}" 
                   data-q-num="${q.num}" 
                   value="${savedVal}"
                   placeholder="..."
                   autocomplete="off"
            />
          `;
          
          // Replace tabs, underscores, or double spaces with inputs
          if (textWithInput.includes('\t')) {
            textWithInput = textWithInput.replace(/\t+/g, inputMarkup);
          } else if (textWithInput.includes('____')) {
            textWithInput = textWithInput.replace(/____+/g, inputMarkup);
          } else {
            // Append input box
            textWithInput = textWithInput + " " + inputMarkup;
          }
          
          questionsHtml += `
            <div class="question-item">
              <span class="question-num">${q.num}</span>
              <div class="question-text" id="q-text-${ex.id}-${q.num}">
                ${textWithInput}
              </div>
              <span class="feedback-badge" id="feedback-${ex.id}-${q.num}"></span>
            </div>
          `;
        });
      }
      
      questionsHtml += '</div>';
      
      // Exercise Score/Progress actions footer
      const score = exerciseScores[ex.id];
      const hasScore = score !== undefined;
      const scoreText = hasScore ? `${score.correct} / ${score.total}` : `0 / ${ex.answers.length}`;
      const isPerfect = hasScore && score.correct === score.total;
      
      const actionsHtml = `
        <div class="exercise-actions">
          <div class="actions-left">
            <button class="primary-btn check-answers-btn" data-ex-id="${ex.id}">
              <span class="material-icons-round">task_alt</span>
              <span>Comprobar respuestas</span>
            </button>
            <button class="secondary-btn show-answers-btn" data-ex-id="${ex.id}">
              <span class="material-icons-round">visibility</span>
              <span>Revelar respuestas</span>
            </button>
            <button class="secondary-btn reset-ex-btn" data-ex-id="${ex.id}">
              <span class="material-icons-round">refresh</span>
              <span>Reiniciar</span>
            </button>
          </div>
          
          <div class="score-display">
            <span>Puntuación:</span>
            <span class="score-badge ${isPerfect ? 'perfect' : ''}" id="score-badge-${ex.id}">${scoreText}</span>
          </div>
        </div>
      `;
      
      card.innerHTML = titleHtml + instrHtml + vocabHtml + questionsHtml + actionsHtml;
      container.appendChild(card);
    });
    
    // Set up Input Event Listeners
    setupInputs(container);
    
  }
}

// Setup input interactions, accent toolbar, check grading and scores
function setupInputs(container) {
  const accentToolbar = document.getElementById('accent-toolbar');
  let activeInput = null;
  
  // Inputs focus handlers to show floating accents bar
  container.querySelectorAll('input[type="text"], textarea').forEach(el => {
    // Capture user typed inputs
    el.addEventListener('input', () => {
      const exId = el.getAttribute('data-ex-id');
      const qNum = el.getAttribute('data-q-num');
      if (!userAnswers[exId]) userAnswers[exId] = {};
      userAnswers[exId][qNum] = el.value;
      saveProgress();
    });
    
    el.addEventListener('focus', () => {
      activeInput = el;
      accentToolbar.classList.add('show');
    });
  });
  
  // Close accent toolbar
  document.getElementById('close-toolbar-btn').addEventListener('click', () => {
    accentToolbar.classList.remove('show');
  });
  
  // Clicking an accent key inserts it into focused input
  const keys = accentToolbar.querySelectorAll('.accent-key');
  let capsMode = false;
  
  keys.forEach(key => {
    // Override click to prevent losing input focus
    key.addEventListener('mousedown', (e) => {
      e.preventDefault(); // Prevents input focus loss
      if (!activeInput) return;
      
      const charType = key.getAttribute('data-case');
      if (charType === 'caps') {
        capsMode = !capsMode;
        key.classList.toggle('active', capsMode);
        // Toggle key labels
        keys.forEach(k => {
          if (!k.getAttribute('data-case')) {
            k.textContent = capsMode ? k.textContent.toUpperCase() : k.textContent.toLowerCase();
          }
        });
        return;
      }
      
      let insertChar = key.textContent;
      const start = activeInput.selectionStart;
      const end = activeInput.selectionEnd;
      const val = activeInput.value;
      
      activeInput.value = val.substring(0, start) + insertChar + val.substring(end);
      activeInput.selectionStart = activeInput.selectionEnd = start + insertChar.length;
      activeInput.focus();
      
      // Trigger input event
      activeInput.dispatchEvent(new Event('input'));
    });
  });
  
  // Button trigger handlers
  container.querySelectorAll('.check-answers-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const exId = btn.getAttribute('data-ex-id');
      checkExerciseAnswers(exId);
    });
  });
  
  container.querySelectorAll('.show-answers-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const exId = btn.getAttribute('data-ex-id');
      revealExerciseAnswers(exId);
    });
  });
  
  container.querySelectorAll('.reset-ex-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const exId = btn.getAttribute('data-ex-id');
      resetExercise(exId);
    });
  });
}

// Grade answers for a specific exercise
function checkExerciseAnswers(exId) {
  const card = document.getElementById(`exercise-card-${exId}`);
  const ch = chaptersData[currentChapterIndex];
  const ex = ch.sections.find(s => s.id === exId);
  if (!ex) return;
  
  let correctCount = 0;
  const totalQuestions = ex.answers.length;
  
  const inputs = card.querySelectorAll(`input[data-ex-id="${exId}"], textarea[data-ex-id="${exId}"]`);
  
  inputs.forEach(input => {
    const qNum = parseInt(input.getAttribute('data-q-num'));
    const ansObj = ex.answers.find(a => a.num === qNum);
    const correctText = ansObj ? ansObj.text : '';
    const userVal = input.value.trim();
    
    // Normalizations
    const normUser = normalizeStr(userVal);
    const acceptedAnswers = getAcceptedAnswers(correctText);
    const acceptedAnswersAccentless = acceptedAnswers.map(answer => removeAccents(answer));
    
    const isStrictCorrect = acceptedAnswers.includes(normUser);
    const isAccentLessCorrect = acceptedAnswersAccentless.includes(removeAccents(normUser));
    
    // Clear old elements
    const badge = document.getElementById(`feedback-${exId}-${qNum}`);
    const paraFeedback = document.getElementById(`feedback-para-${exId}-${qNum}`);
    if (badge) badge.innerHTML = '';
    if (paraFeedback) paraFeedback.innerHTML = '';
    input.className = input.tagName.toLowerCase() === 'textarea' ? 'paragraph-textarea' : 'exercise-input';
    
    // Add text-to-speech speak button next to correct answers
    const ttsMarkup = `
      <button class="tts-btn play-correct-tts" title="Escuchar respuesta" data-speak="${correctText}">
        <span class="material-icons-round">volume_up</span>
      </button>
    `;
    
    if (isStrictCorrect) {
      correctCount++;
      input.classList.add('correct');
      if (badge) {
        badge.className = 'feedback-badge correct';
        badge.innerHTML = `<span class="material-icons-round">check_circle</span> ${ttsMarkup}`;
      }
    } else if (isAccentLessCorrect) {
      // Accent issue (almost correct)
      correctCount += 0.5; // Half credit!
      input.classList.add('incorrect');
      if (badge) {
        badge.className = 'feedback-badge incorrect';
        badge.innerHTML = `
          <span class="material-icons-round" title="¡Casi! Revisa acentos">priority_high</span>
          <span class="feedback-correct-answer">${correctText}</span>
          ${ttsMarkup}
        `;
      }
    } else {
      input.classList.add('incorrect');
      if (badge) {
        badge.className = 'feedback-badge incorrect';
        badge.innerHTML = `
          <span class="material-icons-round">cancel</span>
          <span class="feedback-correct-answer">${correctText}</span>
          ${ttsMarkup}
        `;
      } else if (paraFeedback) {
        paraFeedback.className = 'feedback-area';
        paraFeedback.innerHTML = `
          <div style="margin-top:10px;">
            <span class="feedback-correct-answer" style="margin-left:0; font-size: 14px;">Respuesta sugerida: ${correctText}</span>
            ${ttsMarkup}
          </div>
        `;
      }
    }
  });
  
  // Set up play correct answers TTS
  card.querySelectorAll('.play-correct-tts').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      speakSpanish(btn.getAttribute('data-speak'));
    });
  });
  
  // Score badge
  const scoreBadge = document.getElementById(`score-badge-${exId}`);
  scoreBadge.textContent = `${correctCount} / ${totalQuestions}`;
  if (correctCount === totalQuestions) {
    scoreBadge.className = 'score-badge perfect';
  } else {
    scoreBadge.className = 'score-badge';
  }
  
  // Save scores to state
  exerciseScores[exId] = { correct: correctCount, total: totalQuestions };
  saveProgress();
  
  ensureCurrentChapterIsUnlocked();

  // If all exercises in chapter are completed, auto mark chapter as completed?
  checkAutoChapterCompletion();
}

// Check if all exercises are mastered to auto mark chapter
function checkAutoChapterCompletion() {
  const ch = chaptersData[currentChapterIndex];
  const exercises = ch.sections.filter(s => s.type === 'exercise');
  
  let allMastered = true;
  exercises.forEach(ex => {
    const score = exerciseScores[ex.id];
    if (!score || score.correct < score.total * CHAPTER_UNLOCK_THRESHOLD) {
      allMastered = false;
    }
  });
  
  if (allMastered && !completedChapters.includes(ch.number)) {
    completedChapters.push(ch.number);
    saveProgress();
    loadChapter(); // Redraw headers & update sidebar
  }
}

// Show correct answers
function revealExerciseAnswers(exId) {
  const card = document.getElementById(`exercise-card-${exId}`);
  const ch = chaptersData[currentChapterIndex];
  const ex = ch.sections.find(s => s.id === exId);
  if (!ex) return;
  
  const inputs = card.querySelectorAll(`input[data-ex-id="${exId}"], textarea[data-ex-id="${exId}"]`);
  
  inputs.forEach(input => {
    const qNum = parseInt(input.getAttribute('data-q-num'));
    const ansObj = ex.answers.find(a => a.num === qNum);
    if (ansObj) {
      input.value = ansObj.text;
      // Trigger input event
      input.dispatchEvent(new Event('input'));
    }
  });
  
  // Automatically grade it
  checkExerciseAnswers(exId);
}

// Reset answers
function resetExercise(exId) {
  const card = document.getElementById(`exercise-card-${exId}`);
  const ch = chaptersData[currentChapterIndex];
  const ex = ch.sections.find(s => s.id === exId);
  if (!ex) return;
  
  const inputs = card.querySelectorAll(`input[data-ex-id="${exId}"], textarea[data-ex-id="${exId}"]`);
  
  inputs.forEach(input => {
    input.value = '';
    input.className = input.tagName.toLowerCase() === 'textarea' ? 'paragraph-textarea' : 'exercise-input';
    
    // Clear userAnswers memory
    const qNum = input.getAttribute('data-q-num');
    if (userAnswers[exId] && userAnswers[exId][qNum]) {
      delete userAnswers[exId][qNum];
    }
  });
  
  // Clear feedbacks
  card.querySelectorAll('.feedback-badge').forEach(el => el.innerHTML = '');
  const paraFeedback = card.querySelector(`.feedback-area`);
  if (paraFeedback) paraFeedback.innerHTML = '';
  
  // Reset score badge
  const scoreBadge = document.getElementById(`score-badge-${exId}`);
  scoreBadge.textContent = `0 / ${ex.answers.length}`;
  scoreBadge.className = 'score-badge';
  
  delete exerciseScores[exId];
  saveProgress();
  ensureCurrentChapterIsUnlocked();
  loadChapter();
}

// Set up UI Event listeners
function setupUIListeners() {
  // Toggle Sidebar Menu
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  
  document.getElementById('toggle-sidebar').addEventListener('click', () => {
    sidebar.classList.toggle('open');
    overlay.classList.toggle('show');
  });
  
  overlay.addEventListener('click', () => {
    sidebar.classList.remove('open');
    overlay.classList.remove('show');
  });
  
  // Search bar logic
  const searchInput = document.getElementById('chapter-search');
  const clearSearch = document.getElementById('clear-search');
  
  searchInput.addEventListener('input', () => {
    searchQuery = searchInput.value;
    clearSearch.style.display = searchQuery ? 'block' : 'none';
    renderSidebar();
  });
  
  clearSearch.addEventListener('click', () => {
    searchInput.value = '';
    searchQuery = '';
    clearSearch.style.display = 'none';
    renderSidebar();
  });
  

  
  // Tabs switcher
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeTab = btn.getAttribute('data-tab');
      renderTabContent();
    });
  });
  
  // Chapter nav buttons (Prev / Next)
  document.getElementById('prev-chapter').addEventListener('click', () => {
    if (currentChapterIndex > 0) {
      currentChapterIndex--;
      loadChapter();
      document.getElementById('content-viewport').scrollTop = 0;
    }
  });
  
  document.getElementById('next-chapter').addEventListener('click', () => {
    if (currentChapterIndex < chaptersData.length - 1) {
      currentChapterIndex++;
      loadChapter();
      document.getElementById('content-viewport').scrollTop = 0;
    }
  });
  

  // Light / Dark Theme toggle button
  const themeBtn = document.getElementById('theme-toggle-btn');
  const themeIcon = themeBtn.querySelector('.theme-icon');
  
  // Initialize theme from localStorage or system settings
  const isDark = localStorage.getItem('theme_dark') !== 'false';
  if (isDark) {
    document.documentElement.classList.add('dark');
    themeIcon.textContent = 'light_mode';
  } else {
    document.documentElement.classList.remove('dark');
    themeIcon.textContent = 'dark_mode';
  }
  
  themeBtn.addEventListener('click', () => {
    const dark = document.documentElement.classList.toggle('dark');
    themeIcon.textContent = dark ? 'light_mode' : 'dark_mode';
    localStorage.setItem('theme_dark', dark);
  });

  // About modal
  const aboutBtn = document.getElementById('about-btn');
  const aboutModal = document.getElementById('about-modal');
  const aboutCloseBtn = document.getElementById('about-close-btn');

  const openAbout = () => {
    aboutModal.classList.add('show');
    aboutModal.setAttribute('aria-hidden', 'false');
  };
  const closeAbout = () => {
    aboutModal.classList.remove('show');
    aboutModal.setAttribute('aria-hidden', 'true');
  };

  aboutBtn.addEventListener('click', openAbout);
  aboutCloseBtn.addEventListener('click', closeAbout);
  aboutModal.addEventListener('click', (e) => {
    if (e.target === aboutModal) closeAbout();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && aboutModal.classList.contains('show')) {
      closeAbout();
    }
  });
}

// Bootstrap Application
function init() {
  loadProgress();
  setupUIListeners();
  renderSidebar();
  loadChapter();
}

// Start
init();
