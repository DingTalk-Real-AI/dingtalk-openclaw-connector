import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    // 默认包含所有测试文件
    include: ['tests/**/*.{test,unit.test}.ts'],
    // 只排除 node_modules
    exclude: ['node_modules/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/**',
        'tests/**',
        '**/*.test.ts',
        '**/*.config.ts',
        'src/old/**',
      ],
    },
  },
});
