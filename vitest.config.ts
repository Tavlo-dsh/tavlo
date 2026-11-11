import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['host/tests/**/*.spec.ts'],
    environment: 'node',
    env: {
      DSH_OFFICIAL_HOST: '0',
    },
  },
})
