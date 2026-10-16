import React, { useState, useRef, useEffect, useCallback } from 'react';

const SEVERITY_PATTERNS = {
  CRITICAL: /\b(500|out of memory|oom|fatal|panic|crash)\b/i,
  ERROR: /\b(error|exception|failed|failure)\b/i,
  WARNING: /\b(warn|warning|timeout|retry|deprecated)\b/i,
  INFO: /\b(info|information|started|completed|success)\b/i,
};

function classifyLine(line) {
  for (const [severity, regex] of Object.entries(SEVERITY_PATTERNS)) {
    if (regex.test(line)) return severity;
  }
  return 'DEBUG';
}

const SEVERITY_COLORS = {
  CRITICAL: '#ef4444',
  ERROR: '#f87171',
  WARNING: '#f59e0b',
  INFO: '#38bdf8',
  DEBUG: '#94a3b8',
};

const LiveLogViewer = ({ onAnalyzeWithAgent }) => {
  const [cloudProvider, setCloudProvider] = useState('azure'); // 'azure' or 'gcp'
  const [logs, setLogs] = useState([]);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [paused, setPaused] = useState(false);
  const [filter, setFilter] = useState('');
  const [severityFilter, setSeverityFilter] = useState('ALL');
  const [autoScroll, setAutoScroll] = useState(true);
  const [status, setStatus] = useState(null);

  const logsEndRef = useRef(null);
  const logContainerRef = useRef(null);
  const eventSourceRef = useRef(null);
  const pausedLogsRef = useRef([]);
  const isPausedRef = useRef(false);

  // Keep isPausedRef in sync
  useEffect(() => {
    isPausedRef.current = paused;
  }, [paused]);

  const scrollToBottom = useCallback(() => {
    if (autoScroll && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [autoScroll]);

  // Handle scroll to detect if user scrolled up
  const handleScroll = useCallback(() => {
    if (!logContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = logContainerRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 60;
    setAutoScroll(isAtBottom);
  }, []);

  // Fetch status
  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`http://127.0.0.1:5000/api/application/logs/status?source=${cloudProvider}`);
      const data = await res.json();
      setStatus(data);
    } catch {
      setStatus(null);
    }
  }, [cloudProvider]);

  // Connect to SSE
  const connect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    setConnecting(true);
    const es = new EventSource(`http://127.0.0.1:5000/api/application/logs/stream?source=${cloudProvider}`);

    es.onopen = () => {
      setConnected(true);
      setConnecting(false);
    };

    es.onmessage = (event) => {
      const line = event.data;
      const entry = {
        id: Date.now() + Math.random(),
        text: line,
        severity: classifyLine(line),
        timestamp: new Date(),
      };

      if (isPausedRef.current) {
        pausedLogsRef.current.push(entry);
      } else {
        setLogs((prev) => {
          const updated = [...prev, entry];
          // Cap at 2000 lines to avoid memory bloat
          return updated.length > 2000 ? updated.slice(-2000) : updated;
        });
      }
    };

    es.onerror = () => {
      setConnected(false);
      setConnecting(false);
      es.close();
      // Attempt reconnect after 3s
      setTimeout(() => {
        if (!eventSourceRef.current || eventSourceRef.current.readyState === EventSource.CLOSED) {
          connect();
        }
      }, 3000);
    };

    eventSourceRef.current = es;
  }, [cloudProvider]);

  const disconnect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setConnected(false);
    setConnecting(false);
  }, []);

  // Auto-connect on mount and whenever cloudProvider changes
  useEffect(() => {
    setLogs([]);
    connect();
    fetchStatus();
    const statusInterval = setInterval(fetchStatus, 10000);
    return () => {
      disconnect();
      clearInterval(statusInterval);
    };
  }, [connect, disconnect, fetchStatus, cloudProvider]);

  // Auto-scroll when new logs arrive
  useEffect(() => {
    scrollToBottom();
  }, [logs, scrollToBottom]);

  // Resume: flush paused logs
  const handleResume = () => {
    setPaused(false);
    if (pausedLogsRef.current.length > 0) {
      setLogs((prev) => {
        const merged = [...prev, ...pausedLogsRef.current];
        pausedLogsRef.current = [];
        return merged.length > 2000 ? merged.slice(-2000) : merged;
      });
    }
  };

  const handlePause = () => {
    setPaused(true);
    pausedLogsRef.current = [];
  };

  const handleClear = () => {
    setLogs([]);
    pausedLogsRef.current = [];
  };

  // Filter logs
  const filteredLogs = logs.filter((entry) => {
    if (severityFilter !== 'ALL' && entry.severity !== severityFilter) return false;
    if (filter && !entry.text.toLowerCase().includes(filter.toLowerCase())) return false;
    return true;
  });

  const severityCounts = logs.reduce((acc, entry) => {
    acc[entry.severity] = (acc[entry.severity] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="live-log-viewer">
      {/* Header / Toolbar */}
      <div className="log-toolbar">
        <div className="log-toolbar-left">
          {/* Cloud Provider Toggle (Azure / GCP) */}
          <div className="cloud-provider-toggle" style={{ display: 'flex', alignItems: 'center', background: 'rgba(255,255,255,0.06)', borderRadius: '8px', padding: '3px', border: '1px solid rgba(255,255,255,0.1)' }}>
            <button
              type="button"
              onClick={() => setCloudProvider('azure')}
              style={{
                padding: '0.35rem 0.85rem',
                borderRadius: '6px',
                fontSize: '0.8rem',
                fontWeight: 600,
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                transition: 'all 0.2s',
                background: cloudProvider === 'azure' ? '#0078d4' : 'transparent',
                color: cloudProvider === 'azure' ? '#ffffff' : '#94a3b8',
                boxShadow: cloudProvider === 'azure' ? '0 1px 6px rgba(0, 120, 212, 0.4)' : 'none'
              }}
              title="Azure App Service Live Logs"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M13.05 4.24l-6.84 11.97 4.35 3.55 5.94-10.45-3.45-5.07zm1.75 3.06l3.4 5.95-4.47 6.51H24l-9.2-12.46zM0 19.76h9.11L4.35 15.7 0 19.76z"/></svg>
              Azure App Service
            </button>
            {/* GCP toggle commented out for now so it doesn't disturb Azure */}
            {/* <button
              type="button"
              onClick={() => setCloudProvider('gcp')}
              style={{
                padding: '0.35rem 0.85rem',
                borderRadius: '6px',
                fontSize: '0.8rem',
                fontWeight: 600,
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                transition: 'all 0.2s',
                background: cloudProvider === 'gcp' ? '#ea4335' : 'transparent',
                color: cloudProvider === 'gcp' ? '#ffffff' : '#94a3b8',
                boxShadow: cloudProvider === 'gcp' ? '0 1px 6px rgba(234, 67, 53, 0.4)' : 'none'
              }}
              title="GCP Compute Engine VM Live Logs"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z"/></svg>
              GCP Compute Engine
            </button> */}
          </div>

          <div className={`connection-indicator ${connected ? 'connected' : connecting ? 'connecting' : 'disconnected'}`}>
            <span className="connection-dot"></span>
            <span className="connection-label">
              {connected ? 'Live' : connecting ? 'Connecting...' : 'Disconnected'}
            </span>
          </div>

          {status && (
            <div className="log-meta">
              <span className="meta-chip">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
                {status.app_service}
              </span>
              <span className="meta-chip">
                Mode: {status.mode}
              </span>
              <span className="meta-chip">
                Buffer: {status.buffer_size}
              </span>
            </div>
          )}
        </div>

        <div className="log-toolbar-right">
          {/* Severity filter pills */}
          <div className="severity-pills">
            {['ALL', 'CRITICAL', 'ERROR', 'WARNING', 'INFO', 'DEBUG'].map((sev) => (
              <button
                key={sev}
                className={`severity-pill ${severityFilter === sev ? 'active' : ''} sev-${sev.toLowerCase()}`}
                onClick={() => setSeverityFilter(sev)}
              >
                {sev}
                {sev !== 'ALL' && severityCounts[sev] ? (
                  <span className="pill-count">{severityCounts[sev]}</span>
                ) : null}
              </button>
            ))}
          </div>

          {/* Text filter */}
          <div className="log-filter-input-wrapper">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input
              className="log-filter-input"
              type="text"
              placeholder="Filter logs..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>

          {/* Action buttons */}
          <div className="log-actions">
            {paused ? (
              <button className="log-action-btn resume" onClick={handleResume} title="Resume">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                Resume {pausedLogsRef.current.length > 0 ? `(${pausedLogsRef.current.length})` : ''}
              </button>
            ) : (
              <button className="log-action-btn pause" onClick={handlePause} title="Pause">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
                Pause
              </button>
            )}
            <button className="log-action-btn clear" onClick={handleClear} title="Clear">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
              Clear
            </button>
            {!connected && !connecting && (
              <button className="log-action-btn reconnect" onClick={connect} title="Reconnect">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
                Reconnect
              </button>
            )}
            {onAnalyzeWithAgent && (
              <button 
                className="log-action-btn"
                onClick={() => onAnalyzeWithAgent(severityFilter, filter, cloudProvider)}
                title="Send current filtered logs to Application Agent for deep analysis"
                style={{
                  background: '#2368a0',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '6px',
                  padding: '0.4rem 0.8rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  boxShadow: '0 2px 8px rgba(35, 104, 160, 0.3)'
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                Analyze in Agent
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Log output */}
      <div className="log-output" ref={logContainerRef} onScroll={handleScroll}>
        {filteredLogs.length === 0 && (
          <div className="log-empty">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.3 }}>
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>
            </svg>
            <p>{connected ? 'Waiting for logs...' : 'Not connected to log stream'}</p>
          </div>
        )}

        {filteredLogs.map((entry) => (
          <div key={entry.id} className={`log-line sev-${entry.severity.toLowerCase()}`}>
            <span className="log-severity-badge" style={{ color: SEVERITY_COLORS[entry.severity] }}>
              {entry.severity.substring(0, 4)}
            </span>
            <span className="log-timestamp">
              {entry.timestamp.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
            <span className="log-text">{entry.text}</span>
          </div>
        ))}
        <div ref={logsEndRef} />
      </div>

      {/* Footer stats */}
      <div className="log-footer">
        <span>{filteredLogs.length} / {logs.length} lines</span>
        {paused && <span className="paused-badge">⏸ PAUSED</span>}
        {!autoScroll && !paused && (
          <button className="scroll-to-bottom-btn" onClick={() => { setAutoScroll(true); scrollToBottom(); }}>
            ↓ Scroll to bottom
          </button>
        )}
      </div>
    </div>
  );
};

export default LiveLogViewer;
