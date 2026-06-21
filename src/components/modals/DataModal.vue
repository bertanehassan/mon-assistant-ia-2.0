<template>
  <!-- â•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گ MODAL : DATA â•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گ -->
  <div class="modal-overlay" id="data-modal">
    <div class="modal-box">
      <div class="corner-deco corner-tl"></div>
      <div class="corner-deco corner-tr"></div>
      <div class="corner-deco corner-bl"></div>
      <div class="corner-deco corner-br"></div>
      <div class="modal-header">
        <div class="modal-title">{{ t('mdl_data_title') }}</div>
        <button class="modal-close" id="close-data-modal">{{ t('btn_close_x') }}</button>
      </div>
      <div class="modal-body">

        <div class="info-block">
          <strong>▸ Stockage 100% Local</strong><br>
          Toutes vos données (conversations, agents, mémoires) sont stockées dans la base IndexedDB de votre navigateur.
          Exportez-les pour les sauvegarder ou les transférer sur un autre appareil.
        </div>

        <!-- STATS -->
        <div class="data-grid" id="data-stats">
          <div class="data-card">
            <div class="data-card-value" id="stat-chats">—</div>
            <div class="data-card-label">Conversations</div>
          </div>
          <div class="data-card">
            <div class="data-card-value" id="stat-agents">—</div>
            <div class="data-card-label">Agents</div>
          </div>
          <div class="data-card">
            <div class="data-card-value" id="stat-memories">—</div>
            <div class="data-card-label">Mémoires</div>
          </div>
          <div class="data-card">
            <div class="data-card-value" id="stat-size">—</div>
            <div class="data-card-label">Taille estimée</div>
          </div>
        </div>

        <!-- EXPORT -->
        <div class="section-title">EXPORTER VOS DONNÉES</div>
        <p style="font-size:12px;color:var(--text-dim);margin-bottom:12px;line-height:1.6">Téléchargez toutes vos
          données dans un fichier <code
            style="font-family:var(--font-mono);font-size:10px;color:var(--cyan)">.Mon Assistant IA.json</code> que vous
          pourrez réimporter à tout moment.</p>
        <button class="btn-primary" id="btn-export"
          style="width:100%;justify-content:center;display:flex;gap:8px;align-items:center">
          ⬇ TÉLÉCHARGER TOUTES LES DONNÉES
        </button>

        <!-- IMPORT -->
        <div class="section-title">IMPORTER DES DONNÉES</div>
        <p style="font-size:12px;color:var(--text-dim);margin-bottom:12px;line-height:1.6">Restaurez une sauvegarde
          précédente. <strong style="color:var(--warning)">Attention :</strong> les données existantes seront fusionnées
          (non remplacées).</p>

        <!-- Zone sélection fichier -->
        <div class="export-zone" id="import-drop-zone">
          <div class="export-zone-icon">⬆</div>
          <div class="export-zone-text">
            <strong id="import-zone-label">Glissez votre fichier .Mon Assistant IA.json ici</strong>
            ou cliquez pour sélectionner
          </div>
        </div>
        <input type="file" id="import-file-input" accept=".json,.Mon Assistant IA.json" style="display:none">

        <!-- Aperçu fichier sélectionné (caché par défaut) -->
        <div id="import-preview"
          style="display:none;background:var(--hull);border:var(--hud-border);border-radius:var(--r);padding:14px 16px;margin-top:10px">
          <div
            style="font-family:var(--font-mono);font-size:10px;letter-spacing:2px;color:var(--cyan);margin-bottom:8px">
            FICHIER SÉLECTIONNÉ</div>
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
            <span style="font-size:22px">📄</span>
            <div>
              <div id="import-filename" style="font-family:var(--font-mono);font-size:12px;color:var(--text-bright)">—
              </div>
              <div id="import-fileinfo"
                style="font-family:var(--font-mono);font-size:10px;color:var(--text-dim);margin-top:2px">—</div>
            </div>
          </div>
          <div id="import-summary"
            style="font-size:12px;color:var(--text);line-height:1.7;background:var(--void);border-radius:var(--r);padding:10px 12px;margin-bottom:12px;border:1px solid var(--grid)">
            Analyse en cours…
          </div>
          <div style="display:flex;gap:8px">
            <button class="btn-ghost" id="btn-import-cancel" style="flex:1">✕ Annuler</button>
            <button class="btn-primary" id="btn-import-confirm"
              style="flex:2;justify-content:center;display:flex;gap:6px;align-items:center">
              ✓ VALIDER ET RESTAURER
            </button>
          </div>
        </div>

        <!-- DANGER ZONE -->
        <div class="section-title" style="border-top-color:rgba(255,51,102,0.3);color:rgba(255,51,102,0.6)">ZONE
          CRITIQUE</div>
        <button class="btn-ghost" id="btn-clear-all"
          style="width:100%;justify-content:center;display:flex;border-color:rgba(255,51,102,0.3);color:var(--danger)">
          ⚠ SUPPRIMER TOUTES LES DONNÉES LOCALES
        </button>

        <div class="btn-row" style="border-top:none;margin-top:12px;padding-top:0">
          <button class="btn-ghost" id="close-data-modal-2">Fermer</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { t } from '../../i18n.js';
</script>
