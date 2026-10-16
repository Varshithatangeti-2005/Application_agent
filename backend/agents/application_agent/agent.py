import os
import sys
import re
from pathlib import Path
from typing import Any, Dict, Optional
from dotenv import load_dotenv

# Load local .env variables
env_path = Path(__file__).parent / '.env'
load_dotenv(dotenv_path=env_path, override=True)

# Ensure project root is in sys.path so 'config', 'schemas', etc. can always be resolved
PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

# Prefer MODEL_NAME from local .env, fallback to config.settings or default
MODEL_NAME = os.getenv("MODEL_NAME", "azure/gpt-5.6-terra")

# Setup Gemini / Google AI Credentials if configured
gemini_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
if gemini_key:
    os.environ["GEMINI_API_KEY"] = gemini_key
    os.environ["GOOGLE_API_KEY"] = gemini_key

gcp_creds = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
if gcp_creds and os.path.exists(gcp_creds):
    os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = gcp_creds

from google.adk.agents.llm_agent import Agent

from tools.application_log_tools import (
    analyze_application_logs,
    get_recent_application_logs,
    detect_log_severity,
    send_critical_alert,
)

root_agent = Agent(
    name="application_agent",
    model=MODEL_NAME,
    description=(
        "Specialized Application Agent that ingests application logs, "
        "detects server issues and errors, and formulates remediation actions."
    ),
    instruction=(
        "You are an Application Reliability Agent. Your job is to analyze application logs, "
        "determine severity of issues, and alert the team when needed.\n\n"
        "Workflow:\n"
        "1. Use `get_recent_application_logs` to fetch logs if none are provided.\n"
        "2. Use `analyze_application_logs` to get the raw log lines.\n"
        "3. Read each log line carefully and use YOUR OWN judgment to classify severity as "
        "CRITICAL, HIGH, MEDIUM, LOW, or INFO — based on the semantic meaning of the log. "
        "Do NOT rely on keyword matching. Understand what the log is saying.\n"
        "4. If a user asks about a single log line's severity, use `detect_log_severity` — "
        "it will return the log line and you then classify it semantically.\n"
        "5. After identifying all CRITICAL and HIGH issues, call `send_critical_alert` "
        "with the list of issues containing keys: severity, issue_type, log_entry, remediation.\n"
        "6. Final Response Format:\n"
        "   Your final response MUST NOT be a table. Format each identified issue as a clean paragraph block:\n\n"
        "   **Severity:** <CRITICAL/HIGH/MEDIUM/LOW>\n"
        "   **Issue Type:** <Brief Error Name>\n"
        "   **Log Entry:** `<Raw log line/snippet>`\n"
        "   **Remediation:** <Specific remediation recommendation>\n\n"
        "   Separate multiple issues with `---`.\n\n"
        "STRICT CONSTRAINTS:\n"
        "- Do NOT use tables. Output ONLY paragraph blocks.\n"
        "- Do NOT add any preamble, greeting, or 'Log analysis summary' headers.\n"
        "- Do NOT include 'Operational impact' or any trailing summary paragraphs."
    ),
    tools=[get_recent_application_logs, analyze_application_logs, detect_log_severity, send_critical_alert]
)
