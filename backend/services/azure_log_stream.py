import asyncio
import logging
import base64
from collections import deque
from typing import Dict, Any, Optional
import httpx
from config.settings import settings
import datetime

logger = logging.getLogger(__name__)

class AzureLogStreamService:
    def __init__(self):
        self.buffer = deque(maxlen=settings.LOG_BUFFER_SIZE)
        self.connected = False
        self.last_log_received_at: Optional[datetime.datetime] = None
        self._streaming_task: Optional[asyncio.Task] = None
        self._stop_event = asyncio.Event()
        self.listeners = []

        if settings.LOG_SOURCE == "mock":
            logger.info("Initializing in mock mode. Will not connect to Azure.")

    def add_listener(self, queue: asyncio.Queue):
        self.listeners.append(queue)

    def remove_listener(self, queue: asyncio.Queue):
        if queue in self.listeners:
            self.listeners.remove(queue)

    async def broadcast(self, message: str):
        for queue in self.listeners:
            try:
                queue.put_nowait(message)
            except asyncio.QueueFull:
                pass

    def get_status(self) -> Dict[str, Any]:
        return {
            "connected": self.connected,
            "app_service": settings.AZURE_APP_SERVICE_NAME if settings.LOG_SOURCE == "azure" else "mock",
            "last_log_received_at": self.last_log_received_at.isoformat() if self.last_log_received_at else None,
            "buffer_size": len(self.buffer),
            "mode": settings.LOG_SOURCE,
        }

    def get_buffered_logs(self) -> str:
        return "\n".join(self.buffer)

    async def start(self):
        if settings.LOG_SOURCE == "mock":
            self.connected = True
            return
        self._stop_event.clear()
        self._streaming_task = asyncio.create_task(self._run_stream())
        logger.info("Started Azure log stream background task.")

    async def stop(self):
        self._stop_event.set()
        if self._streaming_task:
            self._streaming_task.cancel()
            try:
                await self._streaming_task
            except asyncio.CancelledError:
                pass
        self.connected = False

    async def _run_stream(self):
        while not self._stop_event.is_set():
            try:
                await self._connect_and_stream()
            except asyncio.CancelledError:
                break
            except Exception as e:
                self.connected = False
                logger.error(f"Log stream error: {e}")
                logger.info(f"Reconnecting in {settings.LOG_STREAM_RETRY_SECONDS}s...")
                await asyncio.sleep(settings.LOG_STREAM_RETRY_SECONDS)

    async def _connect_and_stream(self):
        if not settings.AZURE_APP_SERVICE_NAME:
            raise Exception("AZURE_APP_SERVICE_NAME is not set in .env")
        if not settings.KUDU_USERNAME or not settings.KUDU_PASSWORD:
            raise Exception("KUDU_USERNAME and KUDU_PASSWORD must be set in .env")

        logger.info(f"Connecting to {settings.AZURE_APP_SERVICE_NAME}...")

        basic = base64.b64encode(
            f"{settings.KUDU_USERNAME}:{settings.KUDU_PASSWORD}".encode()
        ).decode()

        url = f"https://{settings.AZURE_APP_SERVICE_NAME}.scm.azurewebsites.net/api/logstream"
        headers = {
            "Authorization": f"Basic {basic}",
            "Accept": "text/event-stream",
        }

        async with httpx.AsyncClient(timeout=None) as client:
            async with client.stream("GET", url, headers=headers) as resp:
                if resp.status_code in (401, 403):
                    raise Exception(f"Auth failed ({resp.status_code}). Check KUDU_USERNAME/KUDU_PASSWORD.")
                if resp.status_code != 200:
                    raise Exception(f"Kudu API returned {resp.status_code}")

                logger.info("Connected to log stream ✓")
                self.connected = True

                async for line in resp.aiter_lines():
                    if line:
                        await self._process_log_line(line)

    async def _process_log_line(self, line: str):
        self.last_log_received_at = datetime.datetime.now(datetime.timezone.utc)
        self.buffer.append(line)
        await self.broadcast(line)

log_stream_service = AzureLogStreamService()


