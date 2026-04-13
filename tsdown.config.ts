import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: { index: 'index.ts', 'entry-bundled': 'entry-bundled.ts' },
  format: 'esm',
  target: 'node22',
  platform: 'node',
  clean: true,
  outDir: 'dist',
  dts: true,
  deps: {
    neverBundle: [
      /^openclaw(\/.*)?$/,
      'axios',
      'dingtalk-stream',
      'form-data',
      'zod',
      /^node:/,
    ],
  },
});
