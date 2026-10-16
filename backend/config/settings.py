from pydantic_settings import BaseSettings
from typing import Optional
from dotenv import load_dotenv
import os

load_dotenv()

class Settings(BaseSettings):
    AZURE_SUBSCRIPTION_ID: Optional[str] = None
    AZURE_RESOURCE_GROUP: Optional[str] = None
    AZURE_APP_SERVICE_NAME: Optional[str] = None
    AZURE_TENANT_ID: Optional[str] = None
    AZURE_CLIENT_ID: Optional[str] = None
    AZURE_CLIENT_SECRET: Optional[str] = None
    KUDU_USERNAME: Optional[str] = None
    KUDU_PASSWORD: Optional[str] = None
    LOG_BUFFER_SIZE: int = 100
    LOG_STREAM_RETRY_SECONDS: int = 5
    LOG_SOURCE: str = "azure"  # "azure" or "gcp" or "mock"
    AZURE_OPENAI_DEPLOYMENT: Optional[str] = None  # Azure OpenAI deployment name for LLM tools

    # GCP Compute Engine Log Stream Settings
    GCP_PROJECT_ID: Optional[str] = None
    GCP_INSTANCE_ID: Optional[str] = None
    GCP_ZONE: Optional[str] = None
    GCP_LOG_FILTER: str = 'resource.type="gce_instance"'
    GOOGLE_APPLICATION_CREDENTIALS: Optional[str] = None

    # Gemini / Model Settings
    GEMINI_API_KEY: Optional[str] = None
    GOOGLE_API_KEY: Optional[str] = None
    MODEL_NAME: str = "azure/gpt-5.6-terra"

    # Email alert settings
    SMTP_HOST: str = "smtp.gmail.com"
    SMTP_PORT: int = 587
    SMTP_USER: Optional[str] = None
    SMTP_PASSWORD: Optional[str] = None  # Gmail App Password
    ALERT_EMAIL: str = "varshithatangeti@gmail.com"

    class Config:
        env_file = ".env"
        extra = "ignore"

settings = Settings()
