import { state } from './state.js';

export const translations = {
  fr: {
    // Boutons
    btn_copy: "⎘ COPIER",
    btn_edit: "✎ ÉDITER",
    btn_regen: "↺ RÉGÉNÉRER",
    btn_word: "📄 WORD",
    btn_convert: "📋 CONVERTIR",
    btn_test_qcm: "▶ TESTER LE QCM",
    btn_cancel: "Annuler",
    btn_save: "Enregistrer",
    btn_close: "FERMER",
    btn_send: "Envoyer",
    btn_verify: "VÉRIFIER",
    btn_download: "Télécharger",
    btn_upload: "Joindre",
    btn_settings: "Paramètres",
    btn_stop: "Arrêter",
    btn_clear: "⌫ EFFACER",
    btn_export: "Exporter",
    btn_new: "+ NOUVEAU",
    btn_archives: "⬡ ARCHIVES",
    btn_autogen: "✦ AUTO-GEN",
    btn_agent: "⚙ AGENT",
    btn_workflows: "🔗 CHAÎNES",
    btn_data: "⬡ DATA",
    btn_delete: "🗑 SUPPRIMER",
    btn_import: "⬆ IMPORTER",
    btn_close_x: "✕",
    
    // Modals
    mdl_feedback_title: "🧠 PROTOCOLE D'APPRENTISSAGE",
    mdl_feedback_btn: "🧠 MÉMORISER LA LEÇON",
    mdl_api_title: "⬡ ACTIVATION API MISTRAL",
    mdl_api_save: "💾 ENREGISTRER ET ACTIVER",
    mdl_agent_title: "⚙ CRÉER UN AGENT IA",
    mdl_wf_title: "🔗 GESTION DES CHAÎNES DE WORKFLOWS",
    mdl_data_title: "⬡ DATA & MÉMOIRE GLOBALE",
    
    // UI Elements
    ui_quality: "QUALITÉ",
    ui_attached_doc: "📄 Document joint : ",
    ui_question: "Question",
    ui_welcome: "Interface avancée avec mémoire globale, agents spécialisés et accès aux modèles Mistral AI.",
    ui_config_api: "Configurez votre clé API pour commencer.",
    ui_api_key: "⬡ CLÉ API",
    ui_theme: "THÈME",
    ui_model: "MODÈLE",
    ui_lang: "🌐 ARAB",
    ui_online: "ONLINE",
    ui_offline: "OFFLINE",
    ui_placeholder_chat: "Transmettez votre message... (Entrée pour envoyer, Maj+Entrée pour nouvelle ligne)",
    ui_no_agent: "▸ NO AGENT",
    ui_search_archives: "Rechercher une conversation...",
    ui_no_archives: "Aucune conversation sauvegardée",
    ui_memory: "⬡ MÉMOIRE GLOBALE",
    ui_add_memory: "Ajouter à la mémoire...",
    
    // Toasts / Messages
    msg_error: "Erreur",
    msg_success: "Succès",
    msg_api_required: "Veuillez configurer votre clé API Mistral.",
    msg_api_saved: "Clé API sauvegardée !",
    msg_copied: "Copié dans le presse-papier !",
    msg_export_qp_success: "Fichier Quiz Player exporté !",
    msg_export_word_success: "Document Word généré avec succès !",
    msg_no_question: "Aucune question valide détectée pour le test.",
    msg_generation_error: "Erreur de génération",
    msg_generation_aborted: "Génération interrompue.",
    
    // Quiz Player
    qp_title: "Titre de la leçon",
    qp_subject: "Matière",
    qp_author: "Auteur",
    qp_class: "Classe",
    qp_desc: "Description courte",
    qp_level: "Niveau",
    qp_module: "Module",
    qp_export_btn: "💾 TÉLÉCHARGER LE JSON",
    qp_modal_title: "EXPORT QUIZ PLAYER",
  },
  ar: {
    // Boutons
    btn_copy: "⎘ نسخ",
    btn_edit: "✎ تعديل",
    btn_regen: "↺ إعادة التوليد",
    btn_word: "📄 وورد",
    btn_convert: "📋 تحويل",
    btn_test_qcm: "▶ اختبار الأسئلة",
    btn_cancel: "إلغاء",
    btn_save: "حفظ",
    btn_close: "إغلاق",
    btn_send: "إرسال",
    btn_verify: "تحقق",
    btn_download: "تحميل",
    btn_upload: "إرفاق",
    btn_settings: "إعدادات",
    btn_stop: "إيقاف",
    btn_clear: "⌫ مسح",
    btn_export: "تصدير",
    btn_new: "+ جديد",
    btn_archives: "⬡ الأرشيف",
    btn_autogen: "✦ توليد تلقائي",
    btn_agent: "⚙ وكيل",
    btn_workflows: "🔗 سلاسل العمل",
    btn_data: "⬡ البيانات",
    btn_delete: "🗑 حذف",
    btn_import: "⬆ استيراد",
    btn_close_x: "✕",
    
    // Modals
    mdl_feedback_title: "🧠 بروتوكول التعلم",
    mdl_feedback_btn: "🧠 حفظ الدرس",
    mdl_api_title: "⬡ تفعيل مفتاح MISTRAL API",
    mdl_api_save: "💾 حفظ وتفعيل",
    mdl_agent_title: "⚙ إنشاء وكيل ذكاء اصطناعي",
    mdl_wf_title: "🔗 إدارة سلاسل العمل",
    mdl_data_title: "⬡ البيانات والذاكرة الشاملة",
    
    // UI Elements
    ui_quality: "الجودة",
    ui_attached_doc: "📄 مستند مرفق : ",
    ui_question: "سؤال",
    ui_welcome: "واجهة متقدمة مع ذاكرة شاملɡ ووكلاء متخصصين، ووصول إلى نماذج Mistral AI.",
    ui_config_api: "قم بإعداد مفتاح API الخاص بك للبدء.",
    ui_api_key: "⬡ مفتاح API",
    ui_theme: "المظهر",
    ui_model: "النموذج",
    ui_lang: "🌐 FR",
    ui_online: "متصل",
    ui_offline: "غير متصل",
    ui_placeholder_chat: "اكتب رسالتك... (اضغط Enter للإرسال، Shift+Enter لسطر جديد)",
    ui_no_agent: "▸ بدون وكيل",
    ui_search_archives: "البحث في المحادثات...",
    ui_no_archives: "لا توجد محادثات محفوظة",
    ui_memory: "⬡ الذاكرة الشاملة",
    ui_add_memory: "إضافة إلى الذاكرة...",
    
    // Toasts / Messages
    msg_error: "خطأ",
    msg_success: "نجاح",
    msg_api_required: "يرجى إعداد مفتاح API لـ Mistral.",
    msg_api_saved: "تم حفظ مفتاح API!",
    msg_copied: "تم النسخ إلى الحافظة!",
    msg_export_qp_success: "تم تصدير ملف Quiz Player!",
    msg_export_word_success: "تم إنشاء مستند Word بنجاح!",
    msg_no_question: "لم يتم اكتشاف أي سؤال صالح للاختبار.",
    msg_generation_error: "خطأ في التوليد",
    msg_generation_aborted: "تم إيقاف التوليد.",
    
    // Quiz Player
    qp_title: "عنوان الدرس",
    qp_subject: "المادة",
    qp_author: "المؤلف",
    qp_class: "القسم",
    qp_desc: "وصف قصير",
    qp_level: "المستوى",
    qp_module: "الوحدة",
    qp_export_btn: "💾 تحميل ملف JSON",
    qp_modal_title: "تصدير لـ Quiz Player",
  }
};

export function t(key) {
  const lang = state.lang || 'fr';
  if (translations[lang] && translations[lang][key]) {
    return translations[lang][key];
  }
  // Fallback to fr
  if (translations['fr'] && translations['fr'][key]) {
    return translations['fr'][key];
  }
  return key; // return the key itself if not found
}
