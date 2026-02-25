#!/usr/bin/env node

/**
 * 钉钉 Stream 连接诊断工具
 */

import { DWClient, TOPIC_ROBOT } from 'dingtalk-stream';

const clientId = 'dingjnzcymsegqejq3ja';
const clientSecret = 'uP-7RAwJnbivUrZVmlfNO0Wg2_FiG0CphX3hLHNDKAFt9JBYp8imnt-qBgIOB5Ss';

console.log('🔍 开始诊断钉钉 Stream 连接...\n');

console.log('1️⃣ 测试凭证有效性...');
console.log(`   AppKey: ${clientId}`);
console.log(`   AppSecret: ${clientSecret.substring(0, 10)}...`);

const client = new DWClient({
  clientId,
  clientSecret,
});

// 监听连接事件
client.on('connect', () => {
  console.log('✅ Stream 客户端已连接');
});

client.on('disconnect', (reason) => {
  console.log('❌ Stream 客户端断开连接:', reason);
});

client.on('error', (err) => {
  console.error('❌ Stream 客户端错误:', err.message);
  console.error('   详细信息:', err);
});

// 注册机器人消息回调
client.registerCallbackListener(TOPIC_ROBOT, async (res) => {
  console.log('📨 收到消息:', JSON.stringify(res, null, 2));
  return { status: 'ok' };
});

console.log('\n2️⃣ 尝试连接钉钉 Stream 服务...');

// 启动连接
client.connect()
  .then(() => {
    console.log('✅ 连接成功！等待消息...');
    console.log('\n💡 请在钉钉中给机器人发送一条测试消息');
    console.log('   按 Ctrl+C 退出\n');
  })
  .catch((err) => {
    console.error('❌ 连接失败:', err.message);
    console.error('   详细错误:', err);
    process.exit(1);
  });

// 保持进程运行
process.on('SIGINT', () => {
  console.log('\n\n👋 正在断开连接...');
  client.disconnect();
  process.exit(0);
});
