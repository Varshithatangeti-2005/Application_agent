import asyncio
import logging
import json
from collections import deque
from typing import Dict, Any, Optional
import datetime
import os

from config.settings import settings

logger = logging.getLogger(__name__)

class GcpLogStreamService:
    def __init__(self):
        self.buffer = deque(maxlen=settings.LOG_BUFFER_SIZE)
        self.connected = False
        self.last_log_received_at: Optional[datetime.datetime] = None
        self._streaming_task: Optional[asyncio.Task] = None
        self._stop_event = asyncio.Event()
        self.listeners = []

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
            "provider": "gcp",
            "app_service": f"GCE VM: {settings.GCP_INSTANCE_ID or 'All Instances'}" if settings.GCP_PROJECT_ID else "GCP (Not Configured)",
            "project_id": settings.GCP_PROJECT_ID or "None",
            "instance_id": settings.GCP_INSTANCE_ID or "all",
            "resource_type": "gce_instance",
            "last_log_received_at": self.last_log_received_at.isoformat() if self.last_log_received_at else None,
            "buffer_size": len(self.buffer),
            "mode": "gcp" if settings.GCP_PROJECT_ID else "unconfigured",
        }

    def get_buffered_logs(self) -> str:
        return "\n".join(self.buffer)

    async def start(self):
        if settings.LOG_SOURCE == "mock":
            self.connected = True
            return
        self._stop_event.clear()
        self._streaming_task = asyncio.create_task(self._run_stream())
        logger.info("Started GCP Compute Engine log stream background task.")

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
                logger.error(f"GCP log stream error: {e}")
                logger.info(f"Reconnecting to GCP in {settings.LOG_STREAM_RETRY_SECONDS}s...")
                try:
                    await asyncio.wait_for(self._stop_event.wait(), timeout=settings.LOG_STREAM_RETRY_SECONDS)
                except asyncio.TimeoutError:
                    pass

    async def _connect_and_stream(self):
        if not settings.GCP_PROJECT_ID:
            logger.info("GCP_PROJECT_ID is not set in .env. Waiting for GCP configuration...")
            await asyncio.sleep(10)
            return

        # Ensure credentials path is set if provided in settings
        if settings.GOOGLE_APPLICATION_CREDENTIALS and os.path.exists(settings.GOOGLE_APPLICATION_CREDENTIALS):
            os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = settings.GOOGLE_APPLICATION_CREDENTIALS

        try:
            from google.cloud.logging_v2.services.logging_service_v2 import LoggingServiceV2AsyncClient
            from google.cloud.logging_v2.types import TailLogEntriesRequest
        except ImportError as e:
            logger.error(f"google-cloud-logging not installed properly: {e}")
            await asyncio.sleep(10)
            return

        logger.info(f"Connecting to GCP Cloud Logging for project {settings.GCP_PROJECT_ID} (Compute Engine VM)...")

        # Build filter expression for GCE instances
        filter_expr = settings.GCP_LOG_FILTER or 'resource.type="gce_instance"'
        if settings.GCP_INSTANCE_ID:
            filter_expr = f'{filter_expr} AND resource.labels.instance_id="{settings.GCP_INSTANCE_ID}"'

        client = LoggingServiceV2AsyncClient()

        async def request_generator():
            yield TailLogEntriesRequest(
                resource_names=[f"projects/{settings.GCP_PROJECT_ID}"],
                filter=filter_expr,
                buffer_window={"seconds": 2}
            )
            while not self._stop_event.is_set():
                await asyncio.sleep(2)

        try:
            stream = await client.tail_log_entries(requests=request_generator())
            logger.info(f"Connected to GCP Cloud Logging stream ✓ (Filter: {filter_expr})")
            self.connected = True

            async for response in stream:
                if self._stop_event.is_set():
                    break
                for entry in response.entries:
                    line = self._format_entry(entry)
                    if line:
                        await self._process_log_line(line)
        finally:
            self.connected = False

    def _format_entry(self, entry) -> Optional[str]:
        text = entry.text_payload
        if not text and entry.json_payload:
            try:
                text = json.dumps(dict(entry.json_payload))
            except Exception:
                text = str(entry.json_payload)
        elif not text and entry.proto_payload:
            text = str(entry.proto_payload)

        if not text:
            return None

        # Clean / single line representation
        text = text.strip()
        ts = ""
        if entry.timestamp:
            ts = entry.timestamp.strftime("%Y-%m-%d %H:%M:%S")

        instance = ""
        if hasattr(entry, "resource") and hasattr(entry.resource, "labels"):
            instance = entry.resource.labels.get("instance_id", "")

        prefix_parts = []
        if ts:
            prefix_parts.append(ts)
        if instance:
            prefix_parts.append(f"GCE:{instance}")

        if prefix_parts:
            return f"[{' | '.join(prefix_parts)}] {text}"
        return text

    async def _process_log_line(self, line: str):
        self.last_log_received_at = datetime.datetime.now(datetime.timezone.utc)
        self.buffer.append(line)
        await self.broadcast(line)

gcp_log_stream_service = GcpLogStreamService()
