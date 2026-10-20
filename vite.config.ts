import { defineConfig } from 'vite';
import cesium from 'vite-plugin-cesium';

/**
 * `vite-plugin-cesium` copies the Cesium runtime (Workers, Assets, Widgets) into the
 * build output and injects the correct CESIUM_BASE_URL, so workers and textures
 * resolve at runtime without any token or manual asset wiring.
 */
export default defineConfig({
  plugins: [cesium()],
  server: {
    port: 5173,
    strictPort: false,
    host: '127.0.0.1',
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 8000,
    sourcemap: false,
  },
  optimizeDeps: {
    // Cesium's ESM source is large; pre-bundling it keeps dev reloads fast.
    include: ['cesium'],
  },
});
