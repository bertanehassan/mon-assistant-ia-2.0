<template>
  <!-- ═══════════════════ MODAL : EDIT AGENT ═══════════════════ -->
  <div class="modal-overlay" id="edit-agent-modal">
    <div class="modal-box">
      <div class="corner-deco corner-tl"></div>
      <div class="corner-deco corner-tr"></div>
      <div class="corner-deco corner-bl"></div>
      <div class="corner-deco corner-br"></div>
      <div class="modal-header">
        <div class="modal-title">⚙ MODIFIER L'AGENT</div>
        <button class="modal-close" id="close-edit-agent-modal">{{ t('btn_close_x') }}</button>
      </div>
      <div class="modal-body">
        <input type="hidden" id="edit-agent-id">
        <div class="field-group">
          <label class="field-label">Nom de l'Agent <span style="color:var(--danger)">*</span></label>
          <input type="text" class="field-input" id="edit-agent-name">
        </div>
        <div class="field-group">
          <label class="field-label">Rôle & Description <span style="color:var(--danger)">*</span></label>
          <textarea class="field-textarea" id="edit-agent-desc" rows="2"></textarea>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div class="field-group">
            <label class="field-label">Tags Mémoire</label>
            <input type="text" class="field-input" id="edit-agent-tags" placeholder="code, recherche, santé">
          </div>
          <div class="field-group">
            <label class="field-label">Modèle préféré</label>
            <select class="field-input field-select" id="edit-agent-model-pref">
              <option value="">Auto</option>
            </select>
          </div>
        </div>
        <div class="field-group">
          <label class="field-label">Instructions Comportementales</label>
          <textarea class="field-textarea" id="edit-agent-instructions" rows="4"></textarea>
        </div>
        <div class="field-group">
          <label class="field-label">Phrase d'Amorce</label>
          <textarea class="field-textarea" id="edit-agent-primer" rows="2"></textarea>
        </div>
        <!-- ADVANCED PARAMS -->
        <div class="agent-advanced-section">
          <div class="agent-advanced-toggle" id="edit-adv-toggle">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
              <path d="M6 9L1 3h10z" />
            </svg>
            PARAMÈTRES AVANCÉS
          </div>
          <div class="agent-advanced-body" id="edit-adv-body">
            <div class="field-group" style="margin-bottom:12px">
              <label class="field-label">Température (créativité)</label>
              <div class="range-group">
                <input type="range" id="edit-agent-temp" min="0" max="2" step="0.05" value="0.7">
                <span class="range-value" id="edit-agent-temp-val">0.7</span>
              </div>
              <div class="field-hint">0 = déterministe &nbsp;•&nbsp; 1 = équilibré &nbsp;•&nbsp; 2 = très créatif</div>
            </div>
            <div class="field-group" style="margin-bottom:12px">
              <label class="field-label">Max Tokens réponse</label>
              <div class="range-group">
                <input type="range" id="edit-agent-maxtok" min="256" max="16000" step="256" value="4096">
                <span class="range-value" id="edit-agent-maxtok-val">4096</span>
              </div>
            </div>
            <div class="field-group" style="margin-bottom:12px">
              <label class="field-label">Style de réponse</label>
              <select class="field-input field-select" id="edit-agent-style">
                <option value="">Auto (défaut)</option>
                <option value="concis">Concis & Direct</option>
                <option value="detaille">Détaillé & Exhaustif</option>
                <option value="formel">Formel & Professionnel</option>
                <option value="creatif">Créatif & Innovant</option>
                <option value="pedagogique">Pédagogique & Clair</option>
              </select>
            </div>
            <div class="field-group" style="margin-bottom:0">
              <label class="field-label">Instructions Interdites</label>
              <textarea class="field-textarea" id="edit-agent-forbidden" rows="2"
                placeholder="Ex : Ne jamais utiliser le langage Markdown."></textarea>
            </div>
            <div class="field-group" style="margin-bottom:0; margin-top:12px">
              <label class="field-label">Priorité Mémoire</label>
              <div class="range-group">
                <input type="range" id="edit-agent-mem-prio" min="1" max="5" step="1" value="3">
                <span class="range-value" id="edit-agent-mem-prio-val">3</span>
              </div>
              <div class="field-hint">1 = ignore mémoire &nbsp;•&nbsp; 5 = mémoire maximale</div>
            </div>
          </div>
        </div>
        <div class="btn-row">
          <button class="btn-ghost" id="close-edit-agent-modal-2">Annuler</button>
          <button class="btn-ghost" id="duplicate-agent-btn"
            style="color:var(--neon);border-color:rgba(0,255,157,0.3)">⧉ Dupliquer</button>
          <button class="btn-primary" id="save-edit-agent">💾 ENREGISTRER</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { t } from '../../i18n.js';
</script>
