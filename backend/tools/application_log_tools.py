from typing import Any, Dict, Optional
import os
import threading
from services.azure_log_stream import log_stream_service
from services.email_service import send_alert_email
from config.settings import settings

MOCK_LOG_FILE = r"C:\Users\vtangeti\Desktop\poc\backend\mockdata\app1.log"


# ---------------------------------------------------------------------------
# Tool 1 — get_recent_application_logs
# ---------------------------------------------------------------------------

def get_recent_application_logs(minutes: Optional[int] = 10, source: Optional[str] = None) -> str:
    """
    Retrieves the most recent application logs from Azure or GCP.
    """
    if settings.LOG_SOURCE == "mock":
        if os.path.isfile(MOCK_LOG_FILE):
            with open(MOCK_LOG_FILE, 'r', encoding='utf-8') as f:
                return f.read()
        return ""

    if source and source.lower() == "gcp":
        from services.gcp_log_stream import gcp_log_stream_service
        return gcp_log_stream_service.get_buffered_logs()

    # Default to Azure
    return log_stream_service.get_buffered_logs()


# ---------------------------------------------------------------------------
# Tool 2 — detect_log_severity
#
# This tool does NOT use hardcoded keyword rules.
# It returns the raw log line back to the agent so the agent's own LLM
# can semantically classify the severity.  The agent reads the log and
# decides: CRITICAL / HIGH / MEDIUM / LOW / INFO — based on meaning,
# not keywords.
# ---------------------------------------------------------------------------

def detect_log_severity(log_line: str) -> Dict[str, str]:
    """
    Returns the raw log line for the agent to semantically classify its severity.

    The calling LLM agent will determine the severity level (CRITICAL / HIGH /
    MEDIUM / LOW / INFO) based on its understanding of the log content —
    no hardcoded rules or keywords are used.

    Args:
        log_line: A single line from an application log.

    Returns:
        A dict with the log_line and a prompt instructing the agent to classify it.
    """
    return {
        "log_line": log_line.strip(),
        "instruction": (
            "Classify the severity of the above log line as one of: "
            "CRITICAL, HIGH, MEDIUM, LOW, or INFO. "
            "Base your decision on the semantic meaning of the log content — "
            "not keywords. Then explain your reasoning in one sentence."
        ),
    }


# ---------------------------------------------------------------------------
# Tool 3 — analyze_application_logs
# ---------------------------------------------------------------------------

def analyze_application_logs(log_content: Optional[str] = None) -> Dict[str, Any]:
    """
    Fetches and returns raw application log lines for the agent to analyze.

    The agent (LLM) will read all log lines, identify issues, determine severity
    semantically (CRITICAL / HIGH / MEDIUM / LOW / INFO), and generate
    remediation recommendations — without any hardcoded rules.

    If no log_content is provided it fetches recent logs automatically.
    If log_content is a file path, it reads the file.

    Returns a dict with:
        - total_lines : number of log lines fetched
        - log_lines   : list of (line_number, log_text) for agent to review
        - instruction : what the agent should do next
    """
    if log_content is None or log_content.strip().lower() in ("analyze", "analyze:live", "analyze:live:azure"):
        log_content = get_recent_application_logs(source="azure")
    elif log_content.strip().lower() == "analyze:live:gcp":
        log_content = get_recent_application_logs(source="gcp")
    elif os.path.isfile(log_content.strip()):
        with open(log_content.strip(), 'r', encoding='utf-8') as f:
            log_content = f.read()

    lines = [l for l in log_content.strip().split('\n') if l.strip()]
    total_logs = len(lines)

    if total_logs == 0:
        return {
            "total_lines": 0,
            "log_lines": [],
            "instruction": "No log lines were found. Inform the user that there are no recent logs to analyze.",
        }

    numbered = [{"line_number": i + 1, "text": line.strip()} for i, line in enumerate(lines)]

    return {
        "total_lines": total_logs,
        "log_lines": numbered,
        "instruction": (
            "Analyze the log lines above. For each line that represents an issue "
            "(ignore routine INFO lines), determine its severity semantically as "
            "CRITICAL, HIGH, MEDIUM, LOW, or INFO — based on the meaning of the log, "
            "not keywords. For each issue found provide: severity, issue_type, log_entry, "
            "and a concrete remediation recommendation. "
            "After analysis, if any CRITICAL or HIGH issues are found, call the "
            "send_critical_alert tool with the list of issues (severity, issue_type, log_entry, remediation). "
            "Your final response MUST NOT be a table. Format each issue as a clean paragraph block:\n\n"
            "**Severity:** <CRITICAL/HIGH/MEDIUM/LOW>\n"
            "**Issue Type:** <Brief Error Name>\n"
            "**Log Entry:** `<Raw log line/snippet>`\n"
            "**Remediation:** <Specific remediation recommendation>\n\n"
            "Separate each issue with `---`. Do NOT use tables. Do NOT include extra headers or summaries."
        ),
    }


# ---------------------------------------------------------------------------
# Tool 4 — send_critical_alert  (called by agent after it identifies issues)
# ---------------------------------------------------------------------------

def send_critical_alert(issues: list, log_source: str = "Live Logs") -> Dict[str, Any]:
    """
    Sends an email alert for CRITICAL and HIGH severity issues identified by the agent.

    Args:
        issues     : List of issue dicts with keys: severity, issue_type,
                     log_entry, remediation, line_number.
        log_source : Label describing where the logs came from.

    Returns:
        Dict with alert status.
    """
    critical_high = [i for i in issues if i.get("severity", "").upper() in ("CRITICAL", "HIGH")]

    if not critical_high:
        return {"alert_sent": False, "reason": "No CRITICAL or HIGH issues — no alert needed."}

    alert_to = getattr(settings, "ALERT_EMAIL", "varshithatangeti@gmail.com")

    threading.Thread(
        target=send_alert_email,
        kwargs={
            "issues": critical_high,
            "to_email": alert_to,
            "log_source": log_source,
        },
        daemon=True,
    ).start()

    return {
        "alert_sent": True,
        "alert_to": alert_to,
        "critical_high_count": len(critical_high),
        "message": f"Alert email triggered for {len(critical_high)} CRITICAL/HIGH issue(s).",
    }
