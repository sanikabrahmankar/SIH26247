import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// base './' makes the build work on Vercel, Netlify AND GitHub Pages project sites (/repo-name/) without edits.
export default defineConfig({ base: './', plugins: [react(), tailwindcss()] })
