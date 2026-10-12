import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// base './' : chemins relatifs, le jeu fonctionne dans un sous-dossier GitHub Pages
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      input: {
        main: 'index.html',
        settings: 'settings.html',
      },
    },
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['icons/*.png'],
      manifest: {
        name: 'Ma Petite Planète',
        short_name: 'Petite Planète',
        description: 'Roule sur une petite planète et évite les météores !',
        lang: 'fr',
        start_url: './',
        scope: './',
        display: 'fullscreen',
        display_override: ['fullscreen', 'standalone'],
        orientation: 'any',
        background_color: '#04050c',
        theme_color: '#04050c',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Tout le jeu est précaché : jouable hors ligne après la première visite
        globPatterns: ['**/*.{js,css,html,json,glb,png,jpg,ttf,woff2,mp3,wav,webmanifest}'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        navigateFallback: null,
      },
    }),
  ],
});
