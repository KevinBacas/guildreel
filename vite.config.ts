import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({ plugins: [react()], root: 'src/client', build: { outDir: '../../dist/client', emptyOutDir: true }, server: { proxy: { '/api': 'http://localhost:4173', '/media': 'http://localhost:4173' } } });
