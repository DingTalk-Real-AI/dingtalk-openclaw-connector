#!/bin/bash
set -e

echo "🚀 开始安装钉钉连接器 v0.8.0-beta..."

# 检查 OpenClaw 是否已安装
if ! command -v openclaw &> /dev/null; then
    echo "❌ 错误：未检测到 OpenClaw，请先安装 OpenClaw"
    exit 1
fi

# 检查 jq 是否已安装（用于 JSON 处理）
if ! command -v jq &> /dev/null; then
    echo "⚠️  警告：未检测到 jq 工具，将跳过自动配置迁移"
    echo "💡 提示：安装 jq 可以自动迁移配置 (brew install jq 或 apt-get install jq)"
    HAS_JQ=false
else
    HAS_JQ=true
fi

CONFIG_FILE="$HOME/.openclaw/openclaw.json"

# 检查并处理旧备份
echo "🔍 检查旧备份..."
BACKUP_DIR="$HOME/.openclaw"
OLD_BACKUPS=$(ls -t "$BACKUP_DIR"/openclaw.json.backup.* 2>/dev/null || true)

if [ -n "$OLD_BACKUPS" ]; then
    BACKUP_COUNT=$(echo "$OLD_BACKUPS" | wc -l | tr -d ' ')
    echo "📋 发现 $BACKUP_COUNT 个旧备份"
    
    # 找到最老的备份（最原始的配置）
    OLDEST_BACKUP=$(echo "$OLD_BACKUPS" | tail -1)
    echo "📌 将从最原始的备份中提取配置: $(basename "$OLDEST_BACKUP")"
    
    # 先复制最老的备份到临时位置（避免被删除）
    TEMP_SOURCE=$(mktemp)
    if ! cp "$OLDEST_BACKUP" "$TEMP_SOURCE"; then
        echo "❌ 错误：无法复制备份文件"
        exit 1
    fi
    SOURCE_CONFIG="$TEMP_SOURCE"
    
    # 删除所有旧备份
    echo "🗑️  清理旧备份..."
    while read -r backup; do
        rm -f "$backup"
        echo "   - 已删除: $(basename "$backup")"
    done <<< "$OLD_BACKUPS"
else
    echo "ℹ️  未发现旧备份，将使用当前配置"
    SOURCE_CONFIG="$CONFIG_FILE"
fi

# 创建新备份
echo "📦 创建新备份..."
BACKUP_FILE="$HOME/.openclaw/openclaw.json.backup.$(date +%Y%m%d_%H%M%S)"

if [ -f "$CONFIG_FILE" ]; then
    if ! cp "$CONFIG_FILE" "$BACKUP_FILE"; then
        echo "❌ 错误：备份配置文件失败"
        exit 1
    fi
    echo "✅ 配置已备份到: $BACKUP_FILE"
    
    # 自动迁移配置（如果有 jq）
    if [ "$HAS_JQ" = true ]; then
        # 先检查当前配置中是否已有 dingtalk-connector 配置
        EXISTING_CONNECTOR_ID=$(jq -r '.channels."dingtalk-connector".clientId // empty' "$CONFIG_FILE")
        EXISTING_CONNECTOR_SECRET=$(jq -r '.channels."dingtalk-connector".clientSecret // empty' "$CONFIG_FILE")
        EXISTING_CONNECTOR_ACCOUNTS=$(jq -r '.channels."dingtalk-connector".accounts // empty' "$CONFIG_FILE")
        
        # 如果已经有 dingtalk-connector 配置，跳过迁移
        if [ -n "$EXISTING_CONNECTOR_ID" ] || [ -n "$EXISTING_CONNECTOR_SECRET" ] || [ "$EXISTING_CONNECTOR_ACCOUNTS" != "null" ] && [ -n "$EXISTING_CONNECTOR_ACCOUNTS" ]; then
            echo "✅ 检测到已有 dingtalk-connector 配置，跳过迁移"
            echo "   - 配置文件保持不变"
        else
            echo "🔄 从原始配置中提取并迁移..."
            
            # 从源配置中提取旧的 dingtalk 配置
            OLD_CLIENT_ID=$(jq -r '.channels.dingtalk.clientId // empty' "$SOURCE_CONFIG")
            
            # 检查 clientSecret 的类型（字符串或对象）
            SECRET_TYPE=$(jq -r '.channels.dingtalk.clientSecret | type' "$SOURCE_CONFIG")
            
            if [ "$SECRET_TYPE" = "string" ]; then
                # 如果是字符串，直接提取
                OLD_CLIENT_SECRET=$(jq -r '.channels.dingtalk.clientSecret // empty' "$SOURCE_CONFIG")
            elif [ "$SECRET_TYPE" = "object" ]; then
                # 如果是对象（SecretInput 引用），保持原样
                OLD_CLIENT_SECRET=$(jq -c '.channels.dingtalk.clientSecret' "$SOURCE_CONFIG")
            else
                OLD_CLIENT_SECRET=""
            fi
            
            # 如果原始配置中有旧配置，则迁移
            if [ -n "$OLD_CLIENT_ID" ] && [ -n "$OLD_CLIENT_SECRET" ]; then
            echo "📋 正在迁移配置到 dingtalk-connector..."
            
            # 创建临时文件
            TEMP_FILE=$(mktemp)
            
            # 迁移配置（根据 clientSecret 类型选择不同的处理方式）
            if [ "$SECRET_TYPE" = "string" ]; then
                # 字符串类型：使用 --arg 传递
                if ! jq --arg clientId "$OLD_CLIENT_ID" \
                       --arg clientSecret "$OLD_CLIENT_SECRET" \
                       '.channels."dingtalk-connector" = (.channels."dingtalk-connector" // {}) | 
                        .channels."dingtalk-connector".enabled = true |
                        .channels."dingtalk-connector".clientId = $clientId |
                        .channels."dingtalk-connector".clientSecret = $clientSecret |
                        .channels.dingtalk.enabled = false' \
                       "$CONFIG_FILE" > "$TEMP_FILE"; then
                    echo "❌ 错误：配置迁移失败"
                    rm -f "$TEMP_FILE"
                    exit 1
                fi
            elif [ "$SECRET_TYPE" = "object" ]; then
                # 对象类型：使用 --argjson 传递 JSON 对象
                if ! jq --arg clientId "$OLD_CLIENT_ID" \
                       --argjson clientSecret "$OLD_CLIENT_SECRET" \
                       '.channels."dingtalk-connector" = (.channels."dingtalk-connector" // {}) | 
                        .channels."dingtalk-connector".enabled = true |
                        .channels."dingtalk-connector".clientId = $clientId |
                        .channels."dingtalk-connector".clientSecret = $clientSecret |
                        .channels.dingtalk.enabled = false' \
                       "$CONFIG_FILE" > "$TEMP_FILE"; then
                    echo "❌ 错误：配置迁移失败"
                    rm -f "$TEMP_FILE"
                    exit 1
                fi
            fi
            
            # 替换原配置文件
            if ! mv "$TEMP_FILE" "$CONFIG_FILE"; then
                echo "❌ 错误：无法更新配置文件"
                exit 1
            fi
            
                echo "✅ 配置迁移完成："
                echo "   - clientId: ${OLD_CLIENT_ID:0:12}..."
                echo "   - clientSecret: [已迁移]"
                echo "   - 旧 dingtalk 插件已禁用"
            else
                echo "ℹ️  未发现旧的 dingtalk 配置"
                echo ""
                echo "📝 检测到您是首次配置钉钉连接器，安装完成后请运行以下命令进行配置："
                echo "   openclaw wizard"
                echo ""
                echo "或者手动编辑配置文件："
                echo "   vim ~/.openclaw/openclaw.json"
                echo ""
                echo "配置示例："
                echo '   {'
                echo '     "channels": {'
                echo '       "dingtalk-connector": {'
                echo '         "enabled": true,'
                echo '         "clientId": "your-client-id",'
                echo '         "clientSecret": "your-client-secret"'
                echo '       }'
                echo '     }'
                echo '   }'
            fi
        fi
    fi
else
    echo "⚠️  配置文件不存在，将在安装后创建"
    echo ""
    echo "📝 安装完成后请运行以下命令进行配置："
    echo "   openclaw wizard"
    echo ""
    echo "或者手动编辑配置文件："
    echo "   vim ~/.openclaw/openclaw.json"
fi

# 克隆升级分支
echo "📥 克隆升级分支..."
cd /tmp
rm -rf dingtalk-openclaw-connector-beta
git clone --single-branch --branch feat/migrate-to-openclaw-sdk \
    https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector.git \
    dingtalk-openclaw-connector-beta

cd dingtalk-openclaw-connector-beta
npm install

# 卸载旧版本
echo "🗑️  卸载旧版本..."
openclaw plugins uninstall dingtalk-connector || true

# 安装新版本
echo "✨ 安装新版本..."
openclaw plugins install -l .

# 重启 Gateway
echo "🔄 重启 Gateway..."
openclaw gateway restart

# 清理临时文件
if [ -n "$TEMP_SOURCE" ] && [ -f "$TEMP_SOURCE" ]; then
    rm -f "$TEMP_SOURCE"
fi

echo ""
echo "✅ 安装完成！"
echo ""
echo "📖 请查看 README_UPGRADE.md 了解新功能"
echo "🐛 遇到问题请提交：https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/issues"
echo ""
echo "💡 如需回滚："
echo "   1. 恢复配置：cp $BACKUP_FILE ~/.openclaw/openclaw.json"
echo "   2. 安装旧版本：openclaw plugins install @dingtalk-real-ai/dingtalk-connector@latest"
echo ""
if [ "$HAS_JQ" = false ]; then
    echo "⚠️  提示：未安装 jq 工具，配置未自动迁移"
    echo "   请手动检查配置：vim ~/.openclaw/openclaw.json"
    echo "   或运行配置向导：openclaw wizard"
fi
