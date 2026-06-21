<template>
  <!-- ═══════════════════ CHAT ═══════════════════ -->
  <main id="chat-container" class="flex-1 overflow-y-auto px-4 py-6 flex flex-col gap-6 hide-scrollbar min-h-0"></main>

  <!-- ═══════════════════ INPUT AREA ═══════════════════ -->
  <footer id="input-area" class="z-40 pt-2 pb-safe flex flex-col gap-2 shrink-0">
    <div class="max-w-4xl mx-auto w-full px-4 flex flex-col gap-3">
      
      <!-- ─── INPUT BOX ─── -->
      <div class="flex items-end gap-3 pb-4">
        <div class="flex-1 input-glass rounded-2xl flex items-center px-4 py-3 min-h-[56px]">
          <button id="file-upload-btn" class="p-2 -ml-2 text-on-surface-variant hover:text-cyan transition-colors" title="Joindre un fichier">
            <span class="material-symbols-outlined">attach_file</span>
          </button>
          <input type="file" id="file-input" accept="image/*,audio/*,.pdf" multiple style="display:none">
          
          <textarea id="user-input" class="bg-transparent border-none focus:ring-0 text-on-surface placeholder:text-on-surface-variant/50 w-full font-body-md resize-none py-2 px-2 focus:outline-none" 
                    @input="$event.target.style.height = ''; $event.target.style.height = $event.target.scrollHeight + 'px'" 
                    :placeholder="t('ui_placeholder_chat')" rows="1"></textarea>
                    
          <button id="voice-btn" class="p-2 -mr-2 text-on-surface-variant hover:text-cyan transition-colors" title="Dictée vocale">
            <span class="material-symbols-outlined">mic</span>
          </button>
        </div>

        <button id="send-btn" class="w-14 h-14 rounded-2xl primary-gradient flex items-center justify-center shadow-lg shadow-cyan/20 hover:brightness-110 active:scale-95 transition-all group shrink-0">
          <span class="material-symbols-outlined text-white font-bold group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" style="font-size: 24px">send</span>
        </button>
      </div>
      
      <div id="token-counter" class="text-center text-xs text-on-surface-variant mb-2"></div>
    </div>
  </footer>

  <!-- ═══════════════════ FLOATING ACTIONS ═══════════════════ -->
  <div class="fixed top-24 right-4 flex flex-col gap-2 z-40">
    <button id="archives-btn" class="w-10 h-10 rounded-full glass-panel flex items-center justify-center hover:bg-white/10 transition-colors shadow-lg" title="Archives des conversations">
      <span class="material-symbols-outlined text-cyan" style="font-size:20px">history</span>
    </button>
    <button id="memory-toggle" class="w-10 h-10 rounded-full glass-panel flex items-center justify-center hover:bg-white/10 transition-colors shadow-lg" title="Mémoire Globale">
      <span class="material-symbols-outlined text-violet" style="font-size:20px">memory</span>
    </button>
  </div>

  <button id="scroll-bottom" class="fixed bottom-32 right-4 w-10 h-10 rounded-full bg-cyan/20 flex items-center justify-center z-30 transition-colors backdrop-blur-md border border-cyan/30" title="Descendre" style="display:none;">
    <span class="material-symbols-outlined text-cyan">arrow_downward</span>
  </button>

  <!-- ═══════════════════ PANELS ═══════════════════ -->
  <div id="archives-panel" class="absolute top-24 right-16 w-80 glass-panel p-4 rounded-xl z-50 flex flex-col gap-3 shadow-2xl border border-white/10" style="display:none;">
    <div class="flex justify-between items-center">
      <h3 class="font-bold text-on-surface">{{ t('btn_archives') }}</h3>
      <button id="archives-new-btn" class="text-xs bg-white/10 px-2 py-1 rounded hover:bg-cyan/20 hover:text-cyan transition-colors">{{ t('btn_new') }}</button>
    </div>
    <input type="text" id="archives-search-input" class="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-sm text-on-surface focus:outline-none focus:border-cyan transition-colors" :placeholder="t('ui_search_archives')">
    <div id="archives-list" class="max-h-60 overflow-y-auto text-sm text-on-surface-variant flex flex-col gap-2 pr-1 custom-scrollbar">
      <div class="archive-empty text-center italic opacity-50 py-4">{{ t('ui_no_archives') }}</div>
    </div>
  </div>

  <div id="memory-panel" class="absolute top-36 right-16 w-80 glass-panel p-4 rounded-xl z-50 flex flex-col gap-3 shadow-2xl border border-white/10" style="display:none;">
    <div class="flex justify-between items-center">
      <h3 class="font-bold text-on-surface">{{ t('ui_memory') }}</h3>
      <button id="memory-clear" class="text-xs bg-white/10 px-2 py-1 rounded hover:bg-error/20 hover:text-error transition-colors">{{ t('btn_clear') }}</button>
    </div>
    <div id="memory-list" class="max-h-60 overflow-y-auto text-sm text-on-surface-variant flex flex-col gap-2 pr-1 custom-scrollbar"></div>
    <div class="flex gap-2 pt-2 border-t border-white/5">
      <input type="text" id="memory-input" class="flex-1 bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-sm text-on-surface focus:outline-none focus:border-violet transition-colors" :placeholder="t('ui_add_memory')">
      <button id="memory-add" class="bg-violet/20 text-violet w-9 rounded-lg flex items-center justify-center hover:bg-violet/40 transition-colors">
        <span class="material-symbols-outlined" style="font-size:20px">add</span>
      </button>
    </div>
  </div>
</template>

<script setup>
import { t } from '../i18n.js';
</script>

<style scoped>
.custom-scrollbar::-webkit-scrollbar { width: 4px; }
.custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
.custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 4px; }
</style>
