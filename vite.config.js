import { defineConfig } from 'vite';

export default defineConfig({
  // base relativo evita ter que mudar o nome do repositório para GitHub Pages.
  base: './',
  build: {
    sourcemap: true,
  },
});
