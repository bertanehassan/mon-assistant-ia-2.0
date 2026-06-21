<template>
  <!-- ─── Header Bar ─── -->
  <header class="w-full top-0 sticky z-50 backdrop-blur-[40px] border-b border-white/10 bg-white/5 flex justify-between items-center px-4 py-3 gap-3" id="hb-header">
    
    <!-- Left: Logo & Title -->
    <div class="flex items-center gap-3">
      <!-- Hexagon logo -->
      <div class="w-9 h-9 rounded-full border border-white/20 ring-2 ring-primary/20 flex items-center justify-center bg-primary/10 flex-shrink-0 hidden sm:flex">
        <svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg" class="w-6 h-6">
          <polygon points="18,2 34,12 34,24 18,34 2,24 2,12" stroke="#00e5ff" stroke-width="1.5" fill="none" opacity="0.6"/>
          <polygon points="18,7 29,13 29,23 18,29 7,23 7,13"  stroke="#00e5ff" stroke-width="1"   fill="none" opacity="0.3"/>
          <circle cx="18" cy="18" r="4" fill="#00e5ff" opacity="0.9"/>
        </svg>
      </div>
      <!-- Title -->
      <div class="flex flex-col leading-tight hidden xl:flex">
        <span class="text-sm font-bold text-on-surface tracking-wide">Mon Assistant IA</span>
        <span class="text-[10px] text-primary font-medium opacity-70">Développé par Hassan Bertane</span>
      </div>
    </div>

    <!-- Center: Selectors & Actions -->
    <div class="flex items-center gap-2 md:gap-3 flex-1 justify-center px-2 flex-wrap sm:flex-nowrap">
      
      <!-- Selectors -->
      <select id="agent-select" class="topbar-select" title="Agents et Chaînes"></select>
      <select id="model-select" class="topbar-select" title="Modèles IA"></select>
      
      <!-- Actions: Effacer & Nouveau -->
      <div class="flex items-center gap-1 ml-0 md:ml-2">
        <button id="clear-chat" class="topbar-btn" title="Effacer la conversation">
          <span class="material-symbols-outlined" style="font-size:16px">delete_sweep</span>
          <span class="hidden md:inline ml-1 text-xs font-semibold">Effacer</span>
        </button>
        <button id="new-chat" class="topbar-btn primary" title="Nouvelle conversation">
          <span class="material-symbols-outlined" style="font-size:16px">add_comment</span>
          <span class="hidden md:inline ml-1 text-xs font-semibold">Nouveau</span>
        </button>
        <input type="file" id="import-quiz-json-input" accept=".json" style="display: none;" />
        <button id="import-quiz-json-btn" class="topbar-btn" title="Jouer un Quiz (.json)" style="color: #d4af37; border-color: rgba(212,175,55,0.4);">
          <span class="material-symbols-outlined" style="font-size:16px">play_circle</span>
          <span class="hidden md:inline ml-1 text-xs font-semibold">Jouer Quiz</span>
        </button>
      </div>

    </div>

    <!-- Right: Status & Settings -->
    <div class="flex items-center gap-2">
      <!-- API status pill -->
      <span class="status-pill hidden sm:flex" id="api-status">
        <span class="status-dot"></span>OFFLINE
      </span>
      <!-- Sidebar toggle -->
      <button @click="showSidebar = !showSidebar"
              class="sidebar-toggle-btn"
              :class="{ 'active': showSidebar }"
              title="Paramètres">
        <span class="material-symbols-outlined" style="font-size:22px">
          {{ showSidebar ? 'close' : 'tune' }}
        </span>
      </button>
    </div>
  </header>

  <!-- ─── Backdrop overlay ─── -->
  <Transition name="fade-overlay">
    <div v-show="showSidebar"
         class="fixed inset-0 z-[60]"
         style="background:rgba(0,0,0,0.55); backdrop-filter:blur(3px)"
         @click="showSidebar = false">
    </div>
  </Transition>

  <!-- ─── Sidebar panel ─── -->
  <Transition name="slide-sidebar">
    <aside v-show="showSidebar" class="sidebar-panel">

      <!-- Sidebar header -->
      <div class="sidebar-hdr">
        <div class="flex items-center gap-2">
          <span class="material-symbols-outlined text-primary" style="font-size:18px">tune</span>
          <span class="text-sm font-semibold text-on-surface">Paramètres</span>
        </div>
        <button @click="showSidebar = false" class="sidebar-close-btn">
          <span class="material-symbols-outlined" style="font-size:18px">close</span>
        </button>
      </div>

      <!-- Scrollable body -->
      <div class="sidebar-body">

        <!-- Modèle IA (Hidden logic required by legacy.js) -->
        <select id="agent-model-pref" class="sb-select mt-2" style="display:none"></select>

        <!-- Contexte utilisé -->
        <div class="sb-section">
          <p class="sb-label">📊 Contexte utilisé</p>
          <div id="context-meter">
            <div class="sb-progress-track">
              <div id="context-bar" class="sb-progress-fill" style="width:0%"></div>
            </div>
            <div id="context-label" class="sb-progress-label">0%</div>
          </div>
        </div>

        <!-- Apparence -->
        <div class="sb-section">
          <p class="sb-label">🎨 Apparence</p>
          <select id="theme-select" class="sb-select">
            <option value="cyber">◈ CYBER</option>
            <option value="midnight">◈ MIDNIGHT</option>
            <option value="light">◈ LIGHT</option>
          </select>
          <button id="lang-switch-btn" class="sb-btn w-full mt-2">
            🌐 &nbsp;عربي / Français
          </button>
        </div>

        <!-- Gestion -->
        <div class="sb-section">
          <p class="sb-label">⚙️ Gestion</p>
          <div class="flex flex-col gap-2">
            <button id="open-api-modal" class="sb-btn sb-btn-neon">
              <span class="material-symbols-outlined" style="font-size:14px">key</span>
              Clé API
            </button>
            <button id="open-agent-modal" class="sb-btn">
              <span class="material-symbols-outlined" style="font-size:14px">smart_toy</span>
              Gérer les agents
            </button>
            <button id="open-workflow-modal" class="sb-btn">
              <span class="material-symbols-outlined" style="font-size:14px">account_tree</span>
              Gérer les workflows
            </button>
            <button id="open-data-modal" class="sb-btn">
              <span class="material-symbols-outlined" style="font-size:14px">database</span>
              Données &amp; Export
            </button>
          </div>
        </div>

        <!-- Mode Évaluation -->
        <div class="sb-section">
          <p class="sb-label">⏱️ Mode Évaluation</p>
          <div class="flex items-center justify-between gap-2 mt-2">
            <span class="text-xs text-on-surface">Temps/Question (s)</span>
            <input type="number" id="quiz-eval-timer-input" class="sb-select" style="width: 80px;" value="30" min="5" max="300" />
          </div>
        </div>

      </div><!-- /sidebar-body -->
    </aside>
  </Transition>

  <!-- Hidden legacy stubs (mobile-menu compatibility) -->
  <div id="mobile-menu" style="display:none;">
    <span id="api-status-mob"></span>
    <select id="theme-select-mob"></select>
    <button id="lang-switch-btn-mob"></button>
    <select id="model-select-mob"></select>
    <select id="agent-select-mob"></select>
    <button id="open-api-modal-mob"></button>
    <button id="open-agent-modal-mob"></button>
    <button id="open-workflow-modal-mob"></button>
    <button id="open-data-modal-mob"></button>
    <button id="clear-chat-mob"></button>
    <button id="new-chat-mob"></button>
    <button id="burger-btn"></button>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { t } from '../i18n.js';

const showSidebar = ref(false);
</script>
