import logging
from typing import Dict, Any, Optional

from services.azure_log_stream import log_stream_service as azure_service
from services.gcp_log_stream import gcp_log_stream_service as gcp_service

logger = logging.getLogger(__name__)

class LogStreamManager:
    """
    Unified manager for multiple cloud log streaming services (Azure & GCP).
    Provides access to individual streams, buffered history, and lifecycle control.
    """
    def __init__(self):
        self.azure = azure_service
        self.gcp = gcp_service

    def get_service(self, source: Optional[str] = "azure"):
        if source and str(source).strip().lower() == "gcp":
            return self.gcp
        return self.azure

    def get_buffered_logs(self, source: Optional[str] = "azure") -> str:
        service = self.get_service(source)
        return service.get_buffered_logs()

    def get_status(self, source: Optional[str] = "azure") -> Dict[str, Any]:
        if source and str(source).strip().lower() == "all":
            return {
                "azure": self.azure.get_status(),
                "gcp": self.gcp.get_status()
            }
        return self.get_service(source).get_status()

    async def start_all(self):
        """Starts both Azure and GCP background log streaming tasks safely."""
        logger.info("LogStreamManager: Starting Azure log stream...")
        try:
            await self.azure.start()
        except Exception as e:
            logger.error(f"Failed to start Azure log stream: {e}")

        # GCP stream startup is commented out for now so it doesn't disturb Azure
        # logger.info("LogStreamManager: Starting GCP log stream...")
        # try:
        #     await self.gcp.start()
        # except Exception as e:
        #     logger.error(f"Failed to start GCP log stream: {e}")

    async def stop_all(self):
        """Stops all background log streaming tasks."""
        logger.info("LogStreamManager: Stopping all log streams...")
        try:
            await self.azure.stop()
        except Exception as e:
            logger.error(f"Error stopping Azure log stream: {e}")
            
        try:
            await self.gcp.stop()
        except Exception as e:
            logger.error(f"Error stopping GCP log stream: {e}")

log_stream_manager = LogStreamManager()
