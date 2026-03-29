/**
 * 测试环境设置
 *
 * 全局 setup，由 vitest.config.ts 的 setupFiles 引入。
 *
 * 全局 axios mock：
 * http-client.ts 在模块加载时立即调用 axios.create()，因此所有测试文件
 * 的 axios mock 必须提供 create 方法，否则会抛出 "default.create is not a function"。
 * 在此统一提供全局 mock，各测试文件可在此基础上覆盖具体的 get/post 行为。
 */
import { vi } from 'vitest';

vi.mock('axios', () => {
  const mockInstance = {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    patch: vi.fn(),
    request: vi.fn(),
    interceptors: {
      request: { use: vi.fn(), eject: vi.fn() },
      response: { use: vi.fn(), eject: vi.fn() },
    },
    defaults: { headers: { common: {} } },
  };

  return {
    default: {
      create: vi.fn(() => ({ ...mockInstance })),
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
      patch: vi.fn(),
    },
  };
});
