import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const repositoryName = process.env.GITHUB_REPOSITORY?.split('/').pop() || 'PageCraft'

export default defineConfig(({ command }) => ({
  base: command === 'build' ? `/${repositoryName}/` : '/',
  plugins: [react()],
}))
