import smtplib
import logging
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import List, Dict, Any
from config.settings import settings

logger = logging.getLogger(__name__)


def build_email_html(issues: List[Dict[str, Any]], log_source: str = "") -> str:
    """Build a clean, readable HTML email body for critical/high severity issues."""

    severity_colors = {
        "CRITICAL": ("#ff4d4d", "#fff0f0"),
        "HIGH": ("#ff8c00", "#fff8f0"),
    }

    rows_html = ""
    for issue in issues:
        severity = issue.get("severity", "HIGH")
        badge_color, row_bg = severity_colors.get(severity, ("#888", "#f9f9f9"))

        rows_html += f"""
        <tr style="background:{row_bg}; border-bottom:1px solid #eee;">
            <td style="padding:12px 16px; vertical-align:top;">
                <span style="
                    display:inline-block;
                    padding:3px 10px;
                    border-radius:12px;
                    background:{badge_color};
                    color:#fff;
                    font-size:12px;
                    font-weight:700;
                    letter-spacing:0.5px;
                ">{severity}</span>
            </td>
            <td style="padding:12px 16px; vertical-align:top; color:#1a1a2e; font-weight:600;">
                {issue.get("issue_type", "Unknown Issue")}
            </td>
            <td style="padding:12px 16px; vertical-align:top;">
                <code style="
                    display:block;
                    background:#f4f4f8;
                    padding:6px 10px;
                    border-radius:4px;
                    font-size:12px;
                    color:#333;
                    word-break:break-all;
                ">{issue.get("log_entry", "")[:200]}</code>
            </td>
            <td style="padding:12px 16px; vertical-align:top; color:#333; font-size:13px;">
                {issue.get("remediation", "Review the logs and take appropriate action.")}
            </td>
        </tr>
        """

    source_label = f"Source: <b>{log_source}</b>" if log_source else ""

    html = f"""
    <!DOCTYPE html>
    <html>
    <head><meta charset="UTF-8"></head>
    <body style="margin:0; padding:0; font-family:Arial,sans-serif; background:#f0f2f5;">
      <div style="max-width:900px; margin:30px auto; background:#fff; border-radius:10px; overflow:hidden; box-shadow:0 4px 20px rgba(0,0,0,0.08);">

        <!-- Header -->
        <div style="background:linear-gradient(135deg,#1a1a2e 0%,#16213e 100%); padding:28px 32px;">
          <h1 style="margin:0; color:#fff; font-size:22px; letter-spacing:0.5px;">
            Log Alert - Critical/High Severity Issues Detected
          </h1>
          <p style="margin:6px 0 0; color:#a0aec0; font-size:13px;">
            {len(issues)} issue(s) require your attention. {source_label}
          </p>
        </div>

        <!-- Issues Table -->
        <div style="padding:24px 32px;">
          <table style="width:100%; border-collapse:collapse; font-size:13px;">
            <thead>
              <tr style="background:#f7f8fa; border-bottom:2px solid #e2e8f0;">
                <th style="padding:10px 16px; text-align:left; color:#718096; font-size:11px; text-transform:uppercase; letter-spacing:0.8px;">Severity</th>
                <th style="padding:10px 16px; text-align:left; color:#718096; font-size:11px; text-transform:uppercase; letter-spacing:0.8px;">Issue Type</th>
                <th style="padding:10px 16px; text-align:left; color:#718096; font-size:11px; text-transform:uppercase; letter-spacing:0.8px;">Log Entry</th>
                <th style="padding:10px 16px; text-align:left; color:#718096; font-size:11px; text-transform:uppercase; letter-spacing:0.8px;">Remediation</th>
              </tr>
            </thead>
            <tbody>
              {rows_html}
            </tbody>
          </table>
        </div>

        <!-- Footer -->
        <div style="padding:16px 32px; background:#f7f8fa; border-top:1px solid #e2e8f0; text-align:center;">
          <p style="margin:0; color:#a0aec0; font-size:12px;">
            This is an automated alert from your Log Analysis System. Please do not reply to this email.
          </p>
        </div>
      </div>
    </body>
    </html>
    """
    return html


def send_alert_email(
    issues: List[Dict[str, Any]],
    to_email: str,
    log_source: str = "",
) -> bool:
    """
    Send an alert email for CRITICAL/HIGH severity log issues.
    Uses SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASSWORD from settings.
    Returns True on success, False on failure.
    """
    if not settings.SMTP_USER or not settings.SMTP_PASSWORD:
        logger.warning(
            "SMTP_USER or SMTP_PASSWORD not configured - skipping alert email."
        )
        return False

    subject = f"Alert: {len(issues)} Critical/High Severity Log Issue(s) Detected"

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = settings.SMTP_USER
    msg["To"] = to_email

    html_body = build_email_html(issues, log_source=log_source)
    msg.attach(MIMEText(html_body, "html"))

    try:
        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT) as server:
            server.ehlo()
            server.starttls()
            server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
            server.sendmail(settings.SMTP_USER, to_email, msg.as_string())
        logger.info(f"Alert email sent to {to_email} for {len(issues)} issue(s).")
        return True
    except Exception as e:
        logger.error(f"Failed to send alert email: {e}")
        return False
