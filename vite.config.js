import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base = nombre del repo en GitHub Pages: https://rikicb9.github.io/Trastero/
export default defineConfig({
  base: '/Trastero/',
  plugins: [react()],
});
