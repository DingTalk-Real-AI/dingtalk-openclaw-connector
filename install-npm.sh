#!/usr/bin/env bash
# =============================================================================
# install-npm.sh
# 将 dingtalk-connector 插件从本地 git 路径安装切换到 npm 包安装
#
# 流程：
#   1. 备份当前 openclaw.json 配置文件
#   2. 写入最小化干净配置（让 openclaw plugins 命令能正常运行）
#   3. 卸载旧插件（清除本地路径安装记录）
#   4. 从 npm 安装最新版插件
#   5. 恢复备份的配置文件（保留用户的所有业务配置）
# =============================================================================

set -euo pipefail

# ============ 常量 ============
OPENCLAW_CONFIG="$HOME/.openclaw/openclaw.json"
PLUGIN_NAME="dingtalk-connector"
NPM_PACKAGE="@dingtalk-real-ai/dingtalk-connector"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${OPENCLAW_CONFIG}.migrate_backup.${TIMESTAMP}"

# ============ 颜色输出 ============
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info()    { echo -e "${BLUE}[INFO]${NC}  $*"; }
log_success() { echo -e "${GREEN}[OK]${NC}    $*"; }
log_warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
log_error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; }

# ============ 错误恢复 ============
# 如果脚本中途失败，自动恢复备份
restore_on_error() {
  if [[ -f "$BACKUP_FILE" ]]; then
    log_warn "脚本异常退出，正在恢复备份配置..."
    cp "$BACKUP_FILE" "$OPENCLAW_CONFIG"
    log_warn "已恢复备份: $BACKUP_FILE"
  fi
}
trap restore_on_error ERR

# ============ 前置检查 ============
echo ""
echo "============================================================"
echo "  DingTalk Connector — 切换到 npm 安装"
echo "============================================================"
echo ""

if [[ ! -f "$OPENCLAW_CONFIG" ]]; then
  log_error "找不到 OpenClaw 配置文件: $OPENCLAW_CONFIG"
  exit 1
fi

if ! command -v openclaw &>/dev/null; then
  log_error "找不到 openclaw 命令，请确认已安装 OpenClaw CLI"
  exit 1
fi

# ============ 步骤 1：备份配置文件 ============
log_info "步骤 1/5：备份当前配置文件..."
cp "$OPENCLAW_CONFIG" "$BACKUP_FILE"
log_success "备份已保存至: $BACKUP_FILE"

# ============ 步骤 2：写入最小化干净配置 ============
log_info "步骤 2/5：写入临时干净配置（用于执行插件命令）..."

# 提取当前配置中 plugins 以外的所有字段，保留业务配置结构
# 同时写入一个空的 plugins 配置，让 openclaw 能正常初始化
python3 - <<'PYEOF'
import json, sys, os

config_path = os.path.expanduser("~/.openclaw/openclaw.json")

with open(config_path, "r") as f:
    original = json.load(f)

# 保留所有非 plugins 字段，plugins 置为空（让 openclaw 重新初始化）
clean_config = {k: v for k, v in original.items() if k != "plugins"}
clean_config["plugins"] = {
    "load": {},
    "entries": {},
    "allow": [],
    "installs": {}
}

with open(config_path, "w") as f:
    json.dump(clean_config, f, indent=2)

print("  干净配置写入完成")
PYEOF

log_success "临时干净配置写入完成"

# ============ 步骤 3：卸载旧插件 ============
log_info "步骤 3/5：卸载旧版插件 (${PLUGIN_NAME})..."
if openclaw plugins uninstall "$PLUGIN_NAME" --yes 2>&1 | grep -v "^$"; then
  log_success "旧插件卸载完成"
else
  log_warn "卸载命令返回非零，可能插件本来就未安装，继续执行..."
fi

# ============ 步骤 4：从 npm 安装最新版插件 ============
log_info "步骤 4/5：从 npm 安装最新版插件 (${NPM_PACKAGE})..."
echo ""
openclaw plugins install "$NPM_PACKAGE"
echo ""
log_success "npm 插件安装完成"

# ============ 步骤 5：恢复备份配置（保留业务配置） ============
log_info "步骤 5/5：将新安装的插件信息合并回原始业务配置..."

python3 - <<'PYEOF'
import json, os

config_path = os.path.expanduser("~/.openclaw/openclaw.json")
import glob
backup_files = sorted(glob.glob(config_path + ".migrate_backup.*"))
backup_path = backup_files[-1]  # 取最新的备份

with open(config_path, "r") as f:
    new_config = json.load(f)

with open(backup_path, "r") as f:
    original_config = json.load(f)

# 策略：以原始业务配置为基础，只替换 plugins.installs 为新安装的结果
# 这样保留了用户所有的 channels、agents、bindings 等业务配置
merged = dict(original_config)
merged["plugins"] = dict(original_config.get("plugins", {}))

# 用新安装的 installs 记录覆盖旧的（包含新的 npm source 信息）
new_installs = new_config.get("plugins", {}).get("installs", {})
if new_installs:
    merged["plugins"]["installs"] = new_installs
    # 同步更新 entries 和 allow（保留原有的 enabled 状态）
    for plugin_id in new_installs:
        if plugin_id not in merged["plugins"].get("entries", {}):
            merged["plugins"].setdefault("entries", {})[plugin_id] = {"enabled": True}
        if plugin_id not in merged["plugins"].get("allow", []):
            merged["plugins"].setdefault("allow", []).append(plugin_id)

with open(config_path, "w") as f:
    json.dump(merged, f, indent=2)

print(f"  已合并配置，新插件安装信息:")
for plugin_id, install_info in new_installs.items():
    print(f"    - {plugin_id}: {install_info.get('spec', 'unknown')} (source: {install_info.get('source', 'unknown')})")
PYEOF

log_success "配置合并完成"

# ============ 完成 ============
echo ""
echo "============================================================"
log_success "迁移完成！"
echo ""
echo "  备份文件: $BACKUP_FILE"
echo "  如需回滚: cp \"$BACKUP_FILE\" \"$OPENCLAW_CONFIG\""
echo ""
echo "  下一步：重启 OpenClaw Gateway 使新插件生效"
echo "    openclaw gateway --force"
echo "============================================================"
echo ""
