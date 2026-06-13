import { defineConfig } from 'vite';

// Dev flow: vite serves the client on 5173 and proxies /api + /ws to the game
// server on 3001. A cloudflared tunnel pointed at 5173 is what the Discord
// URL Mapping targets. In production the Express server serves client/dist
// itself, so the tunnel points at 3001 instead.
export default defineConfig({
  envDir: '..',
  server: {
    port: 5173,
    strictPort: true,
    // The tunnel hostname is random, so allow any host header in dev.
    allowedHosts: true,
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
      '/ws': { target: 'ws://localhost:3001', ws: true },
    },
    // When developing through the Discord proxy + https tunnel, HMR must use
    // wss on 443. Set TUNNEL=1 when running behind cloudflared.
    hmr: process.env.TUNNEL ? { clientPort: 443 } : undefined,
    fs: { allow: ['..'] },
  },
  build: { target: 'es2022', sourcemap: true },
});
