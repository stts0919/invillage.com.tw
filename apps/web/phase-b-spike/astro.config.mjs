import { defineConfig } from 'astro/config';
import react from '@astrojs/react';

export default defineConfig({
  output: 'static',
  build: { format: 'file' },
  integrations: [react()],
});
