// ════════════════════════════════════════
// CONFIG
// ════════════════════════════════════════
import { MODELS, DB_NAME, DB_VERSION } from './config.js';
import { state } from './state.js';
import { fetchWithRetry as fetchWithRetryBase } from './composables/useMistral.js';
import { t } from './i18n.js';

// Annule la génération en cours
function stopGeneration() {
  if (state.abortController) {
    state.abortController.abort();
    state.abortController = null;
  }
  state.isGenerating = false;
}

// Fetch avec retry automatique + backoff exponentiel
async function fetchWithRetry(url, options, maxRetries = 3) {
  return fetchWithRetryBase(url, options, maxRetries, toast);
}

// ════════════════════════════════════════
// QCM SHUFFLE ENGINE
// ════════════════════════════════════════
// Generates a sequence of shuffled options guaranteeing equal distribution
function generateQcmSequenceArray(blocksCount = 50) {
  const letters = ['a', 'b', 'c', 'd'];
  let seq = [];
  let lastLetter = '';
  for (let i = 0; i < blocksCount; i++) {
    let block;
    let attempts = 0;
    do {
      block = [...letters].sort(() => Math.random() - 0.5);
      attempts++;
    } while (block[0] === lastLetter && attempts < 10);
    if (block[0] === lastLetter) {
      let temp = block[0]; block[0] = block[1]; block[1] = temp;
    }
    seq.push(...block);
    lastLetter = block[3];
  }
  return seq;
}

// Takes the LLM output (where [x] is always on a-) and shuffles
// options according to a pre-generated random sequence array.
// seq = array of letters like ['b','d','a','c',...]
function shuffleQcmOptions(text, seq) {
  if (!text || !seq || !seq.length) return text;
  try {
    const lines = text.split('\n');
    const newLines = [];
    let i = 0;
    let questionIndex = 0;

    while (i < lines.length) {
      const line = lines[i];
      // Detect question line: starts with number followed by "-"
      const qMatch = line.match(/^\d+\s*-\s+/);
      if (qMatch && questionIndex < seq.length) {
        newLines.push(line);
        i++;

        const savedLines = [];
        const optionLines = [];
        let correctIdx = -1;
        let peek = i;

        while (peek < lines.length && optionLines.length < 4) {
          const optLine = lines[peek].trim();
          
          // Stop if we hit the next question or the explanation line
          if (optLine.match(/^\d+\s*-\s+/) || optLine.match(/^•/)) {
            break;
          }

          const optMatch = optLine.match(/^(\[x\]\s*)?([a-d])\s*-\s*(.*)/i);
          if (optMatch) {
            const isCorrect = !!optMatch[1];
            const optText = optMatch[3];
            if (isCorrect) correctIdx = optionLines.length;
            optionLines.push({ text: optText, isCorrect, rawIndex: peek });
          }
          savedLines.push(lines[peek]);
          peek++;
        }

        if (optionLines.length === 4 && correctIdx >= 0) {
          const targetLetter = seq[questionIndex];
          const targetIdx = targetLetter.charCodeAt(0) - 97; // 'a'=0, 'b'=1, etc.
          const labels = ['a', 'b', 'c', 'd'];

          const correctOption = optionLines[correctIdx];
          const distractors = optionLines.filter((_, idx) => idx !== correctIdx);

          // Also shuffle distractors for extra randomness
          for (let j = distractors.length - 1; j > 0; j--) {
            const k = Math.floor(Math.random() * (j + 1));
            [distractors[j], distractors[k]] = [distractors[k], distractors[j]];
          }

          const shuffled = [];
          let dIdx = 0;
          for (let pos = 0; pos < 4; pos++) {
            if (pos === targetIdx) {
              shuffled.push({ text: correctOption.text, isCorrect: true });
            } else {
              shuffled.push({ text: distractors[dIdx].text, isCorrect: false });
              dIdx++;
            }
          }

          let optRenderIndex = 0;
          for (let j = 0; j < savedLines.length; j++) {
            const currentRawIndex = i + j;
            const isOptionLine = optionLines.some(opt => opt.rawIndex === currentRawIndex);
            if (isOptionLine) {
              const prefix = shuffled[optRenderIndex].isCorrect ? '[x] ' : '';
              newLines.push(`${prefix}${labels[optRenderIndex]}- ${shuffled[optRenderIndex].text}`);
              optRenderIndex++;
            } else {
              newLines.push(savedLines[j]);
            }
          }
        } else {
          // Couldn't parse as 4-option QCM — push as-is
          for (const savedLine of savedLines) {
            newLines.push(savedLine);
          }
        }
        i = peek;
        questionIndex++;
      } else {
        newLines.push(line);
        i++;
      }
    }
    return newLines.join('\n');
  } catch (e) {
    console.warn('shuffleQcmOptions error:', e);
    return text;
  }
}


// ════════════════════════════════════════
// MARKDOWN CONFIG
// ════════════════════════════════════════
if (typeof marked !== 'undefined') {
  marked.setOptions({
    breaks: true, // line breaks
    highlight: function(code, lang) {
      if (typeof hljs !== 'undefined') {
        const language = hljs.getLanguage(lang) ? lang : 'plaintext';
        return hljs.highlight(code, { language }).value;
      }
      return code;
    }
  });
}

// ════════════════════════════════════════
// UTILS
// ════════════════════════════════════════
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const uuid = () => crypto.randomUUID();
const now = () => Date.now();

const safeJsonParse = (str, fallback = {}) => {
  try { return JSON.parse(str); } catch (e) { return fallback; }
};

const escapeHtml = t => (t||'')
  .replace(/&/g,"&amp;")
  .replace(/</g,"&lt;")
  .replace(/>/g,"&gt;");

const toast = (msg, type = "info") => {
  const t = document.createElement("div");
  t.className = `toast ${type}`;
  const icon = type === "error" ? "⚠" : type === "success" ? "✓" : "◈";
  t.innerHTML = `<span style="color:${type==='error'?'var(--danger)':type==='success'?'var(--neon)':'var(--cyan)'}">${icon}</span><span>${msg}</span>`;
  $("#toast-container").appendChild(t);
  setTimeout(() => t.remove(), 3800);
};

// ════════════════════════════════════════
// SECURE KEY STORAGE — AES-GCM (WebCrypto)
// La clé API est chiffrée avant tout stockage.
// Un attaquant qui vole le cookie ne peut pas l'utiliser dans un autre contexte.
// ════════════════════════════════════════

async function _deriveKey() {
  // Dérive une clé AES à partir d'un "fingerprint" propre à ce navigateur/domaine
  const fingerprint = (navigator.userAgent + location.hostname + "mia-2026-salt").slice(0, 64);
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(fingerprint), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: enc.encode("mia-salt-v1"), iterations: 100000, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function _encryptValue(plaintext) {
  const key = await _deriveKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(plaintext));
  // Stocker iv + ciphertext en base64
  const combined = new Uint8Array(iv.byteLength + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.byteLength);
  return btoa(String.fromCharCode(...combined));
}

async function _decryptValue(b64) {
  try {
    const key = await _deriveKey();
    const combined = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);
    const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
    return new TextDecoder().decode(decrypted);
  } catch(e) {
    return null; // Clé corrompue ou contexte différent
  }
}

const setCookie = async (n, v, d = 365) => {
  try {
    const encrypted = await _encryptValue(v);
    const e = new Date(); e.setDate(e.getDate() + d);
    document.cookie = `${n}=${encodeURIComponent(encrypted)};expires=${e.toUTCString()};path=/;SameSite=Strict`;
    localStorage.setItem('Mon Assistant IA_' + n, encrypted);
  } catch(err) {
    // Fallback plain si WebCrypto indisponible (rare)
    const e = new Date(); e.setDate(e.getDate() + d);
    document.cookie = `${n}=${encodeURIComponent(v)};expires=${e.toUTCString()};path=/;SameSite=Strict`;
    localStorage.setItem('Mon Assistant IA_' + n, v);
  }
};

const getCookie = async (n) => {
  let raw = null;
  try {
    const m = document.cookie.match('(^|;)\\s*' + n + '\\s*=\\s*([^;]+)');
    if (m) raw = decodeURIComponent(m.pop());
  } catch(err) {}
  if (!raw) {
    try { raw = localStorage.getItem('Mon Assistant IA_' + n); } catch(err) {}
  }
  if (!raw) return null;
  // Tenter déchiffrement AES
  const decrypted = await _decryptValue(raw);
  // Si déchiffrement échoue, c'est peut-être une ancienne valeur en clair
  return decrypted || raw;
};

const deleteCookie = (n) => {
  try { document.cookie = `${n}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;SameSite=Strict`; } catch(err) {}
  try { localStorage.removeItem('Mon Assistant IA_' + n); } catch(err) {}
};

const isValidApiKey = k => {
  const c = (k || '').trim();
  if (c.length < 20) return false;
  return /^[A-Za-z0-9\-_]{20,}$/.test(c);
};


// ════════════════════════════════════════
// INDEXEDDB
// ════════════════════════════════════════
import { db } from './storage.js';

// ════════════════════════════════════════
// UTILS: WORD EXPORT
// ════════════════════════════════════════
function exportToWord(text, filename = "Export_IA.doc") {
  const parsedHtml = typeof marked !== 'undefined' ? marked.parse(text) : text.replace(/\n/g, '<br>');
  const htmlContent = `
    <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
    <head><meta charset='utf-8'><title>Export IA</title></head>
    <body style="font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.5; color: #333;">
      ${parsedHtml}
    </body>
    </html>
  `;
  const blob = new Blob(['\ufeff', htmlContent], { type: 'application/msword' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}

// ════════════════════════════════════════
// AGENT FEEDBACK / LEARNING SYSTEM
// ════════════════════════════════════════
const agentFeedback = {
  add: async (entry) => {
    entry.id = entry.id || uuid();
    entry.created = entry.created || now();
    await db.put('agent_feedback', entry);
    return entry;
  },
  getForAgent: async (agentId, limit = 8) => {
    const all = await db.getAll('agent_feedback') || [];
    return all
      .filter(f => f.agentId === agentId)
      .sort((a, b) => b.created - a.created)
      .slice(0, limit);
  },
  getForWorkflow: async (workflowName, limit = 8) => {
    const all = await db.getAll('agent_feedback') || [];
    return all
      .filter(f => f.workflowName === workflowName)
      .sort((a, b) => b.created - a.created)
      .slice(0, limit);
  },
  getCountForAgent: async (agentId) => {
    const all = await db.getAll('agent_feedback') || [];
    return all.filter(f => f.agentId === agentId).length;
  },
  deleteForAgent: async (agentId) => {
    const all = await db.getAll('agent_feedback') || [];
    for (const f of all.filter(fb => fb.agentId === agentId)) {
      await db.delete('agent_feedback', f.id);
    }
  },
  deleteItem: async (id) => {
    await db.delete('agent_feedback', id);
  },
  updateItem: async (id, newFeedback) => {
    const f = await db.get('agent_feedback', id);
    if (f) {
      f.userFeedback = newFeedback;
      await db.put('agent_feedback', f);
    }
  },
  buildLessonsPrompt: (feedbacks) => {
    if (!feedbacks || !feedbacks.length) return '';
    const negatives = feedbacks.filter(f => f.score <= 2 && f.userFeedback);
    const positives = feedbacks.filter(f => f.score >= 4 && f.userFeedback && f.userFeedback !== 'auto_positive');
    if (!negatives.length && !positives.length) return '';
    let block = '\n\n[LEÇONS APPRISES — À RESPECTER IMPÉRATIVEMENT]\n';
    negatives.forEach(f => {
      block += `⛔ ERREUR À NE PAS RÉPÉTER : ${f.userFeedback}\n`;
    });
    positives.forEach(f => {
      block += `✅ BONNE PRATIQUE CONFIRMÉE : ${f.userFeedback}\n`;
    });
    block += `\n[CRITIQUE : Tu dois absolument donner la priorité à ces leçons. Si une instruction ci-dessus contredit une leçon, applique la leçon.]\n`;
    return block;
  }
};

function openFeedbackModal(msgTs, score) {
  const modal = document.getElementById('feedback-modal');
  if (!modal) return;
  document.getElementById('feedback-msg-ts').value = msgTs;
  document.getElementById('feedback-score').value = score;
  document.getElementById('feedback-text').value = '';
  document.getElementById('feedback-score-display').textContent = `${score}/5`;
  document.getElementById('feedback-score-display').className = `feedback-score-val ${score <= 2 ? 'bad' : 'good'}`;
  modal.classList.add('active');
  setTimeout(() => document.getElementById('feedback-text').focus(), 100);
}

async function submitFeedback() {
  const msgTs = parseInt(document.getElementById('feedback-msg-ts').value);
  const score = parseInt(document.getElementById('feedback-score').value);
  const text = document.getElementById('feedback-text').value.trim();
  if (!text) { toast('Veuillez écrire votre feedback', 'error'); return; }

  const msg = (state.messages || []).find(m => m.ts === msgTs);
  if (!msg) return;

  // Determine the agent
  const isRealAgent = state.agent && state.agent !== '__ALL_AGENTS__';
  const agentId = isRealAgent ? state.agent.id : null;
  const agentName = isRealAgent ? state.agent.name : (state.aiConfig?.name || 'Mon Assistant IA');
  const workflowName = msg.workflowUsed || null;

  const entry = {
    agentId: agentId,
    agentName: agentName,
    workflowName: workflowName,
    score: score,
    userFeedback: text,
    originalQuestion: (state.messages || []).filter(m => m.role === 'user').slice(-1)[0]?.content?.slice(0, 200) || '',
    responseSnippet: (msg.content || '').slice(0, 200)
  };

  await agentFeedback.add(entry);
  document.getElementById('feedback-modal').classList.remove('active');
  toast(`🧠 Feedback enregistré pour ${agentName}${workflowName ? ' (chaîne: ' + workflowName + ')' : ''}`, 'success');
  loadAgents(); // refresh badges

  // Mettre à jour le cache de l'agent actif
  if (state.agent && state.agent.id === agentId) {
    const lessons = await agentFeedback.getForAgent(agentId, 8);
    state._agentLessonsCache = agentFeedback.buildLessonsPrompt(lessons);
    const sys = (state.messages||[]).find(m => m.role === "system");
    if (sys) { sys.content = buildSystemPrompt(); await saveChat(); }
  }
}

async function manageLessons(agentId) {
  try {
    const ag = await db.get('agents', agentId);
    if (!ag) return;
    document.getElementById('lessons-agent-name').textContent = ag.name.toUpperCase();
    document.getElementById('manage-lessons-agent-id').value = agentId;
    await renderAgentLessons(agentId);
    
    // Fermer la modale des agents pour éviter les superpositions qui bloquent l'édition
    const agentModal = document.getElementById('agent-modal');
    if (agentModal) agentModal.classList.remove('active');
    
    document.getElementById('agent-lessons-modal').classList.add('active');
  } catch(e) { console.error(e); }
}

async function renderAgentLessons(agentId) {
  const listEl = document.getElementById('agent-lessons-list');
  try {
    const lessons = await agentFeedback.getForAgent(agentId, 100);
    if (!lessons.length) {
      listEl.innerHTML = '<div style="color:var(--text-dim); text-align:center; padding: 20px;">Aucune leçon retenue pour cet agent.</div>';
      return;
    }
    
    listEl.innerHTML = lessons.map(l => `
      <div class="lesson-item ${l.score >= 4 ? 'good' : 'bad'}" id="lesson-${l.id}">
        <div class="lesson-header">
          <span>${new Date(l.created).toLocaleString('fr-FR')} — Note: ${l.score}/5</span>
        </div>
        <textarea class="lesson-textarea" id="lesson-text-${l.id}">${escapeHtml(l.userFeedback || 'Renforcement automatique')}</textarea>
        <div class="lesson-actions">
          <button class="btn-ghost danger" onclick="deleteLesson('${l.id}', '${agentId}')" style="padding:4px 8px;font-size:10px;">🗑 SUPPRIMER</button>
          <button class="btn-ghost" onclick="updateLesson('${l.id}', '${agentId}')" style="padding:4px 8px;font-size:10px;">💾 ENREGISTRER</button>
        </div>
      </div>
    `).join('');
  } catch(e) { listEl.innerHTML = '<div style="color:var(--danger)">Erreur de chargement.</div>'; }
}

async function updateLesson(lessonId, agentId) {
  const newText = document.getElementById(`lesson-text-${lessonId}`).value.trim();
  if (!newText) return;
  try {
    await agentFeedback.updateItem(lessonId, newText);
    toast("Leçon mise à jour", "success");
    // Reload internal prompt cache if it's the active agent
    if (state.agent && state.agent.id === agentId) {
      const lessons = await agentFeedback.getForAgent(agentId, 8);
      state._agentLessonsCache = agentFeedback.buildLessonsPrompt(lessons);
      const sys = (state.messages||[]).find(m => m.role === "system");
      if (sys) { sys.content = buildSystemPrompt(); await saveChat(); }
    }
  } catch(e) { toast("Erreur de mise à jour", "error"); }
}

async function deleteLesson(lessonId, agentId) {
  if (!confirm("Supprimer cette leçon ?")) return;
  try {
    await agentFeedback.deleteItem(lessonId);
    toast("Leçon supprimée", "info");
    await renderAgentLessons(agentId);
    loadAgents(); // Refresh badges
    
    // Reload internal prompt cache if it's the active agent
    if (state.agent && state.agent.id === agentId) {
      const lessons = await agentFeedback.getForAgent(agentId, 8);
      state._agentLessonsCache = agentFeedback.buildLessonsPrompt(lessons);
      const sys = (state.messages||[]).find(m => m.role === "system");
      if (sys) { sys.content = buildSystemPrompt(); await saveChat(); }
    }
  } catch(e) { toast("Erreur", "error"); }
}

async function clearAgentLessons() {
  const agentId = document.getElementById('manage-lessons-agent-id').value;
  if (!agentId) return;
  if (!confirm("Voulez-vous vraiment effacer TOUTES les leçons de cet agent ? Il perdra tout son apprentissage.")) return;
  try {
    await agentFeedback.deleteForAgent(agentId);
    toast("Toutes les leçons ont été effacées", "success");
    await renderAgentLessons(agentId);
    loadAgents();
    
    if (state.agent && state.agent.id === agentId) {
      state._agentLessonsCache = '';
      const sys = (state.messages||[]).find(m => m.role === "system");
      if (sys) { sys.content = buildSystemPrompt(); await saveChat(); }
    }
  } catch(e) { toast("Erreur", "error"); }
}

// ════════════════════════════════════════
// MEMORY SYSTEM
// ════════════════════════════════════════
const memory = {
  add: async (content, tags = []) => {
    const entry = {
      id: uuid(), content,
      tags: Array.isArray(tags) ? tags : (tags||"").split(',').map(t=>t.trim()).filter(Boolean),
      created: now(), importance: 1
    };
    await db.put('global_memory', entry);
    state.globalMemories.push(entry);
    renderMemoryList();
    return entry;
  },
  getAll: async () => {
    state.globalMemories = await db.getAll('global_memory') || [];
    renderMemoryList();
  },
  clear: async () => {
    const all = await db.getAll('global_memory') || [];
    for (const m of all) await db.delete('global_memory', m.id);
    state.globalMemories = [];
    renderMemoryList();
    toast("Mémoire globale effacée", "success");
  },
  getRelevant: (query, limit = 5) => {
    if (!state.globalMemories?.length) return [];
    const q = query.toLowerCase();
    return state.globalMemories
      .map(m => ({ ...m, score:(m.content.toLowerCase().includes(q)?2:0) + ((m.tags||[]).some(t=>q.includes(t.toLowerCase()))?1:0) + (m.importance||1) }))
      .filter(m => m.score > 0)
      .sort((a,b) => b.score - a.score)
      .slice(0, limit)
      .map(m => `[MEM:${(m.tags||[]).join(',')}] ${m.content}`);
  }
};

function renderMemoryList() {
  const list = $("#memory-list");
  if (!state.globalMemories?.length) {
    list.innerHTML = '<div style="color:var(--text-dim);font-family:var(--font-mono);font-size:11px;padding:8px 0">Aucune mémoire enregistrée</div>';
    return;
  }
  list.innerHTML = state.globalMemories.slice(-12).reverse().map(m => `
    <div class="memory-item">
      <div class="content">${escapeHtml(m.content)}</div>
      <div class="actions"><button data-action="delete-memory" data-id="${m.id}">✕</button></div>
    </div>
  `).join('');
}
async function memoryDelete(id) {
  await db.delete('global_memory', id);
  state.globalMemories = state.globalMemories.filter(m => m.id !== id);
  renderMemoryList();
};

function copyMsg(ts) {
  const el = document.getElementById('mc-' + ts);
  if (!el) return;
  const text = el.innerText || el.textContent;
  navigator.clipboard.writeText(text).then(() => toast("Message copié !", "success")).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
    toast("Message copié !", "success");
  });
};

async function saveToMemory(ts) {
  const el = document.getElementById('mc-' + ts);
  if (!el) return;
  const text = (el.innerText || el.textContent).slice(0, 200);
  await memory.add(text);
  toast("Ajouté à la mémoire globale", "success");
};

// ════════════════════════════════════════
// EDIT / REGENERATE MESSAGES
// ════════════════════════════════════════
function editMessage(ts) {
  const tsNum = parseInt(ts);
  const idx = state.messages.findIndex(m => m.ts === tsNum);
  if (idx === -1) return;
  const msg = state.messages[idx];
  if (msg.role !== 'user') return;

  // Mettre le texte dans l'input
  const input = document.getElementById('user-input');
  input.value = msg.content;
  
  // Restaurer les fichiers attachés si présents
  if (msg.attachedFiles && msg.attachedFiles.length > 0) {
    state.attachedFiles = [...msg.attachedFiles];
    updateFilePreview();
  } else if (msg.documentName && msg.documentContext) {
    // Rétrocompatibilité
    let rawData = msg.documentContext.replace(`[CONTENU DU DOCUMENT "${msg.documentName}"]\n\n`, '').replace(`\n\n[FIN DU DOCUMENT]`, '');
    state.attachedFiles = [{ type: 'document', name: msg.documentName, data: rawData }];
    updateFilePreview();
  }

  autoResizeTextarea();
  input.focus();

  // Supprimer ce message et tous les suivants
  state.messages = state.messages.slice(0, idx);
  renderMessages(true);
  saveChat();
  toast("Message restauré — modifiez et renvoyez", "info");
}

async function regenerateMessage(ts) {
  if (state.isGenerating) return;
  const tsNum = parseInt(ts);
  const idx = state.messages.findIndex(m => m.ts === tsNum);
  if (idx === -1) return;
  const msg = state.messages[idx];
  if (msg.role !== 'assistant') return;

  // Trouver le dernier message user avant cette réponse
  let userIdx = idx - 1;
  while (userIdx >= 0 && state.messages[userIdx].role !== 'user') userIdx--;
  if (userIdx < 0) { toast("Aucun message utilisateur trouvé", "error"); return; }

  const userMsg = state.messages[userIdx];

  // Supprimer la réponse assistant (et tout ce qui suit)
  state.messages = state.messages.slice(0, idx);
  renderMessages(true);

  // Remettre le texte dans l'input et renvoyer
  document.getElementById('user-input').value = userMsg.content;

  // Restaurer les fichiers attachés si présents
  if (userMsg.attachedFiles && userMsg.attachedFiles.length > 0) {
    state.attachedFiles = [...userMsg.attachedFiles];
    updateFilePreview();
  } else if (userMsg.documentName && userMsg.documentContext) {
    // Rétrocompatibilité
    let rawData = userMsg.documentContext.replace(`[CONTENU DU DOCUMENT "${userMsg.documentName}"]\n\n`, '').replace(`\n\n[FIN DU DOCUMENT]`, '');
    state.attachedFiles = [{ type: 'document', name: userMsg.documentName, data: rawData }];
    updateFilePreview();
  }

  // Retirer aussi le message user pour que sendMessage le recrée
  state.messages = state.messages.slice(0, userIdx);
  renderMessages(true);
  await saveChat();

  // Envoyer
  sendMessage();
}

// ════════════════════════════════════════
// CHAT RENDERING
// ════════════════════════════════════════
function createMessageElement(m) {
  const div = document.createElement("div");
  div.className = `message ${m.role}`;
  const memTags = m.memoryUsed?.length ? `<span class="mem-tag">⬡ MEM×${m.memoryUsed.length}</span>` : '';
  const agentsTags = m.agentsConsulted?.length ? `<span class="mem-tag" style="background:rgba(0,255,157,0.1);color:var(--neon);border-color:rgba(0,255,157,0.3)" title="${m.agentsConsulted.join(', ')}">⚙ ${m.agentsConsulted.length} EXPERTS</span>` : '';
  const workflowTags = m.workflowUsed ? `<span class="mem-tag" style="background:rgba(0,255,157,0.15);color:var(--neon);border-color:rgba(0,255,157,0.4)">🔗 CHAÎNE : ${m.workflowUsed.toUpperCase()}</span>` : '';
  const label = m.role === 'user' ? '▸ VOUS' : `▸ ${
    state.selectedWorkflow ? state.selectedWorkflow.name.toUpperCase() :
    (state.agent && state.agent !== '__ALL_AGENTS__' ? state.agent.name.toUpperCase() :
    (state.agent === '__ALL_AGENTS__' ? 'TOUS LES AGENTS' :
    (state.aiConfig?.name?.toUpperCase() || 'Mon Assistant IA')))
  }`;
  const msgId = m.ts || Date.now();
  const wordBtn = m.role === 'assistant' ? `<button class="msg-action-btn" data-action="export-word" data-id="${msgId}" style="color:#4fc3f7;border-color:rgba(79,195,247,0.4)">${t('btn_word')}</button>` : '';
  const qpBtn = m.role === 'assistant' ? `<button class="msg-action-btn" data-action="export-qp-modal" data-id="${msgId}" style="color:var(--neon);border-color:rgba(0,255,157,0.3)">${t('btn_convert')}</button>` : '';
  const wqBtn = m.role === 'assistant' ? `<button class="msg-action-btn" data-action="test-web-quiz" data-id="${msgId}" style="color:#d4af37;border-color:rgba(212,175,55,0.4)">${t('btn_test_qcm')}</button>` : '';
  const ratingHtml = m.role === 'assistant' ? `<div class="msg-rating" aria-label="Évaluer la réponse"><span class="rating-label">${t('ui_quality')}</span>${[1,2,3,4,5].map(s => `<button class="rating-star${(m.rating||0)>=s?' active':''}" data-action="rate" data-id="${msgId}" data-score="${s}" title="Noter ${s}/5">★</button>`).join('')}</div>` : '';
  const imgHtml = m.imageData ? `<div class="msg-image"><img src="${m.imageData}" alt="Image jointe" loading="lazy"></div>` : '';
  const audioHtml = m.audioName ? `<div style="font-family:var(--font-mono);font-size:10px;color:var(--text-dim);margin-top:4px">🎵 ${m.audioName}</div>` : '';
  const docHtml = m.documentName ? `<div style="font-family:var(--font-mono);font-size:11px;color:var(--cyan);margin-top:4px;margin-bottom:8px;border:1px solid var(--hud-border);padding:4px 8px;border-radius:4px;display:inline-block;background:rgba(0,229,255,0.05)">${t('ui_attached_doc')} ${m.documentName}</div>` : '';
  
  let displayContent = m.content || '';
  if (m.role === 'assistant') {
    displayContent = displayContent.replace(/<brouillon>[\s\S]*?(?:<\/brouillon>|$)/gi, '').trim();
  }
  let finalContent = escapeHtml(displayContent).replace(/\n/g, '<br>');
  if (typeof marked !== 'undefined') {
    const rawHtml = m.role === 'user' ? escapeHtml(displayContent).replace(/\n/g, '<br>') : marked.parse(displayContent);
    finalContent = typeof DOMPurify !== 'undefined' ? DOMPurify.sanitize(rawHtml) : rawHtml;
  }

  div.innerHTML = `
    <div class="msg-label">${label}</div>
    ${imgHtml}${audioHtml}${docHtml}
    <div class="message-content msg-content" id="mc-${msgId}">${finalContent}</div>
    <div class="msg-meta">
      <span>${new Date(m.ts).toLocaleTimeString('fr-FR', {hour:'2-digit',minute:'2-digit',second:'2-digit'})}</span>
      ${memTags}
      ${agentsTags}
      ${workflowTags}
    </div>
    ${ratingHtml}
    <div class="msg-actions">
      <button class="msg-action-btn" data-action="copy-msg" data-id="${msgId}">${t('btn_copy')}</button>
      ${m.role === 'user' ? `<button class="msg-action-btn" data-action="edit-msg" data-id="${msgId}">${t('btn_edit')}</button>` : ''}
      ${m.role === 'assistant' ? `<button class="msg-action-btn" data-action="regen-msg" data-id="${msgId}">${t('btn_regen')}</button>` : ''}
      ${wordBtn}
      ${qpBtn}
      ${wqBtn}
    </div>`;
  return div;
}

function renderMessages(forceFull = false) {
  const c = $("#chat-container");
  const msgs = (state.messages || []).filter(m => m.role !== 'system');

  if (!msgs.length) {
    c.innerHTML = '';
    return;
  }

  if (c.querySelector('.welcome-banner')) {
    c.innerHTML = '';
  }

  const existingMessages = c.querySelectorAll('.message').length;

  if (forceFull || existingMessages > msgs.length || existingMessages === 0) {
    c.innerHTML = '';
    msgs.forEach(m => c.appendChild(createMessageElement(m)));
  } else {
    for (let i = existingMessages; i < msgs.length; i++) {
      c.appendChild(createMessageElement(msgs[i]));
    }
  }
  
  c.scrollTop = c.scrollHeight;
}

function showTyping() {
  const div = document.createElement("div");
  div.className = "typing-indicator";
  div.id = "typing-indicator";
  div.innerHTML = '<div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div><div id="orchestrator-status" style="margin-left:10px;font-family:var(--font-mono);font-size:11px;color:var(--cyan);opacity:0.8;display:flex;align-items:center;"></div>';
  $("#chat-container").appendChild(div);
  $("#chat-container").scrollTop = $("#chat-container").scrollHeight;
}
function hideTyping() {
  const t = $("#typing-indicator");
  if (t) t.remove();
}

/**
 * Gère la lecture du flux (SSE) provenant de l'API Mistral
 */
async function handleStreamingResponse(response, onChunk, onFinish, signal) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullContent = "";
  let aborted = false;

  // Écouter l'abort pour fermer le reader
  if (signal) {
    signal.addEventListener('abort', () => {
      aborted = true;
      reader.cancel().catch(() => {});
    }, { once: true });
  }

  try {
    while (true) {
      if (aborted) break;
      const { done, value } = await reader.read();
      if (done) break;
      
      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split("\n");
      
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const dataStr = line.slice(6).trim();
          if (dataStr === "[DONE]") continue;
          
          try {
            const data = JSON.parse(dataStr);
            const delta = data.choices?.[0]?.delta?.content || "";
            if (delta) {
              fullContent += delta;
              onChunk(fullContent);
            }
          } catch (e) {
            // Ignorer les fragments JSON partiels
          }
        }
      }
    }
  } catch(e) {
    if (e.name === 'AbortError' || aborted) {
      // Arrêt volontaire — on garde le contenu partiel
    } else {
      throw e;
    }
  } finally {
    try { reader.releaseLock(); } catch(e) {}
  }
  onFinish(fullContent);
  return fullContent;
}

function updateLiveMessage(content) {
  const lastMsg = state.messages[state.messages.length - 1];
  if (lastMsg && lastMsg.role === 'assistant') {
    lastMsg.content = content;
    const container = $("#chat-container");
    const lastEl = container.lastElementChild;
    if (lastEl && lastEl.classList.contains('assistant')) {
      const contentEl = lastEl.querySelector('.message-content');
      if (contentEl) {
        const displayContent = (content || '').replace(/<brouillon>[\s\S]*?(?:<\/brouillon>|$)/gi, '').trim();
        const rawHtml = marked.parse(displayContent);
        contentEl.innerHTML = typeof DOMPurify !== 'undefined' ? DOMPurify.sanitize(rawHtml) : rawHtml;
      }
    }
    container.scrollTop = container.scrollHeight;
  }
}

// ════════════════════════════════════════
// SYSTEM PROMPT
// ════════════════════════════════════════
function buildSystemPrompt() {
  const aiName = state.aiConfig?.name || 'Mon Assistant IA';
  let prompt = `You are ${aiName}, a powerful AI assistant. Be precise, professional, and helpful.`;
  const isRealAgent = state.agent && state.agent !== '__ALL_AGENTS__';
  if (isRealAgent) {
    prompt = `[AGENT ${aiName} : ${state.agent.name}]\n`;
    prompt += `Rôle : ${state.agent.desc || ''}`;
    if (state.agent.instructions) prompt += `\n\nInstructions : ${state.agent.instructions}`;
    if (state.agent.primer) prompt += `\n\nContexte initial : ${state.agent.primer}`;
    if (state.agent.style) {
      const styleMap = {concis:'Réponds de manière concise et directe.',detaille:'Réponds de manière exhaustive et détaillée.',formel:'Maintiens un ton formel et professionnel.',creatif:'Sois créatif et innovant dans tes réponses.',pedagogique:'Adopte une approche pédagogique et claire.'};
      if (styleMap[state.agent.style]) prompt += `\n\nStyle : ${styleMap[state.agent.style]}`;
    }
    if (state.agent.forbidden) prompt += `\n\nINTERDIT DE : ${state.agent.forbidden}`;
  }
  const memPrio = isRealAgent ? (state.agent?.memPrio || 3) : 3;
  const memLimit = Math.min(memPrio * 2, 8);
  const rel = memory.getRelevant("context", memLimit);
  if (rel.length) prompt += `\n\n[MÉMOIRE GLOBALE ACTIVE]\n${rel.join('\n')}`;

  // ── Injection des leçons d'apprentissage (agent direct) ──
  if (isRealAgent && state.agent.id && state._agentLessonsCache) {
    prompt += state._agentLessonsCache;
  }

  prompt += "\n\nRéponds dans la langue de l'utilisateur. Sois précis, structuré et professionnel.";
  return prompt;
}

function updateContextMeter() {
  try {
    const msgs = (state.messages||[]).slice(-22);
    const totalChars = msgs.reduce((s,m) => s + (m.content||'').length, 0);
    const model = MODELS.find(m => m.id === state.model);
    const maxCtx = (model?.tokens || 50000) * 4; // rough chars
    const pct = Math.min(100, Math.round((totalChars / maxCtx) * 100));
    const bar = document.getElementById('context-bar');
    const label = document.getElementById('context-label');
    if (bar && label) {
      bar.style.width = pct + '%';
      bar.className = 'context-bar-fill' + (pct > 80 ? ' danger' : pct > 60 ? ' warn' : '');
      label.textContent = pct + '%';
    }
  } catch(e) {}
}

function estimateTokens(text) {
  // Approximation standard : 1 token ≈ 4 caractères (latins), ≈2 chars (CJK)
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

function updateTokenCounter() {
  const el = document.getElementById('token-counter');
  if (!el) return;
  const input = document.getElementById('user-input');
  const inputText = input?.value || '';
  const inputTokens = estimateTokens(inputText);

  // Contexte = messages récents + system prompt
  const contextMsgs = (state.messages||[]).slice(-22);
  const contextChars = contextMsgs.reduce((s,m) => s + (m.content||'').length, 0);
  const contextTokens = estimateTokens(Array(contextChars).fill('a').join(''));

  // Document attaché
  const docTokens = state.attachedFiles.filter(f => f.type === 'document').reduce((sum, f) => sum + estimateTokens(f.data || ''), 0);

  const totalTokens = inputTokens + contextTokens + docTokens;
  const model = MODELS.find(m => m.id === state.model);
  const maxTokens = model?.tokens || 32000;
  const pct = Math.round((totalTokens / maxTokens) * 100);

  if (inputTokens === 0 && docTokens === 0) {
    el.style.display = 'none';
    return;
  }

  el.style.display = 'flex';
  const warnClass = pct > 80 ? 'token-danger' : pct > 60 ? 'token-warn' : '';
  el.className = `token-counter ${warnClass}`;
  el.innerHTML = `<span>◨ ~${totalTokens.toLocaleString()} tokens</span><span>${pct}% du contexte${docTokens ? ` (doc: ~${docTokens.toLocaleString()})` : ''}</span>`;
}

// ════════════════════════════════════════
// ARCHIVES
// ════════════════════════════════════════
let archivesSearchQuery = "";

async function renderArchives() {
  const list = $("#archives-list");
  if (!list) return;
  try {
    let chats;
    if (archivesSearchQuery) {
      // Chargement complet si on cherche dans le contenu
      chats = await db.getAll('chats') || [];
    } else {
      // Chargement ultra-leger par defaut
      chats = await db.getChatsMetadata() || [];
    }
    chats = chats.sort((a, b) => (b.updated||0) - (a.updated||0));
    if (archivesSearchQuery) {
      const q = archivesSearchQuery.toLowerCase();
      chats = chats.filter(c => (c.title||"").toLowerCase().includes(q) ||
        (c.messages||[]).some(m => (m.content||"").toLowerCase().includes(q)));
    }
    if (!chats.length) {
      list.innerHTML = '<div class="archive-empty">Aucune conversation trouvée</div>';
      return;
    }
    list.innerHTML = chats.map(c => {
      const isActive = c.id === state.chatId;
      const isFav = c.fav ? true : false;
      const msgCount = c.msgCount !== undefined ? c.msgCount : (c.messages||[]).filter(m=>m.role!=='system').length;
      const date = c.updated ? new Date(c.updated).toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}) : '';
      return `<div class="archive-item${isActive?' active-chat':''}" data-action="load-chat" data-id="${c.id}">
        <span class="archive-item-icon">${isFav?'★':'◈'}</span>
        <div class="archive-item-content">
          <div class="archive-item-title">${escapeHtml(c.title||'Sans titre')}</div>
          <div class="archive-item-meta">
            <span>${msgCount} msg</span>
            <span>${date}</span>
          </div>
        </div>
        <button class="archive-fav-btn${isFav?' fav':''}" data-action="toggle-fav" data-id="${c.id}" title="${isFav?'Retirer favoris':'Ajouter favoris'}">${isFav?'★':'☆'}</button>
        <button class="archive-item-del" data-action="delete-chat" data-id="${c.id}" title="Supprimer">✕</button>
      </div>`;
    }).join('');
  } catch(e) { list.innerHTML = '<div class="archive-empty">Erreur de chargement</div>'; }
}

// closeArchivesPanel - accessible globalement
function closeArchivesPanel() {
  const panel = document.getElementById('archives-panel');
  if (panel) panel.classList.remove('active');
}

async function loadArchiveChat(id) {
  await loadChat(id);
  closeArchivesPanel();
  await renderArchives();
  toast("Conversation chargée", "success");
};

async function deleteArchiveChat(id) {
  if (!confirm("Supprimer cette conversation ?")) return;
  await db.delete('chats', id);
  if (state.chatId === id) await newChat();
  await renderArchives();
  toast("Conversation supprimée", "success");
};

async function toggleFav(id) {
  try {
    const chat = await db.get('chats', id);
    if (!chat) return;
    chat.fav = !chat.fav;
    await db.put('chats', chat);
    await renderArchives();
  } catch(e) {}
};

// ════════════════════════════════════════
// SAVE / LOAD CHAT
// ════════════════════════════════════════
async function saveChat() {
  if (!state.chatId) return;
  try {
    const existingChat = await db.get('chats', state.chatId).catch(() => null);
    await db.put('chats', {
      id: state.chatId,
      model: state.model,
      agentId: state.agent?.id,
      messages: state.messages,
      title: (state.messages||[]).slice(1).find(m=>m.role==='user')?.content?.slice(0,50) || "Nouvelle conversation",
      updated: now(),
      fav: existingChat?.fav || false
    });
    renderArchives();
  } catch(e) { console.error("saveChat:", e); }
}

async function newChat() {
  state.chatId = uuid();
  state.messages = [{ role:"system", content:buildSystemPrompt(), ts:now() }];
  await saveChat();
  try { await db.put('settings', { id:'currentChatId', value:state.chatId }); } catch(e) {}
  renderMessages();
}

async function loadChat(id) {
  try {
    const chat = await db.get('chats', id);
    if (!chat) return;
    state.chatId = id;
    state.messages = chat.messages || [];
    state.model = chat.model || state.model;
    $("#model-select").value = state.model;
    if (chat.agentId) {
      try {
        const ag = await db.get('agents', chat.agentId);
        if (ag) { 
          state.agent = ag; 
          $("#agent-select").value = ag.id; 
          // Load lessons for the restored agent
          try {
            const lessons = await agentFeedback.getForAgent(ag.id, 8);
            state._agentLessonsCache = agentFeedback.buildLessonsPrompt(lessons);
          } catch(e) { state._agentLessonsCache = ''; }
        }
      } catch(e) {}
    }
    renderMessages(true);
  } catch(e) { console.error("loadChat:", e); }
}

// ════════════════════════════════════════
// SEND MESSAGE
// ════════════════════════════════════════
async function _sendMessageOriginal() {
  const txt = $("#user-input").value.trim();
  if (!txt) return;
  if (!state.apiKey) {
    toast("Configurez votre clé API d'abord", "error");
    $("#api-modal").classList.add("active");
    return;
  }

  let userText = txt;
  const isQcmAgent = state.agent && (
    state.agent.name.toLowerCase().includes('qcm') || 
    state.agent.id.toLowerCase().includes('qcm') || 
    (state.agent.tags && state.agent.tags.some(t => t.toLowerCase().includes('qcm')))
  );

  if (isQcmAgent || txt.toLowerCase().includes('qcm')) {
    // ── Génération des séquences QCM (post-processing JS) ──
    window.__qcmSequences = [generateQcmSequenceArray(15), generateQcmSequenceArray(15)];
    userText += `\n\n[INSTRUCTION SYSTÈME DYNAMIQUE INVISIBLE] RÈGLE ABSOLUE pour le placement de la bonne réponse :
Tu DOIS TOUJOURS placer la bonne réponse en position a- avec le marqueur [x].
Le format OBLIGATOIRE pour CHAQUE question est :
[numéro]- Énoncé ?
[x] a- LA BONNE RÉPONSE ICI (TOUJOURS en a-)
b- Distracteur 1
c- Distracteur 2
d- Distracteur 3
Le système se chargera automatiquement de mélanger les positions. Toi, tu mets TOUJOURS [x] a- pour la bonne réponse.`;
  }
  const msgObj = { role:"user", content:userText, ts:now() };
  if (state.attachedFiles && state.attachedFiles.length > 0) {
     const docs = state.attachedFiles.filter(f => f.type === 'document');
     if (docs.length > 0) {
       msgObj.documentContext = docs.map(f => `[CONTENU DU DOCUMENT "${f.name}"]\n\n${f.data}\n\n[FIN DU DOCUMENT]`).join('\n\n');
       msgObj.documentName = docs.map(f => f.name).join(', ');
     }
     msgObj.attachedFiles = [...state.attachedFiles];
     clearAttachedFile();
  }
  state.messages.push(msgObj);
  renderMessages();
  $("#user-input").value = "";
  autoResizeTextarea();
  state.isGenerating = true;
  state.abortController = new AbortController();
  $("#send-btn").disabled = false;
  $("#send-btn").className = 'stop-btn';
  $("#send-btn").innerHTML = '⏹ ARRÊTER';
  showTyping();
  await saveChat();

  const relevantMems = memory.getRelevant(txt, 4);

  // Préparer le message de l'assistant vide pour le streaming
  const assistantMsgId = now();
  state.messages.push({ role: "assistant", content: "", ts: assistantMsgId, memoryUsed: relevantMems.length ? relevantMems : undefined });
  renderMessages();

  try {
    // slice(0,-1) exclut le message assistant vide ajouté pour le streaming
    const contextMessages = [
      { role:"system", content:buildSystemPrompt() },
      ...(state.messages||[]).slice(0, -1).filter(m => m.role !== 'system').slice(-22).map(m => {
        let contentStr = m.content;
        if (m.documentContext) {
           contentStr = `${m.documentContext}\n\n${m.content || "Analyse le document fourni."}`;
        }
        return { role: m.role, content: contentStr };
      })
    ];
    if (relevantMems.length) {
      contextMessages.splice(1, 0, {
        role:"user",
        content:`[Contexte depuis la mémoire globale]\n${relevantMems.join('\n')}\n\nContinuez la conversation :`
      });
    }

    // ── RAPPEL FORT DES LEÇONS (Biais de Récence) ──
    const isRealAgent = state.agent && state.agent !== '__ALL_AGENTS__';
    if (isRealAgent && state._agentLessonsCache) {
      const lastUserMsg = contextMessages.findLast(m => m.role === 'user');
      if (lastUserMsg) {
        lastUserMsg.content += `\n\n[RAPPEL CRITIQUE - LIS CECI AVANT DE RÉPONDRE]\n${state._agentLessonsCache}`;
      }
    }

    const activeModelId = (isRealAgent && state.agent.modelPref && state.agent.modelPref !== '') ? state.agent.modelPref : state.model;
    const model = MODELS.find(m => m.id === activeModelId) || MODELS[0];

    updateContextMeter();
    const agentTemp = (isRealAgent && state.agent.temperature !== undefined) ? state.agent.temperature : model.temp;
    const agentMaxTok = (isRealAgent && state.agent.maxTokens) ? state.agent.maxTokens : 8192;

    // ════════════════════════════════════════
    // ORCHESTRATION MULTI-AGENTS (uniquement si activée)
    // ════════════════════════════════════════
    const orchestrationMode = state.agent === '__ALL_AGENTS__';
    const allAgents = orchestrationMode ? (await db.getAll('agents') || []) : [];

    if (orchestrationMode && allAgents.length > 0) {
      // ── PHASE 1 : Consultation de TOUS les agents en parallèle ──
      const statusEl = document.getElementById("orchestrator-status");
      if (statusEl) statusEl.textContent = `⚙ Consultation de ${allAgents.length} experts…`;

      const recentContext = (state.messages || []).slice(0, -1).filter(m => m.role !== 'system').slice(-6);

      // On lance les appels par lots de 3 pour ne pas surcharger l'API
      const BATCH_SIZE = 3;
      const expertResults = [];

      for (let i = 0; i < allAgents.length; i += BATCH_SIZE) {
        const batch = allAgents.slice(i, i + BATCH_SIZE);

        // Mise à jour visuelle : afficher les noms des agents en cours
        if (statusEl) {
          const names = batch.map(a => a.name).join(', ');
          statusEl.textContent = `⚙ ${names}… (${Math.min(i + BATCH_SIZE, allAgents.length)}/${allAgents.length})`;
        }

        const batchPromises = batch.map(agent => callSubAgentDirect(agent, txt, recentContext));
        const batchResults = await Promise.allSettled(batchPromises);

        batchResults.forEach((result, idx) => {
          const agent = batch[idx];
          const response = result.status === 'fulfilled' ? result.value : `[Erreur : ${result.reason}]`;
          // On ne garde que les réponses substantielles (pas les erreurs vides)
          if (response && response.length > 10 && !response.startsWith('Erreur')) {
            expertResults.push({ name: agent.name, desc: agent.desc, response });
          }
        });
      }

      // Mise à jour du message avec les agents consultés
      const lastMsg = state.messages[state.messages.length - 1];
      lastMsg.agentsConsulted = expertResults.map(r => r.name);

      // ── PHASE 2 : Synthèse par l'agent principal (Streamée) ──
      if (statusEl) statusEl.textContent = `✦ Synthèse de ${expertResults.length} expertises…`;

      const aiName = state.aiConfig?.name || 'Mon Assistant IA';
      const expertBlock = expertResults.map((r, i) => `━━━ EXPERT ${i+1} : ${r.name} ━━━\n${r.response}`).join('\n\n');

      const synthesisMessages = [
        { role: "system", content: `Tu es ${aiName}. Synthétise les réponses de tes experts en une réponse unique et parfaite. Ne mentionne pas les experts.` },
        { role: "user", content: `Question : "${txt}"\n\nRéponses experts :\n${expertBlock}` }
      ];

      const res = await fetchWithRetry("https://api.mistral.ai/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${state.apiKey}`, "Content-Type": "application/json" },
        signal: state.abortController?.signal,
        body: JSON.stringify({
          model: activeModelId || state.model,
          messages: synthesisMessages,
          temperature: agentTemp,
          max_tokens: agentMaxTok,
          stream: true,
          top_p: 0.95
        })
      });

      if (!res.ok) {
        const err = await res.text();
        let errMsg = err.slice(0, 300);
        try { const j = JSON.parse(err); errMsg = j.message || j.error?.message || errMsg; } catch(e) {}
        throw new Error(errMsg);
      }

      await handleStreamingResponse(res, updateLiveMessage, () => {}, state.abortController?.signal);
      
      const finalMsg = state.messages[state.messages.length - 1];
      if (finalMsg && finalMsg.role === 'assistant' && finalMsg.content.match(/\[EXPORT_WORD\]/i)) {
        finalMsg.content = finalMsg.content.replace(/\[EXPORT_WORD\]/ig, '').trim();
        exportToWord(finalMsg.content, `Export_Synthesis_${Date.now()}.doc`);
        finalMsg.content += "\n\n*(📄 Fichier Word généré automatiquement)*";
      }
      // Restore QCM shuffle to guarantee randomness
      if (finalMsg && finalMsg.role === 'assistant' && finalMsg.content) {
        const seq = generateQcmSequenceArray();
        finalMsg.content = shuffleQcmOptions(finalMsg.content, seq);
      }

      hideTyping();
      await saveChat();
    } else {
      const res = await fetchWithRetry("https://api.mistral.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${state.apiKey}`,
          "Content-Type": "application/json"
        },
        signal: state.abortController?.signal,
        body: JSON.stringify({
          model: activeModelId || state.model,
          messages: contextMessages,
          temperature: agentTemp,
          max_tokens: agentMaxTok,
          stream: true,
          top_p: 0.95
        })
      });

      if (!res.ok) {
        const err = await res.text();
        let errMsg = err.slice(0, 300);
        try { const j = JSON.parse(err); errMsg = j.message || j.error?.message || errMsg; } catch(e) {}
        throw new Error(errMsg);
      }

      await handleStreamingResponse(res, updateLiveMessage, () => {}, state.abortController?.signal);
      
      const lastMsg = state.messages[state.messages.length - 1];
      if (lastMsg && lastMsg.role === 'assistant' && lastMsg.content.match(/\[EXPORT_WORD\]/i)) {
        lastMsg.content = lastMsg.content.replace(/\[EXPORT_WORD\]/ig, '').trim();
        exportToWord(lastMsg.content, `Export_Agent_${Date.now()}.doc`);
        lastMsg.content += "\n\n*(📄 Fichier Word généré automatiquement)*";
      }
      // Restore QCM shuffle to guarantee randomness
      if (lastMsg && lastMsg.role === 'assistant' && lastMsg.content) {
        const seq = generateQcmSequenceArray();
        lastMsg.content = shuffleQcmOptions(lastMsg.content, seq);
      }

      hideTyping();
      await saveChat();
    }
  } catch (e) {
    if (e.name === 'AbortError') {
      // Génération stoppée par l'utilisateur — on garde le contenu partiel
      hideTyping();
      const lastMsg = state.messages[state.messages.length - 1];
      if (lastMsg && lastMsg.role === 'assistant' && lastMsg.content) {
        lastMsg.content += '\n\n*— Génération interrompue —*';
      } else if (lastMsg && lastMsg.role === 'assistant') {
        lastMsg.content = '*— Génération interrompue —*';
      }
      renderMessages(true);
      await saveChat();
      toast("Génération stoppée", "info");
    } else {
      let errMsg = e.message?.slice(0, 300) || String(e);
      hideTyping();
      toast(`Erreur API : ${errMsg}`, "error");
      state.messages[state.messages.length - 1].content = `⚠ Requête échouée : ${errMsg}`;
      renderMessages();
    }
  } finally {
    state.isGenerating = false;
    state.abortController = null;
    $("#send-btn").disabled = false;
    $("#send-btn").className = '';
    $("#send-btn").innerHTML = "ENVOYER ▶";
  }
}

// Fonction pour interroger un agent spécifique en arrière-plan (version directe avec objet agent)
async function callSubAgentDirect(agent, userQuestion, recentMessages, abortSignal = null, onChunk = null) {
  let systemPrompt = `Tu es l'agent expert : ${agent.name}.\nRôle : ${agent.desc || 'Assistance experte'}\n`;
  systemPrompt += `Réponds toujours dans la langue de l'utilisateur.\n`;
  if (agent.primer) systemPrompt += `\nContexte initial : ${agent.primer}\n`;
  if (agent.forbidden) systemPrompt += `\nINTERDIT DE : ${agent.forbidden}\n`;
  if (agent.instructions) {
    systemPrompt += `\nINSTRUCTIONS STRICTES À SUIVRE À LA LETTRE :\n${agent.instructions}\n`;
  }

  // ── Injection des leçons d'apprentissage ──
  try {
    const lessons = await agentFeedback.getForAgent(agent.id, 8);
    const lessonsBlock = agentFeedback.buildLessonsPrompt(lessons);
    if (lessonsBlock) systemPrompt += lessonsBlock;
  } catch(e) { /* silently ignore if feedback DB not ready */ }

  const historyContext = recentMessages
    .filter(m => m.content && m.content.length > 0)
    .slice(-4)
    .map(m => `${m.role === 'user' ? 'Utilisateur' : 'IA'}: ${(m.content || '').slice(0, 300)}`)
    .join('\n');

  let prompt = "";
  if (historyContext) {
    prompt += `[Historique récent]\n${historyContext}\n\n`;
  }
  prompt += userQuestion;

  // Injection forcée à la toute fin (biais de récence)
  try {
    const lessons = await agentFeedback.getForAgent(agent.id, 8);
    const lessonsBlock = agentFeedback.buildLessonsPrompt(lessons);
    if (lessonsBlock) prompt += `\n\n[RAPPEL CRITIQUE - LIS CECI AVANT DE RÉPONDRE]\n${lessonsBlock}`;
  } catch(e) {}

  const modelId = (agent.modelPref && agent.modelPref !== '') ? agent.modelPref : "mistral-large-2512";
  const temp = agent.temperature !== undefined ? agent.temperature : 0.4;
  const maxTok = agent.maxTokens || 8192; // Autoriser des réponses longues

  const reqBody = {
    model: modelId,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: prompt }
    ],
    temperature: temp,
    max_tokens: maxTok
  };

  if (onChunk) {
    reqBody.stream = true;
  }

  const res = await fetchWithRetry("https://api.mistral.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${state.apiKey}`,
      "Content-Type": "application/json"
    },
    signal: abortSignal,
    body: JSON.stringify(reqBody)
  });

  if (!res.ok) throw new Error(`API ${res.status}`);

  if (onChunk) {
    let finalResult = "";
    await handleStreamingResponse(res, (chunk) => {
      finalResult = chunk;
      onChunk(chunk);
    }, () => {}, abortSignal);
    return finalResult;
  } else {
    const data = await res.json();
    return data.choices?.[0]?.message?.content || "";
  }
}

// ════════════════════════════════════════
// WORKFLOW EXECUTION ENGINE (CHAÎNE SÉQUENTIELLE)
// ════════════════════════════════════════
async function executeWorkflow(userQuestion, workflow) {
  const recentContext = (state.messages || []).filter(m => m.role !== 'system').slice(-6);

  // ── Extraire l'instruction dynamique (séquences QCM) de l'input utilisateur ──
  const dynMatch = userQuestion.match(/\[INSTRUCTION SYSTÈME DYNAMIQUE INVISIBLE\][\s\S]*/);
  const dynamicInstruction = dynMatch ? '\n\n' + dynMatch[0] : '';
  const cleanUserQuestion = userQuestion.replace(/\[INSTRUCTION SYSTÈME DYNAMIQUE INVISIBLE\][\s\S]*/, '').trim();

  let currentInput = cleanUserQuestion;
  let fullContext = `Requête initiale : ${cleanUserQuestion}\n\n`;
  const stepResults = []; // {agentName, result, stepIndex}

  // ── Charger les leçons de la chaîne ──
  let workflowLessons = '';
  try {
    const wfFeedbacks = await agentFeedback.getForWorkflow(workflow.name, 8);
    workflowLessons = agentFeedback.buildLessonsPrompt(wfFeedbacks);
  } catch(e) { /* ignore */ }

  let jumpCount = 0;
  const MAX_JUMPS = 10;

  for (let i = 0; i < workflow.steps.length; i++) {
    // Check for abort
    if (state.abortController?.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    const step = workflow.steps[i];
    let agent;
    try {
      agent = await db.get('agents', step.agentId);
    } catch(e) {
      agent = null;
    }

    if (!agent) {
      const errMsg = `Agent introuvable pour l'étape ${i + 1}`;
      stepResults.push({ agentName: '???', result: errMsg, stepIndex: i });
      toast(errMsg, "error");
      continue;
    }

    // ── Update typing indicator with progress ──
    const statusEl = document.getElementById("orchestrator-status");
    if (statusEl) {
      statusEl.innerHTML = `<span style="color:var(--neon)">🔗</span> Étape ${i + 1}/${workflow.steps.length} : <strong>${agent.name}</strong>…`;
    }

    // ── Build prompt for THIS agent ──
    let stepPrompt;
    if (step.instructionCustom && (step.instructionCustom.includes('{input}') || step.instructionCustom.includes('{initial}'))) {
      // Mode Templating Dynamique
      stepPrompt = step.instructionCustom
        .replace(/\{input\}/g, i === 0 ? cleanUserQuestion : currentInput)
        .replace(/\{initial\}/g, cleanUserQuestion);
    } else {
      // Mode Standard
      if (i === 0) {
        stepPrompt = cleanUserQuestion;
        if (step.instructionCustom) {
          stepPrompt = `${step.instructionCustom}\n\nContenu à traiter :\n"""\n${cleanUserQuestion}\n"""`;
        }
      } else {
        stepPrompt = `Voici le travail de l'étape précédente :\n"""\n${currentInput}\n"""\n\n`;
        if (step.instructionCustom) {
          stepPrompt += `Ton instruction spécifique : ${step.instructionCustom}`;
        } else {
          stepPrompt += `Continue le travail selon ton rôle et ton expertise.`;
        }
      }
    }

    // ── Inject workflow-level lessons into every step ──
    if (workflowLessons) {
      stepPrompt += `\n${workflowLessons}`;
    }

    // ── Inject dynamic instruction (séquences) ──
    if (dynamicInstruction) {
      stepPrompt += dynamicInstruction;
    }

    // ── Call the agent ──
    try {
      let finalOutputPrefix = `### 🔗 RAPPORT DE CHAÎNE : ${workflow.name}\n\n`;
      stepResults.forEach(r => {
        finalOutputPrefix += `#### ◈ Étape ${r.stepIndex + 1} : ${r.agentName}\n${r.result}\n\n---\n\n`;
      });
      let currentStepTitle = `#### ◈ Étape ${i + 1} : ${agent.name}\n`;

      let result = await callSubAgentDirect(agent, stepPrompt, recentContext, state.abortController?.signal, (chunk) => {
        let displayChunk = chunk.replace(/\[STOP\]/ig, '').replace(/\[GOTO:\d+\]/ig, '').replace(/\[EXPORT_WORD\]/ig, '');
        updateLiveMessage(finalOutputPrefix + currentStepTitle + displayChunk);
      });
      
      const currentStepDisplay = i + 1;
      let branchMsg = "";
      let stopChain = false;
      const gotoMatch = result.match(/\[GOTO:(\d+)\]/i);
      
      if (result.match(/\[STOP\]/i)) {
        stopChain = true;
        result = result.replace(/\[STOP\]/ig, '').trim();
        branchMsg = "\n\n*([STOP] Chaîne arrêtée par cet agent)*";
      } else if (gotoMatch) {
        jumpCount++;
        if (jumpCount > MAX_JUMPS) {
          result = result.replace(/\[GOTO:\d+\]/ig, '').trim();
          branchMsg = "\n\n*(⚠️ڈ [GOTO] ignoré : Limite de sauts atteinte pour prévenir une boucle infinie)*";
        } else {
          const targetStep = parseInt(gotoMatch[1], 10);
          result = result.replace(/\[GOTO:\d+\]/ig, '').trim();
          if (targetStep > 0 && targetStep <= workflow.steps.length) {
            i = targetStep - 2; // -1 for 0-index, -1 because loop does i++
            branchMsg = `\n\n*(Branchement vers l'étape ${targetStep} - Saut ${jumpCount}/${MAX_JUMPS})*`;
          }
        }
      }

      if (result.match(/\[EXPORT_WORD\]/i)) {
        result = result.replace(/\[EXPORT_WORD\]/ig, '').trim();
        exportToWord(result, `Export_Workflow_${Date.now()}.doc`);
        branchMsg += "\n\n*(📄 Fichier Word généré automatiquement)*";
      }

      currentInput = result;
      fullContext += `--- Résultat Étape ${currentStepDisplay} (${agent.name}) ---\n${result}\n\n`;
      stepResults.push({ agentName: agent.name, result: result + branchMsg, displayStep: currentStepDisplay });
      
      if (stopChain) break;

    } catch(e) {
      if (e.name === 'AbortError') throw e;
      const errMsg = `Erreur à l'étape ${i + 1} (${agent.name}) : ${e.message?.slice(0, 150) || e}`;
      stepResults.push({ agentName: agent.name, result: errMsg, displayStep: i + 1 });
      currentInput = errMsg;
      toast(errMsg, "error");
    }
  }

  // ── Build final accordion content ──
  let finalResult = currentInput || '';
  let accordionHtml = '';

  if (stepResults.length > 1) {
    accordionHtml = `\n\n---\n\n<details>\n<summary>🔗 Détail du parcours (${stepResults.length} exécutions)</summary>\n\n`;
    stepResults.forEach((s, idx) => {
      const isLast = idx === stepResults.length - 1;
      accordionHtml += `**Étape ${s.displayStep} — ${s.agentName}** ${isLast ? '(résultat final)' : ''}\n\n${s.result}\n\n${!isLast ? '---\n\n' : ''}`;
    });
    accordionHtml += `</details>`;
  }
  // Clean up any stray LLM comments at the end of multiple-choice options
  if (typeof finalResult === 'string') {
    finalResult = finalResult.replace(/(^(\[x\]\s*)?[a-d]-.*?)(\s*\(\s*(?:E[1-4]\s*:|erreur|car |Bonne).*?\)\s*)$/gmi, '$1');
  }

  // ══════════════════════════════════════════════════════════════
  // POST-PROCESSING : Restore QCM shuffle to guarantee randomness
  // ══════════════════════════════════════════════════════════════
  if (typeof finalResult === 'string') {
    const seq = generateQcmSequenceArray();
    finalResult = shuffleQcmOptions(finalResult, seq);
  }

  // The final message content: last agent's result + accordion
  const displayContent = stepResults.length > 1
    ? `**🔗 Résultat de la chaîne "${workflow.name}"** (${stepResults.length} étapes)\n\n${finalResult}${accordionHtml}`
    : finalResult;

  return { displayContent, stepResults, finalResult };
}


async function loadAgents() {
  try {
    const agents = await db.getAll('agents') || [];
    window.__allAgents = agents; // FIX: Exposer tous les agents pour l'éditeur de chaînes
    const workflows = await db.getAll('workflows') || [];
    
    const orderMap = {
      "QCM-Fr 1": 1,
      "QCM-Fr 2": 2,
      "QCM-Ar 1": 3,
      "QCM-Ar2": 4,
      "VRAI/FAUX": 5,
      "AUDIT": 6
    };
    workflows.sort((a, b) => {
      const orderA = orderMap[a.name] || 99;
      const orderB = orderMap[b.name] || 99;
      return orderA - orderB;
    });

    const sel = $("#agent-select");

    // Build select with optgroups
    sel.innerHTML = '<option value="">▸ AUCUN AGENT</option>';

    // Gather agent IDs used in workflows
    const workflowAgentIds = new Set();
    workflows.forEach(w => {
      (w.steps || []).forEach(s => {
        if (s.agentId) workflowAgentIds.add(s.agentId);
      });
    });

    // ── Agents optgroup ──
    const mainAgents = agents.filter(a => !workflowAgentIds.has(a.id));
    /* Les agents individuels sont masqués du menu déroulant principal selon la demande
    if (mainAgents.length) {
      const agGroup = document.createElement("optgroup");
      agGroup.label = "⚙ AGENTS";
      mainAgents.forEach(a => {
        const opt = document.createElement("option");
        opt.value = a.id;
        opt.textContent = `◈ ${a.name}`;
        opt.title = a.desc;
        agGroup.appendChild(opt);
      });
      sel.appendChild(agGroup);
    }
    */

    // ── Workflows optgroup ──
    if (workflows.length) {
      const wfGroup = document.createElement("optgroup");
      wfGroup.label = "🔗 WORKFLOWS (CHAÎNES)";
      workflows.forEach(w => {
        const opt = document.createElement("option");
        opt.value = `__WF__${w.id}`;
        opt.textContent = `🔗 ${w.name} (${(w.steps||[]).length} étapes)`;
        opt.title = w.desc || '';
        wfGroup.appendChild(opt);
      });
      sel.appendChild(wfGroup);
    }

    // Existing agents in modal (hide workflow-internal agents)
    const list = $("#agent-existing-list");
    if (list) {
      if (!mainAgents.length) {
        list.innerHTML = '';
        return;
      }
      list.innerHTML = `
        <div style="font-family:var(--font-mono);font-size:10px;letter-spacing:2px;color:var(--text-dim);margin-bottom:10px">AGENTS STANDALONE (${mainAgents.length})</div>
        ${mainAgents.map(a => `
          <div class="agent-preview" data-action="activate-agent" data-id="${a.id}">
            <div style="flex:1;min-width:0">
              <div class="agent-preview-name">◈ ${escapeHtml(a.name)} <span class="agent-lessons-badge" data-action="manage-lessons" data-id="${a.id}" data-agent-lessons="${a.id}" title="Leçons d'apprentissage">🧠 ...</span></div>
              <div class="agent-preview-desc">${escapeHtml((a.desc||'').slice(0,80))}${(a.desc||'').length>80?'…':''}</div>
            </div>
            <div class="agent-card-actions">
              <button class="agent-action-btn" data-action="edit-agent" data-id="${a.id}" title="Modifier">✎</button>
              <button class="agent-action-btn" data-action="duplicate-agent" data-id="${a.id}" title="Dupliquer">⎘</button>
              <button class="agent-action-btn" data-action="export-agent" data-id="${a.id}" title="Exporter">⬇</button>
              <button class="agent-action-btn danger" data-action="delete-agent" data-id="${a.id}" title="Supprimer">✕</button>
            </div>
          </div>
        `).join('')}
      `;
      // Load lesson counts asynchronously
      mainAgents.forEach(async a => {
        try {
          const count = await agentFeedback.getCountForAgent(a.id);
          const badge = document.querySelector(`[data-agent-lessons="${a.id}"]`);
          if (badge) {
            badge.textContent = count > 0 ? `🧠 ${count}` : '🧠 0';
            if (count > 0) badge.classList.add('has-lessons');
          }
        } catch(e) {}
      });
    }
    
    // Auto-sélectionner l'agent par défaut si pending
    if (window._pendingDefaultAgentId) {
      sel.value = window._pendingDefaultAgentId;
      delete window._pendingDefaultAgentId;
    }
    // Sinon restaurer la sélection courante si un agent est actif
    else if (state.agent && state.agent !== '__ALL_AGENTS__' && state.agent.id) {
      sel.value = state.agent.id;
    } else if (state.agent === '__ALL_AGENTS__') {
      sel.value = '__ALL_AGENTS__';
    }
  } catch(e) { console.error("loadAgents:", e); }
}

async function activateAgent(id) {
  try {
    const ag = await db.get('agents', id);
    if (ag) {
      state.agent = ag;
      $("#agent-select").value = id;
      // Charger les leçons d'apprentissage
      try {
        const lessons = await agentFeedback.getForAgent(id, 8);
        state._agentLessonsCache = agentFeedback.buildLessonsPrompt(lessons);
      } catch(e) { state._agentLessonsCache = ''; }
      const sys = (state.messages||[]).find(m => m.role === "system");
      if (sys) { sys.content = buildSystemPrompt(); await saveChat(); renderMessages(true); }
      toast(`Agent "${ag.name}" activé`, "success");
      $("#agent-modal").classList.remove("active");
    }
  } catch(e) { console.error(e); }
};

async function deleteAgent(id) {
  if (!confirm("Supprimer cet agent ?")) return;
  await db.delete('agents', id);
  if (state.agent?.id === id) state.agent = null;
  await loadAgents();
  toast("Agent supprimé", "success");
};

// ════════════════════════════════════════
// WORKFLOW (CHAÎNES) MANAGEMENT
// ════════════════════════════════════════
let wfSteps = []; // in-memory steps for the editor

async function renderWfExistingList() {
  const list = $("#wf-existing-list");
  if (!list) return;
  try {
    const workflows = await db.getAll('workflows') || [];
    if (!workflows.length) {
      list.innerHTML = '';
      return;
    }
    list.innerHTML = `
      <div style="font-family:var(--font-mono);font-size:10px;letter-spacing:2px;color:var(--text-dim);margin-bottom:10px">CHAÎNES EXISTANTES (${workflows.length})</div>
      ${workflows.map(w => `
        <div class="wf-preview" data-id="${w.id}">
          <span class="wf-preview-icon" style="cursor:pointer" data-action="edit-workflow" data-id="${w.id}">🔗</span>
          <div class="wf-preview-info" style="cursor:pointer" data-action="edit-workflow" data-id="${w.id}">
            <div class="wf-preview-name">${escapeHtml(w.name)}</div>
            <div class="wf-preview-desc">${escapeHtml(w.desc || '')}</div>
          </div>
          <span class="wf-preview-steps-count" style="margin-right:10px">${(w.steps||[]).length} étapes</span>
          <button class="agent-action-btn" data-action="activate-workflow" data-id="${w.id}" title="Activer cette chaîne pour le prochain message" style="color:var(--neon);border-color:var(--neon);margin-right:5px;width:auto;padding:0 8px">✓ ACTIVER</button>
          <button class="agent-action-btn danger" data-action="delete-workflow" data-id="${w.id}" title="Supprimer">✕</button>
        </div>
      `).join('')}
    `;
  } catch(e) { console.error("renderWfExistingList:", e); }
}

async function renderWfSteps() {
  const zone = $("#wf-steps-zone");
  if (!zone) return;
  if (!wfSteps.length) {
    zone.innerHTML = '<div class="wf-steps-empty">Aucune étape — cliquez sur "+ AJOUTER" ci-dessous</div>';
    return;
  }

  // Get agents for the select options - always reload fresh from DB
  const freshAgents = await db.getAll('agents') || [];
  window.__allAgents = freshAgents;
  console.log('[DEBUG renderWfSteps] agents:', freshAgents.length, 'steps:', wfSteps.length, 'step0 agentId:', wfSteps[0]?.agentId);
  const agentOpts = freshAgents.map(a => ({
    id: a.id, name: a.name
  }));

  zone.innerHTML = wfSteps.map((step, i) => {
    const isFirst = i === 0;
    const isLast = i === wfSteps.length - 1;
    const connector = !isLast ? '<div class="wf-step-connector">↓</div>' : '';

    return `
      <div class="wf-step" data-step-index="${i}">
        <div class="wf-step-header">
          <div class="wf-step-number">${i + 1}</div>
          <div class="wf-step-label">ÉTAPE ${i + 1}</div>
          <div class="wf-step-actions">
            <button class="wf-step-action-btn" data-action="wf-move-up" data-idx="${i}" title="Monter"${isFirst ? ' disabled style="opacity:0.3;cursor:default"' : ''}>↑</button>
            <button class="wf-step-action-btn" data-action="wf-move-down" data-idx="${i}" title="Descendre"${isLast ? ' disabled style="opacity:0.3;cursor:default"' : ''}>↓</button>
            <button class="wf-step-action-btn danger" data-action="wf-remove-step" data-idx="${i}" title="Supprimer l'étape">✕</button>
          </div>
        </div>
        <div class="wf-step-body">
          <select class="field-input field-select wf-step-agent" data-idx="${i}">
            <option value="">— Choisir un agent —</option>
            ${agentOpts.map(a => `<option value="${a.id}"${step.agentId === a.id ? ' selected' : ''}>${a.name}</option>`).join('')}
          </select>
          <textarea class="field-textarea wf-step-instruction" data-idx="${i}" rows="2" placeholder="Instruction personnalisée (optionnel) — Ex : Traduis ce texte, Fais un résumé…">${escapeHtml(step.instructionCustom || '')}</textarea>
          <div style="font-family:var(--font-mono);font-size:9.5px;color:var(--text-dim);margin-top:6px;line-height:1.4">
            Astuce : Utilisez <code style="color:var(--neon);background:rgba(0,255,157,0.1);padding:1px 3px;border-radius:2px">{input}</code> pour placer la sortie de l'étape précédente, ou <code style="color:var(--cyan);background:rgba(0,229,255,0.1);padding:1px 3px;border-radius:2px">{initial}</code> pour la requête d'origine.
          </div>
        </div>
      </div>
      ${connector}
    `;
  }).join('');

  // Force values via DOM to guarantee selection even if HTML attribute fails
  setTimeout(() => {
    document.querySelectorAll('.wf-step-agent').forEach(sel => {
      const i = parseInt(sel.dataset.idx);
      if (wfSteps[i] && wfSteps[i].agentId) {
        sel.value = wfSteps[i].agentId;
      }
    });
  }, 10);
}

async function wfAddStep() {
  wfSteps.push({ agentId: '', instructionCustom: '' });
  await renderWfSteps();
  // Scroll to bottom of steps zone
  const zone = $("#wf-steps-zone");
  if (zone) zone.scrollTop = zone.scrollHeight;
}

async function wfMoveStep(fromIdx, direction) {
  const toIdx = fromIdx + direction;
  if (toIdx < 0 || toIdx >= wfSteps.length) return;
  // Sync current UI values before move
  syncWfStepsFromUI();
  const [moved] = wfSteps.splice(fromIdx, 1);
  wfSteps.splice(toIdx, 0, moved);
  await renderWfSteps();
}

async function wfRemoveStep(idx) {
  syncWfStepsFromUI();
  wfSteps.splice(idx, 1);
  await renderWfSteps();
}

function syncWfStepsFromUI() {
  document.querySelectorAll('.wf-step-agent').forEach(sel => {
    const i = parseInt(sel.dataset.idx);
    if (wfSteps[i]) wfSteps[i].agentId = sel.value;
  });
  document.querySelectorAll('.wf-step-instruction').forEach(ta => {
    const i = parseInt(ta.dataset.idx);
    if (wfSteps[i]) wfSteps[i].instructionCustom = ta.value.trim();
  });
}

async function openWorkflowForEdit(id) {
  try {
    toast("Debug: Clic capté sur " + id, "success");
    const wf = await db.get('workflows', id);
    if (!wf) return;
    $("#wf-edit-id").value = wf.id;
    $("#wf-name").value = wf.name || '';
    $("#wf-desc").value = wf.desc || '';
    wfSteps = (wf.steps || []).map(s => ({ agentId: s.agentId || '', instructionCustom: s.instructionCustom || '' }));
    // Ensure agents loaded into window.__allAgents before rendering steps
    if (!window.__allAgents || !window.__allAgents.length) {
      window.__allAgents = await db.getAll('agents') || [];
    }
    await renderWfSteps();
    $("#wf-delete-btn").style.display = '';
    // Scroll to the form and highlight it
    const nameField = $("#wf-name");
    nameField.scrollIntoView({ behavior: 'smooth', block: 'center' });
    nameField.focus();
    nameField.style.transition = 'box-shadow 0.3s, border-color 0.3s';
    nameField.style.boxShadow = '0 0 12px var(--neon)';
    nameField.style.borderColor = 'var(--neon)';
    setTimeout(() => {
      nameField.style.boxShadow = '';
      nameField.style.borderColor = '';
    }, 1500);
    toast(`Chaîne "${wf.name}" chargée pour modification`, "success");
  } catch(e) { console.error("openWorkflowForEdit:", e); }
}

async function resetWorkflowForm() {
  $("#wf-edit-id").value = '';
  $("#wf-name").value = '';
  $("#wf-desc").value = '';
  wfSteps = [];
  await renderWfSteps();
  $("#wf-delete-btn").style.display = 'none';
}

async function saveWorkflow() {
  try {
    const name = $("#wf-name").value.trim();
    if (!name) { toast("Le nom de la chaîne est obligatoire", "error"); return; }

    syncWfStepsFromUI();

    if (wfSteps.length < 1) { toast("Ajoutez au moins une étape", "error"); return; }


    // If any step is missing agentId (UI didn't populate), try to recover from DB
    const editId = $("#wf-edit-id").value;
    if (editId) {
      const dbWf = await db.get('workflows', editId).catch(() => null);
      if (dbWf && dbWf.steps) {
        wfSteps = wfSteps.map((s, i) => ({
          agentId: s.agentId || (dbWf.steps[i] ? dbWf.steps[i].agentId : '') || '',
          instructionCustom: s.instructionCustom !== undefined ? s.instructionCustom : (dbWf.steps[i] ? dbWf.steps[i].instructionCustom : '') || ''
        }));
      }
    }
    // Validate all steps have an agent
    const hasEmpty = wfSteps.some(s => !s.agentId);
    if (hasEmpty) { toast("Chaque étape doit avoir un agent sélectionné", "error"); return; }
    const wf = {
      id: editId || uuid(),
      name,
      desc: $("#wf-desc").value.trim(),
      steps: wfSteps.map(s => ({ agentId: s.agentId, instructionCustom: s.instructionCustom })),
      created: editId ? (await db.get('workflows', editId).catch(() => null))?.created || now() : now()
    };

    await db.put('workflows', wf);
    toast(`Chaîne "${name}" ${editId ? 'modifiée' : 'créée'} !`, "success");
    await resetWorkflowForm();
    await renderWfExistingList();
    await loadAgents();
    
    // Update memory if this workflow is currently selected
    if (state.selectedWorkflow && state.selectedWorkflow.id === wf.id) {
      state.selectedWorkflow = wf;
      $("#agent-select").value = "__WF__" + wf.id;
    }
    
    // Sync mobile
    const mAgent = $("#agent-select-mob");
    if (mAgent) { 
      mAgent.innerHTML = $("#agent-select").innerHTML; 
      mAgent.value = state.selectedWorkflow ? "__WF__" + state.selectedWorkflow.id : (state.agent?.id || ""); 
    }
    
    // Fermer le modal pour que l'utilisateur voit que l'enregistrement a marché
    if ($("#workflow-modal")) $("#workflow-modal").classList.remove("active");
  } catch(e) {
    console.error("Erreur saveWorkflow:", e);
    toast("Erreur lors de la sauvegarde: " + e.message, "error");
  }
}

async function deleteWorkflow(id) {
  if (!confirm("Supprimer cette chaîne ?")) return;
  await db.delete('workflows', id);
  await renderWfExistingList();
  await loadAgents();
  toast("Chaîne supprimée", "success");
}

// ════════════════════════════════════════
// DATA EXPORT / IMPORT
// ════════════════════════════════════════
async function computeStats() {
  try {
    const chats = await db.getAll('chats') || [];
    const agents = await db.getAll('agents') || [];
    const mems = await db.getAll('global_memory') || [];
    const json = JSON.stringify({ chats, agents, mems });
    const sizeKb = (new Blob([json]).size / 1024).toFixed(1);
    $("#stat-chats").textContent = chats.length;
    $("#stat-agents").textContent = agents.length;
    $("#stat-memories").textContent = mems.length;
    $("#stat-size").textContent = sizeKb + " KB";
  } catch(e) {}
}

async function exportData() {
  try {
    const chats = await db.getAll('chats') || [];
    const agents = await db.getAll('agents') || [];
    const mems = await db.getAll('global_memory') || [];
    const settings = await db.getAll('settings') || [];
    const workflows = await db.getAll('workflows') || [];
    const feedbacks = await db.getAll('agent_feedback') || [];
    const payload = {
      version: "3.0",
      exported: new Date().toISOString(),
      source: "Mon Assistant IA",
      data: { chats, agents, global_memory: mems, settings, workflows, agent_feedback: feedbacks }
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type:"application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Mon Assistant IA-backup-${new Date().toISOString().slice(0,10)}.Mon Assistant IA.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast("Données exportées avec succès (inclut les leçons d'apprentissage) !", "success");
  } catch(e) {
    toast("Erreur export : " + e.message, "error");
  }
}

async function importData(file) {
  try {
    const text = await file.text();
    const payload = JSON.parse(text);
    const data = payload.data || payload;
    let count = 0;
    if (data.chats?.length) {
      for (const c of data.chats) { await db.put('chats', c); count++; }
    }
    if (data.agents?.length) {
      for (const a of data.agents) { await db.put('agents', a); count++; }
    }
    if (data.global_memory?.length) {
      for (const m of data.global_memory) { await db.put('global_memory', m); count++; }
    }
    if (data.workflows?.length) {
      for (const w of data.workflows) { await db.put('workflows', w); count++; }
    }
    if (data.agent_feedback?.length) {
      for (const f of data.agent_feedback) { await db.put('agent_feedback', f); count++; }
    }
    await memory.getAll();
    await loadAgents();
    await computeStats();
    toast(`Import réussi — ${count} éléments restaurés`, "success");
  } catch(e) {
    toast("Erreur import : " + e.message, "error");
  }
}

async function exportWorkflows() {
  try {
    const workflows = await db.getAll('workflows') || [];
    const payload = {
      version: "1.0",
      exported: new Date().toISOString(),
      source: "Mon Assistant IA_WORKFLOWS",
      data: { workflows }
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type:"application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Mon Assistant IA-workflows-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast("Chaînes exportées avec succès !", "success");
  } catch(e) {
    toast("Erreur export : " + e.message, "error");
  }
}

async function importWorkflows(file) {
  try {
    const text = await file.text();
    const payload = JSON.parse(text);
    const data = payload.data || payload;
    let count = 0;
    if (data.workflows?.length) {
      for (const w of data.workflows) { await db.put('workflows', w); count++; }
    }
    await loadAgents();
    toast(`Import réussi — ${count} chaînes restaurées`, "success");
  } catch(e) {
    toast("Erreur import : " + e.message, "error");
  }
}


// ════════════════════════════════════════
// RATING SYSTEM
// ════════════════════════════════════════
async function rateMessage(ts, score) {
  const msg = (state.messages||[]).find(m => m.ts === ts);
  if (!msg) return;
  msg.rating = score;
  await saveChat();
  // Update stars UI
  const msgEl = document.getElementById('mc-' + ts)?.closest('.message');
  if (msgEl) {
    msgEl.querySelectorAll('.rating-star').forEach((btn, i) => {
      btn.classList.toggle('active', i < score);
    });
  }

  if (score <= 2) {
    // Mauvaise note → ouvrir popup feedback pour correction
    openFeedbackModal(ts, score);
  } else if (score >= 4) {
    // Bonne note → enregistrer silencieusement un renforcement positif
    const isRealAgent = state.agent && state.agent !== '__ALL_AGENTS__';
    const agentId = isRealAgent ? state.agent.id : null;
    const agentName = isRealAgent ? state.agent.name : (state.aiConfig?.name || 'Mon Assistant IA');
    const workflowName = msg.workflowUsed || null;
    await agentFeedback.add({
      agentId: agentId,
      agentName: agentName,
      workflowName: workflowName,
      score: score,
      userFeedback: 'auto_positive',
      originalQuestion: '',
      responseSnippet: (msg.content || '').slice(0, 200)
    });
    toast(`✅ ${score}/5 — Comportement renforcé pour ${agentName}`, "success");
    
    if (state.agent && state.agent.id === agentId) {
      const lessons = await agentFeedback.getForAgent(agentId, 8);
      state._agentLessonsCache = agentFeedback.buildLessonsPrompt(lessons);
      const sys = (state.messages||[]).find(m => m.role === "system");
      if (sys) { sys.content = buildSystemPrompt(); await saveChat(); }
    }
  } else {
    toast(`Évaluation ${score}/5 enregistrée`, "success");
  }
};

// ════════════════════════════════════════
// FILE UPLOAD FOR VISION/AUDIO
// ════════════════════════════════════════
function initFileUpload() {
  const btn = document.getElementById('file-upload-btn');
  const inp = document.getElementById('file-input');
  if (!btn || !inp) return;
  btn.onclick = () => inp.click();
  inp.onchange = async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    
    for (const file of files) {
      const model = MODELS.find(m => m.id === state.model);
      const isImage = file.type.startsWith('image/');
      const isAudioFile = file.type.startsWith('audio/');
      const isPdf = file.type === 'application/pdf';
      
      if (isImage) {
        const reader = new FileReader();
        reader.onload = (ev) => {
          state.attachedFiles.push({ type: 'image', data: ev.target.result, name: file.name, mimeType: file.type });
          updateFilePreview();
        };
        reader.readAsDataURL(file);
      } else if (isAudioFile) {
        const reader = new FileReader();
        reader.onload = (ev) => {
          state.attachedFiles.push({ type: 'audio', data: ev.target.result, name: file.name, mimeType: file.type });
          updateFilePreview();
        };
        reader.readAsDataURL(file);
      } else if (isPdf) {
        toast(`Extraction de ${file.name}...`, "info");
        const reader = new FileReader();
        reader.onload = async (ev) => {
          try {
            const typedarray = new Uint8Array(ev.target.result);
            const pdf = await pdfjsLib.getDocument(typedarray).promise;
            let fullText = "";
            for (let i = 1; i <= pdf.numPages; i++) {
              const page = await pdf.getPage(i);
              const textContent = await page.getTextContent();
              let lastY, text = "";
              for (const item of textContent.items) {
                if (lastY !== undefined && Math.abs(lastY - item.transform[5]) > 2) text += "\n";
                text += item.str;
                lastY = item.transform[5];
              }
              fullText += text + "\n\n";
            }
            state.attachedFiles.push({ type: 'document', data: fullText.trim(), name: file.name, mimeType: file.type });
            updateFilePreview();
            toast(`${file.name} lu avec succès !`, "success");
          } catch (err) {
            toast(`Erreur de lecture pour ${file.name}`, "error");
          }
        };
        reader.readAsArrayBuffer(file);
      } else {
        toast(`Format non supporté pour ${file.name}.`, "error");
      }
    }
    inp.value = '';
  };
}

function updateFilePreview() {
  const area = document.getElementById('input-area');
  let preview = document.getElementById('file-preview-bar');
  if (!state.attachedFiles || state.attachedFiles.length === 0) {
    if (preview) preview.remove();
    return;
  }
  if (!preview) {
    preview = document.createElement('div');
    preview.id = 'file-preview-bar';
    preview.className = 'file-preview';
    preview.style.display = 'flex';
    preview.style.flexWrap = 'wrap';
    preview.style.gap = '8px';
    area.parentNode.insertBefore(preview, area);
  }
  preview.innerHTML = '';
  state.attachedFiles.forEach((file, index) => {
    let icon = '📄';
    if (file.type === 'image') icon = '🖼';
    if (file.type === 'audio') icon = '🎵';
    
    const fileTag = document.createElement('div');
    fileTag.style.display = 'inline-flex';
    fileTag.style.alignItems = 'center';
    fileTag.style.gap = '6px';
    fileTag.style.padding = '4px 8px';
    fileTag.style.background = 'rgba(0,229,255,0.05)';
    fileTag.style.border = '1px solid var(--hud-border)';
    fileTag.style.borderRadius = '4px';
    fileTag.innerHTML = `${icon} <strong style="color:var(--cyan);font-size:11px">${file.name}</strong><button class="file-preview-remove" style="cursor:pointer;background:none;border:none;color:var(--text-dim);font-size:10px" data-action="clear-file" data-index="${index}">✕</button>`;
    preview.appendChild(fileTag);
  });
}

function clearAttachedFile(index = null) {
  if (index !== null) {
    state.attachedFiles.splice(index, 1);
  } else {
    state.attachedFiles = [];
  }
  updateFilePreview();
};

// Override sendMessage to handle file attachments
async function sendMessage() {
  const txt = document.getElementById('user-input').value.trim();
  if (!txt && (!state.attachedFiles || state.attachedFiles.length === 0)) return;
  if (!state.apiKey) {
    toast("Configurez votre clé API d'abord", "error");
    document.getElementById('api-modal').classList.add("active");
    return;
  }

  // ════════════════════════════════════════
  // 🔗 INTERCEPT: EXÉCUTION D'UNE CHAÎNE (WORKFLOW)
  // ════════════════════════════════════════
  if (state.selectedWorkflow) {
    // 1. Affiche le message utilisateur
    const userMsg = { role: "user", content: txt, ts: now() };
    state.messages.push(userMsg);
    renderMessages();
    document.getElementById('user-input').value = "";
    autoResizeTextarea();
    
    state.isGenerating = true;
    state.abortController = new AbortController();
    document.getElementById('send-btn').disabled = false;
    document.getElementById('send-btn').className = 'stop-btn';
    document.getElementById('send-btn').innerHTML = '⏹ ARRÊTER';
    
    // 2. Prépare le message assistant final
    state.messages.push({ role: "assistant", content: "", ts: now(), workflowUsed: state.selectedWorkflow.name });
    renderMessages();
    showTyping();
    await saveChat();

    let workflowInput = txt;
    if (state.attachedFiles && state.attachedFiles.length > 0) {
       const docs = state.attachedFiles.filter(f => f.type === 'document');
       if (docs.length > 0) {
           const docText = docs.map(f => `[CONTENU DU DOCUMENT "${f.name}"]\n\n${f.data}\n\n[FIN DU DOCUMENT]`).join('\n\n');
           userMsg.documentContext = docText;
           userMsg.documentName = docs.map(f => f.name).join(', ');
           workflowInput = `${docText}\n\nInstruction de l'utilisateur : ${txt || "Traite ces documents."}`;
       }
       userMsg.attachedFiles = [...state.attachedFiles];
       clearAttachedFile();
    }

    // ── Génération des séquences QCM (post-processing JS retiré, géré par le prompt Agent 3) ──

    try {
      // 3. Exécute la chaîne
      const { displayContent } = await executeWorkflow(workflowInput, state.selectedWorkflow);
      
      // 4. Affiche le résultat final
      const lastMsg = state.messages[state.messages.length - 1];
      if (lastMsg && lastMsg.role === 'assistant') {
        lastMsg.content = displayContent;
      }
      renderMessages(true);
      await saveChat();
    } catch (e) {
      if (e.name === 'AbortError') {
         const lastMsg = state.messages[state.messages.length - 1];
         if (lastMsg && lastMsg.role === 'assistant') {
           lastMsg.content = lastMsg.content ? lastMsg.content + '\n\n*— Chaîne interrompue —*' : '*— Chaîne interrompue —*';
         }
         renderMessages(true);
         toast("Chaîne stoppée", "info");
      }
    } finally {
      hideTyping();
      state.isGenerating = false;
      state.abortController = null;
      document.getElementById('send-btn').disabled = false;
      document.getElementById('send-btn').className = '';
      document.getElementById('send-btn').innerHTML = 'ENVOYER ▶';
      const statusEl = document.getElementById("orchestrator-status");
      if (statusEl) statusEl.innerHTML = "";
    }
    return;
  }

  const model = MODELS.find(m => m.id === state.model) || MODELS[0];
  const isVision = state.model.includes('pixtral');
  const isAudio = state.model.includes('voxtral');

  if (state.attachedFiles && state.attachedFiles.length > 0 && (isVision || isAudio)) {
    // Multi-modal message
    const images = state.attachedFiles.filter(f => f.type === 'image');
    const audios = state.attachedFiles.filter(f => f.type === 'audio');
    
    const userMsg = {
      role: "user",
      content: txt || (images.length > 0 ? "Décris ces images" : "Transcris cet audio"),
      ts: now(),
      imageData: images.length > 0 ? images[0].data : null, // (Keeping simple fallback for first item if needed elsewhere)
      audioName: audios.length > 0 ? audios[0].name : null,
      attachedFiles: [...state.attachedFiles]
    };
    state.messages.push(userMsg);
    renderMessages();
    document.getElementById('user-input').value = "";
    autoResizeTextarea();
    state.isGenerating = true;
    state.abortController = new AbortController();
    document.getElementById('send-btn').disabled = false;
    document.getElementById('send-btn').className = 'stop-btn';
    document.getElementById('send-btn').innerHTML = '⏹ ARRÊTER';
    
    state.messages.push({ role: "assistant", content: "", ts: now() });
    renderMessages();
    showTyping();
    await saveChat();
    updateContextMeter();

    let msgContent = [];
    for (const f of state.attachedFiles) {
        if (f.type === 'image') {
            msgContent.push({ type: "image_url", image_url: f.data });
        }
    }
    if (txt) msgContent.push({ type: "text", text: txt });
    else msgContent.push({ type: "text", text: "Analyse ces images en détail." });

    const contextMessages = [
      { role: "system", content: buildSystemPrompt() },
      { role: "user", content: msgContent }
    ];

    try {
      const _isRealAgent = state.agent && state.agent !== '__ALL_AGENTS__';
      const agentTemp = (_isRealAgent && state.agent.temperature !== undefined) ? state.agent.temperature : model.temp;
      const agentMaxTok = (_isRealAgent && state.agent.maxTokens) ? state.agent.maxTokens : 4096;
      const res = await fetchWithRetry("https://api.mistral.ai/v1/chat/completions", {
        method: "POST",
        headers: { 
          "Authorization": `Bearer ${state.apiKey}`, 
          "Content-Type": "application/json" 
        },
        signal: state.abortController?.signal,
        body: JSON.stringify({ 
          model: state.model, 
          messages: contextMessages, 
          temperature: agentTemp, 
          max_tokens: agentMaxTok,
          stream: true
        })
      });
      if (!res.ok) throw new Error(await res.text());
      await handleStreamingResponse(res, updateLiveMessage, () => {}, state.abortController?.signal);
      
      const lastMsg = state.messages[state.messages.length - 1];
      if (lastMsg && lastMsg.role === 'assistant' && lastMsg.content) {
        const seq = generateQcmSequenceArray();
        lastMsg.content = shuffleQcmOptions(lastMsg.content, seq);
      }

      hideTyping();
      renderMessages();
      await saveChat();
    } catch(err) {
      hideTyping();
      if (err.name === 'AbortError') {
        const lastMsg = state.messages[state.messages.length - 1];
        if (lastMsg && lastMsg.role === 'assistant' && lastMsg.content) {
          lastMsg.content += '\n\n*— Génération interrompue —*';
        } else if (lastMsg && lastMsg.role === 'assistant') {
          lastMsg.content = '*— Génération interrompue —*';
        }
        renderMessages(true);
        await saveChat();
        toast("Génération stoppée", "info");
      } else {
        toast("Erreur API : " + err.message.slice(0,100), "error");
      }
    } finally {
      state.isGenerating = false;
      state.abortController = null;
      document.getElementById('send-btn').disabled = false;
      document.getElementById('send-btn').className = '';
      document.getElementById('send-btn').innerHTML = 'ENVOYER ▶';
    }
    // Clear file
    state.attachedFiles = [];
    updateFilePreview();
    return;
  }

  const isDocument = state.attachedFile?.type === 'document';
  if (state.attachedFile && !isVision && !isAudio && !isDocument) {
    toast("Ce modèle ne supporte pas les fichiers. Utilisez Pixtral Vision ou Voxtral pour audio.", "error");
    return;
  }


  // Normal text message - use original logic but with agent temperature
  const _model = MODELS.find(m => m.id === state.model) || MODELS[0];
  const origTemp = _model.temp;
  const _isRealAgent2 = state.agent && state.agent !== '__ALL_AGENTS__';
  if (_isRealAgent2 && state.agent.temperature !== undefined) _model.temp = state.agent.temperature;
  await _sendMessageOriginal();
  _model.temp = origTemp;
}

// ════════════════════════════════════════
// AGENT EDIT / DUPLICATE / EXPORT / IMPORT
// ════════════════════════════════════════
async function openEditAgent(id) {
  try {
    const ag = await db.get('agents', id);
    if (!ag) return;
    document.getElementById('edit-agent-id').value = ag.id;
    document.getElementById('edit-agent-name').value = ag.name || '';
    document.getElementById('edit-agent-desc').value = ag.desc || '';
    document.getElementById('edit-agent-instructions').value = ag.instructions || '';
    document.getElementById('edit-agent-primer').value = ag.primer || '';
    document.getElementById('edit-agent-tags').value = (ag.tags||[]).join(', ');
    document.getElementById('edit-agent-temp').value = ag.temperature ?? 0.7;
    document.getElementById('edit-agent-temp-val').textContent = ag.temperature ?? 0.7;
    document.getElementById('edit-agent-maxtok').value = ag.maxTokens || 4096;
    document.getElementById('edit-agent-maxtok-val').textContent = ag.maxTokens || 4096;
    document.getElementById('edit-agent-style').value = ag.style || '';
    document.getElementById('edit-agent-forbidden').value = ag.forbidden || '';
    document.getElementById('edit-agent-mem-prio').value = ag.memPrio || 3;
    document.getElementById('edit-agent-mem-prio-val').textContent = ag.memPrio || 3;
    // Populate model select
    const sel = document.getElementById('edit-agent-model-pref');
    sel.innerHTML = '<option value="">Auto</option>';
    MODELS.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.id; opt.textContent = m.name;
      if (ag.modelPref === m.id) opt.selected = true;
      sel.appendChild(opt);
    });
    document.getElementById('edit-agent-modal').classList.add("active");
  } catch(e) { console.error(e); toast("Erreur ouverture agent", "error"); }
};

async function duplicateAgentById(id) {
  try {
    const ag = await db.get('agents', id);
    if (!ag) return;
    const copy = { ...ag, id: uuid(), name: ag.name + ' (copie)', created: now() };
    await db.put('agents', copy);
    await loadAgents();
    toast(`Agent "${copy.name}" dupliqué`, "success");
  } catch(e) { toast("Erreur duplication", "error"); }
};

async function exportAgent(id) {
  try {
    const ag = await db.get('agents', id);
    if (!ag) return;
    
    // Inclure les leçons d'apprentissage liées à cet agent
    const feedbacks = await agentFeedback.getForAgent(id, 20);
    ag._feedbacks = feedbacks;

    const blob = new Blob([JSON.stringify(ag, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `agent-${ag.name.replace(/\s+/g,'-')}.json`;
    a.click(); URL.revokeObjectURL(url);
    toast(`Agent "${ag.name}" exporté`, "success");
  } catch(e) { toast("Erreur export agent", "error"); }
};

function initAgentImport() {
  const btn = document.getElementById('import-agent-btn');
  const inp = document.getElementById('import-agent-input');
  if (!btn || !inp) return;
  btn.onclick = () => inp.click();
  inp.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const ag = JSON.parse(text);
      if (!ag.name || !ag.desc) throw new Error("Fichier agent invalide");
      ag.id = uuid(); ag.created = now();
      await db.put('agents', ag);

      // Restaurer les leçons d'apprentissage si présentes
      let feedbackCount = 0;
      if (ag._feedbacks && Array.isArray(ag._feedbacks)) {
        for (const fb of ag._feedbacks) {
          fb.id = uuid(); // Nouveau UUID pour le feedback
          fb.agentId = ag.id; // Lier au nouvel ID de l'agent importé
          await agentFeedback.add(fb);
          feedbackCount++;
        }
      }

      await loadAgents();
      toast(`Agent "${ag.name}" importé${feedbackCount > 0 ? ` (avec ${feedbackCount} leçons)` : ''}`, "success");
    } catch(err) { toast("Erreur import : " + err.message, "error"); }
    inp.value = '';
  };
}

// ════════════════════════════════════════
// SETUP WIZARD
// ════════════════════════════════════════
async function checkFirstRun() {
  try {
    const cfg = await db.get('settings', 'aiConfig');
    if (cfg?.value) {
      state.aiConfig = cfg.value;
      updateBrandName();
    }
    const key = await getCookie("mistral_api_key");
    if (!key) {
      showWizard(1);
      return true;
    }
    state.apiKey = key;
    return false;
  } catch(e) { return false; }
}

function updateBrandName() {
  const name = state.aiConfig?.name;
  if (!name) return;
  const brandEl = document.querySelector('.brand-name');
  if (brandEl) brandEl.textContent = name;
  const wvLogo = document.querySelector('.wv-logo');
  if (wvLogo) wvLogo.textContent = name;
}

function showWizard(step = 1) {
  document.getElementById('setup-wizard-overlay').classList.add("active");
  setWizardStep(step);
}

function hideWizard() {
  document.getElementById('setup-wizard-overlay').classList.remove("active");
}

function setWizardStep(n) {
  document.querySelectorAll('.wizard-step').forEach(s => s.classList.remove('active'));
  const s = document.getElementById('wizard-step-' + n);
  if (s) s.classList.add('active');
}

// ════════════════════════════════════════
// ADVANCED AGENT FACTORY — MULTI-PHASE PROMPT ENGINEERING v2.0
// ════════════════════════════════════════
const AgentFactory = {

  // ── Appel API mutualisé ──
  _callAPI: async (apiKey, messages, maxTokens = 16000, temperature = 0.6) => {
    const res = await fetchWithRetry("https://api.mistral.ai/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "mistral-large-2512",
        messages,
        temperature,
        max_tokens: maxTokens,
        top_p: 0.92
      })
    });
    if (!res.ok) throw new Error("API Mistral : " + res.status);
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || "";
    return text.replace(/```json|```/g, '').trim();
  },

  // ═══════════════════════════════════════════════════════════════════
  // PHASE 1 : ANALYSE DE DOMAINE & DÉCOMPOSITION STRATÉGIQUE
  // ═══════════════════════════════════════════════════════════════════
  analyzeDomain: async (apiKey, aiName, aiGoal, agentCount = 4) => {
    const systemPrompt = `Tu es un Expert Pédagogique et Ingénieur en Évaluation du système éducatif marocain.
Ton expertise couvre : l'ingénierie pédagogique, la création d'évaluations (QCM), et la connaissance des programmes officiels marocains.

Tu conçois des équipes d'agents IA spécialisés dans la génération de QCM :
chaque agent a un rôle précis (ex: Professeur de SVT, Ingénieur d'évaluation, Correcteur), des frontières claires, et se base uniquement sur le système éducatif du Maroc.`;

    const userPrompt = `MISSION : Analyse l'objectif suivant et décompose-le en domaines d'expertise distincts pour créer EXACTEMENT ${agentCount} agent(s).

═══ CONTEXTE ═══
Nom de l'IA : "${aiName}"
Objectif principal : "${aiGoal}"

═══ PROCESSUS D'ANALYSE (Chain-of-Thought) ═══
Raisonne étape par étape :
1. Identifie EXACTEMENT ${agentCount} SPÉCIALITÉS nécessaires et parfaitement complémentaires. Repartis-les dans 1 à ${Math.min(agentCount, 3)} macro-domaines.
2. Pour chaque spécialité, évalue :
   - Le NIVEAU DE RIGUEUR requis : "strict" (données, calcul) / "balanced" (général) / "creative" (idéation, rédaction)
   - La TEMPÉRATURE optimale : 0.15-0.35 pour strict, 0.35-0.55 pour balanced, 0.55-0.95 pour creative
   - Le STYLE DE RÉPONSE idéal : concis / detaille / formel / creatif / pedagogique
   - La LONGUEUR MAXIMALE de réponse idéale en tokens : 4096 / 8192 / 12288 / 16384
4. Identifie les SYNERGIES entre spécialités (quel agent nourrit quel autre dans une chaîne)
5. Vérifie qu'il n'y a AUCUN TROU de compétence et AUCUN DOUBLON

═══ FORMAT DE SORTIE (JSON strict, AUCUN texte avant/après, AUCUN markdown) ═══
{
  "context_summary": "Résumé analytique du contexte en 2-3 phrases",
  "macro_domains": [
    {
      "name": "Nom du macro-domaine",
      "importance": "critique|haute|moyenne",
      "specialties": [
        {
          "role_title": "Titre du rôle spécialisé",
          "core_mission": "Mission principale en une phrase",
          "key_skills": ["compétence1", "compétence2", "compétence3"],
          "rigidity": "strict|balanced|creative",
          "temperature": 0.4,
          "style": "concis|detaille|formel|creatif|pedagogique",
          "max_tokens": 8192,
          "synergies": ["autre rôle 1", "autre rôle 2"]
        }
      ]
    }
  ],
  "total_agents": ${agentCount}
}`;

    const raw = await AgentFactory._callAPI(apiKey, [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ], 6000, 0.5);

    try {
      return JSON.parse(raw);
    } catch(e) {
      // Fallback : extraction JSON partielle
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) return JSON.parse(match[0]);
      throw new Error("Analyse de domaine invalide");
    }
  },

  // ═══════════════════════════════════════════════════════════════════
  // PHASE 2 : CRÉATION PROFONDE DES AGENTS (par lot de domaines)
  // ═══════════════════════════════════════════════════════════════════
  craftAgentsBatch: async (apiKey, aiName, aiGoal, domainAnalysis, batchDomains, existingNames = []) => {
    const specialtiesBlock = batchDomains.map(d =>
      (d.specialties || []).map(s =>
        `• ${s.role_title} — ${s.core_mission} [rigidité:${s.rigidity}, temp:${s.temperature}, style:${s.style}, maxTok:${s.max_tokens}]\n  Compétences: ${(s.key_skills||[]).join(', ')}\n  Synergies: ${(s.synergies||[]).join(', ')}`
      ).join('\n')
    ).join('\n\n');

    const existingBlock = existingNames.length
      ? `\n\n⚠️ڈ AGENTS DÉJÀ EXISTANTS (NE PAS recréer, NE PAS dupliquer) :\n${existingNames.map(n => `- ${n}`).join('\n')}`
      : '';

    const systemPrompt = `Tu es « Promptor », un Expert mondial, généraliste et exhaustif en Prompt Engineering et en Intelligence Artificielle.
Ton objectif ultime est de rédiger, d'optimiser et d'affiner le meilleur prompt (instructions système) possible pour chaque agent que l'utilisateur souhaite créer.
Tes créations sont spécifiquement conçues pour exploiter à 100% l'architecture des LLMs avancés.

# RÈGLES DE RÉDACTION
Pour CHAQUE agent que tu vas créer, tu dois impérativement générer le champ "instructions" en respectant ces 5 piliers :

1. Structure CO-STAR :
   - (C) Context : Fournir le contexte et attribuer un RÔLE d'expert très précis à l'agent.
   - (O) Objective : Définir clairement la tâche et le but de cet agent.
   - (S) Style : Définir le style d'écriture de l'agent.
   - (T) Tone : Définir le ton de l'agent.
   - (A) Audience : Identifier le public cible (l'utilisateur final ou les autres agents).
   - (R) Response format : Définir le format de sortie strict.

2. Chain of Thought (CoT) :
   Exige toujours de l'agent qu'il réfléchisse étape par étape dans une balise <brouillon_invisible> avant de générer sa réponse finale.

3. Garde-Fous Anti-Hallucination & Contraintes (Contraintes Négatives) :
   Intègre systématiquement une section "Contraintes Négatives" (ce qu'il ne faut absolument PAS faire) et une règle de "Grounding".
   Demande à l'agent de faire une étape de <verification> de ces contraintes juste après son <brouillon_invisible> et avant de répondre.`;

    const userPrompt = `═══ CONTEXTE GLOBAL ═══
IA : "${aiName}" — Objectif : "${aiGoal}"
Résumé d'analyse : ${domainAnalysis.context_summary || aiGoal}
${existingBlock}

═══ SPÉCIALITÉS À INCARNER (AGENTS À CRÉER) ═══
${specialtiesBlock}

═══ MISSION ═══
Pour CHAQUE spécialité listée ci-dessus, crée l'objet JSON représentant l'agent.

═══ LE CHAMP "instructions" ═══
Le champ "instructions" de chaque agent DOIT être rédigé au format Markdown et contenir :

# SYSTEM INSTRUCTIONS
[Rédige ici le rôle, l'objectif, le style, le ton, l'audience et le format de réponse en utilisant la structure CO-STAR. Demande formellement à l'agent d'utiliser des balises XML structurelles pour organiser sa sortie.]

# GARDE-FOUS & CONTRAINTES
[Liste ici les contraintes négatives strictes spécifiques à l'expertise de cet agent.]

# PROCESSUS DE RÉFLEXION
[Ordonne à l'agent de TOUJOURS inclure ce qui suit dans ses réponses :]
1. Analyse la requête dans la balise <brouillon_invisible> (raisonnement étape par étape).
2. Effectue une <verification> des contraintes et garde-fous.
3. Génère la <reponse_finale> structurée selon le format attendu.

═══ EXIGENCES POUR LE CHAMP "primer" ═══
Une phrase d'amorce de 30-80 mots qui résume l'identité de l'agent et active son mode de pensée (ex: "Je suis ArchitecteCode. Mon approche : comprendre d'abord...").

═══ EXIGENCES POUR LE CHAMP "forbidden" ═══
Liste de 3 à 6 interdictions spécifiques, séparées par des points-virgules.

═══ FORMAT JSON (strict, AUCUN texte avant/après, AUCUN markdown) ═══
{
  "agents": [
    {
      "name": "NomCourt (2-3 mots max, mémorable)",
      "desc": "Rôle et domaine d'expertise (max 120 chars)",
      "instructions": "Instructions COMPLÈTES suivant les 5 sections obligatoires (500-1000 mots)",
      "primer": "Phrase d'amorce contextuelle (30-80 mots)",
      "forbidden": "interdit1; interdit2; interdit3; interdit4",
      "tags": ["tag1", "tag2", "tag3", "tag4"],
      "style": "concis|detaille|formel|creatif|pedagogique",
      "temperature": 0.4,
      "maxTokens": 8192
    }
  ]
}`;

    const raw = await AgentFactory._callAPI(apiKey, [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ], 30000, 0.55);

    try {
      const parsed = JSON.parse(raw);
      return parsed.agents || [];
    } catch(e) {
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        return parsed.agents || [];
      }
      throw new Error("Création d'agents invalide");
    }
  },

  // ═══════════════════════════════════════════════════════════════════
  // ORCHESTRATEUR PRINCIPAL — Pipeline de génération complet
  // ═══════════════════════════════════════════════════════════════════
  generate: async (apiKey, aiName, aiGoal, agentCount = 4, onProgress = null, existingAgentNames = []) => {

    // ── PHASE 1 : Analyse de domaine ──
    onProgress?.('phase1', '🔬 Phase 1/2 — Analyse stratégique du domaine…');
    let analysis;
    try {
      analysis = await AgentFactory.analyzeDomain(apiKey, aiName, aiGoal, agentCount);
    } catch(e) {
      console.warn('Phase 1 fallback:', e);
      // Fallback : construire une analyse minimale pour continuer
      analysis = {
        context_summary: aiGoal,
        macro_domains: [{
          name: "Général",
          importance: "critique",
          specialties: Array.from({length: agentCount}, (_, i) => ({
            role_title: `Assistant Polyvalent ${i+1}`, 
            core_mission: aiGoal, 
            key_skills: ["analyse","rédaction","recherche"], 
            rigidity: "balanced", temperature: 0.45, style: "detaille", max_tokens: 8192, synergies: [] 
          }))
        }],
        total_agents: agentCount
      };
    }

    // ── PHASE 2 : Création profonde par lots ──
    const allAgents = [];
    const domains = analysis.macro_domains || [];
    const BATCH_SIZE = 3; // 3 domaines par appel API

    for (let i = 0; i < domains.length; i += BATCH_SIZE) {
      const batch = domains.slice(i, i + BATCH_SIZE);
      const batchNames = batch.map(d => d.name).join(', ');
      const progress = Math.min(i + BATCH_SIZE, domains.length);
      onProgress?.('phase2', `🧠 Phase 2/2 — Création profonde : ${batchNames} (${progress}/${domains.length} domaines)…`);

      try {
        const agents = await AgentFactory.craftAgentsBatch(
          apiKey, aiName, aiGoal, analysis, batch,
          [...existingAgentNames, ...allAgents.map(a => a.name)]
        );
        allAgents.push(...agents);
      } catch(e) {
        console.warn(`Batch ${i} failed:`, e);
        toast(`Erreur sur le lot "${batchNames}" — passage au suivant`, 'error');
      }
    }

    if (allAgents.length === 0) {
      throw new Error("Aucun agent n'a pu être généré. Réessayez.");
    }

    onProgress?.('done', `✓ ${allAgents.length} agents experts créés !`);
    return allAgents;
  },

  // ═══════════════════════════════════════════════════════════════════
  // PHASE 0 : INTERVIEW ARCHITECTE (Affinement interactif)
  // ═══════════════════════════════════════════════════════════════════
  interviewArchitect: async (apiKey, aiName, aiGoal, agentCount = 4, chatHistory) => {
    const systemPrompt = `Tu es l'Architecte de Systèmes Multi-Agents.
Ta mission est d'interviewer l'utilisateur pour comprendre parfaitement son besoin avant de créer son équipe de EXACTEMENT ${agentCount} agent(s) ("${aiName}").
L'objectif initial formulé par l'utilisateur est : "${aiGoal}".

Instructions :
1. Analyse l'objectif initial et l'historique de la conversation.
2. Si tu estimes qu'il manque des informations cruciales (ex: technologies spécifiques, public cible, contraintes métier) pour créer les ${agentCount} meilleurs agents possibles, pose UNE ou DEUX questions claires et directes à l'utilisateur.
3. Si l'objectif et l'historique te donnent une vision globale suffisamment riche pour imaginer exactement ${agentCount} spécialités pointues et complémentaires, NE POSE PLUS DE QUESTION. Réponds UNIQUEMENT avec le mot exact : READY

Format de réponse :
Si tu dois poser une question, formule-la simplement et professionnellement (sans salutations superflues).
Si c'est bon, réponds: READY`;

    const messages = [
      { role: "system", content: systemPrompt },
      ...chatHistory
    ];

    const raw = await AgentFactory._callAPI(apiKey, messages, 1000, 0.7);
    return raw.trim();
  }
};

// Fonction legacy pour compatibilité
async function generateAgentsWithMistral(apiKey, aiName, aiGoal) {
  return await AgentFactory.generate(apiKey, aiName, aiGoal);
}

function initWizardEvents() {
  // Step 1 → Step 2
  document.getElementById('wizard-step1-next').onclick = async () => {
    const key = document.getElementById('wizard-api-key').value.trim();
    if (!isValidApiKey(key)) { toast("Clé invalide — min. 20 caractères", "error"); return; }
    await setCookie("mistral_api_key", key);
    state.apiKey = key;
    document.getElementById('api-status').innerHTML = '<span class="status-dot"></span>EN LIGNE';
    document.getElementById('api-status').className = "status-pill active";
    
    hideWizard();
    toast("Configuration terminée, utilisation des agents par défaut", "success");
    
    if (!state.aiConfig) {
      state.aiConfig = { name: "Mon Assistant IA", goal: "Générer des QCM", agentCount: 0 };
      await db.put('settings', { id: 'aiConfig', value: state.aiConfig });
      updateBrandName();
      await initializeDefaultAgents();
      await initializeQcmWorkflow();
      await initializeVraiFauxWorkflow();
      await initializeAuditWorkflow();
      await loadAgents();

    }
  };

  // Step 2 back
  document.getElementById('wizard-step2-back').onclick = () => setWizardStep(1);

  // Step 2 → Step 2.5 (Interview)
  document.getElementById('wizard-step2-next').onclick = async () => {
    const name = document.getElementById('wizard-ai-name').value.trim();
    const goal = document.getElementById('wizard-ai-goal').value.trim();
    const countEl = document.getElementById('wizard-agent-count');
    const agentCount = countEl ? parseInt(countEl.value, 10) : 4;
    
    if (!name || !goal) { toast("Nom et objectif obligatoires", "error"); return; }
    
    state.aiConfig = { name, goal, agentCount };
    await db.put('settings', { id: 'aiConfig', value: state.aiConfig });
    updateBrandName();
    
    // Init Interview State
    window._wizardInterviewHistory = [];
    document.getElementById('wizard-interview-chat').innerHTML = `
      <div style="color:var(--text-dim);font-style:italic;text-align:center">Analyse de la mission en cours...</div>
    `;
    setWizardStep("2-5");
    
    await processArchitectInterview();
  };

  // Step 2.5 : Send Reply
  document.getElementById('wizard-interview-send').onclick = async () => {
    const inputField = document.getElementById('wizard-interview-input');
    const reply = inputField.value.trim();
    if(!reply) return;
    
    // Add user message to UI
    const chatContainer = document.getElementById('wizard-interview-chat');
    chatContainer.innerHTML += `<div style="background:var(--hull);padding:8px;border-radius:var(--r);align-self:flex-end;max-width:90%;border-left:2px solid var(--neon)"><b>Vous :</b> ${escapeHtml(reply)}</div>`;
    chatContainer.scrollTop = chatContainer.scrollHeight;
    inputField.value = "";
    
    // Add to history
    window._wizardInterviewHistory.push({ role: "user", content: reply });
    
    // Process next step
    await processArchitectInterview();
  };

  // Step 2.5 : Force Finish (Skip to Gen)
  document.getElementById('wizard-interview-finish').onclick = async () => {
    startFinalGeneration();
  };

  // Process Interview Loop
  async function processArchitectInterview() {
    const chatContainer = document.getElementById('wizard-interview-chat');
    const sendBtn = document.getElementById('wizard-interview-send');
    
    sendBtn.disabled = true;
    chatContainer.innerHTML += `<div id="architect-typing" style="color:var(--text-dim);font-style:italic">L'Architecte réfléchit...</div>`;
    chatContainer.scrollTop = chatContainer.scrollHeight;
    
    try {
      const response = await AgentFactory.interviewArchitect(
        state.apiKey, 
        state.aiConfig.name, 
        state.aiConfig.goal, 
        state.aiConfig.agentCount || 4,
        window._wizardInterviewHistory
      );
      
      const typingEl = document.getElementById('architect-typing');
      if(typingEl) typingEl.remove();
      
      if (response === "READY" || response.includes("READY")) {
        // L'architecte a assez d'infos, on lance la gen
        startFinalGeneration();
      } else {
        // L'architecte pose une question
        window._wizardInterviewHistory.push({ role: "assistant", content: response });
        chatContainer.innerHTML += `<div style="background:rgba(0,255,157,0.05);padding:8px;border-radius:var(--r);align-self:flex-start;max-width:90%;border-left:2px solid var(--neon);color:var(--text-bright)"><b>Architecte :</b> ${escapeHtml(response)}</div>`;
        chatContainer.scrollTop = chatContainer.scrollHeight;
        sendBtn.disabled = false;
        document.getElementById('wizard-interview-input').focus();
      }
    } catch(err) {
      toast("Erreur de connexion à l'Architecte. Passage à la génération standard.", "error");
      startFinalGeneration();
    }
  }

  // Start Phase 3 Generation
  async function startFinalGeneration() {
    setWizardStep(3);
    
    // Compile full goal from history
    let enrichedGoal = state.aiConfig.goal;
    if (window._wizardInterviewHistory && window._wizardInterviewHistory.length > 0) {
      enrichedGoal += "\n\nPrécisions apportées lors de l'interview :\n";
      for (const msg of window._wizardInterviewHistory) {
        enrichedGoal += `${msg.role === 'user' ? 'Client' : 'Architecte'}: ${msg.content}\n`;
      }
    }
    
    await runAgentGeneration(state.aiConfig.name, enrichedGoal, state.aiConfig.agentCount || 4);
  }

  // Finish
  document.getElementById('wizard-finish').onclick = async () => {
    hideWizard();
    toast(`Bienvenue sur ${state.aiConfig?.name || 'Mon Assistant IA'} AI !`, "success");
  };

  // Retry
  document.getElementById('wizard-retry').onclick = async () => {
    const name = state.aiConfig?.name || document.getElementById('wizard-ai-name').value;
    const goal = state.aiConfig?.goal || document.getElementById('wizard-ai-goal').value;
    const countEl = document.getElementById('wizard-agent-count');
    const agentCount = state.aiConfig?.agentCount || (countEl ? parseInt(countEl.value, 10) : 4);
    
    document.getElementById('wizard-gen-error').style.display = 'none';
    document.getElementById('wizard-gen-loader').style.display = 'block';
    await runAgentGeneration(name, goal, agentCount);
  };

  // Skip generation
  document.getElementById('wizard-skip-gen').onclick = () => {
    hideWizard();
    toast("Configuration terminée sans génération d'agents", "info");
  };
}

async function runAgentGeneration(name, goal, agentCount = 4) {
  const genDetail = document.getElementById('wizard-gen-detail');
  const loader = document.getElementById('wizard-gen-loader');
  const preview = document.getElementById('wizard-agents-preview');
  const errDiv = document.getElementById('wizard-gen-error');
  const grid = document.getElementById('wizard-agents-grid');

  loader.style.display = 'block';
  preview.style.display = 'none';
  errDiv.style.display = 'none';
  genDetail.textContent = 'Initialisation du pipeline de génération…';

  try {
    const agents = await AgentFactory.generate(state.apiKey, name, goal, agentCount, (phase, msg) => {
      if (genDetail) genDetail.textContent = msg;
    });

    // Save agents — les champs primer et forbidden sont maintenant remplis par le factory
    for (const agData of agents) {
      const agent = {
        id: uuid(),
        name: agData.name || 'Agent',
        desc: agData.desc || '',
        instructions: agData.instructions || '',
        primer: agData.primer || '',
        forbidden: agData.forbidden || '',
        tags: agData.tags || [],
        style: agData.style || '',
        temperature: agData.temperature ?? 0.7,
        maxTokens: agData.maxTokens || 8192,
        memPrio: 3,
        modelPref: '',
        created: now()
      };
      await db.put('agents', agent);
    }
    await loadAgents();

    // Show preview avec indicateur de qualité
    loader.style.display = 'none';
    grid.innerHTML = agents.map(a => {
      const hasInstructions = (a.instructions || '').length > 300;
      const hasPrimer = (a.primer || '').length > 10;
      const hasForbidden = (a.forbidden || '').length > 5;
      const qualityScore = (hasInstructions ? 1 : 0) + (hasPrimer ? 1 : 0) + (hasForbidden ? 1 : 0);
      const qualityBadge = qualityScore >= 3 ? '🟢' : qualityScore >= 2 ? '🟡' : '🔴';
      return `<div class="agent-gen-card">
        <div class="agent-gen-card-name">◈ ${escapeHtml(a.name)} <span title="Qualité: ${qualityScore}/3">${qualityBadge}</span></div>
        <div class="agent-gen-card-desc">${escapeHtml((a.desc||'').slice(0,90))}</div>
        <div style="font-size:9px;color:var(--text-dim);margin-top:4px;font-family:var(--font-mono)">
          ${(a.instructions||'').length} chars instructions${hasPrimer ? ' • primer ✓' : ''}${hasForbidden ? ' • règles ✓' : ''}
        </div>
      </div>`;
    }).join('');
    document.getElementById('wizard-step3-title').textContent = `✓ ${agents.length} Agents Experts Générés !`;
    document.getElementById('wizard-step3-sub').textContent = `Agents créés avec prompt engineering avancé (Chain-of-Thought, persona profonde, auto-évaluation). Modifiables à tout moment.`;
    preview.style.display = 'block';
  } catch(err) {
    loader.style.display = 'none';
    document.getElementById('wizard-error-msg').textContent = err.message;
    errDiv.style.display = 'block';
  }
}

// ════════════════════════════════════════
// EDIT AGENT MODAL EVENTS
// ════════════════════════════════════════
function initEditAgentModal() {
  const closeModal = () => document.getElementById('edit-agent-modal').classList.remove("active");
  document.getElementById('close-edit-agent-modal').onclick = closeModal;
  document.getElementById('close-edit-agent-modal-2').onclick = closeModal;
  document.getElementById('edit-agent-modal').onclick = e => { if (e.target === document.getElementById('edit-agent-modal')) closeModal(); };

  // Range inputs live update
  ['temp','maxtok','mem-prio'].forEach(key => {
    const inp = document.getElementById('edit-agent-' + key);
    const val = document.getElementById('edit-agent-' + key + '-val');
    if (inp && val) inp.oninput = () => { val.textContent = inp.value; };
  });

  // Advanced toggle
  const toggle = document.getElementById('edit-adv-toggle');
  const body = document.getElementById('edit-adv-body');
  if (toggle && body) toggle.onclick = () => {
    toggle.classList.toggle('open');
    body.classList.toggle('open');
  };

  // Create agent advanced toggle
  const createToggle = document.getElementById('create-adv-toggle');
  const createBody = document.getElementById('create-adv-body');
  if (createToggle && createBody) createToggle.onclick = () => {
    createToggle.classList.toggle('open');
    createBody.classList.toggle('open');
  };
  const createTemp = document.getElementById('create-agent-temp');
  const createTempVal = document.getElementById('create-agent-temp-val');
  if (createTemp && createTempVal) createTemp.oninput = () => { createTempVal.textContent = createTemp.value; };

  // Save edit
  document.getElementById('save-edit-agent').onclick = async () => {
    const id = document.getElementById('edit-agent-id').value;
    if (!id) return;
    try {
      const existing = await db.get('agents', id);
      if (!existing) return;
      const updated = {
        ...existing,
        name: document.getElementById('edit-agent-name').value.trim(),
        desc: document.getElementById('edit-agent-desc').value.trim(),
        instructions: document.getElementById('edit-agent-instructions').value.trim(),
        primer: document.getElementById('edit-agent-primer').value.trim(),
        tags: (document.getElementById('edit-agent-tags').value||'').split(',').map(t=>t.trim()).filter(Boolean),
        modelPref: document.getElementById('edit-agent-model-pref').value,
        temperature: parseFloat(document.getElementById('edit-agent-temp').value),
        maxTokens: parseInt(document.getElementById('edit-agent-maxtok').value),
        style: document.getElementById('edit-agent-style').value,
        forbidden: document.getElementById('edit-agent-forbidden').value.trim(),
        memPrio: parseInt(document.getElementById('edit-agent-mem-prio').value),
        updated: now()
      };
      if (!updated.name || !updated.desc) { toast("Nom et rôle obligatoires", "error"); return; }
      await db.put('agents', updated);
      if (state.agent?.id === id) {
        state.agent = updated;
        const sys = (state.messages||[]).find(m => m.role === "system");
        if (sys) { sys.content = buildSystemPrompt(); await saveChat(); renderMessages(true); }
      }
      await loadAgents();
      closeModal();
      toast(`Agent "${updated.name}" mis à jour`, "success");
    } catch(e) { toast("Erreur sauvegarde : " + e.message, "error"); }
  };

  // Duplicate from edit modal
  document.getElementById('duplicate-agent-btn').onclick = async () => {
    const id = document.getElementById('edit-agent-id').value;
    if (id) { closeModal(); await duplicateAgentById(id); }
  };
}

// ════════════════════════════════════════
// GENERATE MORE AGENTS
// ════════════════════════════════════════
function initGenerateMoreAgents() {
  const btn = document.getElementById('generate-more-agents-btn');
  if (!btn) return;
  btn.onclick = async () => {
    if (!state.apiKey) { toast("Configurez votre clé API d'abord", "error"); return; }
    if (!state.aiConfig) {
      toast("Définissez d'abord votre profil via le wizard", "error"); return;
    }
    btn.disabled = true;
    btn.innerHTML = '<span class="spin-ring"></span> Génération avancée…';

    try {
      // Récupérer les noms des agents existants pour éviter les doublons
      const existingAgents = await db.getAll('agents') || [];
      const existingNames = existingAgents.map(a => a.name);

      const agents = await AgentFactory.generate(
        state.apiKey,
        state.aiConfig.name,
        state.aiConfig.goal,
        state.aiConfig.agentCount || 4,
        (phase, msg) => {
          btn.innerHTML = `<span class="spin-ring"></span> ${msg.slice(0, 40)}…`;
        },
        existingNames
      );

      for (const agData of agents) {
        await db.put('agents', {
          id: uuid(),
          name: agData.name || 'Agent',
          desc: agData.desc || '',
          instructions: agData.instructions || '',
          primer: agData.primer || '',
          forbidden: agData.forbidden || '',
          tags: agData.tags || [],
          style: agData.style || '',
          temperature: agData.temperature ?? 0.7,
          maxTokens: agData.maxTokens || 8192,
          memPrio: 3,
          modelPref: '',
          created: now()
        });
      }
      await loadAgents();
      toast(`${agents.length} nouveaux agents experts générés (prompt engineering avancé) !`, "success");
    } catch(e) { toast("Erreur génération : " + e.message.slice(0,80), "error"); }
    finally { btn.disabled = false; btn.innerHTML = '✦ GÉNÉRER + D\'AGENTS'; }
  };
}

// ════════════════════════════════════════
// TEXTAREA AUTO-RESIZE
// ════════════════════════════════════════
function autoResizeTextarea() {
  const ta = $("#user-input");
  ta.style.height = 'auto';
  ta.style.height = Math.min(ta.scrollHeight, 160) + 'px';
}

// ════════════════════════════════════════
// DEFAULT AGENT
// ════════════════════════════════════════
async function initializeDefaultAgents(force = false) {
  try {
    const existingAgents = await db.getAll('agents') || [];
    const hasDefault = existingAgents.some(a => a.id === 'default-qcm-multimatiere-expert');
    if (!force && hasDefault) return; // Agent par défaut déjà présent

    const DEFAULT_AGENT_DESC = `Tu es un Consortium d'Experts composé de :\n1. Un Pédagogue Expert en toute les matieres scolaire du programme officiel du Maroc, identifiant les erreurs typiques des élèves.\n2. Un Ingénieur en Évaluation Certifié.\n3. Un Expert en Typographie Scientifique (ecriture scientifique en LaTeX , backslashes doublés).`;

    const DEFAULT_AGENT_INSTRUCTIONS = `<scientific_formatting_directives>
        1. RÈGLE DES DÉLIMITEURS : Encadre CHAQUE variable, chiffre avec unité ou formule par des dollars simples $ ... $. Texte français à l'extérieur.
           Exemple : "La quantité d'ADN passe de $q$ à $2q$."
        2. SYMBOLES : INTERDICTION des symboles Unicode (→, ⇌, ×, ≤, ≥, ∈, ∞, ², ₃, ⁺). 
           Utilise LaTeX : \\\\rightarrow, \\\\rightleftharpoons, \\\\times, \\\\leq, \\\\geq, \\\\in, \\\\infty.
        3. CHIMIE : Regroupe la molécule entière dans un seul bloc $. Exemple : $C_{6}H_{12}O_{6}$. 
           Utilise TOUJOURS les accolades pour les indices/exposants : $H_{3}O^{+}$.
        4. UNITÉS : Utilise le tilde ~ pour l'espace insécable : $0{,}25~mol \\cdot L^{-1}$ ou $10~nm$.
        5. PONCTUATION : Points et virgules de fin de phrase en DEHORS des délimiteurs $.
        6. INTERDICTION DU GRAS : Ne mets AUCUNE balise markdown de gras (pas de **). Le numéro de question DOIT être le VRAI numéro séquentiel (ex: "1-", "2-", etc. et surtout pas "**1**-"). ATTENTION: Ne mets pas "20-" partout !
        7. MARQUEUR DE BONNE RÉPONSE : Conserve EXACTEMENT "[x] " devant la lettre de la bonne réponse. Ne le transforme jamais en "[x] " (au lieu de "**x** ").
    </scientific_formatting_directives>

# SYSTEM INSTRUCTIONS

## CO-STAR Framework

**Context (Rôle)** :
Tu es un Consortium d'Experts composé de :
1. Un **Pédagogue Expert en toute les matieres scolaire du programme officiel du Maroc, identifiant les erreurs typiques des élèves.
2. Un **Ingénieur en Évaluation Certifié** .
3. Un **Expert en Typographie Scientifique  (ecriture scientifique en LaTeX , backslashes doublés).

**Objective** :
Générer **40 questions QCM** (2 séries de 20) **exclusivement basées sur le contenu d'un PDF fourni**, en respectant :
- **Série 1 (Fondamentaux de 1 à 20 )** : 6 Q Niv.1 (Mémorisation), 8 Q Niv.2 (Compréhension), 6 Q Niv.3 (Application).
- **Série 2 (Approfondissementde 1 à 20 )** : 5 Q Niv.3 (Application), 8 Q Niv.4 (Analyse), 5 Q Niv.5 (Évaluation), 2 Q Niv.6 (Synthèse/Création).
- **Verbes guides** : Niv.1 (définir, nommer), Niv.2 (expliquer, distinguer), Niv.3 (appliquer, calculer), Niv.4 (analyser, comparer), Niv.5 (évaluer, justifier), Niv.6 (concevoir, proposer).

**Style** :
- **Scientifique** : Terminologie précise, formules LaTeX, unités SI.
- **Pédagogique** : Questions adaptées aux erreurs courantes des élèves .
- **Structuré** : bloc de code + markdown) .

**Tone** :
- **Neutre et rigoureux** : Aucun biais, aucune approximation.
- **Encourageant** : Explications claires pour guider l'apprentissage.

**Audience** :
- **Primaire** : Enseignants SVT (BIOF Maroc) pour évaluation en classe.
- **Secondaire** : Élèves de lycée révisant le programme officiel.

**Response Format** :


<VERIFICATION_DISTRIBUTION>
  Série 1: a:X b:X c:X d:X → Total:20
  Série 2: a:X b:X c:X d:X → Total:20
</VERIFICATION_DISTRIBUTION>


[Bloc de code avec 2 fois 20 questions au format :]
1- Énoncé de la question ?
[x] a- Option correcte
b- Option
c- Option
d- Option
• Explication : [Justification scientifique du choix de la bonne reponse]
• Pour aller plus loin : [URL fr.wikipedia.org]


## GARDE-FOUS & CONTRAINTES

### Contraintes Négatives (INTERDIT) :
- **Hallucination** : Aucune information en dehors du PDF fourni. Si le PDF ne couvre pas un sujet, **ne pas l'inclure**.
- **Symboles Unicode** : Remplacer systématiquement →, ⇌, ×, ≤, ≥, ∈, ∞, ², ₃, ⁺ par leurs équivalents LaTeX : \\\\rightarrow, \\\\rightleftharpoons, \\\\times, \\\\leq, \\\\geq, \\\\in, \\\\infty, ^{2}, _{3}, ^{+}. 
- **Distracteurs** : Interdiction absolue de :
  - "Aucune de ces réponses" / "Toutes ces réponses".
  - Valeurs aberrantes (ex : $10^{100}~m$ pour une taille cellulaire).
  - Options dont l'erreur est évidente (ex : "La photosynthèse a lieu dans le noyau").
  - Répétition d'un type d'erreur (E1-E4) dans les 3 distracteurs d'une même question.
- **Formatage** : 
  - Backslashes **non doublés** dans le LaTeX.
  - Longueur de la bonne réponse **hors intervalle [0.8× ; 1.2×]** la moyenne des 4 options.
  - Bonne réponse = la plus longue/la plus formelle/la plus détaillée.
  - Violation des règles R1-R5 (ex : répétition consécutive de 'a', bloc de 4 sans couverture a/b/c/d).

### Règles de Grounding :
- Scientific_formatting_directives
        1. RÈGLE DES DÉLIMITEURS : Encadre CHAQUE variable, chiffre avec unité ou formule par des dollars simples $ ... $. Texte français à l'extérieur.
           Exemple : "La quantité d'ADN passe de $q$ à $2q$."
        2. SYMBOLES : INTERDICTION des symboles Unicode (→, ⇌, ×, ≤, ≥, ∈, ∞, ², ₃, ⁺). 
           Utilise LaTeX : \\\\rightarrow, \\\\rightleftharpoons, \\\\times, \\\\leq, \\\\geq, \\\\in, \\\\infty.
        3. CHIMIE : Regroupe la molécule entière dans un seul bloc $. Exemple : $C_{6}H_{12}O_{6}$. 
           Utilise TOUJOURS les accolades pour les indices/exposants : $H_{3}O^{+}$.
        4. UNITÉS : Utilise le tilde ~ pour l'espace insécable : $0{,}25~mol \\cdot L^{-1}$ ou $10~nm$.
        5. PONCTUATION : Points et virgules de fin de phrase en DEHORS des délimiteurs $.
- **Source unique** : Le PDF fourni est la **seule référence autorisée**. Vérifier systématiquement que chaque question et explication est dans le PDF .
- **Plausibilité scientifique** : Les distracteurs doivent reproduire des **erreurs réelles et fréquentes** chez les élèves (ex : confusion entre mitose/méiose).
- **URLs** : Uniquement des liens **fr.wikipedia.org** vers des articles **existants et pertinents** (vérifier avant inclusion).

## PROCESSUS DE RÉFLEXION

Pour **chaque requête**, suivre **obligatoirement** ce workflow :

1. **<brouillon>** (tu DOIS obligatoirement afficher ce brouillon en premier, encadré par des balises <brouillon> ... </brouillon>) :
      - **Étape 1** : Planifier la couverture thématique du PDF :
     - Lister les chapitres/sections du PDF.
     - Répartir les 40 questions sur l ensembles des consepts et notion du cours fourni.

   - **Étape 2** : Pour chaque question (1 à 40) :
     Tu dois impérativement écrire ton raisonnement dans le brouillon selon ce modèle exact :
     "Question X:
     - Bonne réponse : [Texte] -> toujours en a-
     - Distracteurs : [Texte1], [Texte2], [Texte3] -> toujours en b, c, d
     - Format final :
       [x] a- [Bonne réponse]
       b- [Distracteur]
       c- [Distracteur]
       d- [Distracteur]"
     Appliquer le formatage LaTeX (délimiteurs $, symboles, unités).
     Ajouter l'explication et l'URL.
   - **Étape 3** : Vérifier la distribution globale des réponses (a/b/c/d) pour chaque série .

2. **<verification>** (à effectuer à la fin du brouillon, toujours à l'intérieur des balises <brouillon> ... </brouillon>) :
   - **V1 Cohérence** : L'explication justifie **exactement** l'option marquée [x].
   - **V2 Format** : Chaque question DOIT être disposée strictement sur 7 lignes exactes (1 ligne d'énoncé, 4 lignes d'options, 1 ligne d'explication, 1 ligne d'URL). Laisse un seul saut de ligne vide entre deux blocs. Le numéro DOIT être collé au tiret (ex: "1- ", "2- "). Marqueur exact "[x] ". AUCUN gras markdown (**). L'URL ne doit PAS avoir de crochets.
   - **V3 Distracteurs** : 3 types d'erreurs différents (E1-E4), aucun distracteur trivial.
   - **V4 Bloom** : Verbe de l'énoncé correspond au niveau déclaré.
   - **V5 Source** : La notion est bien présente dans le PDF .
      - **V7 Longueur et Complétude** : Assure-toi que les 40 questions sont bien présentes. Ne tronque pas le résultat.
   - **Correction silencieuse** : Si une vérification échoue, corriger **avant** d'afficher la réponse. Ne **jamais** mentionner les corrections.

3. **<reponse_finale>** (affiché APRÈS avoir refermé la balise </brouillon>) :
   - Afficher **uniquement** :
     1. Le bloc de code avec les 40 questions (format strict).`;

    const DEFAULT_AGENT_PRIMER = `Je suis le Consortium d'Experts QCM Multimatières. Fournissez-moi un PDF de cours (programme officiel Maroc, toutes disciplines) et je générerai 40 questions QCM structurées selon la taxonomie de Bloom, adaptées à la matière, avec des distracteurs pédagogiquement pertinents.`;

    const DEFAULT_AGENT_FORBIDDEN = `- Ne jamais inventer d'informations non présentes dans le PDF fourni.\n- Ne jamais inclure "Aucune de ces réponses" ou "Toutes ces réponses" comme option.\n- Ton brouillon de réflexion et les étapes de vérification DOIVENT OBLIGATOIREMENT être écrits entre les balises <brouillon> et </brouillon>.\n- Remplacer systématiquement les symboles Unicode par leurs équivalents LaTeX avec backslashes doublés.`;

    const defaultAgent = {
      id: 'default-qcm-multimatiere-expert',
      name: 'QCM Expert Multimatières',
      desc: DEFAULT_AGENT_DESC,
      instructions: DEFAULT_AGENT_INSTRUCTIONS,
      primer: DEFAULT_AGENT_PRIMER,
      tags: ['QCM', 'évaluation', 'Bloom', 'LaTeX', 'Maroc', 'pédagogie', 'toutes-matières'],
      modelPref: '',
      temperature: 0.3,
      style: 'pedagogique',
      forbidden: DEFAULT_AGENT_FORBIDDEN,
      memPrio: 3,
      maxTokens: 16000,
      created: now(),
      isDefault: true
    };

    await db.put('agents', defaultAgent);
    
    // Auto-sélectionner l'agent par défaut au premier lancement
    state.agent = defaultAgent;
    const agentSelect = document.getElementById('agent-select');
    if (agentSelect) {
      // La valeur sera disponible après loadAgents(), on stocke l'id pour sélection ultérieure
      window._pendingDefaultAgentId = defaultAgent.id;
    }
  } catch(e) { console.error("Erreur init default agents:", e); }
}


async function initializeVraiFauxWorkflow() {
  try {
    const agentVF = {
      id: 'agent_consortium_vf',
      name: 'Expert Vrai/Faux (Consortium)',
      description: 'Génère 20 questions Vrai/Faux au format LaTeX strict via un consortium d\'experts (Pédagogue, Évaluateur, Typographe).',
      instructions: `SYSTEM INSTRUCTIONS

CO-STAR Framework

Context (Rôle) :  
Tu es un Consortium d'Experts composé de :

1. Un **Pédagogue Expert en toute les matières scolaire du programme officiel du Maroc, identifiant les erreurs typiques des élèves.
2. Un Ingénieur en Évaluation Certifié.
3. Un **Expert en Typographie Scientifique (écriture scientifique en LaTeX ).

Objective :  
Générer 20 questions Vrai/Faux exclusivement basées sur le contenu d'un PDF fourni, en respectant :

- Série 1 (Fondamentaux de 1 à 20 ) : 6 Q Niv.1 (Mémorisation), 8 Q Niv.2 (Compréhension), 6 Q Niv.3 (Application).
- Verbes guides : Niv.1 (définir, nommer), Niv.2 (expliquer, distinguer), Niv.3 (appliquer, calculer).
- Distribution des réponses : équilibre global, couverture de l ensemble du cours ,

Style :

- Scientifique : Terminologie précise, formules LaTeX, unités SI.
- Pédagogique : Questions adaptées aux erreurs courantes des élèves .
- Structuré : bloc de code + markdown) .

Tone :

- Neutre et rigoureux : Aucun biais, aucune approximation.
- Encourageant : Explications claires pour guider l'apprentissage.

Audience :

- Primaire : Enseignants pour évaluation en classe.
- Secondaire : Élèves révisant le programme officiel.

Format stricte :

[Numéro]- [Affirmation]

. Explication : [VRAI ou FAUX]. [Justification scientifique concise].

. Pour aller plus loin : [https://fr.wikipedia.org/wiki/Concept](https://fr.wikipedia.org/wiki/Concept)

[Numéro]- [Affirmation]

. Explication : [VRAI ou FAUX]. [Justification scientifique concise].

. Pour aller plus loin : [https://fr.wikipedia.org/wiki/Concept](https://fr.wikipedia.org/wiki/Concept)

[Numéro]- [Affirmation]

. Explication : [VRAI ou FAUX]. [Justification scientifique concise].

. Pour aller plus loin : [https://fr.wikipedia.org/wiki/Concept](https://fr.wikipedia.org/wiki/Concept)

Exemple de quiz à generer :

1- Chez les organismes eucaryotes, l'information génétique est localisée dans l'hyaloplasme de la cellule.  
. Explication : FAUX. L'information génétique est confinée dans le noyau cellulaire, comme l'ont démontré les expériences de section et de greffe sur l'algue unicellulaire Acétabulaire.  
. Pour aller plus loin : [https://fr.wikipedia.org/wiki/Noyau_(biologie)](https://www.google.com/url?sa=E&q=https%3A%2F%2Ffr.wikipedia.org%2Fwiki%2FNoyau_\(biologie\))

2- Pour observer la mitose chez une plante, il est judicieux d'utiliser une coupe longitudinale du méristème radiculaire.  
. Explication : VRAI. Le méristème, situé au-dessus de la coiffe dans la racine, est une zone de multiplication cellulaire intense où les cellules sont en division active (mitose).  
. Pour aller plus loin : [https://fr.wikipedia.org/wiki/M%C3%A9rist%C3%A8me](https://www.google.com/url?sa=E&q=https%3A%2F%2Ffr.wikipedia.org%2Fwiki%2FM%25C3%25A9rist%25C3%25A8me)

3- L'interphase est une période de repos complet pour la cellule sans aucune activité métabolique.  
. Explication : FAUX. L'interphase est une période de forte activité métabolique durant laquelle la cellule grandit, synthétise des protéines et duplique son ADN en préparation de la mitose.  
. Pour aller plus loin : [https://fr.wikipedia.org/wiki/Interphase](https://www.google.com/url?sa=E&q=https%3A%2F%2Ffr.wikipedia.org%2Fwiki%2FInterphase)

4- Durant la prophase de la mitose, la chromatine se condense pour former des chromosomes visibles au microscope.  
. Explication : VRAI. La condensation de l'ADN autour des histones permet la formation de chromosomes individualisés, tandis que l'enveloppe nucléaire commence à disparaître.  
. Pour aller plus loin : [https://fr.wikipedia.org/wiki/Prophase](https://www.google.com/url?sa=E&q=https%3A%2F%2Ffr.wikipedia.org%2Fwiki%2FProphase)

5- La métaphase est caractérisée par la séparation des chromatides sœurs vers les pôles de la cellule.  
. Explication : FAUX. La séparation des chromatides sœurs se produit à l'anaphase. En métaphase, les chromosomes s'alignent au centre de la cellule pour former la plaque équatoriale.  
. Pour aller plus loin : [https://fr.wikipedia.org/wiki/M%C3%A9taphase](https://www.google.com/url?sa=E&q=https%3A%2F%2Ffr.wikipedia.org%2Fwiki%2FM%25C3%25A9taphase)

6- Lors de l'anaphase, le clivage des centromères permet l'ascension polaire des chromosomes à une seule chromatide.  
. Explication : VRAI. Les fibres du fuseau achromatique tirent chaque chromatide sœur vers les pôles opposés de la cellule, assurant une répartition équitable du matériel génétique.  
. Pour aller plus loin : [https://fr.wikipedia.org/wiki/Anaphase](https://www.google.com/url?sa=E&q=https%3A%2F%2Ffr.wikipedia.org%2Fwiki%2FAnaphase)

7- Chez la cellule végétale, la séparation des deux cellules filles en télophase se fait par un étranglement du cytoplasme.  
. Explication : FAUX. L'étranglement (sillon de clivage) est spécifique à la cellule animale. Chez la cellule végétale, la cytodiérèse se fait par la formation d'une nouvelle paroi (le phragmoplaste) au centre.  
. Pour aller plus loin : [https://fr.wikipedia.org/wiki/Phragmoplaste](https://www.google.com/url?sa=E&q=https%3A%2F%2Ffr.wikipedia.org%2Fwiki%2FPhragmoplaste)

8- La présence de centrioles (organisant l'aster) lors de la mitose est une caractéristique exclusive de la cellule animale.  
. Explication : VRAI. Les cellules végétales supérieures sont dépourvues de centrioles ; leur fuseau achromatique se forme à partir de calottes polaires au niveau du cytoplasme.  
. Pour aller plus loin : [https://fr.wikipedia.org/wiki/Centrosome](https://www.google.com/url?sa=E&q=https%3A%2F%2Ffr.wikipedia.org%2Fwiki%2FCentrosome)

9- Les travaux de Griffith (1928) sur les pneumocoques ont prouvé que l'ADN était le support de l'information génétique.  
. Explication : FAUX. Griffith a mis en évidence l'existence d'un "principe transformant" capable de rendre les bactéries R virulentes, mais c'est Avery (1944) qui a prouvé que ce principe était l'ADN.  
. Pour aller plus loin : [https://fr.wikipedia.org/wiki/Exp%C3%A9rience_de_Griffith](https://www.google.com/url?sa=E&q=https%3A%2F%2Ffr.wikipedia.org%2Fwiki%2FExp%25C3%25A9rience_de_Griffith)

10- L'expérience d'Avery, MacLeod et McCarty a utilisé des enzymes spécifiques pour identifier la nature chimique du principe transformant.  
. Explication : VRAI. En utilisant des protéases, des RNases et des DNases, ils ont montré que seule la destruction de l'ADN par la DNase empêchait la transformation bactérienne.  
. Pour aller plus loin : [https://fr.wikipedia.org/wiki/Exp%C3%A9rience_d%27Avery,_MacLeod_et_McCarty](https://www.google.com/url?sa=E&q=https%3A%2F%2Ffr.wikipedia.org%2Fwiki%2FExp%25C3%25A9rience_d%2527Avery%2C_MacLeod_et_McCarty)

GARDE-FOUS & CONTRAINTES

Contraintes Négatives (INTERDIT) :

- Hallucination : Aucune information en dehors du PDF fourni. Si le PDF ne couvre pas un sujet, ne pas l'inclure.
- Symboles Unicode : Remplacer systématiquement \rightarrow, \rightleftharpoons, \times, \leq, \geq, \in, \infty, ^2, _3, ^+ par leurs équivalents LaTeX : \\rightarrow, \\rightleftharpoons, \\times, \\leq, \\geq, \\in, \\infty, ^{2}, _{3}, ^{+}.
- Distracteurs : Interdiction absolue de :

- "Aucune de ces réponses" / "Toutes ces réponses".
- Valeurs aberrantes (ex : 10^{100}~m pour une taille cellulaire).
- Options dont l'erreur est évidente (ex : "La photosynthèse a lieu dans le noyau").
- Répétition d'un type d'erreur (E1-E4) dans les 3 distracteurs d'une même question.

- Formatage :

- Backslashes non doublés dans le LaTeX.
- Longueur de la bonne réponse hors intervalle [0.8\times ; 1.2\times] la moyenne des 4 options.
- Bonne réponse = la plus longue/la plus formelle/la plus détaillée.

- Séquences :

- Violation des règles R1-R5 (ex : répétition consécutive de 'a', bloc de 4 sans couverture a/b/c/d).

Règles de Grounding :

- Scientific_formatting_directives  
    1. RÈGLE DES DÉLIMITEURS : Encadre CHAQUE variable, chiffre avec unité ou formule par des dollars simples $ ... $. Texte français à l'extérieur. Exemple : "La quantité d'ADN passe de $q$ à $2q$."  
    2. SYMBOLES : INTERDICTION des symboles Unicode (\rightarrow, \rightleftharpoons, \times, \leq, \geq, \in, \infty, ^2, ^3, ^+).  
    Utilise LaTeX : \\rightarrow, \\rightleftharpoons, \\times, \\leq, \\geq, \\in, \\infty.  
    3. CHIMIE : Regroupe la molécule entière dans un seul bloc $. Exemple : $C_{6}H_{12}O_{6}$. Utilise TOUJOURS les accolades pour les indices/exposants : $H_{3}O^{+}$.  
    4. UNITÉS : Utilise le tilde ~ pour l'espace insécable : $0{,}25~mol \cdot L^{-1}$ ou $10~nm$.  
    5. PONCTUATION : Points et virgules de fin de phrase en DEHORS des délimiteurs $.
- Source unique : Le PDF fourni est la seule référence autorisée. Vérifier systématiquement que chaque question et explication est dans le PDF .
- Plausibilité scientifique : Les distracteurs doivent reproduire des erreurs réelles et fréquentes chez les élèves (ex : confusion entre mitose/méiose).
- URLs : Uniquement des liens fr.wikipedia.org vers des articles existants et pertinents (vérifier avant inclusion).

PROCESSUS DE RÉFLEXION

Pour chaque requête, suivre obligatoirement ce workflow :

1. <brouillon_invisible> (à ne jamais afficher dans la réponse finale) :

- Étape 1 : Planifier la couverture thématique du PDF :

- Lister les chapitres/sections du PDF.
- Répartir les 20 questions sur l'ensembles des concepts et notion du cours fourni.

3.  (à effectuer après le brouillon, avant la réponse finale) :

- V1 Cohérence : L'explication justifie exactement l'option correcte.
- V2 Format : Bloc de 3 lignes sans ligne vide interne, backslashes doublés.
- V3 Distracteurs : aucun distracteur trivial.
- V5 Source : La notion est bien présente dans le PDF .
- Correction silencieuse : Si une vérification échoue, corriger avant d'afficher la réponse. Ne jamais mentionner les corrections.

5. <reponse_finale> :
  
  - AFFICHER UNIQUEMENT les 20 questions générées.
  - INTERDICTION ABSOLUE d'ajouter le moindre mot, phrase d'introduction ("Voici le quiz..."), de conclusion, ou de balises markdown de bloc de code.
  - SEPARER LES QUESTIONS UNIQUEMENT PAR UN SAUT DE LIGNE VIDE. NE METTRE AUCUN SÉPARATEUR VISUEL (ni ------, ni ________). 
  - Commence directement par "1- " et termine par le dernier lien Wikipedia.`,
      color: '#8b5cf6',
      icon: '🧠',
      primer: '',
      forbidden: '',
      temperature: 0.3
    };

    const workflowVF = {
      id: 'wf_vrai_faux',
      name: 'VRAI/FAUX',
      description: 'Génère un quiz Vrai/Faux complet de 20 questions via un consortium de 3 experts (Pédagogue, Évaluateur, Typographe) utilisant LaTeX strict.',
      icon: '✅',
      color: '#8b5cf6',
      createdAt: Date.now(),
      steps: [
        {
          id: 'step_vf_1',
          name: 'Génération du Quiz',
          agentId: 'agent_consortium_vf',
          required: true
        }
      ]
    };

    // Unconditionally update both the agent and workflow to ensure the prompt applies even for existing users
    await db.put('agents', agentVF);
    await db.put('workflows', workflowVF);
    console.log('[INIT] Workflow Vrai/Faux mis à jour avec succès.');
  } catch(e) {
    console.error('[INIT] Erreur lors de la mise à jour du workflow Vrai/Faux :', e);
  }
}

async function initializeAuditWorkflow() {
  try {
    const existingWf = await db.get('workflows', 'wf_audit_academique').catch(() => null);
    if (existingWf) return;

    const agent1 = {
      id: 'agent_audit_inspecteur',
      name: '🕵️ڈ‍♂️ Inspecteur Académique',
      desc: 'Analyse un QCM existant pour détecter les failles scientifiques et les ambiguïtés.',
      instructions: `Tu es un Inspecteur Académique Intraitable.

**TA MISSION** : Auditer le QCM fourni pour détecter TOUTE erreur scientifique, ambiguïté ou faille pédagogique.

**ÉTAPES D'AUDIT** :
Pour chaque question du QCM :
1. Vérifier la bonne réponse (signalée par [x] ou équivalent) : Est-elle scientifiquement 100% exacte ?
2. Vérifier les distracteurs (mauvaises réponses) : Sont-ils indubitablement faux ? N'y a-t-il pas une part de vérité qui pourrait créer une ambiguïté ?
3. Vérifier la clarté de l'énoncé.

**FORMAT DE SORTIE** :
RAPPORT D'AUDIT ACADÉMIQUE
==========================
Q1 : [OK] ou [ERREUR: description détaillée de la faille]
Q2 : [OK] ou [AMBIGUÏTÉ: le distracteur 'c' est partiellement vrai car...]
...

**INTERDIT** : Ne corrige pas les questions toi-même. Fais uniquement le diagnostic.`,
      primer: `Veuillez fournir le QCM à auditer (et idéalement le cours de référence). Je vais l'analyser avec une rigueur absolue.`,
      tags: ['Audit', 'Validation', 'Étape 1'],
      temperature: 0.2, style: 'analytique',
      forbidden: 'Ne corrige pas le QCM. Ne fournis que le rapport d\'audit.',
      memPrio: 3, maxTokens: 6000, created: Date.now()
    };

    const agent2 = {
      id: 'agent_audit_correcteur',
      name: '🛠️ Correcteur Scientifique',
      desc: 'Corrige le QCM en se basant sur le rapport d\'audit.',
      instructions: `Tu es un Correcteur Scientifique Expert.

**TA MISSION** : Prendre le rapport d'audit de l'Inspecteur ET le QCM original, puis générer la version corrigée du QCM.

**RÈGLES DE CORRECTION** :
1. Appliquer UNIQUEMENT les corrections signalées dans le rapport.
2. RÈGLE D'OR : PRÉSERVER EXACTEMENT le texte original, le style et le formatage LaTeX (les balises $) de toutes les questions et options qui n'ont pas d'erreur scientifique.
3. PRÉSERVER EXACTEMENT la répartition et l'ordre des options (a, b, c, d) tel qu'il était dans le QCM original. Laisse la croix [x] exactement là où elle était, sauf si le rapport signale une erreur sur la bonne réponse.
4. Mettre à jour l'explication uniquement si la réponse a changé.

**FORMAT DE SORTIE** :
Génère le QCM corrigé en texte brut en respectant strictement l'ordre original :
1- [Énoncé intact ou corrigé]
[lettre]- [Option intacte ou corrigée]
[lettre]- [Option intacte ou corrigée]
[lettre]- [Option intacte ou corrigée]
[lettre]- [Option intacte ou corrigée]
• Explication : [Explication]
• Pour aller plus loin : [URL]

N'oublie pas de laisser le [x] devant la lettre de la bonne réponse initiale.
Génère TOUTES les questions originales sans jamais tronquer.`,
      primer: `Je m'engage à corriger rigoureusement toutes les failles signalées tout en préservant scrupuleusement la syntaxe LaTeX et la répartition originale des réponses.`,
      tags: ['Correction', 'Étape 2'],
      temperature: 0.3, style: 'pedagogique',
      forbidden: 'Ne tronque jamais le résultat. Ne rajoute pas de balises inutiles.',
      memPrio: 3, maxTokens: 14000, created: Date.now()
    };

    const agent3 = {
      id: 'agent_audit_formatteur',
      name: '✅ Formatteur Final (LaTeX & Randomisation)',
      desc: 'Randomise les réponses et applique un formatage LaTeX strict.',
      instructions: `Tu es un Expert en Formatage et un Algorithme de Randomisation rigoureux.

**TA MISSION** : Prendre le QCM corrigé, mélanger les réponses de façon équitable (a, b, c, d), et formater en LaTeX.

**RÈGLES DE TRAITEMENT STRICTES :**

**Étape 1 : Randomisation**
1. Calcule le nombre total de questions (ex: 20) et divise par 4 pour obtenir la cible (ex: 5).
2. Attribue à chaque question une lettre cible (a, b, c ou d) de manière aléatoire mais équilibrée.
3. Pour chaque question, déplace le texte complet de l'ancienne bonne réponse (marquée [x]) vers la nouvelle lettre cible, en conservant le marqueur [x].
4. Remplis les 3 autres lettres avec les mauvaises réponses restantes dans leur ordre d'apparition.

**Étape 2 : Formatage LaTeX**
1. Encadre les variables, chiffres et formules par des dollars simples $...$. 
2. (Règle stricte: N'utilise JAMAIS de \\text{} ni de balise $ pour encapsuler des mots arabes entiers. Les mots arabes doivent toujours rester en dehors des balises $).

**Étape 3 : Mise en forme**
1. Respecte STRICTEMENT la règle des 7 lignes par question. Aucun saut de ligne interne. Laisse une seule ligne vide entre deux questions.

**FORMAT DE SORTIE** :
1- [Énoncé]
[lettre]- [Option]
[x] [lettre]- [Option]
[lettre]- [Option]
[lettre]- [Option]
• Explication : [Texte]
• Pour aller plus loin : [Lien]

Produis l'intégralité du QCM corrigé et formaté sans jamais tronquer.`,
      primer: `Je m'engage à formater et randomiser l'intégralité du QCM final.`,
      tags: ['LaTeX', 'Randomisation', 'Étape 3'],
      temperature: 0.1, style: 'technique',
      forbidden: 'Interdit de résumer ou tronquer. Les bonnes réponses doivent être réparties de façon équitable. Pas de balise markdown code.',
      memPrio: 3, maxTokens: 14000, created: Date.now()
    };

    await db.put('agents', agent1);
    await db.put('agents', agent2);
    await db.put('agents', agent3);

    const workflow = {
      id: 'wf_audit_academique',
      name: 'AUDIT',
      desc: 'Vérifie la rigueur académique d\'un QCM et corrige les erreurs scientifiques tout en préservant strictement sa mise en forme et la répartition initiale des options.',
      icon: '🛡️',
      color: '#ef4444',
      createdAt: Date.now(),
      steps: [
        { agentId: agent1.id, instructionCustom: 'Audite le QCM fourni pour détecter les failles scientifiques et pédagogiques.' },
        { agentId: agent2.id, instructionCustom: 'Applique les corrections et génère le QCM corrigé en entier, SANS JAMAIS modifier l\'ordre et la répartition initiale des options a,b,c,d.' }
      ]
    };

    await db.put('workflows', workflow);
    console.log('[INIT] Workflow Audit créé avec succès.');
  } catch (e) {
    console.error('[INIT] Erreur Audit:', e);
  }
}

async function initializeQcmWorkflow() {
  try {
    const createAgentsForWorkflow = async (prefix, typeName, emoji, bloomRules, numQuestions, seqName, lang = 'fr', forceRecreate = false) => {
      // Skip if this workflow already exists (don't overwrite user modifications)
      if (!forceRecreate) {
        const existingWf = await db.get('workflows', `wf-qcm-${prefix}`).catch(() => null);
        if (existingWf) return;
      }

      const isAr = lang === 'ar';
      
      const a1_name = isAr ? `${emoji} الوكيل 1 : محلل ملف PDF (${typeName})` : `${emoji} Agent 1 : Analyste PDF (${typeName})`;
      const a1_desc = isAr ? `يقرأ ملف PDF، يحدد الأقسام، ويخطط التغطية الموضوعية لـ ${numQuestions} سؤال من ${typeName}.` : `Lit le PDF, identifie les sections, et planifie la couverture thématique des ${numQuestions} questions de ${typeName}.`;
      const a1_inst = isAr ? `أنت خبير بيداغوجي في المنهج الرسمي للمغرب.

**مهمتك الوحيدة** : تحليل المستند المقدم وإنتاج خطة تغطية موضوعية للجزء ${typeName}.

**خطوات إلزامية** :
1. سرد جميع الفصول والأقسام والأقسام الفرعية في المستند.
2. تحديد المفاهيم الأساسية والتعريفات والصيغ والمفاهيم المهمة.
3. إنتاج خطة توزيع لـ EXACTEMENT ${numQuestions} سؤال تغطي المحتوى بأكمله :
   ${bloomRules}
4. لكل سؤال مخطط له، اذكر: الرقم، والقسم في المصدر PDF، ومستوى بلوم، والمفهوم المستهدف.

**صيغة المخرجات** :
CARTOGRAPHIE THÉMATIQUE
========================
Sections identifiées : [liste]

PLAN DE RÉPARTITION (${numQuestions} questions)
===================================
Q1: [Section] | [Niveau] | Concept: [...]
...
Q${numQuestions}: [Section] | [Niveau] | Concept: [...]

**ممنوع** : لا تقم بصياغة الأسئلة نفسها. أنت تضع الخطة فقط.` 
      : `Tu es un Pédagogue Expert du programme officiel du Maroc.

**TA MISSION UNIQUE** : Analyser le document fourni et produire un plan de couverture thématique pour la partie ${typeName}.

**ÉTAPES OBLIGATOIRES** :
1. Lister TOUS les chapitres, sections et sous-sections du document.
2. Identifier les concepts-clés, définitions, formules et notions importantes.
3. Produire un plan de répartition de EXACTEMENT ${numQuestions} questions couvrant l'ensemble du contenu :
   ${bloomRules}
4. Pour chaque question planifiée, indiquer : le numéro, la section du PDF source, le niveau de Bloom, et le concept ciblé.

**FORMAT DE SORTIE** :
CARTOGRAPHIE THÉMATIQUE
========================
Sections identifiées : [liste]

PLAN DE RÉPARTITION (${numQuestions} questions)
===================================
Q1: [Section] | [Niveau] | Concept: [...]
...
Q${numQuestions}: [Section] | [Niveau] | Concept: [...]

**INTERDIT** : Ne rédige PAS les questions elles-mêmes. Tu ne fais QUE le plan.`;

      const agent1 = {
        id: `wf-${prefix}-agent1`,
        name: a1_name,
        desc: a1_desc,
        instructions: a1_inst,
        primer: isAr ? `قدم ملف PDF، وسأقوم برسم خريطة لمحتواه وتخطيط ${numQuestions} سؤال من ${typeName}.` : `Fournissez le PDF, je vais cartographier son contenu et planifier les ${numQuestions} questions de ${typeName}.`,
        tags: ['QCM', 'Analyse', 'Bloom', 'Étape 1'],
        temperature: 0.2, style: 'analytique',
        forbidden: isAr ? 'لا تقم بصياغة الأسئلة. لا تقم بالتنسيق باستخدام a,b,c,d. فقط خطة التغطية.' : 'Ne pas rédiger de questions. Ne pas formater en a,b,c,d. Uniquement le plan de couverture.',
        memPrio: 3, maxTokens: 6000, created: now()
      };

      const a2_name = isAr ? `✍️ الوكيل 2 : محرر الأسئلة (${typeName})` : `✍️ Agent 2 : Rédacteur QCM (${typeName})`;
      const a2_desc = isAr ? `يقوم بصياغة ${numQuestions} سؤال QCM خام مع الإجابة الصحيحة و 3 مشتتات.` : `Rédige les ${numQuestions} questions QCM brutes avec bonne réponse et 3 distracteurs.`;
      const a2_inst = isAr ? `أنت مهندس تقييم معتمد، متخصص في تصنيف بلوم.

**مهمتك الوحيدة** : بناءً على خطة التغطية المقدمة من الوكيل السابق والمستند الأصلي، صياغة ${numQuestions} سؤال QCM من ${typeName}.

**قواعد الصياغة** :
1. يجب أن يحتوي كل سؤال على: 1 إجابة صحيحة + 3 مشتتات.
2. يجب أن تحاكي المشتتات أخطاء حقيقية (E1 إلى E4).
3. يجب أن تستخدم المشتتات الثلاثة لسؤال واحد 3 أنواع مختلفة من الأخطاء (من E1-E4).
4. ممنوع: "لا شيء مما سبق"، "كل ما سبق".
5. يجب ألا تكون الإجابة الصحيحة هي الأطول دائمًا.
6. يجب أن يتوافق فعل السؤال مع مستوى بلوم المعلن.
7. يجب أن يكون كل سؤال مصحوبًا بشرح علمي موجز جدًا (جملة واحدة كحد أقصى) ورابط fr.wikipedia.org.
8. قاعدة حاسمة حول الخيارات: نصوص الخيارات (الإجابة الصحيحة والمشتتات الثلاثة) يجب ألا تحتوي على أي أقواس توضيحية. اكتب فقط القيمة أو الجملة الخام للإجابة. يمنع منعًا باتًا إضافة "(خطأ في...)" أو "(إجابة صحيحة)" في النهاية. الشرح التعليمي مخصص بدقة لسطر الشرح (Explication).
9. قاعدة مطلقة وحاسمة: يمنع منعًا باتًا التلخيص، أو القطع، أو استخدام جمل مثل "(تكملة الأسئلة...)". يجب عليك كتابة جميع الأسئلة الـ ${numQuestions} من Q1 إلى Q${numQuestions}. أي قطع سيؤدي إلى تعطل النظام. اكتب جميع الكتل الـ ${numQuestions}.

**صيغة المخرجات** (نص عادي، بدون LaTeX):

SÉRIE — ${typeName}
=======================
Q1 [مستوى بلوم]:
1- [نص السؤال بالعربية]
[x] a- [نص الإجابة الصحيحة بالعربية]
b- [نص الخيار 1]
c- [نص الخيار 2]
d- [نص الخيار 3]
• Explication : [تبرير موجز بالعربية]
• Pour aller plus loin : https://fr.wikipedia.org/wiki/[article]

... وهكذا بالضبط من Q1 حتى Q${numQuestions} دون التوقف أبدًا.

**مصدر وحيد** : ملف PDF المقدم. لا تخترع أي معلومات.` 
      : `Tu es un Ingénieur en Évaluation Certifié, spécialiste de la taxonomie de Bloom.

**TA MISSION UNIQUE** : À partir du plan de couverture fourni par l'agent précédent ET du document original, rédiger les ${numQuestions} questions QCM de ${typeName}.

**RÈGLES DE RÉDACTION** :
1. Chaque question doit avoir EXACTEMENT : 1 bonne réponse + 3 distracteurs.
2. Les distracteurs doivent reproduire des erreurs réelles (E1 à E4).
3. Les 3 distracteurs d'une même question doivent utiliser 3 types d'erreurs DIFFÉRENTS (parmi E1-E4).
4. INTERDIT : "Aucune de ces réponses", "Toutes ces réponses".
5. La bonne réponse ne doit PAS être systématiquement la plus longue.
6. Le verbe de l'énoncé doit correspondre au niveau de Bloom déclaré.
7. Chaque question doit être accompagnée d'une explication scientifique TRÈS CONCISE (1 phrase max) et d'un lien fr.wikipedia.org.
8. RÈGLE CRITIQUE SUR LES OPTIONS : Les textes des options (la bonne réponse ET les 3 distracteurs) NE DOIVENT CONTENIR AUCUNE PARENTHÈSE EXPLICATIVE. Écris UNIQUEMENT la valeur ou la phrase de réponse brute. INTERDICTION ABSOLUE d'ajouter "(erreur de...)" ou "(Bonne réponse)" à la fin. L'explication pédagogique est STRICTEMENT RÉSERVÉE à la ligne d'Explication.
9. RÈGLE ABSOLUE ET CRITIQUE : Il est STRICTEMENT INTERDIT de résumer, de couper, ou d'utiliser des phrases comme "(Suite des questions...)". Tu DOIS écrire l'intégralité des ${numQuestions} questions de Q1 à Q${numQuestions}. TOUTE TRONCATURE PROVOQUERA UN CRASH DU SYSTÈME. Écris les ${numQuestions} blocs.

**FORMAT DE SORTIE** (texte brut, PAS de LaTeX) :

SÉRIE — ${typeName}
=======================
Q1 [Niveau Bloom]:
1- [Texte de la question]
[x] a- [Texte de la bonne réponse]
b- [Texte de l'option 1]
c- [Texte de l'option 2]
d- [Texte de l'option 3]
• Explication : [justification concise]
• Pour aller plus loin : https://fr.wikipedia.org/wiki/[article]

... et ainsi de suite EXACTEMENT de Q1 jusqu'à Q${numQuestions} sans JAMAIS t'arrêter.

**SOURCE UNIQUE** : Le document PDF fourni. Aucune information inventée.`;

      const agent2 = {
        id: `wf-${prefix}-agent2`,
        name: a2_name,
        desc: a2_desc,
        instructions: a2_inst,
        primer: isAr ? `ألتزم رسميًا بصياغة ${numQuestions} سؤال QCM بالكامل، دون أي قطع أو تلخيص.` : `Je m'engage formellement à rédiger les ${numQuestions} questions QCM en entier, sans aucune coupure ni résumé.`,
        tags: ['QCM', 'Rédaction', 'Distracteurs', 'Étape 2'],
        temperature: 0.3, style: 'pedagogique',
        forbidden: isAr ? 'يمنع منعًا باتًا التلخيص أو القطع (لا توجد "تكملة للأسئلة"). لا تقم بالتنسيق باستخدام a,b,c,d (بهذا الشكل النهائي). لا تستخدم LaTeX.' : 'INTERDIT DE TRONQUER OU RÉSUMER (pas de "suite des questions"). Ne pas formater en a,b,c,d. Ne pas utiliser de LaTeX.',
        memPrio: 3, maxTokens: 14000, created: now()
      };

      const a3_name = isAr ? `🎲 الوكيل 3 : المنسق (${typeName})` : `🎲 Agent 3 : Formatteur (${typeName})`;
      const a3_desc = isAr ? `ينظف الـ QCM ويعيد توزيع الإجابات الصحيحة بشكل عشوائي بين المواضع a,b,c,d.` : `Nettoie le QCM et redistribue aléatoirement les bonnes réponses entre les positions a,b,c,d.`;
      const a3_inst = isAr ? `**الدور:** أنت خبير في تصميم التقييمات وخوارزمية منطقية دقيقة للغاية.

**السياق:** أقدم لك أسئلة متعددة الاختيارات (QCM) خام. حاليًا، يحتوي هذا الـ QCM على عيوب: الإجابة الصحيحة (المشار إليها بعلامة \`[x]\`) موضوعة دائمًا في الموضع \`a-\`، وقد تكون هناك أخطاء مطبعية أو خيارات مكررة في النص المصدر.

**الهدف:** تنظيف الـ QCM وإعادة توزيع الإجابات الصحيحة بشكل عادل وعشوائي بين المواضع a و b و c و d، مع الحفاظ الصارم على التنسيق العام.

**قواعد المعالجة الصارمة (يجب اتباعها بهذا الترتيب الدقيق):**

**الخطوة 1: إنشاء مفتاح التوزيع الديناميكي**
* احسب النسبة المثالية لتوزيع مثالي: \${numQuestions} / 4.
* أنشئ قائمة بـ \${numQuestions} حرفًا (a أو b أو c أو d) تحترم هذا التوزيع العادل بشكل صارم.
* اخلط هذه القائمة بحيث يبدو الترتيب عشوائيًا تمامًا (بدون تسلسلات متكررة).
* اعرض مفتاح التوزيع هذا في شكل قائمة مرقمة أعلى إجابتك لإثبات حساباتك.

**الخطوة 2: إعادة كتابة الـ QCM**
لكل سؤال (من 1 إلى \${numQuestions})، قم بتعديل مكان الإجابة الصحيحة بناءً على الحرف المخصص في الخطوة 1:
1. ضع نص الإجابة القديمة المشار إليها بـ \`[x]\` في موضع الحرف الهدف الجديد. احتفظ بعلامة \`[x] \` قبل هذا الحرف الجديد.
2. خذ الإجابات الخاطئة الثلاث المتبقية وضعها في الأحرف الثلاثة الفارغة الأخرى، **مع الحفاظ على ترتيب ظهورها الأصلي**.
3. **التنسيق:** يجب عليك الحفاظ بشكل صارم على التنسيق الأصلي (النص، النقاط، الروابط).
    مثال للتنسيق المتوقع:
    1- [نص السؤال]
    [حرف]- [إجابة خاطئة]
    [x] [حرف]- [الإجابة الصحيحة المنقولة]
    [حرف]- [إجابة خاطئة]
    [حرف]- [إجابة خاطئة]
    • Explication : [نص الشرح]
    • Pour aller plus loin : [رابط]

4. احترم ترتيب الخيارات a,b,c,d بدقة.`
      : `**Rôle :** Tu es un Expert en conception d'évaluations et un Algorithme logique extrêmement rigoureux.

**Contexte :** Je te fournis un QCM (Questions à Choix Multiples) brut. Actuellement, ce QCM présente des défauts : la bonne réponse (signalée par la balise \`[x]\`) est systématiquement placée en position \`a-\`, et il peut y avoir des erreurs de frappe ou des options doublées dans le texte source.

**Objectif :** Nettoyer le QCM et redistribuer les bonnes réponses de manière équitable et aléatoire entre les positions a, b, c et d, tout en conservant strictement la mise en forme globale.

**Règles strictes de traitement (à suivre dans cet ordre précis) :**

**ÉTAPE 1 : Création de la clé de répartition dynamique**
*   Calcule le ratio idéal pour une répartition parfaite : \${numQuestions} / 4.
*   Génère une liste de \${numQuestions} lettres (a, b, c, ou d) respectant cette répartition équitable de manière stricte. 
*   Mélange cette liste pour que l'ordre semble totalement aléatoire (pas de suites répétitives).
*   Affiche cette clé de répartition sous forme de liste numérotée en haut de ta réponse pour prouver ton calcul.

**ÉTAPE 2 : Réécriture du QCM**
Pour chaque question (de 1 à \${numQuestions}), modifie la place de la bonne réponse en fonction de la lettre attribuée à l'Étape 1 :
1.  Place le texte de l'ancienne réponse indiquée par \`[x]\` à la position de la nouvelle lettre cible. Conserve bien la balise \`[x] \` devant cette nouvelle lettre.
2.  Prends les 3 mauvaises réponses restantes et place-les dans les 3 autres lettres vides, **en conservant leur ordre d'apparition d'origine**.
3.  **Mise en forme :** Tu dois conserver STRICTEMENT la mise en forme originale (texte, puces, liens). 
    Exemple de format attendu :
    1- [Texte de la question]
    [lettre]- [Mauvaise réponse]
    [x] [lettre]- [Bonne réponse déplacée]
    [lettre]- [Mauvaise réponse]
    [lettre]- [Mauvaise réponse]
    • Explication : [Texte]
    • Pour aller plus loin : [Lien]

4. respectez strictement l'ordre a,b,c,d des propositions.`;

      const agent3 = {
        id: `wf-\${prefix}-agent3`,
        name: a3_name,
        desc: a3_desc,
        instructions: a3_inst,
        primer: isAr ? `ألتزم رسميًا بتوزيع الإجابات عشوائياً وتنسيق \${numQuestions} سؤال QCM بالكامل، دون أي قطع.` : `Je m'engage formellement à redistribuer les réponses et formater les \${numQuestions} questions QCM en entier, sans aucune coupure.`,
        tags: ['QCM', 'Randomisation', 'Étape 3'],
        temperature: 0.1, style: 'technique',
        forbidden: isAr ? 'يمنع التلخيص أو القطع. يجب أن تكون الإجابات الصحيحة موزعة عشوائياً بشكل متساوٍ بين a,b,c,d.' : 'INTERDIT DE TRONQUER OU RÉSUMER. Les bonnes réponses DOIVENT être réparties équitablement entre a,b,c,d.',
        memPrio: 3, maxTokens: 14000, created: now()
      };

      const a4_name = isAr ? `🔬 الوكيل 4 : منسق LaTeX (${typeName})` : `🔬 Agent 4 : Formateur LaTeX (${typeName})`;
      const a4_desc = isAr ? `يطبق تنسيق LaTeX العلمي الصارم.` : `Applique le formatage LaTeX scientifique strict (délimiteurs $, chimie, unités SI).`;
      const a4_inst = isAr ? `أنت خبير في الطباعة العلمية LaTeX.

**مهمتك الوحيدة** : أخذ أسئلة QCM المتسلسلة المقدمة من الوكيل السابق وتطبيق تنسيق LaTeX العلمي الصارم لـ Quiz Player.

**قواعد التنسيق الإلزامية** :
1. قاعدة المحددات: استخدم علامات الدولار المفردة $ ... $ فقط للرموز الرياضية، والأرقام، والصيغ الكيميائية المكتوبة بحروف لاتينية. يمنع منعاً باتاً إدخال أي كلمة عربية داخل علامات $ أو استخدام \\text{} للكلمات العربية، لأن ذلك يفكك اتصال الحروف. يجب أن يبقى النص العربي دائماً خارج الـ LaTeX.
2. الرموز: يمنع استخدام رموز Unicode. استخدم LaTeX للأسهم والرموز الرياضية (مثال: \\rightarrow).
3. الكيمياء: اجمع الجزيء بالكامل في كتلة $ واحدة (مثال: $H_2O$).
4. الوحدات: استخدم التلدة ~ للمسافة غير القابلة للكسر بين الرقم والوحدة.
5. الترقيم: نقاط وفواصل نهاية الجملة خارج محددات $.
6. حظر الخط العريض: لا تضع أي علامة ماركداون للخط العريض (لا **). يجب أن يكون رقم السؤال هو الرقم التسلسلي الحقيقي (مثال: "1-"، "2-"، وما إلى ذلك، وليس "**1**-").
7. علامة الإجابة الصحيحة: احتفظ بالضبط بـ "[x] " أمام حرف الإجابة الصحيحة. لا تحوله أبدًا إلى "**x** ".
8. قاعدة الأسطر السبعة: يجب ترتيب كل سؤال بدقة على 7 أسطر (نص السؤال، a، b، c، d، الشرح، URL). لا يسمح بأي فاصل أسطر داخل نص السؤال أو الخيارات. اترك سطرًا فارغًا واحدًا فقط بين سؤالين. لا يوجد خط فصل (لا --- أو ***).

**صيغة المخرجات** : كتلة نصية تحتوي على ${numQuestions} سؤال منسق، بالضبط بهذا التنسيق:


<VERIFICATION_DISTRIBUTION>
  ${seqName}: a:X b:X c:X d:X -> Total:${numQuestions}
</VERIFICATION_DISTRIBUTION>

1- [نص السؤال بالعربية - النص العربي خارج LaTeX]
[x] a- [الخيار الصحيح - النص العربي خارج LaTeX]
b- [خيار - النص العربي خارج LaTeX]
c- [خيار - النص العربي خارج LaTeX]
d- [خيار - النص العربي خارج LaTeX]
• Explication : [التبرير بالعربية - النص العربي خارج LaTeX]
• Pour aller plus loin : https://...

**ممنوع منعًا باتًا** : 
1. لا \\begin{questions}، لا \\choice. نص عادي + LaTeX فقط.
2. يمنع منعًا باتًا التلخيص أو قطع النتيجة. يجب عليك إنشاء ${numQuestions} سؤال كاملة بدون أي استثناء.`
      : `Tu es un Expert en Typographie Scientifique LaTeX.

**TA MISSION UNIQUE** : Prendre les QCM séquencés fournis par l'agent précédent et appliquer le formatage scientifique LaTeX strict pour le Quiz Player.

**RÈGLES DE FORMATAGE OBLIGATOIRES** :
1. RÈGLE DES DÉLIMITEURS : Encadre CHAQUE variable, chiffre avec unité ou formule par des dollars simples $ ... $. Texte français à l'extérieur.
2. SYMBOLES : INTERDICTION des symboles Unicode. Utilise LaTeX (ex: \\rightarrow).
3. CHIMIE : Regroupe la molécule entière dans un seul bloc $.
4. UNITÉS : Utilise le tilde ~ pour l'espace insécable.
5. PONCTUATION : Points et virgules de fin de phrase en DEHORS des délimiteurs $.
6. INTERDICTION DU GRAS : Ne mets AUCUNE balise markdown de gras (pas de **). Le numéro de question DOIT être le VRAI numéro séquentiel (ex: "1-", "2-", etc. et surtout pas "**1**-"). ATTENTION: Ne mets pas "20-" partout !
7. MARQUEUR DE BONNE RÉPONSE : Conserve EXACTEMENT "[x] " devant la lettre de la bonne réponse. Ne le transforme jamais en "**x** ".
8. RÈGLE DES 7 LIGNES : Chaque question DOIT être disposée strictement sur 7 lignes (énoncé, a, b, c, d, explication, URL). AUCUN retour à la ligne n'est autorisé à l'intérieur de l'énoncé ou des options (tout le LaTeX doit être sur une seule ligne continue). Laisse un seul saut de ligne vide entre deux questions. AUCUN trait de séparation (pas de --- ou ***).

**FORMAT DE SORTIE** : Un bloc de texte contenant les ${numQuestions} questions formatées, EXACTEMENT dans ce format :


<VERIFICATION_DISTRIBUTION>
  ${seqName}: a:X b:X c:X d:X -> Total:${numQuestions}
</VERIFICATION_DISTRIBUTION>

1- [Énoncé avec LaTeX]
[x] a- [Option correcte avec LaTeX]
b- [Option avec LaTeX]
c- [Option avec LaTeX]
d- [Option avec LaTeX]
• Explication : [Justification avec LaTeX]
• Pour aller plus loin : https://...

**INTERDIT ABSOLU** : 
1. Pas de \\begin{questions}, pas de \\choice. Format TEXTE SIMPLE + LaTeX en ligne.
2. IL EST STRICTEMENT INTERDIT DE TRONQUER OU RÉSUMER LE RÉSULTAT. Tu DOIS générer l'intégralité des ${numQuestions} questions sans aucune exception.`;

      const agent4 = {
        id: `wf-${prefix}-agent4`,
        name: a4_name,
        desc: a4_desc,
        instructions: a4_inst,
        primer: isAr ? `ألتزم رسميًا بتنسيق ${numQuestions} QCM بالكامل، دون أي قطع.` : `Je m'engage formellement à formater les ${numQuestions} QCM en entier, sans aucune coupure.`,
        tags: ['QCM', 'LaTeX', 'Formatage', 'Étape 4'],
        temperature: 0.1, style: 'technique',
        forbidden: isAr ? 'يمنع التلخيص أو القطع. لا تستخدم \\begin{questions}. لا تقم بتعديل موضع الإجابات.' : 'INTERDIT DE TRONQUER OU RÉSUMER. Ne pas utiliser \\begin{questions}. Ne pas modifier la position des réponses.',
        memPrio: 3, maxTokens: 14000, created: now()
      };

      const a5_name = isAr ? `✅ الوكيل 5 : المدقق النهائي (${typeName})` : `✅ Agent 5 : Vérificateur Final (${typeName})`;
      const a5_desc = isAr ? `مراقبة الجودة النهائية قبل التصدير إلى Quiz Player.` : `Contrôle qualité final avant export pour Quiz Player.`;
      const a5_inst = isAr ? `أنت مراقب الجودة النهائي.

**مهمتك الوحيدة** : التحقق من الامتثال التام للنتيجة وإنتاج الكتلة النصية النهائية الجاهزة لـ Quiz Player.

**عمليات التحقق الإلزامية** :
- **V1 الاتساق**: الشرح يبرر بالضبط الخيار المميز بعلامة [x].
- **V2 التنسيق**: يجب ترتيب كل سؤال بدقة على 7 أسطر (سطر واحد للسؤال، 4 أسطر للخيارات، سطر للشرح، سطر للرابط). اترك سطرًا فارغًا واحدًا فقط بين كتلتين. لا يوجد خط فصل (لا --- أو ***). يجب أن يكون الرقم متصلاً بالشرطة (مثال: "1- "، "2- "). علامة دقيقة "[x] ". لا يوجد خط عريض (**). لا ينبغي أن يحتوي الرابط على أقواس (اكتب "https://..." وليس "[https://...]"). إليك النموذج الصارم:
1- نص السؤال ؟
[x] a- الخيار الصحيح
b- خيار
c- خيار
d- خيار
• Explication : نص الشرح بالعربية.
• Pour aller plus loin : https://fr.wikipedia.org/wiki/Article
- **V3 المشتتات**: 3 أنواع مختلفة من الأخطاء (E1-E4) لكل سؤال.
- **V4 الإجابة**: يجب أن تكون هناك إجابة واحدة صحيحة فقط مميزة بالعلامة \`[x] \` لكل سؤال (في الموضع a أو b أو c أو d).
- **V5 LaTeX**: يتم استبدال جميع رموز Unicode بـ LaTeX.
- **V6 الطول والاكتمال**: تأكد من وجود جميع الأسئلة الـ \${numQuestions}. لا تقطع النتيجة.
- **V7 التنظيف**: قم بإزالة أي تعليق أو قوس زائد في نهاية الخيارات. يجب أن تكون الخيارات نظيفة 100%.

**إذا فشل التحقق** : قم بالتصحيح بصمت دون ذكره.

**المخرجات النهائية** : أنتج فقط الكتلة النصية المصححة والكاملة.
**قاعدة مطلقة وحاسمة** : يمنع منعًا باتًا قطع النتيجة. يجب عليك التحقق وعرض جميع الأسئلة الـ \${numQuestions} من Q1 إلى Q\${numQuestions}. إذا كانت النتيجة تحتوي على \${numQuestions} سؤال، يجب أن تحتوي مخرجاتك على \${numQuestions} سؤال بالضبط. لا تضع أي تعليق، ولا علامة <مسودة>، ولا تلخص أبدًا.`
      : `Tu es le Contrôleur Qualité Final.

**TA MISSION UNIQUE** : Vérifier la conformité TOTALE du résultat et produire le bloc de texte final prêt pour le Quiz Player.

**VÉRIFICATIONS OBLIGATOIRES** :
- **V1 Cohérence** : L'explication justifie EXACTEMENT l'option marquée [x].
- **V2 Format** : Chaque question DOIT être disposée strictement sur 7 lignes exactes (1 ligne d'énoncé, 4 lignes d'options, 1 ligne d'explication, 1 ligne d'URL). Laisse un seul saut de ligne vide entre deux blocs. AUCUN trait de séparation (pas de --- ou ***). Le numéro DOIT être collé au tiret (ex: "1- ", "2- "). Marqueur exact "[x] ". AUCUN gras markdown (**). L'URL ne doit PAS avoir de crochets (écris "https://..." et non "[https://...]"). Voici le modèle STRICT :
1- Énoncé de la question ?
[x] a- Option correcte
b- Option
c- Option
d- Option
• Explication : Texte de l'explication.
• Pour aller plus loin : https://fr.wikipedia.org/wiki/Article
- **V3 Distracteurs** : 3 types d'erreurs différents (E1-E4) par question.
- **V4 Réponse** : Une seule bonne réponse marquée par \`[x] \` doit être présente pour chaque question (en position a, b, c ou d).
- **V5 LaTeX** : Tous les symboles Unicode sont remplacés par du LaTeX.
- **V6 Longueur et Complétude** : Assure-toi que les ${numQuestions} questions sont bien présentes. Ne tronque pas le résultat.
- **V7 Nettoyage** : Supprime tout commentaire ou parenthèse parasite à la fin des options (ex: supprime "(Bonne réponse)" ou "(Erreur de calcul)"). Les options doivent être 100% propres.

**SI UNE VÉRIFICATION ÉCHOUE** : Corrige silencieusement SANS le mentionner.

**SORTIE FINALE** : Produis UNIQUEMENT le bloc de texte corrigé, complet.
**RÈGLE ABSOLUE ET CRITIQUE** : IL EST STRICTEMENT INTERDIT DE TRONQUER LE RÉSULTAT. Tu DOIS vérifier et afficher l'intégralité des ${numQuestions} questions de Q1 à Q${numQuestions}. Si le résultat contient ${numQuestions} questions, ta sortie DOIT contenir exactement ${numQuestions} questions. Ne mets AUCUN commentaire, AUCUNE balise <brouillon>, et ne résume JAMAIS.`;

      const agent5 = {
        id: `wf-${prefix}-agent5`,
        name: a5_name,
        desc: a5_desc,
        instructions: a5_inst,
        primer: isAr ? `ألتزم رسميًا بالتحقق وإخراج ${numQuestions} QCM بالكامل، دون أي قطع.` : `Je m'engage formellement à vérifier et sortir les ${numQuestions} QCM en entier, sans aucune coupure.`,
        tags: ['QCM', 'Vérification', 'Qualité', 'Étape 5'],
        temperature: 0.1, style: 'technique',
        forbidden: isAr ? 'يمنع التلخيص أو القطع. لا تضف تعليقات. أخرج فقط الكتلة النهائية الكاملة.' : 'INTERDIT DE TRONQUER OU RÉSUMER. Ne pas ajouter de commentaires. Sortir UNIQUEMENT le bloc final complet.',
        memPrio: 3, maxTokens: 14000, created: now()
      };

      await db.put('agents', agent1);
      await db.put('agents', agent2);
      await db.put('agents', agent3);
      await db.put('agents', agent4);
      await db.put('agents', agent5);

      let wfName = '';
      if (prefix === 'fondamentaux') wfName = "QCM-Fr 1";
      else if (prefix === 'approfondissement') wfName = "QCM-Fr 2";
      else if (prefix === 'fondamentaux-ar') wfName = "QCM-Ar 1";
      else if (prefix === 'approfondissement-ar') wfName = "QCM-Ar2";

      const workflow = {
        id: `wf-qcm-${prefix}`,
        name: wfName,
        desc: isAr ? `سلسلة من 5 خطوات مخصصة للجزء ${typeName} (${numQuestions} سؤال).` : `Workflow en 5 étapes dédié à la partie ${typeName} (${numQuestions} questions).`,
        steps: [
          { agentId: agent1.id, instructionCustom: '' },
          { agentId: agent2.id, instructionCustom: isAr ? `قم بصياغة \${numQuestions} سؤال QCM من \${typeName} باتباع خطة التغطية.` : `Rédige les \${numQuestions} questions QCM de \${typeName} en suivant le plan de couverture.` },
          { agentId: agent3.id, instructionCustom: isAr ? `قم بإعادة توزيع الإجابات الصحيحة بشكل عشوائي ومتساوٍ على المواضع a,b,c,d.` : `Redistribue les bonnes réponses de manière équitable et aléatoire entre les positions a, b, c et d.` },
          { agentId: agent4.id, instructionCustom: isAr ? `قم بتطبيق تنسيق LaTeX العلمي الصارم على أسئلة QCM هذه.` : `Applique le formatage LaTeX scientifique strict à ces QCM.` },
          { agentId: agent5.id, instructionCustom: isAr ? `تحقق من الامتثال التام وأخرج فقط الكتلة النصية النهائية الجاهزة لـ Quiz Player.` : `Vérifie la conformité totale et sors UNIQUEMENT le bloc de texte final prêt pour le Quiz Player.` }
        ],
        created: now()
      };
      await db.put('workflows', workflow);
    };

    // Nettoyage des anciens workflows et agents
    try { await db.delete('workflows', 'wf-qcm-sequence'); } catch(e) {}
    try { await db.delete('agents', 'wf-agent1-analyste-pdf'); } catch(e) {}
    try { await db.delete('agents', 'wf-agent2-redacteur-qcm'); } catch(e) {}
    try { await db.delete('agents', 'wf-agent3-sequenceur'); } catch(e) {}
    try { await db.delete('agents', 'wf-agent4-formateur-latex'); } catch(e) {}
    try { await db.delete('agents', 'wf-agent5-verificateur'); } catch(e) {}

    const forceAll = arguments[0] === true;

    // 1. Fondamentaux (20 questions) - Français
    await createAgentsForWorkflow(
      'fondamentaux',
      'Fondamentaux',
      '📘',
      '- **Fondamentaux** : 6 Q Niv.1 (Mémorisation), 8 Q Niv.2 (Compréhension), 6 Q Niv.3 (Application).',
      20,
      'SÉRIE 1',
      'fr',
      forceAll
    );

    // 2. Approfondissement (20 questions) - Français
    await createAgentsForWorkflow(
      'approfondissement',
      'Approfondissement',
      '📙',
      '- **Approfondissement** : 5 Q Niv.3 (Application), 8 Q Niv.4 (Analyse), 5 Q Niv.5 (Évaluation), 2 Q Niv.6 (Synthèse).',
      20,
      'SÉRIE 2',
      'fr',
      forceAll
    );

    // 3. Fondamentaux (20 questions) - Arabe
    await createAgentsForWorkflow(
      'fondamentaux-ar',
      'استرداد المعارف',
      '📘',
      '- **استرداد المعارف** : 6 Q Niv.1 (مستوى 1 - تذكر), 8 Q Niv.2 (مستوى 2 - فهم), 6 Q Niv.3 (مستوى 3 - تطبيق).',
      20,
      'سلسلة 1',
      'ar',
      forceAll
    );

    // 4. Approfondissement (20 questions) - Arabe
    await createAgentsForWorkflow(
      'approfondissement-ar',
      'الاستدلال العلمي',
      '📙',
      '- **الاستدلال العلمي** : 5 Q Niv.3 (مستوى 3 - تطبيق), 8 Q Niv.4 (مستوى 4 - تحليل), 5 Q Niv.5 (مستوى 5 - تقييم), 2 Q Niv.6 (مستوى 6 - تركيب).',
      20,
      'سلسلة 2',
      'ar',
      forceAll
    );

    console.log('[INIT] Workflows QCM (FR/AR) créés avec succès.');
  } catch(e) {
    console.error('[INIT] Erreur lors de la création des workflows QCM :', e);
  }
}

// ════════════════════════════════════════
// SEED DEFAULT DATA (1er lancement)
// ════════════════════════════════════════
async function seedDefaultData() {
  const steps = [
    { label: '📋 Création de l\'Agent QCM Expert…',     fn: () => initializeDefaultAgents(true) },
    { label: '🔗 Chaîne Fondamentaux FR…',               fn: () => initializeQcmWorkflow(true) },
    { label: '✅ Chaîne Vrai/Faux…',                     fn: () => initializeVraiFauxWorkflow() },
    { label: '🛡️ Chaîne Audit Académique…',              fn: () => initializeAuditWorkflow() },
  ];
  for (const step of steps) {
    toast(step.label, 'info');
    await step.fn();
    await new Promise(r => setTimeout(r, 300));
  }
  await loadAgents();
  toast('🎉 Tous les agents et chaînes sont prêts !', 'success');
}

// ════════════════════════════════════════
// INIT
// ════════════════════════════════════════
export const mountApp = async () => {
  // DB
  try { await db.open(); } catch(e) { console.error("DB init:", e); }

  // Lang
  try {
    const l = await db.get('settings', 'lang');
    if (l) state.lang = l.value;
    document.documentElement.dir = state.lang === 'ar' ? 'rtl' : 'ltr';
  } catch(e) {}

  // Theme
  try {
    const t = await db.get('settings', 'theme');
    if (t) {
      document.documentElement.dataset.theme = t.value;
      $("#theme-select").value = t.value;
    } else {
      document.documentElement.dataset.theme = 'midnight';
      $("#theme-select").value = 'midnight';
    }
  } catch(e) {
    document.documentElement.dataset.theme = 'midnight';
    $("#theme-select").value = 'midnight';
  }

  // Models
  const modelSel = $("#model-select");
  const agentModelPref = $("#agent-model-pref");
  MODELS.forEach(m => {
    const opt = document.createElement("option");
    opt.value = m.id;
    opt.textContent = m.name;
    opt.title = `${m.desc} • ${m.tokens.toLocaleString()} max tokens${m.vision?' • 👁 Vision':''}${m.audio?' • 🎵 Audio':''}`;
    modelSel.appendChild(opt);
    if (agentModelPref) {
      const opt2 = document.createElement("option");
      opt2.value = m.id;
      opt2.textContent = m.name;
      agentModelPref.appendChild(opt2);
    }
  });
  // Show/hide file upload btn based on model capability
  const updateFileBtn = () => {
    const m = MODELS.find(x => x.id === state.model);
    const fileBtn = document.getElementById('file-upload-btn');
    if (fileBtn) {
      const canUpload = m?.vision || m?.audio;
      fileBtn.style.opacity = canUpload ? '1' : '0.35';
      fileBtn.title = canUpload ? `Joindre un fichier (${m.vision?'image':'audio'} supporté)` : 'Upload disponible avec Pixtral (images) ou Voxtral (audio)';
    }
  };
  updateFileBtn();
  document.getElementById('model-select').addEventListener('change', () => {
    setTimeout(updateFileBtn, 50);
  });
  try {
    const savedModel = await db.get('settings', 'model');
    if (savedModel) { state.model = savedModel.value; modelSel.value = state.model; }
    else modelSel.value = state.model;
  } catch(e) {}

  // API Key
  const cookieKey = await getCookie("mistral_api_key");
  if (cookieKey && isValidApiKey(cookieKey)) {
    state.apiKey = cookieKey;
    $("#api-status").innerHTML = '<span class="status-dot"></span>EN LIGNE';
    $("#api-status").className = "status-pill active";
    $("#open-api-modal").textContent = "⬡ CLÉ API";
  }

  // Init new features
  initFileUpload();
  initEditAgentModal();
  initAgentImport();
  initWizardEvents();
  initGenerateMoreAgents();

  // Check first run / wizard
  const isFirstRun = await checkFirstRun();

  // One-time auto-fix for corrupted IndexedDB characters (Mojibake)
  const patchedMojibake = await db.get('settings', 'patched_mojibake_v2').catch(() => null);
  if (!patchedMojibake) {
    try {
      const bads = [
        { bad: /أ©/g, good: 'é' }, { bad: /أ¨/g, good: 'è' }, { bad: /أ®/g, good: 'î' },
        { bad: /أھ/g, good: 'ê' }, { bad: /أ§/g, good: 'ç' }, { bad: /أ´/g, good: 'ô' },
        { bad: /أ»/g, good: 'û' }, { bad: /أ¹/g, good: 'ù' }, { bad: /أ‰/g, good: 'É' },
        { bad: new RegExp('أ\u00A0', 'g'), good: 'à' }, { bad: /â€™/g, good: "'" },
        { bad: /إ“/g, good: 'œ' }, { bad: /â€”/g, good: '—' }, { bad: /â€¦/g, good: '…' },
        { bad: /âœ…/g, good: '✅' }, { bad: new RegExp('ًں§\u00A0', 'g'), good: '🧠' },
        { bad: /ًں”—/g, good: '🔗' }, { bad: /⚠ï¸/g, good: '⚠️' }, { bad: /ًں\x93„/g, good: '📄' },
        { bad: /ًں–¼/g, good: '🖼' }, { bad: /ًںژµ/g, good: '🎵' }, { bad: /ًں•µï¸/g, good: '🕵️' },
        { bad: /â€\x8Dâ™‚ï¸/g, good: '‍♂️' }, { bad: /ًں”\x8D/g, good: '🔍' }, { bad: /ًں\x92،/g, good: '💡' },
        { bad: /ًں\x93\x82/g, good: '📂' }, { bad: /ًں“„/g, good: '📄' }, { bad: /ًں“‚/g, good: '📂' },
        { bad: /ًں\x9A€/g, good: '🚀' }, { bad: /▶/g, good: '▶' }, { bad: /âڈ¹/g, good: '⏹' },
        { bad: /âœ\x8Fï¸/g, good: '✏️' }, { bad: /ًں’¬/g, good: '💬' }, { bad: /ًں“\x8D/g, good: '📌' },
        { bad: /ًں“\x88/g, good: '📈' }, { bad: /طھط¹ظ…ظٹظ‚/g, good: 'تعميق' }
      ];
      function fixStr(s) {
        if(typeof s !== 'string') return s;
        let res = s;
        for (const r of bads) res = res.replace(r.bad, r.good);
        return res;
      }
      function fixObj(obj) {
        let changed = false;
        for (const key of Object.keys(obj)) {
          if (typeof obj[key] === 'string') {
            const fixed = fixStr(obj[key]);
            if (fixed !== obj[key]) { obj[key] = fixed; changed = true; }
          } else if (Array.isArray(obj[key])) {
            for (let i = 0; i < obj[key].length; i++) {
              if (typeof obj[key][i] === 'object' && obj[key][i]) {
                if (fixObj(obj[key][i])) changed = true;
              } else if (typeof obj[key][i] === 'string') {
                const fixed = fixStr(obj[key][i]);
                if (fixed !== obj[key][i]) { obj[key][i] = fixed; changed = true; }
              }
            }
          } else if (typeof obj[key] === 'object' && obj[key]) {
            if (fixObj(obj[key])) changed = true;
          }
        }
        return changed;
      }
      const allAgents = await db.getAll('agents') || [];
      for (const a of allAgents) { if (fixObj(a)) await db.put('agents', a); }
      const allWfs = await db.getAll('workflows') || [];
      for (const w of allWfs) { if (fixObj(w)) await db.put('workflows', w); }
      const allChats = await db.getAll('chats') || [];
      for (const c of allChats) { if (fixObj(c)) await db.put('chats', c); }
      await db.put('settings', { id: 'patched_mojibake_v2', value: true });
    } catch(e) {}
  }


  if (!isFirstRun) {
    // One-time patch: delete bugged Arabic workflows so they get recreated with the fix
    const patchedAr = await db.get('settings', 'patched_ar_agents_v2').catch(()=>null);
    if (!patchedAr) {
      await db.delete('workflows', 'wf-qcm-fondamentaux-ar').catch(()=>{});
      await db.delete('workflows', 'wf-qcm-approfondissement-ar').catch(()=>{});
      await db.put('settings', { id: 'patched_ar_agents_v2', value: true }).catch(()=>{});
    }

    // Initialize default agents only if no agents exist and no wizard ran
    await initializeDefaultAgents();
    await initializeQcmWorkflow();
    await initializeVraiFauxWorkflow();
    await initializeAuditWorkflow();

    // One-time patch: rename workflows to "QCM-Ar II تعميق" and "QCM-Ar I"
    const patchedNameAr = await db.get('settings', 'patched_wf_name_ar_v2').catch(()=>null);
    if (!patchedNameAr) {
      try {
        const wfApp = await db.get('workflows', 'wf-qcm-approfondissement-ar');
        if (wfApp) {
          wfApp.name = "QCM-Ar II تعميق";
          await db.put('workflows', wfApp);
        }
        const wfFond = await db.get('workflows', 'wf-qcm-fondamentaux-ar');
        if (wfFond) {
          wfFond.name = "QCM-Ar I";
          await db.put('workflows', wfFond);
        }
      } catch (e) {
        console.error("Failed to patch workflow name:", e);
      }
      await db.put('settings', { id: 'patched_wf_name_ar_v2', value: true }).catch(()=>{});
    }

    // One-time patch: force recreate audit workflow to update the Formatteur instructions
    const patchedAudit3 = await db.get('settings', 'patched_audit_v3').catch(()=>null);
    if (!patchedAudit3) {
      await db.delete('workflows', 'wf_audit_academique').catch(()=>{});
      await db.put('settings', { id: 'patched_audit_v3', value: true }).catch(()=>{});
      await initializeAuditWorkflow();
    }

    // One-time patch: rename all workflows to standard concise names V3
    const patchedWfNamesV4 = await db.get('settings', 'patched_wf_names_v4').catch(()=>null);
    if (!patchedWfNamesV4) {
      try {
        const updates = [
          {id: 'wf-qcm-fondamentaux', name: 'QCM-Fr 1'},
          {id: 'wf-qcm-approfondissement', name: 'QCM-Fr 2'},
          {id: 'wf-qcm-fondamentaux-ar', name: 'QCM-Ar 1'},
          {id: 'wf-qcm-approfondissement-ar', name: 'QCM-Ar2'},
          {id: 'wf-vrai-faux-consortium', name: 'VRAI/FAUX'},
          {id: 'wf_audit_academique', name: 'AUDIT'}
        ];
        for (const u of updates) {
          const wf = await db.get('workflows', u.id).catch(()=>null);
          if (wf) {
            wf.name = u.name;
            await db.put('workflows', wf);
          }
        }
      } catch (e) { console.error("Failed to patch V3 workflow names:", e); }
      await db.put('settings', { id: 'patched_wf_names_v4', value: true }).catch(()=>{});
    }
  }

  // Memories & agents
  await memory.getAll();
  await loadAgents();
  await renderArchives();

  // Chat
  try {
    const savedChatId = await db.get('settings', 'currentChatId');
    if (savedChatId?.value) await loadChat(savedChatId.value);
    else await newChat();
  } catch(e) { await newChat(); }

  updateContextMeter();
  bindEvents();
};

// ════════════════════════════════════════
// EXPORT QUIZ PLAYER LOGIC
// ════════════════════════════════════════
async function sha256(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.prototype.map.call(new Uint8Array(buf), x=>(('00'+x.toString(16)).slice(-2))).join('');
}

async function hmacSha256(keyStr, dataStr) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw", enc.encode(keyStr), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", keyMaterial, enc.encode(dataStr));
  return Array.prototype.map.call(new Uint8Array(signature), x=>(('00'+x.toString(16)).slice(-2))).join('');
}

function obfuscateAnswer(index) {
  const revStr = index.toString().split('').reverse().join('');
  return btoa(revStr).split('').reverse().join('');
}

function isExplanationLine(text) {
  const tl = text.toLowerCase().trim();
  const ts = text.trim();
  if (ts.startsWith('\u2022') || (ts.startsWith('-') && tl.includes('explication'))) return true;
  if (ts.startsWith('.') && tl.includes('explication')) return true;
  if (tl.startsWith('explication')) return true;
  if (tl.includes('justification') && (text.includes(':') || tl.startsWith('justification'))) return true;
  if (ts.includes('\u0634\u0631\u062d') || ts.includes('\u0627\u0644\u062a\u0641\u0633\u064a\u0631')) return true;
  return false;
}

function isPourAllerPlusLoinLine(text) {
  const tl = text.toLowerCase().trim();
  const ts = text.trim();
  if (tl.includes('pour aller plus loin')) return true;
  if (ts.includes('\u0644\u0644\u0645\u0632\u064a\u062f \u0645\u0646 \u0627\u0644\u0645\u0639\u0644\u0648\u0645\u0627\u062a') || ts.includes('\u0644\u0644\u062a\u0648\u0633\u0639')) return true;
  return false;
}

function extractExplanationText(text) {
  let cleaned = text.trim();
  if (cleaned.startsWith('\u2022')) cleaned = cleaned.substring(1).trim();
  if (cleaned.startsWith('.')) cleaned = cleaned.substring(1).trim();
  if (cleaned.startsWith('-')) cleaned = cleaned.substring(1).trim();
  const prefixesFr = [
    'explication et la justification :', 'explication et justification :',
    'explication :', 'justification :'
  ];
  const cl = cleaned.toLowerCase();
  for (const p of prefixesFr) {
    if (cl.startsWith(p)) { cleaned = cleaned.substring(p.length).trim(); break; }
  }
  const prefixesAr = ['\u0634\u0631\u062d \u0625\u0636\u0627\u0641\u064a:', '\u0634\u0631\u062d \u0625\u0636\u0627\u0641\u064a :', '\u0634\u0631\u062d \u0625\u0636\u0627\u0641\u064a', '\u0627\u0644\u062a\u0641\u0633\u064a\u0631:', '\u0627\u0644\u062a\u0641\u0633\u064a\u0631 :', '\u0627\u0644\u062a\u0641\u0633\u064a\u0631', '\u0634\u0631\u062d:', '\u0634\u0631\u062d :', '\u0634\u0631\u062d'];
  for (const p of prefixesAr) {
    if (cleaned.startsWith(p)) { cleaned = cleaned.substring(p.length).trim(); break; }
  }

  return cleaned;
}

function extractPourAllerPlusLoinText(text) {
  let cleaned = text.trim();
  if (cleaned.startsWith('\u2022')) cleaned = cleaned.substring(1).trim();
  if (cleaned.startsWith('-')) cleaned = cleaned.substring(1).trim();
  if (cleaned.startsWith('.')) cleaned = cleaned.substring(1).trim();
  const prefixesFr = ['pour aller plus loin :', 'pour aller plus loin:', 'pour aller plus loin'];
  const cl = cleaned.toLowerCase();
  for (const p of prefixesFr) {
    if (cl.startsWith(p)) { cleaned = cleaned.substring(p.length).trim(); break; }
  }
  const prefixesAr = ['\u0644\u0644\u0645\u0632\u064a\u062f \u0645\u0646 \u0627\u0644\u0645\u0639\u0644\u0648\u0645\u0627\u062a:', '\u0644\u0644\u0645\u0632\u064a\u062f \u0645\u0646 \u0627\u0644\u0645\u0639\u0644\u0648\u0645\u0627\u062a :', '\u0644\u0644\u0645\u0632\u064a\u062f \u0645\u0646 \u0627\u0644\u0645\u0639\u0644\u0648\u0645\u0627\u062a', '\u0644\u0644\u062a\u0648\u0633\u0639:', '\u0644\u0644\u062a\u0648\u0633\u0639 :', '\u0644\u0644\u062a\u0648\u0633\u0639'];
  for (const p of prefixesAr) {
    if (cleaned.startsWith(p)) { cleaned = cleaned.substring(p.length).trim(); break; }
  }
  if (cleaned.startsWith(':')) cleaned = cleaned.substring(1).trim();
  return cleaned;
}

// Extrait une URL propre depuis un texte brut ou un lien markdown [texte](url)
function extractUrlFromText(raw) {
  if (!raw) return '';
  raw = raw.trim();
  // Format markdown : [texte](url)
  const mdMatch = raw.match(/\[.*?\]\((https?:\/\/[^)]+)\)/);
  if (mdMatch) return mdMatch[1];
  // URL brute
  const urlMatch = raw.match(/(https?:\/\/[^\s\)\]]+)/);
  if (urlMatch) return urlMatch[1];
  return '';
}

function processBlock(block) {
  if (!block || !block.question || !block.choix) return null;
  let cleanedChoices = [];
  let correctIndex = -1;
  let explanationText = "";
  let pourAllerPlusLoinText = "";

  for (let i = 0; i < block.choix.length; i++) {
    const choiceLine = block.choix[i];
    if (isPourAllerPlusLoinLine(choiceLine)) {
      pourAllerPlusLoinText = extractPourAllerPlusLoinText(choiceLine);
      continue;
    }
    if (isExplanationLine(choiceLine)) {
      explanationText = extractExplanationText(choiceLine);
      continue;
    }
    const isCorrect = choiceLine.toLowerCase().includes('[x]');
    let finalText = choiceLine.replace(/\[x\]/gi, '').replace(/\[X\]/g, '').trim();
    // Strip letter prefix (a-, b-, c-, d- or Arabic أ-, ب-, ج-, د-) at parse time
    finalText = finalText.replace(/^[\u200F\u200E\u202A-\u202E\u2066-\u2069]*(?:[a-d]|أ|ب|ج|د)[\-\)]\s*/i, '');
    cleanedChoices.push(finalText);
    if (isCorrect) correctIndex = cleanedChoices.length - 1;
  }

  if (block.explication && !explanationText) explanationText = block.explication;
  if (block.pour_aller_plus_loin && !pourAllerPlusLoinText) pourAllerPlusLoinText = block.pour_aller_plus_loin;
  
    if (cleanedChoices.length === 0 && explanationText) {
      const matchVF = explanationText.match(/^\s*(VRAI|FAUX)\s*[.:-]/i);
      if (matchVF) {
        cleanedChoices = ["Vrai", "Faux"];
        correctIndex = matchVF[1].toUpperCase() === "VRAI" ? 0 : 1;
      }
    }

    if (cleanedChoices.length === 0) return null;

  if (correctIndex !== -1) {
    let result = {
      question: block.question,
      choix: cleanedChoices,
      reponse_obfusquee: obfuscateAnswer(correctIndex)
    };
    if (explanationText) result.explication = explanationText;
    if (pourAllerPlusLoinText) result.pour_aller_plus_loin = pourAllerPlusLoinText;
    return result;
  }
  return null;
}

function processLinesStandard(allLines) {
  const finalData = [];
  let currentBlock = null;
  const questionPattern = /^\s*\d+\s*[-\u2013\u2014.)]\s*/;

  for (const textLine of allLines) {
    if (questionPattern.test(textLine) && !isExplanationLine(textLine) && !isPourAllerPlusLoinLine(textLine)) {
      if (currentBlock) {
        const processed = processBlock(currentBlock);
        if (processed) finalData.push(processed);
      }
      currentBlock = { question: textLine, choix: [], explication: "", pour_aller_plus_loin: "" };
    } else if (currentBlock) {
      if (isPourAllerPlusLoinLine(textLine)) {
        currentBlock.pour_aller_plus_loin = extractPourAllerPlusLoinText(textLine);
      } else if (isExplanationLine(textLine)) {
        currentBlock.explication = extractExplanationText(textLine);
      } else {
        currentBlock.choix.push(textLine);
      }
    }
  }
  if (currentBlock) {
    const processed = processBlock(currentBlock);
    if (processed) finalData.push(processed);
  }
  return finalData;
}

function processLinesMixed(allLines) {
  const finalQuestions = [];
  let currentBlockLines = [];
  const questionPattern = /^\s*\d+\s*[-\u2013\u2014.)]\s*/;
  const vfPattern = /^\s*\[V\/F\]\s*\d+/i;

  function flushBlock(lines) {
    if (!lines.length) return null;
    lines = lines.map(l => l.trim()).filter(l => l);
    if (!lines.length) return null;

    const hasChoices = lines.some(l => l.toLowerCase().includes('[x]'));
    if (hasChoices) {
      return processBlock({ question: lines[0], choix: lines.slice(1), explication: "", pour_aller_plus_loin: "" });
    }
    if (lines.length >= 2) {
      return processBlock({ question: lines[0], choix: lines.slice(1), explication: "", pour_aller_plus_loin: "" });
    }
    return null;
  }

  for (const line of allLines) {
    const lineClean = line.trim();
    if (!lineClean) continue;
    if ((questionPattern.test(lineClean) || vfPattern.test(lineClean)) && !isExplanationLine(lineClean) && !isPourAllerPlusLoinLine(lineClean)) {
      if (currentBlockLines.length) {
        const q = flushBlock(currentBlockLines);
        if (q) finalQuestions.push(q);
      }
      currentBlockLines = [lineClean];
    } else {
      if (currentBlockLines.length) currentBlockLines.push(lineClean);
      else currentBlockLines = [lineClean];
    }
  }
  if (currentBlockLines.length) {
    const q = flushBlock(currentBlockLines);
    if (q) finalQuestions.push(q);
  }
  return finalQuestions;
}

function cleanupLineContent(text) {
  text = text.replace(/\ufeff/g, '');
  const charsToRemove = ['\u200e','\u200f','\u202a','\u202b','\u202c','\u202d','\u202e','\u00a0'];
  for (const c of charsToRemove) text = text.replaceAll(c, ' ');
  return text.trim();
}

function extractSubjectFromContent(content) {
  if (!content) return "Sujet";
  let clean = content.replace(/<details>[\s\S]*?<\/details>/gi, '');
  
  const titleMatch = clean.match(/#+\s+([^\n]+)/) || clean.match(/\*\*([^\*]{5,40})\*\*/);
  let textToSearch = titleMatch ? titleMatch[1] : clean.substring(0, 500);
  
  const words = textToSearch.split(/[\s\n'.,:;!?()\[\]{}"]+/).filter(w => w.length > 4);
  const stopwords = ['voici', 'cette', 'question', 'questions', 'réponse', 'réponses', 'choix', 'parmi', 'lequel', 'laquelle', 'lesquelles', 'lesquels', 'chaque', 'selon', 'fonction', 'soit', 'dans', 'pour', 'avec', 'tout', 'tous', 'toutes', 'chapitre', 'cours', 'exercice', 'exercices', 'sujet', 'thème', 'partie', 'section', 'génère', 'générer', 'crée', 'créer', 'fais', 'faire', 'donne', 'donner', 'rédige', 'rédiger', 'propose', 'proposer', 'quiz', 'test', 'évaluation', 'evaluation', 'niveau', 'classe', 'baccalauréat', 'lycée', 'collège', 'maroc', 'marocain', 'programme', 'suivantes', 'suivants', 'affirmation', 'affirmations', 'propositions', 'proposition', 'quelle', 'quelles', 'votre', 'concerne', 'concernant', 'correcte', 'correctes'];
  
  for (let w of words) {
    let lower = w.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""); // remove accents for stopword check
    if (!stopwords.includes(lower) && !lower.includes('$') && !lower.includes('\\')) {
      let subject = w.replace(/[^a-zA-Z0-9éèêàâôûùç\-]/gi, '');
      if (subject.length > 3) {
        return subject.charAt(0).toUpperCase() + subject.slice(1).toLowerCase();
      }
    }
  }
  return "Sujet";
}

async function exportQuizPlayer(msgId) {
  const msg = state.messages.find(m => (m.ts || '') == msgId);
  if (!msg || !msg.content) return;

  const rawContent = msg.content.replace(/<details>[\s\S]*<\/details>/i, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const allLines = rawContent.split('\n')
    .map(l => cleanupLineContent(l))
    .filter(l => l && !/^[-_*]{2,}$/.test(l));

  // Essayer le mode standard, sinon le mode mixte
  let questions = processLinesStandard(allLines);
  if (!questions.length) {
    questions = processLinesMixed(allLines);
  }

  if (!questions.length) {
    toast("Erreur: Aucune question valide d\u00e9tect\u00e9e dans ce message. V\u00e9rifiez le format.", "error");
    return;
  }

  const titre = document.getElementById('qp-titre').value || "Quiz sans titre";
  const matiere = document.getElementById('qp-matiere').value || "SVT";
  const auteur = document.getElementById('qp-auteur').value || "Hassan Bertane";
  const isEval = document.getElementById('qp-eval').checked;
  const timeLimit = parseInt(document.getElementById('qp-timer').value || "30");

  let quizData = {
    titre: titre,
    lecon: matiere,
    auteur: auteur,
    type: "Mixed",
    questions: questions
  };

  // Hash compact identique au Python: json.dumps(sort_keys=True, separators=(',', ':'))
  const deepSortObj = (obj) => {
    if (Array.isArray(obj)) return obj.map(deepSortObj);
    if (obj && typeof obj === 'object') {
      return Object.keys(obj).sort().reduce((acc, key) => {
        acc[key] = deepSortObj(obj[key]);
        return acc;
      }, {});
    }
    return obj;
  };

  const sortedData = deepSortObj(quizData);
  const rawJson = JSON.stringify(sortedData);
  const qHash = (await sha256(rawJson)).substring(0, 16);

  const settings = { e: isEval ? 1 : 0, t: timeLimit, h: qHash, s: isEval ? 1 : 0 };
  const settingsStr = JSON.stringify(settings);

  const QP_KEY = "QzPl@y3r_2026!sEcReT";
  const signature = await hmacSha256(QP_KEY, settingsStr);

  const payload = `${settingsStr}|${signature}`;
  const blobB64 = btoa(unescape(encodeURIComponent(payload)));

  quizData._qp = blobB64;

  const finalJson = JSON.stringify(quizData, null, 2);
  const source = 'data:application/json;charset=utf-8,' + encodeURIComponent(finalJson);
  const fileDownload = document.createElement("a");
  document.body.appendChild(fileDownload);
  fileDownload.href = source;
  
  let downloadName = titre.replace(/\s+/g,'_');
  if (!downloadName.toLowerCase().startsWith('qcm')) {
    downloadName = `QCM-${downloadName}`;
  }
  fileDownload.download = `${downloadName}.json`;
  
  fileDownload.click();
  document.body.removeChild(fileDownload);

  const modal = document.getElementById('quiz-player-modal');
  if (modal) modal.classList.remove('active');
  toast(`Fichier Quiz Player export\u00e9 ! (${questions.length} questions)`, "success");
}

function exportMessageToWord(msgId) {
    const contentEl = document.getElementById(`mc-${msgId}`);
    if (!contentEl) return;
    
    let htmlContent = contentEl.innerHTML;

    // Nettoyage de l'export Word : suppression de l'en-tête et de la trace uniquement
    htmlContent = htmlContent.replace(/🔗 Résultat de la chaîne.*?(\n|<br>|<\/p>|<h[1-6]>)/ig, '$1');
    
    // Supprimer tout le texte d'introduction avant la question 1
    const firstQMatch = htmlContent.match(/(<p[^>]*>|<br>|<div>|\n|^)\s*1-\s/i);
    if (firstQMatch) {
        htmlContent = htmlContent.substring(firstQMatch.index);
    }

    // Supprimer les traits de séparation (underscores ou <hr>) générés par l'IA
    htmlContent = htmlContent.replace(/_{5,}/g, '');
    htmlContent = htmlContent.replace(/<hr[^>]*>/ig, '');

    const traceIdx = htmlContent.indexOf('🔗 Détail du parcours');
    if (traceIdx !== -1) {
        const hrIdx = htmlContent.lastIndexOf('<hr>', traceIdx);
        htmlContent = htmlContent.substring(0, hrIdx !== -1 ? hrIdx : traceIdx);
    }

    // MS Word doesn't handle <pre> tags well, so we convert them to standard divs with <br>
    htmlContent = htmlContent.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, function(match, inner) {
       return `<div style="font-family: Consolas, monospace; background: #f4f4f4; padding: 10px; border: 1px solid #ddd;">${inner.replace(/\n/g, '<br>')}</div>`;
    });
    // Remove <code> tags since Word might format them weirdly inside the new div
    htmlContent = htmlContent.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '$1');

    const header = "<html xmlns:o='urn:schemas-microsoft-com:office:office' " +
                   "xmlns:w='urn:schemas-microsoft-com:office:word' " +
                   "xmlns='http://www.w3.org/TR/REC-html40'>" +
                   "<head><meta charset='utf-8'><title>Export QCM</title>" +
                   "<style>body { font-family: Calibri, sans-serif; }</style>" +
                   "</head><body>";
    
    const footer = "</body></html>";
    const sourceHTML = header + htmlContent + footer;
    
    let filename = 'QCM_Export.doc';
    const msg = state.messages.find(m => (m.ts || '') == msgId);
    if (msg && msg.content) {
      const subject = extractSubjectFromContent(msg.content);
      filename = `QCM-${subject.replace(/\s+/g,'_')}.doc`;
    }
    
    const blob = new Blob(['\ufeff', sourceHTML], { type: 'application/msword' });
    const url = URL.createObjectURL(blob);
    const fileDownload = document.createElement("a");
    document.body.appendChild(fileDownload);
    fileDownload.href = url;
    fileDownload.download = filename;
    fileDownload.click();
    
    setTimeout(() => {
      document.body.removeChild(fileDownload);
      URL.revokeObjectURL(url);
    }, 100);
    toast("Export Word réussi !", "success");
}

// ════════════════════════════════════════
// EVENTS
// ════════════════════════════════════════
function bindEvents() {

  // ══ EVENT DELEGATION (Centralized Click Handler) ══
  document.addEventListener('click', async e => {
    const actionEl = e.target.closest('[data-action]');
    if (!actionEl) return;
    
    const action = actionEl.dataset.action;
    const id = actionEl.dataset.id;

    if (action === "copy-msg") { copyMsg(id); }
    else if (action === "save-memo") { saveToMemory(id); }
    else if (action === "print") { window.print(); }
    else if (action === "export-word") { exportMessageToWord(id); }
    else if (action === "export-qp-modal") {
      const qpModal = document.getElementById('quiz-player-modal');
      if (qpModal) {
        document.getElementById('qp-msg-id').value = id;
        
        const msg = state.messages.find(m => (m.ts || '') == id);
        if (msg && msg.content) {
          const subject = extractSubjectFromContent(msg.content);
          document.getElementById('qp-titre').value = `QCM-${subject}`;
        }
        
        qpModal.classList.add('active');
      }
    }
    else if (action === "test-web-quiz") {
      openWebQuizPlayer(id);
    }
    else if (action === "rate") { rateMessage(parseInt(id), parseInt(actionEl.dataset.score)); }
    else if (action === "delete-memory") { memoryDelete(id); }
    else if (action === "load-chat") { loadArchiveChat(id); }
    else if (action === "delete-chat") { e.stopPropagation(); deleteArchiveChat(id); }
    else if (action === "toggle-fav") { e.stopPropagation(); toggleFav(id); }
    else if (action === "activate-agent") { activateAgent(id); }
    else if (action === "edit-agent") { e.stopPropagation(); openEditAgent(id); }
    else if (action === "duplicate-agent") { e.stopPropagation(); duplicateAgentById(id); }
    else if (action === "export-agent") { e.stopPropagation(); exportAgent(id); }
    else if (action === "delete-agent") { e.stopPropagation(); deleteAgent(id); }
    else if (action === "clear-file") { clearAttachedFile(); }
    else if (action === "edit-msg") { editMessage(id); }
    else if (action === "regen-msg") { regenerateMessage(id); }
    else if (action === "manage-lessons") { e.stopPropagation(); manageLessons(id); }
    // ─── WORKFLOW ACTIONS ───────────────────────────────────────────────
    else if (action === "edit-workflow") {
      e.stopPropagation();
      if (id) await openWorkflowForEdit(id);
    }
    else if (action === "activate-workflow") {
      e.stopPropagation();
      if (id) {
        const wf = await db.get('workflows', id);
        if (wf) {
          $("#agent-select").value = '__WF__' + id;
          if ($("#agent-select-mob")) $("#agent-select-mob").value = '__WF__' + id;
          state.selectedWorkflow = wf;
          toast('Chaîne "' + wf.name + '" activée', 'success');
          $("#workflow-modal").classList.remove('active');
        }
      }
    }
    else if (action === "delete-workflow") {
      e.stopPropagation();
      if (id) await deleteWorkflow(id);
    }
    else if (action === "wf-move-up") {
      const idx = parseInt(actionEl.dataset.idx);
      if (!isNaN(idx)) await wfMoveStep(idx, -1);
    }
    else if (action === "wf-move-down") {
      const idx = parseInt(actionEl.dataset.idx);
      if (!isNaN(idx)) await wfMoveStep(idx, 1);
    }
    else if (action === "wf-remove-step") {
      const idx = parseInt(actionEl.dataset.idx);
      if (!isNaN(idx)) await wfRemoveStep(idx);
    }
  });

  // Archives panel
  const archivesBtn = $("#archives-btn");
  const archivesPanel = $("#archives-panel");
  const openArchivesDesktop = $("#open-archives-desktop");
  const archivesMob = $("#archives-mob");

  const openArchivesPanel = () => {
    archivesPanel.classList.add("active");
    renderArchives();
  };

  // closeArchivesPanel is now defined globally (above loadArchiveChat)

  if (archivesBtn) {
    archivesBtn.onclick = e => {
      e.stopPropagation();
      openArchivesPanel();
    };
  }

  if (openArchivesDesktop) {
    openArchivesDesktop.onclick = openArchivesPanel;
  }

  if (archivesMob) {
    archivesMob.onclick = () => {
      closeBurger();
      openArchivesPanel();
    };
  }

  document.addEventListener('click', e => {
    if (archivesPanel.classList.contains("active") && !archivesPanel.contains(e.target) && e.target !== archivesBtn && e.target !== openArchivesDesktop) {
      closeArchivesPanel();
    }
  });

  if ($("#archives-new-btn")) {
    $("#archives-new-btn").onclick = e => { e.stopPropagation(); newChat(); closeArchivesPanel(); };
  }
  if ($("#archives-search-input")) {
    $("#archives-search-input").oninput = e => { archivesSearchQuery = e.target.value; renderArchives(); };
    $("#archives-search-input").onclick = e => e.stopPropagation();
  }

  // Scroll to bottom
  const scrollBottomBtn = $("#scroll-bottom");
  const chatContainer = $("#chat-container");
  if (scrollBottomBtn && chatContainer) {
    chatContainer.addEventListener('scroll', () => {
      const distFromBottom = chatContainer.scrollHeight - chatContainer.scrollTop - chatContainer.clientHeight;
      scrollBottomBtn.classList.toggle("visible", distFromBottom > 150);
    });
    scrollBottomBtn.onclick = () => { chatContainer.scrollTop = chatContainer.scrollHeight; };
  }

  // Voice dictation
  const voiceBtn = $("#voice-btn");
  if (voiceBtn && ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SR();
    recognition.lang = 'fr-FR'; recognition.continuous = false; recognition.interimResults = false;
    let isRecording = false;
    voiceBtn.onclick = () => {
      if (isRecording) { recognition.stop(); return; }
      recognition.start();
      isRecording = true;
      voiceBtn.classList.add("recording");
      voiceBtn.title = "Arrêter la dictée";
    };
    recognition.onresult = e => {
      const transcript = Array.from(e.results).map(r=>r[0].transcript).join('');
      const inp = $("#user-input");
      inp.value += (inp.value ? ' ' : '') + transcript;
      autoResizeTextarea();
    };
    recognition.onend = () => { isRecording = false; voiceBtn.classList.remove("recording"); voiceBtn.title = "Dictée vocale"; };
    recognition.onerror = () => { isRecording = false; voiceBtn.classList.remove("recording"); toast("Dictée vocale indisponible", "error"); };
  } else if (voiceBtn) {
    voiceBtn.style.display = "none";
  }

  // Send / Stop
  $("#send-btn").onclick = () => {
    if (state.isGenerating) { stopGeneration(); }
    else { sendMessage(); }
  };
  $("#user-input").oninput = () => { autoResizeTextarea(); updateTokenCounter(); };
  $("#user-input").onkeydown = e => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!state.isGenerating) sendMessage();
    }
  };

  // ══ KEYBOARD SHORTCUTS ══
  document.addEventListener('keydown', e => {
    // Ignorer si on tape dans un input/textarea (sauf Escape)
    const inInput = ['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName);

    // Escape — Fermer les modals/panels ouverts
    if (e.key === 'Escape') {
      if (state.isGenerating) { stopGeneration(); return; }
      const modals = document.querySelectorAll('.modal-overlay.active');
      if (modals.length) { modals.forEach(m => m.classList.remove('active')); return; }
      const memPanel = document.getElementById('memory-panel');
      if (memPanel?.classList.contains('active')) { memPanel.classList.remove('active'); return; }
      const archPanel = document.getElementById('archives-panel');
      if (archPanel?.classList.contains('active')) { closeArchivesPanel(); return; }
    }

    if (inInput) return; // Les raccourcis suivants ne marchent pas dans un champ de saisie

    // Ctrl+N — Nouvelle conversation
    if (e.ctrlKey && e.key === 'n') { e.preventDefault(); newChat(); }
    // Ctrl+L — Effacer le chat
    else if (e.ctrlKey && e.key === 'l') {
      e.preventDefault();
      state.messages = (state.messages||[]).filter(m => m.role === 'system');
      renderMessages(); saveChat(); toast('Conversation effacée', 'success');
    }
    // Ctrl+K — Focus sur l'input
    else if (e.ctrlKey && e.key === 'k') { e.preventDefault(); document.getElementById('user-input')?.focus(); }
    // Ctrl+/ — Ouvrir les archives
    else if (e.ctrlKey && e.key === '/') { e.preventDefault(); openArchivesPanel(); }
  });

  // Chat controls
  $("#clear-chat").onclick = async () => {
    state.messages = (state.messages||[]).filter(m => m.role === "system");
    renderMessages();
    await saveChat();
    toast("Conversation effacée", "success");
  };
  $("#new-chat").onclick = newChat;

  // Model
  $("#model-select").onchange = e => {
    state.model = e.target.value;
    db.put('settings', { id:'model', value:state.model }).catch(()=>{});
    const sys = (state.messages||[]).find(m => m.role === "system");
    if (sys) { sys.content = buildSystemPrompt(); saveChat(); }
  };

  // Agent select
  $("#agent-select").onchange = async e => {
    try {
      const val = e.target.value;
      if (val === '__ALL_AGENTS__') {
        state.agent = '__ALL_AGENTS__';
        state.selectedWorkflow = null;
        toast("Mode Multi-Agents activé — tous les experts seront consultés", "success");
      } else if (val.startsWith('__WF__')) {
        const wfId = val.replace('__WF__', '');
        const wf = await db.get('workflows', wfId);
        if (wf) {
          state.selectedWorkflow = wf;
          state.agent = null;
          toast(`Chaîne "${wf.name}" sélectionnée (${wf.steps.length} étapes)`, "success");
        }
      } else if (val) {
        state.agent = await db.get('agents', val);
        state.selectedWorkflow = null;
        // Charger les leçons d'apprentissage
        try {
          const lessons = await agentFeedback.getForAgent(val, 8);
          state._agentLessonsCache = agentFeedback.buildLessonsPrompt(lessons);
        } catch(e) { state._agentLessonsCache = ''; }
      } else {
        state.agent = null;
        state.selectedWorkflow = null;
      }
      const sys = (state.messages||[]).find(m => m.role === "system");
      if (sys) { sys.content = buildSystemPrompt(); await saveChat(); renderMessages(true); }
    } catch(err) { console.error(err); }
  };

  // Theme
  $("#theme-select").onchange = e => {
    document.documentElement.dataset.theme = e.target.value;
    db.put('settings', { id:'theme', value:e.target.value }).catch(()=>{});
  };

  // Lang Switcher
  const toggleLang = () => {
    state.lang = state.lang === 'ar' ? 'fr' : 'ar';
    document.documentElement.dir = state.lang === 'ar' ? 'rtl' : 'ltr';
    db.put('settings', { id:'lang', value:state.lang }).catch(()=>{});
    renderMessages(true);
  };
  if ($("#lang-switch-btn")) $("#lang-switch-btn").onclick = toggleLang;
  if ($("#lang-switch-btn-mob")) $("#lang-switch-btn-mob").onclick = toggleLang;

  // Wizard Modal
  if ($("#open-wizard-btn")) {
    $("#open-wizard-btn").onclick = () => showWizard(state.apiKey ? 2 : 1);
  }
  if ($("#open-wizard-btn-mob")) {
    $("#open-wizard-btn-mob").onclick = () => { closeBurger(); showWizard(state.apiKey ? 2 : 1); };
  }

  // API Modal
  $("#open-api-modal").onclick = () => {
    if (state.apiKey) {
      // Pre-fill with current key (masked display via type=password)
      $("#api-key-input").value = state.apiKey;
    }
    $("#api-modal").classList.add("active");
  };
  const closeApiModal = () => $("#api-modal").classList.remove("active");
  $("#close-api-modal").onclick = closeApiModal;
  if ($("#close-api-modal-2")) $("#close-api-modal-2").onclick = closeApiModal;
  $("#api-modal").onclick = e => { if (e.target === $("#api-modal")) closeApiModal(); };

  $("#save-api-key").onclick = async () => {
    const k = $("#api-key-input").value.trim();
    if (!isValidApiKey(k)) {
      toast("Clé invalide — min. 20 caractères alphanumériques", "error");
      return;
    }
    await setCookie("mistral_api_key", k);
    state.apiKey = k;
    $("#api-status").innerHTML = '<span class="status-dot"></span>EN LIGNE';
    $("#api-status").className = "status-pill active";
    if ($("#api-status-mob")) { $("#api-status-mob").innerHTML = '<span class="status-dot"></span>EN LIGNE'; $("#api-status-mob").className = "status-pill active"; }
    closeApiModal();
    toast("Clé API activée — persistante 365 jours !", "success");
    // Seed all default agents & workflows on first API key entry
    const existingAgents = await db.getAll('agents') || [];
    const hasDefault = existingAgents.some(a => a.id === 'default-qcm-multimatiere-expert');
    if (!hasDefault) {
      if (!state.aiConfig) {
        state.aiConfig = { name: "Mon Assistant IA", goal: "Générer des QCM", agentCount: 0 };
        await db.put('settings', { id: 'aiConfig', value: state.aiConfig });
        updateBrandName();
      }
      await seedDefaultData();

    }
  };

  if ($("#delete-api-key")) {
    $("#delete-api-key").onclick = () => {
      if (!confirm("Supprimer votre clé API sauvegardée ?")) return;
      deleteCookie("mistral_api_key");
      state.apiKey = null;
      $("#api-key-input").value = "";
      $("#api-status").innerHTML = '<span class="status-dot"></span>OFFLINE';
      $("#api-status").className = "status-pill";
      toast("Clé API supprimée", "success");
    };
  }

  // Agent Modal
  const openAgentModal = async () => {
    await loadAgents();
    $("#agent-modal").classList.add("active");
  };
  const closeAgentModal = () => $("#agent-modal").classList.remove("active");
  $("#open-agent-modal").onclick = openAgentModal;
  $("#close-agent-modal").onclick = closeAgentModal;
  if ($("#close-agent-modal-2")) $("#close-agent-modal-2").onclick = closeAgentModal;
  $("#agent-modal").onclick = e => { if (e.target === $("#agent-modal")) closeAgentModal(); };

  $("#save-agent").onclick = async () => {
    const name = $("#agent-name").value.trim();
    const desc = $("#agent-desc").value.trim();
    if (!name || !desc) { toast("Nom et rôle obligatoires", "error"); return; }
    const agent = {
      id: uuid(),
      name,
      desc,
      instructions: $("#agent-instructions").value.trim(),
      primer: ($("#agent-primer") ? $("#agent-primer").value.trim() : ""),
      tags: ($("#agent-tags").value||"").split(',').map(t=>t.trim()).filter(Boolean),
      modelPref: ($("#agent-model-pref") ? $("#agent-model-pref").value : ""),
      temperature: parseFloat(($("#create-agent-temp") ? $("#create-agent-temp").value : "0.7")) || 0.7,
      style: ($("#create-agent-style") ? $("#create-agent-style").value : ""),
      forbidden: ($("#create-agent-forbidden") ? $("#create-agent-forbidden").value.trim() : ""),
      memPrio: 3,
      maxTokens: 4096,
      created: now()
    };
    await db.put('agents', agent);
    closeAgentModal();
    await loadAgents();
    $("#agent-select").value = agent.id;
    state.agent = agent;
    const sys = (state.messages||[]).find(m => m.role === "system");
    if (sys) { sys.content = buildSystemPrompt(); await saveChat(); renderMessages(); }
    toast(`Agent "${name}" créé et activé !`, "success");
    ["agent-name","agent-desc","agent-instructions","agent-tags"].forEach(id => {
      const el = $(`#${id}`);
      if (el) el.value = "";
    });
    if ($("#agent-primer")) $("#agent-primer").value = "";
  };

  // ══ WORKFLOW MODAL ══
  const openWorkflowModal = async () => {
    await loadAgents(); // ensure agents are loaded for step selects
    await renderWfExistingList();
    await resetWorkflowForm();
    $("#workflow-modal").classList.add("active");
  };
  const closeWorkflowModal = () => $("#workflow-modal").classList.remove("active");
  if ($("#open-workflow-modal")) $("#open-workflow-modal").onclick = openWorkflowModal;
  if ($("#close-workflow-modal")) $("#close-workflow-modal").onclick = closeWorkflowModal;
  if ($("#close-workflow-modal-2")) $("#close-workflow-modal-2").onclick = closeWorkflowModal;
  if ($("#workflow-modal")) $("#workflow-modal").onclick = e => { if (e.target === $("#workflow-modal")) closeWorkflowModal(); };
  if ($("#wf-add-step")) $("#wf-add-step").onclick = async () => await wfAddStep();
  if ($("#wf-save-btn")) $("#wf-save-btn").onclick = () => saveWorkflow();
  if ($("#wf-delete-btn")) $("#wf-delete-btn").onclick = async () => {
    const id = $("#wf-edit-id").value;
    if (id) {
      await deleteWorkflow(id);
      await resetWorkflowForm();
    }
  };



  // Memory
  $("#memory-toggle").onclick = () => $("#memory-panel").classList.toggle("active");
  $("#memory-add").onclick = async () => {
    const txt = $("#memory-input").value.trim();
    if (!txt) return;
    await memory.add(txt);
    $("#memory-input").value = "";
    toast("Mémoire ajoutée", "success");
    const sys = (state.messages||[]).find(m => m.role === "system");
    if (sys) { sys.content = buildSystemPrompt(); await saveChat(); }
  };
  $("#memory-input").onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); $("#memory-add").click(); } };
  $("#memory-clear").onclick = async () => {
    if (confirm("Effacer toute la mémoire globale ?")) await memory.clear();
  };

  // Data Modal
  const openDataModal = async () => {
    await computeStats();
    $("#data-modal").classList.add("active");
  };
  const closeDataModal = () => $("#data-modal").classList.remove("active");
  if ($("#open-data-modal")) $("#open-data-modal").onclick = openDataModal;
  if ($("#close-data-modal")) $("#close-data-modal").onclick = closeDataModal;
  if ($("#close-data-modal-2")) $("#close-data-modal-2").onclick = closeDataModal;
  if ($("#data-modal")) $("#data-modal").onclick = e => { if (e.target === $("#data-modal")) closeDataModal(); };

  if ($("#btn-export")) $("#btn-export").onclick = exportData;

  // Quiz Player Modal interactions
  const qpEval = $("#qp-eval");
  if (qpEval) {
    qpEval.onchange = (e) => {
      const timerGroup = $("#qp-timer-group");
      if (e.target.checked) timerGroup.style.display = "flex";
      else timerGroup.style.display = "none";
    };
  }
  const qpExportBtn = $("#qp-export-btn");
  if (qpExportBtn) {
    qpExportBtn.onclick = () => {
      const msgId = $("#qp-msg-id").value;
      if (msgId) exportQuizPlayer(msgId);
    };
  }

  // Workflow Export / Import
  if ($("#btn-wf-export")) $("#btn-wf-export").onclick = exportWorkflows;
  
  const wfDropZone = $("#wf-import-drop-zone");
  const wfFileInput = $("#wf-import-file-input");
  if (wfDropZone && wfFileInput) {
    wfDropZone.onclick = () => wfFileInput.click();
    wfDropZone.ondragover = e => { e.preventDefault(); wfDropZone.classList.add("dragover"); };
    wfDropZone.ondragleave = () => wfDropZone.classList.remove("dragover");
    wfDropZone.ondrop = async e => {
      e.preventDefault();
      wfDropZone.classList.remove("dragover");
      const file = e.dataTransfer.files[0];
      if (file) {
        await importWorkflows(file);
        renderWfExistingList(); // Refresh UI list
      }
    };
    wfFileInput.onchange = async e => {
      const file = e.target.files[0];
      if (file) {
        await importWorkflows(file);
        renderWfExistingList(); // Refresh UI list
        wfFileInput.value = "";
      }
    };
  }

  if ($("#btn-clear-all")) $("#btn-clear-all").onclick = async () => {
    if (!confirm("⚠ Supprimer TOUTES les données locales Mon Assistant IA ? Cette action est irréversible.")) return;
    const stores = ['chats','agents','settings','global_memory','workflows'];
    for (const s of stores) {
      const all = await db.getAll(s) || [];
      for (const r of all) await db.delete(s, r.id);
    }
    state.messages = [];
    state.agent = null;
    state.globalMemories = [];
    await newChat();
    await loadAgents();
    renderMemoryList();
    closeDataModal();
    toast("Toutes les données supprimées", "success");
  };

  // Import zone — étape 1 : sélection + aperçu
  let pendingImportFile = null;

  const dropZone = $("#import-drop-zone");
  const fileInput = $("#import-file-input");
  const importPreview = $("#import-preview");

  const showImportPreview = async (file) => {
    pendingImportFile = file;
    $("#import-filename").textContent = file.name;
    $("#import-fileinfo").textContent = `${(file.size / 1024).toFixed(1)} KB — ${new Date(file.lastModified).toLocaleDateString('fr-FR')}`;
    $("#import-summary").textContent = "Analyse en cours…";
    importPreview.style.display = "block";
    dropZone.style.opacity = "0.4";

    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      const data = payload.data || payload;
      const nbChats = data.chats?.length || 0;
      const nbAgents = data.agents?.length || 0;
      const nbMems = data.global_memory?.length || 0;
      const exported = payload.exported ? `Sauvegarde du ${new Date(payload.exported).toLocaleString('fr-FR')}` : "Date inconnue";
      $("#import-summary").innerHTML = `
        <strong style="color:var(--neon)">✓ Fichier valide</strong><br>
        ${exported}<br>
        ▸ ${nbChats} conversation(s) &nbsp;|&nbsp; ${nbAgents} agent(s) &nbsp;|&nbsp; ${nbMems} souvenir(s)
      `;
    } catch(e) {
      $("#import-summary").innerHTML = `<span style="color:var(--danger)">⚠ Fichier invalide ou corrompu : ${e.message}</span>`;
      pendingImportFile = null;
    }
  };

  const resetImportUI = () => {
    pendingImportFile = null;
    importPreview.style.display = "none";
    dropZone.style.opacity = "1";
    if (fileInput) fileInput.value = "";
  };

  if (dropZone && fileInput) {
    dropZone.onclick = () => fileInput.click();
    dropZone.ondragover = e => { e.preventDefault(); dropZone.classList.add("dragover"); };
    dropZone.ondragleave = () => dropZone.classList.remove("dragover");
    dropZone.ondrop = e => {
      e.preventDefault();
      dropZone.classList.remove("dragover");
      const file = e.dataTransfer.files[0];
      if (file) showImportPreview(file);
    };
    fileInput.onchange = e => {
      const file = e.target.files[0];
      if (file) showImportPreview(file);
    };
  }

  // Import étape 2 : confirmer
  if ($("#btn-import-confirm")) {
    $("#btn-import-confirm").onclick = async () => {
      if (!pendingImportFile) return;
      const btn = $("#btn-import-confirm");
      btn.disabled = true;
      btn.innerHTML = '<span class="spin-ring"></span> RESTAURATION…';
      try {
        await importData(pendingImportFile);
        resetImportUI();
        await computeStats();
      } finally {
        btn.disabled = false;
        btn.innerHTML = '✓ VALIDER ET RESTAURER';
      }
    };
  }
  if ($("#btn-import-cancel")) {
    $("#btn-import-cancel").onclick = resetImportUI;
  }

  // ══ BURGER MENU MOBILE ══
  const burgerBtn = $("#burger-btn");
  const mobileMenu = $("#mobile-menu");

  const closeBurger = () => mobileMenu.classList.remove("open");

  if (burgerBtn && mobileMenu) {
    burgerBtn.onclick = (e) => {
      e.stopPropagation();
      mobileMenu.classList.toggle("open");
    };

    // Sync mobile selects with desktop selects
    const syncMobile = () => {
      const mMod = $("#model-select-mob");
      const mAgent = $("#agent-select-mob");
      const mTheme = $("#theme-select-mob");
      if (mMod) { mMod.innerHTML = $("#model-select").innerHTML; mMod.value = state.model; }
      if (mAgent) { 
        mAgent.innerHTML = $("#agent-select").innerHTML; 
        mAgent.value = state.selectedWorkflow ? `__WF__${state.selectedWorkflow.id}` : (state.agent?.id || ""); 
      }
      if (mTheme) mTheme.value = document.documentElement.dataset.theme;
    };

    mobileMenu.addEventListener('click', e => e.stopPropagation());
    document.addEventListener('click', () => closeBurger());

    // Mobile model select
    const mModSel = $("#model-select-mob");
    if (mModSel) {
      // Populate
      MODELS.forEach(m => {
        const opt = document.createElement("option");
        opt.value = m.id;
        opt.textContent = m.name;
        mModSel.appendChild(opt);
      });
      mModSel.value = state.model;
      mModSel.onchange = e => {
        state.model = e.target.value;
        $("#model-select").value = state.model;
        db.put('settings', { id:'model', value:state.model }).catch(()=>{});
        const sys = (state.messages||[]).find(m => m.role === "system");
        if (sys) { sys.content = buildSystemPrompt(); saveChat(); }
      };
    }

    // Mobile agent select
    const mAgentSel = $("#agent-select-mob");
    if (mAgentSel) {
      mAgentSel.onchange = async e => {
        try {
          const val = e.target.value;
          if (val === '__ALL_AGENTS__') {
            state.agent = '__ALL_AGENTS__';
            state.selectedWorkflow = null;
            toast("Mode Multi-Agents activé — tous les experts seront consultés", "success");
          } else if (val.startsWith('__WF__')) {
            const wfId = val.replace('__WF__', '');
            const wf = await db.get('workflows', wfId);
            if (wf) {
              state.selectedWorkflow = wf;
              state.agent = null;
              toast(`Chaîne "${wf.name}" sélectionnée (${wf.steps.length} étapes)`, "success");
            }
          } else if (val) {
            state.agent = await db.get('agents', val);
            state.selectedWorkflow = null;
          } else {
            state.agent = null;
            state.selectedWorkflow = null;
          }
          $("#agent-select").value = val;
          const sys = (state.messages||[]).find(m => m.role === "system");
          if (sys) { sys.content = buildSystemPrompt(); await saveChat(); renderMessages(true); }
        } catch(err) { console.error(err); }
      };
    }

    // Mobile theme select
    const mThemeSel = $("#theme-select-mob");
    if (mThemeSel) {
      mThemeSel.onchange = e => {
        document.documentElement.dataset.theme = e.target.value;
        $("#theme-select").value = e.target.value;
        db.put('settings', { id:'theme', value:e.target.value }).catch(()=>{});
      };
    }

    // Mobile API modal
    if ($("#open-api-modal-mob")) $("#open-api-modal-mob").onclick = () => { closeBurger(); $("#api-modal").classList.add("active"); };
    // Mobile Agent modal
    if ($("#open-agent-modal-mob")) $("#open-agent-modal-mob").onclick = async () => { closeBurger(); await loadAgents(); $("#agent-modal").classList.add("active"); };
    // Mobile Data modal
    if ($("#open-data-modal-mob")) $("#open-data-modal-mob").onclick = async () => { closeBurger(); await computeStats(); $("#data-modal").classList.add("active"); };
    // Mobile Workflow modal
    if ($("#open-workflow-modal-mob")) $("#open-workflow-modal-mob").onclick = async () => { closeBurger(); await loadAgents(); await renderWfExistingList(); await resetWorkflowForm(); $("#workflow-modal").classList.add("active"); };
    // Mobile clear / new
    if ($("#clear-chat-mob")) $("#clear-chat-mob").onclick = () => { closeBurger(); $("#clear-chat").click(); };
    if ($("#new-chat-mob")) $("#new-chat-mob").onclick = () => { closeBurger(); newChat(); };

    // Sync mobile status pill
    const syncStatusMob = () => {
      const mob = $("#api-status-mob");
      if (!mob) return;
      mob.innerHTML = $("#api-status").innerHTML;
      mob.className = $("#api-status").className;
    };

    // Sync mobile status after API key save
    const origSaveKey = document.getElementById("save-api-key");
    if (origSaveKey) {
      const origClick = origSaveKey.onclick;
      origSaveKey.onclick = function(...args) {
        if (origClick) origClick.apply(origSaveKey, args);
        setTimeout(syncStatusMob, 100);
      };
    }

    // Sync on open
    burgerBtn.addEventListener('click', syncStatusMob);
  }

  // Close memory panel on outside click
  document.addEventListener('click', e => {
    const panel = $("#memory-panel");
    const toggle = $("#memory-toggle");
    if (panel.classList.contains("active") && !panel.contains(e.target) && e.target !== toggle) {
      panel.classList.remove("active");
    }
  });
}

// ════════════════════════════════════════
// EXPOSE GLOBAL FUNCTIONS (for inline onclick handlers in HTML)
// ════════════════════════════════════════
window.submitFeedback = submitFeedback;
window.clearAgentLessons = clearAgentLessons;
window.deleteLesson = deleteLesson;
window.updateLesson = updateLesson;
window.manageLessons = manageLessons;
window.openFeedbackModal = openFeedbackModal;
// ════════════════════════════════════════
// WEB QUIZ PLAYER
// ════════════════════════════════════════
let wqState = {
  questions: [],
  currentIndex: 0,
  selectedChoice: null,
  isVerified: false,
  mode: 'revision',
  score: 0,
  timerSeconds: 0,
  timerInterval: null
};

// Sélection automatique du modèle d'IA en fonction du contenu de la question
function autoSelectMistralModel(textContext) {
  const lower = textContext.toLowerCase();
  
  // 1. Mathématiques / Logique complexe
  // Détection de symboles LaTeX fréquents ou mots-clés
  if (lower.includes('\\\\') || lower.includes('$') || lower.includes('équation') || 
      lower.includes('dérivée') || lower.includes('limite') || lower.includes('théorème') || 
      lower.includes('vecteur') || lower.includes('\\\\frac') || lower.includes('mathématiques')) {
    return "mistral-large-2512";
  }
  
  // 2. Programmation / Informatique
  if (lower.includes('javascript') || lower.includes('python') || lower.includes('html') || 
      lower.includes(' css ') || lower.includes('fonction') || lower.includes('algorithme') || 
      lower.includes('code') || lower.includes('variable') || lower.includes('</')) {
    return "codestral-2508";
  }
  
  // 3. Culture générale / Facile
  // Si rien de spécifique n'est détecté, on privilégie la vitesse et la légèreté
  return "mistral-small-2603";
}

// Fix unbalanced [ ] { } and \left / \right inside a LaTeX expression
function fixLatexBraces(latex) {
  let s = latex;

  // 1. Balance [ ]
  const ob = (s.match(/\[/g)||[]).length, cb = (s.match(/\]/g)||[]).length;
  if (ob > cb) s += ']'.repeat(ob - cb);

  // 2. Balance { }
  const oc = (s.match(/\{/g)||[]).length, cc = (s.match(/\}/g)||[]).length;
  if (oc > cc) s += '}'.repeat(oc - cc);

  // 3. Balance \left / \right
  // Count each (they must be followed by a non-letter, e.g. \left( \right| \left.)
  const nLeft  = (s.match(/\\left(?=[^a-zA-Z])/g)||[]).length;
  const nRight = (s.match(/\\right(?=[^a-zA-Z])/g)||[]).length;
  if (nLeft > nRight) {
    // Missing \right — append invisible \right. for each missing one
    s += ' \\right.'.repeat(nLeft - nRight);
  } else if (nRight > nLeft) {
    // Extra \right — prepend invisible \left. for each extra one
    s = '\\left. '.repeat(nRight - nLeft) + s;
  }

  return s;
}

// Render text: preserve LaTeX for MathJax, HTML-escape the rest
// Also auto-wraps bare LaTeX commands (e.g. \mapsto, \rightarrow) in $...$
function renderWithLatex(rawText) {
  if (!rawText) return "";

  // Step 1: extract delimited LaTeX blocks into a safe placeholder map
  const blocks = [];
  let text = rawText;

  function stash(content) {
    blocks.push(content);
    return `__LATEX_BLOCK_${blocks.length - 1}__`;
  }

  // Replace $$...$$
  text = text.replace(/\$\$([\s\S]*?)\$\$/g, (m, p1) => stash(`$$${fixLatexBraces(p1)}$$`));
  // Replace \[...\]
  text = text.replace(/\\\[([\s\S]*?)\\\]/g, (m, p1) => stash(`\\[${fixLatexBraces(p1)}\\]`));
  // Replace \(...\)
  text = text.replace(/\\\(([\s\S]*?)\\\)/g, (m, p1) => stash(`\\(${fixLatexBraces(p1)}\\)`));
  // Replace $...$
  text = text.replace(/\$((?:[^$\\]|\\.)+)\$/g, (m, p1) => stash(`$${fixLatexBraces(p1)}$`));

  // Step 2: identify bare math commands (like \rightarrow, \frac) that are NOT in placeholders
  // We'll roughly assume any word starting with \ that isn't a text command is math.
  const bareMathRegex = /\\[a-zA-Z]+(?:_[^{}\s]+|\^[^{}\s]+|_\{[^}]+\}|\^\{[^}]+\}|(?:\{[^}]*\})*)*(?:\s*[=+\-<>]\s*[0-9a-zA-Z]+)?/g;
  text = text.replace(bareMathRegex, (m) => {
    // Avoid escaping newlines or common non-math
    if (m === '\\n' || m === '\\t' || m.startsWith('\\textbf') || m.startsWith('\\textit')) return m;
    return stash(`$${fixLatexBraces(m)}$`);
  });

  // Step 3: Markdown processing (simple bold/italics to HTML)
  text = text
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br>');

  // Step 4: restore LaTeX blocks
  return text.replace(/__LATEX_BLOCK_(\d+)__/g, (m, idx) => blocks[parseInt(idx, 10)]);
}

window.openWebQuizPlayer = function(msgId) {
  const msg = state.messages.find(m => (m.ts || '') == msgId);
  if (!msg || !msg.content) return;

  const rawContent = msg.content.replace(/<details>[\s\S]*<\/details>/i, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const allLines = rawContent.split('\n')
    .map(l => cleanupLineContent(l))
    .filter(l => l && !/^[-_*]{2,}$/.test(l));

  let questions = processLinesStandard(allLines);
  if (!questions.length) {
    questions = processLinesMixed(allLines);
  }

  if (!questions.length) {
    toast("Erreur: Aucune question valide détectée pour le test.", "error");
    return;
  }

  wqState.questions = questions;
  wqState.currentIndex = 0;
  wqState.selectedChoice = null;
  wqState.isVerified = false;

  document.getElementById('web-quiz-player-modal').classList.add('active');
  window.renderWebQuizPlayer();
};

window.renderWebQuizPlayer = function() {
  const q = wqState.questions[wqState.currentIndex];
  const isLast = wqState.currentIndex === wqState.questions.length - 1;
  const isFirst = wqState.currentIndex === 0;

  document.getElementById('wq-counter').innerText = `Question ${wqState.currentIndex + 1}/${wqState.questions.length}`;
  document.getElementById('wq-progress-bar').style.width = `${((wqState.currentIndex + 1) / wqState.questions.length) * 100}%`;

  // Fix unbalanced [ ] { } and \left / \right inside a LaTeX expression
  function fixLatexBraces(latex) {
    let s = latex;

    // 1. Balance [ ]
    const ob = (s.match(/\[/g)||[]).length, cb = (s.match(/\]/g)||[]).length;
    if (ob > cb) s += ']'.repeat(ob - cb);

    // 2. Balance { }
    const oc = (s.match(/\{/g)||[]).length, cc = (s.match(/\}/g)||[]).length;
    if (oc > cc) s += '}'.repeat(oc - cc);

    // 3. Balance \left / \right
    // Count each (they must be followed by a non-letter, e.g. \left( \right| \left.)
    const nLeft  = (s.match(/\\left(?=[^a-zA-Z])/g)||[]).length;
    const nRight = (s.match(/\\right(?=[^a-zA-Z])/g)||[]).length;
    if (nLeft > nRight) {
      // Missing \right — append invisible \right. for each missing one
      s += ' \\right.'.repeat(nLeft - nRight);
    } else if (nRight > nLeft) {
      // Extra \right — prepend invisible \left. for each extra one
      s = '\\left. '.repeat(nRight - nLeft) + s;
    }

    return s;
  }

  // Render text: preserve LaTeX for MathJax, HTML-escape the rest
  // Also auto-wraps bare LaTeX commands (e.g. \mapsto, \rightarrow) in $...$
  function renderWithLatex(rawText) {
    if (!rawText) return "";

    // Step 1: extract delimited LaTeX blocks into a safe placeholder map
    const blocks = [];
    let text = rawText;

    function stash(content) {
      blocks.push(content);
      return `\x02${blocks.length - 1}\x03`;
    }

    // $$...$$ display
    text = text.replace(/\$\$([\s\S]*?)\$\$/g, (_, inner) => stash('$$' + fixLatexBraces(inner) + '$$'));
    // \[...\] display
    text = text.replace(/\\\[([\s\S]*?)\\\]/g, (_, inner) => stash('\\[' + fixLatexBraces(inner) + '\\]'));
    // \(...\) inline
    text = text.replace(/\\\(([\s\S]*?)\\\)/g, (_, inner) => stash('\\(' + fixLatexBraces(inner) + '\\)'));
    // $...$ inline — only match balanced pairs (no newline inside)
    text = text.replace(/\$([^$\n\x02\x03]+?)\$/g, (_, inner) => stash('$' + fixLatexBraces(inner) + '$'));

    // Step 2: in remaining plain segments, auto-wrap bare LaTeX command sequences
    text = text.replace(/[^\x02\x03]+/g, (seg) => {
      if (!/\\[a-zA-Z]/.test(seg)) return seg; // fast path: no LaTeX commands
      // Wrap runs containing \cmd — split on whitespace sequences that are clearly French words
      return seg.replace(
        /((?:\\[a-zA-Z]+(?:\{[^}]*\}|\[[^\]]*\])*|[a-zA-Z0-9])[_^]?(?:\{[^}]*\}|\[[^\]]*\])?(?:\s*(?:\\[a-zA-Z]+(?:\{[^}]*\}|\[[^\]]*\])*|[a-zA-Z0-9])[_^]?(?:\{[^}]*\}|\[[^\]]*\])?)*)/g,
        (token) => {
          if (/\\[a-zA-Z]/.test(token)) return stash('$' + fixLatexBraces(token.trim()) + '$');
          return token;
        }
      );
    });

    // Step 3: reassemble — HTML-escape plain segments, restore LaTeX blocks as-is
    return text.split(/(\x02\d+\x03)/).map(seg => {
      const m = seg.match(/\x02(\d+)\x03/);
      if (m) return blocks[parseInt(m[1])]; // restore raw LaTeX for MathJax
      // plain text: HTML-escape then markdown
      let plain = seg.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
      if (typeof marked !== 'undefined') plain = marked.parseInline(plain);
      return plain;
    }).join('');
  }

  let qText = renderWithLatex(q.question);
  document.getElementById('wq-question-text').innerHTML = qText;

  // De-obfuscate the correct answer
  const revStr = q.reponse_obfusquee.split('').reverse().join('');
  const correctIndex = parseInt(atob(revStr).split('').reverse().join(''));

  const choicesHtml = q.choix.map((choice, i) => {
    const isSelected = wqState.selectedChoice === i;
    const isCorrect = correctIndex === i;
    
    let stateClass = '';
    if (wqState.isVerified) {
      if (isCorrect) stateClass = 'correct';
      else if (isSelected) stateClass = 'incorrect';
      stateClass += ' disabled';
    } else {
      if (isSelected) stateClass = 'selected';
    }

    let cleanChoice = choice.replace(/^(?:[a-d]|أ|ب|ج|د)[\-\)]\s*/i, '');
    let cText = renderWithLatex(cleanChoice);

    let displayLetter = String.fromCharCode(97 + i);
    if (state.lang === 'ar') {
      const arLetters = ['أ', 'ب', 'ج', 'د', 'هـ', 'و'];
      displayLetter = arLetters[i] || displayLetter;
    }

    return `<div class="wq-choice-card ${stateClass}" data-choice="${i}">
      <div class="wq-choice-letter">${displayLetter}</div>
      <div class="wq-choice-text">${cText}</div>
    </div>`;
  }).join('');

  document.getElementById('wq-choices').innerHTML = choicesHtml;

  const verifyBtn = document.getElementById('wq-btn-verify');
  const wikiBtn = document.getElementById('wq-btn-wiki-action');
  const prevBtn = document.getElementById('wq-btn-prev');
  const nextBtn = document.getElementById('wq-btn-next');
  const feedback = document.getElementById('wq-feedback');

  prevBtn.disabled = isFirst;

  if (wqState.mode === 'evaluation') {
    // In evaluation mode: next always hidden on last, show TERMINER on last question
    nextBtn.style.display = isLast ? 'none' : 'inline-flex';
    nextBtn.disabled = true;
    const finishBtn = document.getElementById('wq-btn-finish');
    if (finishBtn) finishBtn.style.display = isLast ? 'inline-flex' : 'none';
    const finishRevBtn = document.getElementById('wq-btn-finish-revision');
    if (finishRevBtn) finishRevBtn.style.display = 'none';
    if (verifyBtn) verifyBtn.style.display = 'none';
    if (wikiBtn) wikiBtn.style.display = 'none';
    if (feedback) feedback.style.display = 'none';
  } else {
    // Revision mode
    nextBtn.style.display = isLast ? 'none' : 'inline-flex';
    nextBtn.disabled = isLast; // Only disabled on last question (TERMINER button replaces it)
    const finishBtn = document.getElementById('wq-btn-finish');
    if (finishBtn) finishBtn.style.display = 'none';
    const finishRevBtn = document.getElementById('wq-btn-finish-revision');
    // Always show TERMINER on the last question so the user can finish without verifying
    if (finishRevBtn) finishRevBtn.style.display = isLast ? 'inline-flex' : 'none';

    if (wqState.isVerified) {
      feedback.style.display = 'block';
      let expl = renderWithLatex(q.explication || "Pas d'explication disponible.");
      document.getElementById('wq-feedback-text').innerHTML = expl;

      // Extraire l'URL propre (supporte format brut et markdown [texte](url))
      let wikiUrl = extractUrlFromText(q.pour_aller_plus_loin);

      // Si pas d'URL directe : générer une recherche Wikipedia depuis le texte de la question
      if (!wikiUrl) {
        const questionText = (q.question || '').replace(/^\s*\d+[\-\.\)]\s*/, '').replace(/\$[^$]*\$/g, '').trim().substring(0, 60);
        wikiUrl = 'https://fr.wikipedia.org/w/index.php?search=' + encodeURIComponent(questionText);
      }

      // Remplacer le bouton VÉRIFIER par POUR ALLER PLUS LOIN
      verifyBtn.style.display = 'none';
      wikiBtn.style.display = 'inline-flex';
      wikiBtn.href = wikiUrl;

    } else {
      // Remettre le bouton VÉRIFIER et cacher le bouton wiki
      verifyBtn.style.display = '';
      verifyBtn.disabled = wqState.selectedChoice === null;
      verifyBtn.classList.remove('checked');
      verifyBtn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:8px"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg> VÉRIFIER`;
      if (wikiBtn) wikiBtn.style.display = 'none';
      feedback.style.display = 'none';
    }
  }

  // Réinitialiser la zone IA
  const aiContainer = document.getElementById('wq-ai-response-container');
  const aiContent = document.getElementById('wq-ai-response-content');
  const aiBtn = document.getElementById('wq-btn-ask-ai');
  if (aiContainer && aiContent && aiBtn) {
    aiContainer.style.display = 'none';
    aiContent.innerHTML = '';
    aiBtn.style.display = (wqState.mode === 'evaluation' || !wqState.isVerified) ? 'none' : 'inline-flex';
    aiBtn.disabled = false;
  }

  // Trigger MathJax if available
  if (window.MathJax && typeof window.MathJax.typesetPromise === 'function') {
    try {
      window.MathJax.typesetClear();
      window.MathJax.typesetPromise([document.getElementById('wq-question-text'), document.getElementById('wq-choices'), document.getElementById('wq-feedback')]).catch(err => console.log(err));
    } catch(e) {}
  }
}

window.selectWebQuizChoice = function(index) {
  wqState.selectedChoice = index;
  if (wqState.mode === 'evaluation') {
    wqState.questions[wqState.currentIndex].userAnswer = index;
    // Stop the countdown — question answered
    if (wqState.timerInterval) {
      clearInterval(wqState.timerInterval);
      wqState.timerInterval = null;
    }
    window.renderWebQuizPlayer();
    // Auto-advance to next question after 1.5s
    setTimeout(() => {
      if (wqState.mode !== 'evaluation') return;
      if (wqState.currentIndex < wqState.questions.length - 1) {
        wqState.currentIndex++;
        wqState.selectedChoice = null;
        window.renderWebQuizPlayer();
        startQuestionCountdown();
      } else {
        // Last question answered — trigger finish
        window.renderWebQuizPlayer();
        const finishBtn = document.getElementById('wq-btn-finish');
        if (finishBtn) finishBtn.click();
      }
    }, 1500);
  } else {
    wqState.isVerified = true; // Auto-verify on click
    // Track the answer for final score in revision mode
    wqState.questions[wqState.currentIndex]._lastAnswer = index;
    window.renderWebQuizPlayer();
  }
};

document.addEventListener('click', e => {
  const choiceCard = e.target.closest('.wq-choice-card');
  if (choiceCard && !wqState.isVerified) {
    const idx = parseInt(choiceCard.dataset.choice);
    if (!isNaN(idx)) {
      window.selectWebQuizChoice(idx);
    }
    return;
  }

  const verifyBtn = e.target.closest('#wq-btn-verify');
  if (verifyBtn && !verifyBtn.disabled) {
    if (wqState.selectedChoice !== null) {
      wqState.isVerified = true;
      // Track the answer for final score in revision mode
      wqState.questions[wqState.currentIndex]._lastAnswer = wqState.selectedChoice;
      window.renderWebQuizPlayer();
    }
    return;
  }

  const prevBtn = e.target.closest('#wq-btn-prev');
  if (prevBtn && !prevBtn.disabled) {
    if (wqState.currentIndex > 0) {
      wqState.currentIndex--;
      wqState.selectedChoice = null;
      wqState.isVerified = false;
      window.renderWebQuizPlayer();
      if (wqState.mode === 'evaluation') startQuestionCountdown();
    }
    return;
  }

  const nextBtn = e.target.closest('#wq-btn-next');
  if (nextBtn && !nextBtn.disabled) {
    const isLast = wqState.currentIndex === wqState.questions.length - 1;
    if (isLast && wqState.mode === 'revision' && wqState.isVerified) {
      // Last question in revision — show final score screen
      showFinalScoreScreen();
    } else if (!isLast) {
      wqState.currentIndex++;
      wqState.selectedChoice = null;
      wqState.isVerified = false;
      window.renderWebQuizPlayer();
      if (wqState.mode === 'evaluation') startQuestionCountdown();
    }
    return;
  }

  const aiBtn = e.target.closest('#wq-btn-ask-ai');
  if (aiBtn && !aiBtn.disabled && wqState.isVerified) {
    aiBtn.disabled = true;
    const aiContainer = document.getElementById('wq-ai-response-container');
    const aiContent = document.getElementById('wq-ai-response-content');
    aiContainer.style.display = 'block';
    aiContent.innerHTML = "<em>L'assistant réfléchit...</em>";
    const q = wqState.questions[wqState.currentIndex];
    const correctIdx = q.choix.findIndex(c => c.correct);
    const userChoiceText = wqState.selectedChoice !== null ? q.choix[wqState.selectedChoice].text : "Aucun";
    const correctChoiceText = correctIdx >= 0 ? q.choix[correctIdx].text : "Inconnue";
    
    const prompt = `Tu es un tuteur pédagogique.
Règle ABSOLUE : Tu DOIS répondre dans la LANGUE EXACTE de la "Question" ci-dessous. Si la question est en ARABE, réponds intégralement en ARABE.

Voici les données du QCM :
- Question : ${q.question}
- Options :
${q.choix.map((c, i) => String.fromCharCode(97+i) + "- " + c.text).join('\\n')}
- Bonne réponse : ${correctChoiceText}
- Explication prévue : ${q.explication}
- Choix de l'utilisateur : ${userChoiceText}

Tâche :
Explique brièvement pourquoi la réponse est correcte ou pourquoi le choix de l'utilisateur est faux. 
NE METS AUCUNE BALISE \`\`\`markdown AUTOUR DE TA RÉPONSE ! (Écris directement le texte). Formate les maths en LaTeX ($ ou $$).
RAPPEL CRUCIAL : RÉPONDS EXCLUSIVEMENT DANS LA LANGUE DE LA QUESTION.`;

    const dynamicModel = autoSelectMistralModel(q.question + " " + (q.explication || ""));

    const reqBody = {
      model: state.agent?.modelPref || dynamicModel,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      stream: true
    };

    fetchWithRetry("https://api.mistral.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${state.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(reqBody)
    }).then(async res => {
      if (!res.ok) throw new Error("API " + res.status);
      let content = "";
      await handleStreamingResponse(res, (chunk) => {
        content = chunk;
        aiContent.innerHTML = renderWithLatex(content);
        
        // Auto RTL pour l'Arabe
        if (/[\u0600-\u06FF]/.test(content)) {
          aiContent.setAttribute("dir", "rtl");
          aiContent.style.textAlign = "right";
        } else {
          aiContent.setAttribute("dir", "ltr");
          aiContent.style.textAlign = "left";
        }
      }, () => {
        aiBtn.disabled = false;
        // Trigger MathJax after full render
        if (window.MathJax && typeof window.MathJax.typesetPromise === 'function') {
          window.MathJax.typesetPromise([aiContent]).catch(err => console.log(err));
        }
      });
    }).catch(err => {
      aiContent.innerHTML = `<span style="color:var(--neon-red)">Erreur : Impossible de joindre l'IA.</span>`;
      aiBtn.disabled = false;
      console.error(err);
    });
    return;
  }
});

// ─── SCORE FINAL SCREEN ─────────────────────────────────────────────────────

function showFinalScoreScreen() {
  if (wqState.timerInterval) {
    clearInterval(wqState.timerInterval);
    wqState.timerInterval = null;
  }
  hideQuizTimerDisplay();

  const modal = document.getElementById('web-quiz-player-modal');
  if (!modal) return;

  const questions = wqState.questions;
  const total = questions.length;

  // Compute score: count correct answers
  let correct = 0;
  questions.forEach(q => {
    const revStr = (q.reponse_obfusquee || '').split('').reverse().join('');
    let correctIdx = -1;
    try { correctIdx = parseInt(atob(revStr).split('').reverse().join('')); } catch(e) {}
    const answered = wqState.mode === 'evaluation' ? q.userAnswer : (q._lastAnswer !== undefined ? q._lastAnswer : null);
    if (answered !== null && answered !== undefined && answered === correctIdx) correct++;
  });

  const pct = total > 0 ? Math.round((correct / total) * 100) : 0;
  const elapsedSec = wqState.timerSeconds || 0;
  const mins = Math.floor(elapsedSec / 60);
  const secs = elapsedSec % 60;
  const timeStr = wqState.mode === 'evaluation' ? `${mins}:${secs.toString().padStart(2,'0')}` : null;

  // Color by score
  const color = pct >= 75 ? '#4caf50' : pct >= 50 ? '#ffa500' : '#ff4d4d';
  const emoji = pct >= 75 ? '🏆' : pct >= 50 ? '👍' : '📚';
  const mention = pct >= 75 ? 'Excellent !' : pct >= 50 ? 'Bien joué !' : 'À revoir !';

  const scoreHtml = `
    <div id="wq-score-screen" style="
      display:flex; flex-direction:column; align-items:center; justify-content:center;
      padding: 40px 24px; text-align:center; gap:20px; min-height:60vh;">
      <div style="font-size:64px;">${emoji}</div>
      <div style="font-size:28px; font-weight:800; color:${color};">${mention}</div>
      <div style="font-size:48px; font-weight:900; color:${color}; letter-spacing:2px;">
        ${correct} / ${total}
      </div>
      <div style="font-size:18px; color: var(--color-on-surface, #ccc);">
        Score : <strong style="color:${color};">${pct}%</strong>
      </div>
      ${timeStr ? `<div style="font-size:14px; color:#888;">Temps total : <strong style="color:#d4af37;">${timeStr}</strong></div>` : ''}
      <div style="width:200px; height:8px; background:rgba(255,255,255,0.1); border-radius:99px; overflow:hidden;">
        <div style="height:100%; width:${pct}%; background:${color}; border-radius:99px; transition:width 0.8s ease;"></div>
      </div>
      <div style="display:flex; gap:12px; flex-wrap:wrap; justify-content:center; margin-top:12px;">
        <button id="wq-score-restart" style="
          padding:10px 24px; border-radius:10px; border:1px solid rgba(212,175,55,0.4);
          background:rgba(212,175,55,0.1); color:#d4af37; font-weight:700; cursor:pointer; font-size:14px;">
          🔄 Rejouer
        </button>
        <button id="wq-score-close" style="
          padding:10px 24px; border-radius:10px; border:1px solid rgba(255,255,255,0.15);
          background:rgba(255,255,255,0.05); color:#fff; font-weight:700; cursor:pointer; font-size:14px;">
          ✕ Fermer
        </button>
      </div>
    </div>`;

  // Replace modal body content
  const body = modal.querySelector('.wq-body') || modal.querySelector('.wq-content') || modal;
  const existingScore = modal.querySelector('#wq-score-screen');
  if (existingScore) existingScore.remove();

  // Hide all quiz UI, show only score
  const quizElements = modal.querySelectorAll('.wq-header, .wq-body, .wq-footer, #wq-feedback, #wq-ai-response-container');
  quizElements.forEach(el => el.style.display = 'none');

  const scoreWrapper = document.createElement('div');
  scoreWrapper.innerHTML = scoreHtml;
  modal.appendChild(scoreWrapper.firstElementChild);

  // Restart button
  modal.querySelector('#wq-score-restart')?.addEventListener('click', () => {
    modal.querySelector('#wq-score-screen')?.remove();
    quizElements.forEach(el => el.style.display = '');
    document.getElementById('import-quiz-json-input').click();
  });

  // Close button
  modal.querySelector('#wq-score-close')?.addEventListener('click', () => {
    modal.querySelector('#wq-score-screen')?.remove();
    quizElements.forEach(el => el.style.display = '');
    modal.classList.remove('active');
  });
}

// Wire up the TERMINER button (Evaluation mode)
document.addEventListener('click', (e) => {
  const finishBtn = e.target.closest('#wq-btn-finish');
  if (finishBtn) {
    showFinalScoreScreen();
  }
  const finishRevBtn = e.target.closest('#wq-btn-finish-revision');
  if (finishRevBtn) {
    showFinalScoreScreen();
  }
});

// ─── JSON QUIZ IMPORT & EVALUATION MODE ─────────────────────────────────────

document.addEventListener('click', (e) => {
  const btn = e.target.closest('#import-quiz-json-btn');
  if (btn) {
    document.getElementById('import-quiz-json-input').click();
  }
});

document.addEventListener('change', (e) => {
  if (e.target.id === 'import-quiz-json-input') {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        let content = ev.target.result;
        if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
        const json = JSON.parse(content);
        const questions = Array.isArray(json) ? json : (json.questions || []);
        if (!questions || questions.length === 0) throw new Error('Format invalide');

        // Demander le mode
        const isEval = window.confirm('Voulez-vous jouer en mode \u00c9valuation (avec score final et temps chronom\u00e9tr\u00e9) ?\\n\\nCliquez sur OK pour \u00c9VALUATION, ou Annuler pour R\u00c9VISION.');
        const mode = isEval ? 'evaluation' : 'revision';
        
        startWebQuizFromData(questions, mode);
      } catch (err) {
        console.error(err);
        alert('Erreur de chargement du fichier JSON.');
      }
      e.target.value = '';
    };
    reader.readAsText(file);
  }
});

function startWebQuizFromData(questions, mode) {
  wqState.questions = questions.map(q => {
    if (typeof q === 'string') return { question: q, choix: [], explication: '' };
    return q;
  });
  wqState.currentIndex = 0;
  wqState.selectedChoice = null;
  wqState.isVerified = false;
  wqState.mode = mode;
  wqState.score = 0;
  
  if (wqState.timerInterval) clearInterval(wqState.timerInterval);
  wqState.timerSeconds = 0;
  // Read the per-question timer setting from sidebar (default 30s)
  wqState.secondsPerQuestion = parseInt(document.getElementById('quiz-eval-timer-input')?.value) || 30;
  wqState.questionTimeLeft = wqState.secondsPerQuestion;

  if (mode === 'evaluation') {
    startQuestionCountdown();
  } else {
    hideQuizTimerDisplay();
  }

  document.getElementById('web-quiz-player-modal').classList.add('active');
  window.renderWebQuizPlayer();
}

function startQuestionCountdown() {
  if (wqState.timerInterval) clearInterval(wqState.timerInterval);
  wqState.questionTimeLeft = wqState.secondsPerQuestion;
  updateQuizTimerDisplay();
  wqState.timerInterval = setInterval(() => {
    wqState.questionTimeLeft--;
    wqState.timerSeconds++; // keep total elapsed for final score screen
    updateQuizTimerDisplay();
    if (wqState.questionTimeLeft <= 0) {
      clearInterval(wqState.timerInterval);
      wqState.timerInterval = null;
      // Auto-advance: mark unanswered and go next
      if (wqState.mode === 'evaluation') {
        if (wqState.selectedChoice === null) {
          wqState.questions[wqState.currentIndex].userAnswer = null; // unanswered
        }
        if (wqState.currentIndex < wqState.questions.length - 1) {
          wqState.currentIndex++;
          wqState.selectedChoice = null;
          window.renderWebQuizPlayer();
          startQuestionCountdown();
        } else {
          // Last question — show finish screen
          window.renderWebQuizPlayer();
          const finishBtn = document.getElementById('wq-btn-finish');
          if (finishBtn) finishBtn.click();
        }
      }
    }
  }, 1000);
}

function updateQuizTimerDisplay() {
  let timerEl = document.getElementById('wq-timer-display');
  if (!timerEl) {
    timerEl = document.createElement('div');
    timerEl.id = 'wq-timer-display';
    timerEl.style.cssText = 'position:absolute; top:12px; left:50%; transform:translateX(-50%); font-weight:bold; background:rgba(0,0,0,0.5); padding: 4px 16px; border-radius: 12px; font-family: monospace; font-size: 18px; border: 1px solid rgba(212,175,55,0.4); transition: color 0.3s;';
    const header = document.querySelector('#web-quiz-player-modal .wq-header');
    if (header) header.appendChild(timerEl);
  }
  const t = wqState.questionTimeLeft !== undefined ? wqState.questionTimeLeft : 0;
  const min = Math.floor(t / 60);
  const sec = t % 60;
  // Change color: green > 10s, orange 5-10s, red <= 5s
  timerEl.style.color = t <= 5 ? '#ff4d4d' : t <= 10 ? '#ffa500' : '#d4af37';
  timerEl.style.borderColor = t <= 5 ? 'rgba(255,77,77,0.5)' : t <= 10 ? 'rgba(255,165,0,0.5)' : 'rgba(212,175,55,0.4)';
  timerEl.innerText = `${min}:${sec.toString().padStart(2, '0')}`;
  timerEl.style.display = 'block';
}

function hideQuizTimerDisplay() {
  const timerEl = document.getElementById('wq-timer-display');
  if (timerEl) timerEl.style.display = 'none';
}










