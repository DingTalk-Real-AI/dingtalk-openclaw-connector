"""dingtalk-moltbot-connector

将钉钉机器人连接到 Moltbot Gateway 的轻量级 Python 连接器。
"""

from .config import ConnectorConfig
from .connector import MoltbotConnector
from .handler import MoltbotChatbotHandler
from .media import build_media_system_prompt

__version__ = "0.2.0"

__all__ = [
    "MoltbotConnector",
    "ConnectorConfig",
    "MoltbotChatbotHandler",
    "build_media_system_prompt",
]
