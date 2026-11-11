import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // Unit tests run outside VS Code: map the `vscode` module to a small stub.
      vscode: fileURLToPath(new URL('./test/stubs/vscode.ts', import.meta.url)),
    },
  },
  test: {
    include: ['test/unit/**/*.test.ts'],
    environment: 'node',
  },
});
