/**
 * 媒体处理公共工具和常量
 */

import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import { createLogger } from '../../utils/logger.ts';

// ============ 常量 ============

/** 文本文件扩展名 */
export const TEXT_FILE_EXTENSIONS = new Set([
  '.txt', '.md', '.json', '.yaml', '.yml', '.xml', '.html', '.css',
  '.js', '.ts', '.py', '.java', '.c', '.cpp', '.h', '.sh', '.bat', '.csv',
]);

/** 图片文件扩展名 */
export const IMAGE_EXTENSIONS = /\.(png|jpg|jpeg|gif|bmp|webp|tiff|svg)$/i;

/** 本地图片路径正则表达式（跨平台） */
export const LOCAL_IMAGE_RE =
  /!\[([^\]]*)\]\(((?:file:\/\/|MEDIA:|attachment:\/\/)[^)]+|\/(?:tmp|var|private|Users|home|root)[^)]+|[A-Za-z]:[\\/][^)]+)\)/g;

/** 纯文本图片路径正则表达式 */
export const BARE_IMAGE_PATH_RE =
  /`?((?:\/(?:tmp|var|private|Users|home|root)\/[^\s`'",)]+|[A-Za-z]:[\\/][^\s`'",)]+)\.(?:png|jpg|jpeg|gif|bmp|webp))`?/gi;

/** 视频标记正则表达式 */
export const VIDEO_MARKER_PATTERN = /\[DINGTALK_VIDEO\](.*?)\[\/DINGTALK_VIDEO\]/gs;

/** 音频标记正则表达式 */
export const AUDIO_MARKER_PATTERN = /\[DINGTALK_AUDIO\](.*?)\[\/DINGTALK_AUDIO\]/gs;

/** 文件标记正则表达式 */
export const FILE_MARKER_PATTERN = /\[DINGTALK_FILE\](.*?)\[\/DINGTALK_FILE\]/gs;

// ============ 工具函数 ============

/**
 * 去掉 file:// / MEDIA: / attachment:// 前缀，得到实际的绝对路径
 */
export function toLocalPath(raw: string): string {
  let filePath = raw;
  if (filePath.startsWith('file://')) filePath = filePath.replace('file://', '');
  else if (filePath.startsWith('MEDIA:')) filePath = filePath.replace('MEDIA:', '');
  else if (filePath.startsWith('attachment://')) filePath = filePath.replace('attachment://', '');

  try {
    filePath = decodeURIComponent(filePath);
  } catch {
    // 解码失败则保持原样
  }
  return filePath;
}

/**
 * 通用媒体文件上传函数
 */
export async function uploadMediaToDingTalk(
  filePath: string,
  mediaType: 'image' | 'file' | 'video' | 'voice',
  oapiToken: string,
  maxSize: number = 20 * 1024 * 1024,
  debug: boolean = false,
): Promise<string | null> {
  // 确保 debug 是布尔值
  const debugEnabled = debug === true || debug === 'true';
  const log = createLogger(debugEnabled, `DingTalk][${mediaType}`);
  
  log.info(`[uploadMediaToDingTalk] 开始上传，filePath: ${filePath}, mediaType: ${mediaType}, debug: ${debugEnabled}`);
  
  try {
    const FormData = (await import('form-data')).default;

    const absPath = toLocalPath(filePath);
    log.info(`检查文件是否存在：${absPath}`);
    if (!fs.existsSync(absPath)) {
      log.warn(`文件不存在：${absPath}`);
      return null;
    }

    const stats = fs.statSync(absPath);
    const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);
    const fileSize = stats.size;

    // ✅ 对于视频和文件类型，如果超过 20MB，使用分块上传
    if ((mediaType === 'video' || mediaType === 'file') && fileSize > CHUNK_CONFIG.SIZE_THRESHOLD) {
      log.info(`文件超过 20MB，使用分块上传：${absPath} (${fileSizeMB}MB)`);
      try {
        const { uploadLargeFileByChunks } = await import('./chunk-upload.js');
        const downloadCode = await uploadLargeFileByChunks(absPath, mediaType, oapiToken, debug);
        if (downloadCode) {
          log.info(`分块上传成功：${absPath}, download_code: ${downloadCode}`);
          return downloadCode;
        }
        log.error(`分块上传失败：${absPath}`);
      } catch (chunkErr: any) {
        log.error(`分块上传异常：${chunkErr.message}`);
      }
      return null;
    }

    // 检查文件大小（对于小于 20MB 的文件）
    if (stats.size > maxSize) {
      const maxSizeMB = (maxSize / (1024 * 1024)).toFixed(0);
      log.warn(
        `文件过大：${absPath}, 大小：${fileSizeMB}MB, 超过限制 ${maxSizeMB}MB`,
      );
      return null;
    }

    const form = new FormData();
    form.append('media', fs.createReadStream(absPath), {
      filename: path.basename(absPath),
      contentType: mediaType === 'image' ? 'image/jpeg' : 'application/octet-stream',
    });

    // ✅ 钉钉媒体上传 API 不支持 video 类型，视频需要使用 file 类型上传
    const uploadType = mediaType === 'video' ? 'file' : mediaType;
    
    log.info(`上传文件：${absPath} (${fileSizeMB}MB), uploadType=${uploadType}`);
    const resp = await axios.post(
      `${DINGTALK_OAPI}/media/upload?access_token=${oapiToken}&type=${uploadType}`,
      form,
      { headers: form.getHeaders(), timeout: 60_000 },
    );

    const mediaId = resp.data?.media_id;
    if (mediaId) {
      const cleanMediaId = mediaId.startsWith('@') ? mediaId.substring(1) : mediaId;
      const downloadUrl = `https://down.dingtalk.com/media/${cleanMediaId}`;
      log.info(`上传成功：mediaId=${cleanMediaId}`);
      return downloadUrl;
    }
    log.warn(`上传返回无 media_id`);
    return null;
  } catch (err: any) {
    log.error(`上传失败：${err.message}`);
    return null;
  }
}

/** 钉钉 OAPI 常量 */
export const DINGTALK_OAPI = 'https://oapi.dingtalk.com';