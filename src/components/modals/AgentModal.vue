<template>
  <!-- â•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گ MODAL : AGENT â•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گ -->
  <div class="modal-overlay" id="agent-modal">
    <div class="modal-box">
      <div class="corner-deco corner-tl"></div>
      <div class="corner-deco corner-tr"></div>
      <div class="corner-deco corner-bl"></div>
      <div class="corner-deco corner-br"></div>
      <div class="modal-header">
        <div class="modal-title">{{ t('mdl_agent_title') }}</div>
        <button class="modal-close" id="close-agent-modal">{{ t('btn_close_x') }}</button>
      </div>
      <div class="modal-body">

        <!-- EXPLICATION DU CERVEAU CENTRAL -->
        <div class="info-block" style="border-left-color:var(--neon)">
          <strong style="color:var(--neon)">▸ Qu'est-ce qu'un Agent Mon Assistant IA ?</strong><br>
          Un Agent est un <em>cerveau central</em> qui dirige chaque conversation. Il définit la
          <strong>personnalité</strong>, le <strong>domaine d'expertise</strong>, le <strong>ton</strong> et les
          <strong>règles comportementales</strong> du modèle IA. Une fois activé, chaque réponse est façonnée par ses
          instructions. Vous pouvez créer plusieurs agents spécialisés (dev, rédaction, analyse, recherche…) et switcher
          selon la tأ¢che.
        </div>

        <!-- ONGLETS AGENTS EXISTANTS -->
        <div id="agent-existing-list"></div>

        <div style="display:flex;align-items:center;gap:8px;margin:8px 0 4px">
          <button class="btn-ghost" id="import-agent-btn" style="font-size:10px;padding:5px 10px">{{ t('btn_import') }}</button>
          <input type="file" id="import-agent-input" accept=".json" style="display:none">
          <button class="btn-ghost" id="generate-more-agents-btn"
            style="font-size:10px;padding:5px 10px;color:var(--neon);border-color:rgba(0,255,157,0.3)">✦ GÉNÉRER +
            D'AGENTS</button>
        </div>
        <div class="section-title">CONFIGURATION DU NOUVEL AGENT</div>

        <div class="field-group">
          <label class="field-label">Nom de l'Agent <span style="color:var(--danger)">*</span></label>
          <input type="text" class="field-input" id="agent-name"
            placeholder="ex. CodeArchitect, ResearchBot, BioinfoGPT…">
        </div>

        <div class="field-group">
          <label class="field-label">Rôle & Domaine d'Expertise <span style="color:var(--danger)">*</span></label>
          <textarea class="field-textarea" id="agent-desc" rows="2"
            placeholder="Ex : Tu es un expert en bioinformatique spécialisé en génomique. Tu analyses les données scientifiques avec précision et cites tes sources."></textarea>
          <div class="field-hint">▸ Décrivez la spécialité, le ton souhaité et les capacités principales de cet agent.
          </div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div class="field-group">
            <label class="field-label">Tags Mémoire</label>
            <input type="text" class="field-input" id="agent-tags" placeholder="code, recherche, médecine">
            <div class="field-hint">Séparés par des virgules</div>
          </div>
          <div class="field-group">
            <label class="field-label">Modèle préféré</label>
            <select class="field-input field-select" id="agent-model-pref">
              <option value="">Auto (par défaut)</option>
            </select>
          </div>
        </div>

        <div class="field-group">
          <label class="field-label">Instructions Comportementales Avancées</label>
          <textarea class="field-textarea" id="agent-instructions" rows="4"
            placeholder="Ex :&#10;- Réponds toujours en français sauf si l'utilisateur écrit en anglais&#10;- Structure tes réponses avec des sections claires&#10;- Cite systématiquement les sources et les APIs utilisées&#10;- Si la question dépasse ton domaine, dis-le clairement"></textarea>
          <div class="field-hint">▸ Ces règles sont injectées dans chaque prompt système. Soyez précis pour un
            comportement optimal du cerveau central.</div>
        </div>

        <div class="field-group">
          <label class="field-label">Phrase d'Amorce (Contexte Initial)</label>
          <textarea class="field-textarea" id="agent-primer" rows="2"
            placeholder="Ex : 'Je commence chaque analyse par une revue des publications récentes sur PubMed…'"></textarea>
          <div class="field-hint">▸ Contexte de départ injecté au début de la conversation.</div>
        </div>

        <!-- ADVANCED PARAMS CREATE -->
        <div class="agent-advanced-section" style="margin-top:8px">
          <div class="agent-advanced-toggle" id="create-adv-toggle">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
              <path d="M6 9L1 3h10z" />
            </svg>
            PARAMأˆTRES AVANCÉS (optionnel)
          </div>
          <div class="agent-advanced-body" id="create-adv-body">
            <div class="field-group" style="margin-bottom:12px">
              <label class="field-label">Température</label>
              <div class="range-group">
                <input type="range" id="create-agent-temp" min="0" max="2" step="0.05" value="0.7">
                <span class="range-value" id="create-agent-temp-val">0.7</span>
              </div>
            </div>
            <div class="field-group" style="margin-bottom:12px">
              <label class="field-label">Style de réponse</label>
              <select class="field-input field-select" id="create-agent-style">
                <option value="">Auto</option>
                <option value="concis">Concis & Direct</option>
                <option value="detaille">Détaillé & Exhaustif</option>
                <option value="formel">Formel & Professionnel</option>
                <option value="creatif">Créatif & Innovant</option>
                <option value="pedagogique">Pédagogique & Clair</option>
              </select>
            </div>
            <div class="field-group" style="margin-bottom:0">
              <label class="field-label">Instructions Interdites</label>
              <textarea class="field-textarea" id="create-agent-forbidden" rows="2"
                placeholder="Ex : Ne jamais donner de conseils médicaux directs."></textarea>
            </div>
          </div>
        </div>
        <div class="btn-row">
          <button class="btn-ghost" id="close-agent-modal-2">Annuler</button>
          <button class="btn-primary" id="save-agent">⚙ CRÉER L'AGENT</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { t } from '../../i18n.js';
</script>
