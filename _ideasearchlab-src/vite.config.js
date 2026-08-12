import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { copyFileSync, existsSync } from 'node:fs'

// Makes the build fully self-contained for GitHub Pages SPA hosting, so no
// post-build shell step (the old CI `sed`) is needed:
//  1. Injects the redirect-restore script at the very top of <head> so deep
//     links bounced through 404.html land on the right client-side route.
//  2. Copies the built index.html to 404.html so unknown paths fall back to
//     the app (GitHub Pages serves 404.html for missing files).
function spaFallback() {
  return {
    name: 'spa-fallback',
    transformIndexHtml() {
      return [{
        tag: 'script',
        injectTo: 'head-prepend',
        children:
          '(function(){try{var p=new URLSearchParams(window.location.search).get("redirect");if(!p)return;var d=decodeURIComponent(p);if(d.charAt(0)!=="/"||d.charAt(1)==="/"||d.indexOf("/lab/ideasearchlab")!==0)return;window.history.replaceState(null,null,d);}catch(e){}}());',
      }]
    },
    closeBundle() {
      const index = 'dist/index.html'
      if (existsSync(index)) copyFileSync(index, 'dist/404.html')
    },
  }
}

export default defineConfig({
  plugins: [react(), spaFallback()],
  base: '/lab/ideasearchlab/',
  build: {
    outDir: 'dist',
    // Vite's default 'modules' target claims safari14, but the emitted CSS uses
    // flexbox `gap` throughout, which Safari only gained in 14.1 — so the build
    // was declaring compatibility it did not have. State the real floor.
    target: ['es2020', 'edge88', 'firefox78', 'chrome87', 'safari14.1'],
    cssTarget: ['edge88', 'firefox78', 'chrome87', 'safari14.1'],
  },
})
