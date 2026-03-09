/**
 * 常量定义模块
 * 集中管理所有常量
 */

export const id = 'dingtalk-connector';

/** 默认账号 ID，用于标记单账号模式（无 accounts 配置）时的内部标识，映射到 'main' agent */
export const DEFAULT_ACCOUNT_ID = '__default__';

/** 消息去重缓存过期时间（5分钟） */
export const MESSAGE_DEDUP_TTL = 5 * 60 * 1000;

/** 新会话触发命令 */
export const NEW_SESSION_COMMANDS = ['/new', '/reset', '/clear', '新会话', '重新开始', '清空对话'];

/** 钉钉 API 端点 */
export const DINGTALK_API = 'https://api.dingtalk.com';
export const DINGTALK_OAPI = 'https://oapi.dingtalk.com';

/** AI Card 模板 ID */
export const AI_CARD_TEMPLATE_ID = '382e4302-551d-4880-bf29-a30acfab2e71.schema';

/** flowStatus 值与 Python SDK AICardStatus 一致（cardParamMap 的值必须是字符串） */
export const AICardStatus = {
  PROCESSING: '1',
  INPUTING: '2',
  FINISHED: '3',
  EXECUTING: '4',
  FAILED: '5',
} as const;

/** 视频大小限制：20MB */
export const MAX_VIDEO_SIZE = 20 * 1024 * 1024;

/** 文件大小限制：20MB（字节） */
export const MAX_FILE_SIZE = 20 * 1024 * 1024;

/** 音频文件扩展名 */
export const AUDIO_EXTENSIONS = ['mp3', 'wav', 'amr', 'ogg', 'aac', 'flac', 'm4a'];

/** 可直接读取内容的文本类文件扩展名 */
export const TEXT_FILE_EXTENSIONS = new Set(['.txt', '.md', '.csv', '.json', '.xml', '.yaml', '.yml', '.html', '.htm', '.log', '.conf', '.ini', '.sh', '.py', '.js', '.ts', '.css', '.sql']);

/** 需要保存但无法直接读取的 Office/二进制文件扩展名 */
export const OFFICE_FILE_EXTENSIONS = new Set(['.docx', '.xlsx', '.pptx', '.pdf', '.doc', '.xls', '.ppt', '.zip', '.rar', '.7z']);
