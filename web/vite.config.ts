import { defineConfig } from 'vite';

// GitHub Pages（プロジェクトページ）でもサブパスで動くよう相対パスで出力する
export default defineConfig({
  base: './',
  build: { outDir: 'dist', chunkSizeWarningLimit: 1500 },
});
