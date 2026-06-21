import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import obfuscatorPlugin from 'rollup-plugin-obfuscator'

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [
    vue(),
    // Obfuscation activée uniquement en production
    mode === 'production' && obfuscatorPlugin({
      options: {
        // ── Encodage des chaînes de caractères ──
        stringArray: true,
        stringArrayEncoding: ['base64'],
        stringArrayThreshold: 0.85,
        stringArrayWrappersCount: 3,
        stringArrayWrappersType: 'variable',
        stringArrayIndexShift: true,
        stringArrayRotate: true,
        stringArrayShuffle: true,

        // ── Aplatissement du flux de contrôle (rend la logique illisible) ──
        controlFlowFlattening: true,
        controlFlowFlatteningThreshold: 0.7,

        // ── Injection de code mort (leurres) ──
        deadCodeInjection: true,
        deadCodeInjectionThreshold: 0.3,

        // ── Renommage des identifiants ──
        identifierNamesGenerator: 'hexadecimal',
        renameGlobals: false,

        // ── Auto-défense: le code se casse si on le reformatte ──
        selfDefending: true,

        // ── Empêche le débogueur de s'attacher ──
        debugProtection: true,
        debugProtectionInterval: 4000,

        // ── Désactive la console ──
        disableConsoleOutput: false, // garder false pour ne pas bloquer les logs légitimes

        // ── Source maps désactivées en prod ──
        sourceMap: false,

        // ── Cible navigateur ──
        target: 'browser',
      }
    }),
  ].filter(Boolean),
}))
