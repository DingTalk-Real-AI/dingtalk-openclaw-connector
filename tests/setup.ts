/**
 * 测试环境设置
 */

import { beforeAll, afterAll } from 'vitest';

// 设置测试超时时间
beforeAll(() => {
  // 确保测试环境变量已设置
  if (!process.env.GATEWAY_URL) {
    console.warn('⚠️  GATEWAY_URL 未设置，使用默认值: http://localhost:18789/gateway/call');
  }
  
  if (process.env.SKIP_INTEGRATION === 'true') {
    console.log('ℹ️  跳过集成测试（SKIP_INTEGRATION=true）');
  } else {
    console.log('ℹ️  运行完整测试（包括集成测试）');
    console.log('ℹ️  如需跳过集成测试，请设置 SKIP_INTEGRATION=true');
  }
});

afterAll(() => {
  console.log('✅ 测试完成');
});
