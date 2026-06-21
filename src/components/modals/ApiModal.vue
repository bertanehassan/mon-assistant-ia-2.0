<template>
  <!-- ═══════════════════ MODAL : API KEY ═══════════════════ -->
  <div class="modal-overlay" id="api-modal">
    <div class="modal-box">
      <div class="corner-deco corner-tl"></div>
      <div class="corner-deco corner-tr"></div>
      <div class="corner-deco corner-bl"></div>
      <div class="corner-deco corner-br"></div>
      <div class="modal-header">
        <div class="modal-title">{{ t('mdl_api_title') }}</div>
        <button class="modal-close" id="close-api-modal">{{ t('btn_close_x') }}</button>
      </div>
      <div class="modal-body">

        <!-- FORMULAIRE -->
        <div class="field-group">
          <label class="field-label">🔑 Clé API Mistral</label>
          <input type="password" class="field-input" id="api-key-input" placeholder="Collez votre clé ici…">
          <div class="field-hint">Format : min. 20 caractères — ex. <code
              style="font-family:var(--font-mono);color:var(--text-code);font-size:11px">sk-xxxxxxxxxxxxxxxxxxxxxxxx</code>
          </div>
        </div>
        <div class="btn-row" style="margin-top:0;padding-top:0;border-top:none;margin-bottom:20px">
          <button class="btn-ghost" id="close-api-modal-2">{{ t('btn_cancel') }}</button>
          <button class="btn-ghost danger" id="delete-api-key"
            style="border-color:rgba(255,51,102,0.3);color:var(--danger)">{{ t('btn_delete') }}</button>
          <button class="btn-primary" id="save-api-key">{{ t('mdl_api_save') }}</button>
        </div>

        <!-- SÉPARATEUR -->
        <div class="section-title">GUIDE D'ACTIVATION — ACCÈS GRATUIT</div>

        <!-- INFO TUTORIEL -->
        <div class="info-block" style="margin-top:12px">
          <strong>✦ Free Tier Mistral AI — Chiffres Officiels 2025</strong><br>
          Le Free Tier de Mistral AI donne accès aux modèles via l'API sans abonnement payant. Les limites exactes
          dépendent du modèle utilisé, mais typiquement :
          <ul style="padding-left:16px;margin-top:8px;line-height:2">
            <li>Modèles légers (Ministral, Mistral Small) : <strong>~1 req/sec</strong>, plusieurs dizaines de milliers
              de tokens/min</li>
            <li>Modèles large (Mistral Large, Codestral) : <strong>~500 req/heure</strong>, limites adaptées</li>
            <li>Aucun frais de carte bancaire pour commencer</li>
          </ul>
          <div style="margin-top:8px;font-size:12px;color:var(--text-dim)">▸ Consultez <code>console.mistral.ai</code> →
            votre tableau de bord pour voir vos quotas en temps réel.</div>
        </div>

        <!-- ÉTAPES -->
        <div
          style="font-family:var(--font-mono);font-size:10px;letter-spacing:2px;color:var(--cyan);margin:14px 0 10px;opacity:0.7">
          PROCÉDURE EN 4 ÉTAPES</div>
        <ol class="step-list">
          <li>Ouvrez <strong><code>console.mistral.ai</code></strong> dans votre navigateur</li>
          <li>Cliquez sur <strong>"Sign Up"</strong> → créez votre compte (email + mot de passe, ou OAuth Google)</li>
          <li>Dans le menu latéral, allez dans <strong>"API Keys"</strong> → cliquez <strong>"Create new key"</strong> →
            nommez-la (ex. <em>hassan-bertane-key</em>)</li>
          <li>Copiez la clé générée (visible <strong>une seule fois</strong>) → collez-la dans le champ ci-dessus</li>
        </ol>

        <div class="success-block">
          <strong>🔒 Persistance garantie 365 jours</strong><br>
          Votre clé API est stockée dans un cookie sécurisé <strong>ET</strong> dans le stockage local de votre
          navigateur. Elle est automatiquement restaurée à chaque visite et n'est jamais transmise à aucun serveur tiers
          — uniquement envoyée directement à <code style="font-size:11px;color:var(--neon)">api.mistral.ai</code>.
        </div>

        <div style="margin-top:12px;font-size:12px;color:var(--text-dim);text-align:center">
          Documentation officielle : <a href="https://docs.mistral.ai" target="_blank"
            style="color:var(--cyan)">docs.mistral.ai</a>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { t } from '../../i18n.js';
</script>
