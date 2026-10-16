import React, { useState, useRef, useEffect, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const SEV_COLOR = {
  CRITICAL: { text: '#ef4444', bg: 'rgba(239,68,68,0.1)',  border: 'rgba(239,68,68,0.3)'  },
  HIGH:     { text: '#f97316', bg: 'rgba(249,115,22,0.1)', border: 'rgba(249,115,22,0.3)' },
  MEDIUM:   { text: '#eab308', bg: 'rgba(234,179,8,0.1)',  border: 'rgba(234,179,8,0.3)'  },
  LOW:      { text: '#22c55e', bg: 'rgba(34,197,94,0.1)',  border: 'rgba(34,197,94,0.3)'  },
  INFO:     { text: '#38bdf8', bg: 'rgba(56,189,248,0.1)', border: 'rgba(56,189,248,0.3)' },
};

function SeverityBadge({ text }) {
  const m = text.match(/^\[(CRITICAL|HIGH|MEDIUM|LOW|INFO)\]/);
  if (!m) return <strong>{text}</strong>;
  const sev = SEV_COLOR[m[1]] || {};
  return (  
    <strong>
      <span style={{
        display: 'inline-block', padding: '0.15rem 0.55rem', borderRadius: '6px',
        fontWeight: 700, fontSize: '0.78rem', letterSpacing: '0.5px', marginRight: '0.4rem',
        color: sev.text, background: sev.bg, border: `1px solid ${sev.border}`,
      }}>{m[1]}</span>
      {text.slice(m[0].length)}
    </strong>
  );
}

const paragraphComponents = {
  hr() {
    return <hr style={{ border: 'none', borderTop: '1px solid rgba(0,0,0,0.08)', margin: '1.2rem 0' }} />;
  },
  strong({ children }) {
    const text = typeof children === 'string' ? children : (Array.isArray(children) ? children.join('') : '');
    return <SeverityBadge text={text} />;
  },
  p({ children }) {
    return <p style={{ margin: '0.3rem 0', lineHeight: 1.65, color: '#334155' }}>{children}</p>;
  },
  code({ children }) {
    return (
      <code style={{
        background: 'rgba(99,102,241,0.08)', color: '#4f46e5',
        padding: '0.1rem 0.4rem', borderRadius: '4px', fontSize: '0.82rem', fontFamily: 'monospace',
        wordBreak: 'break-all',
      }}>{children}</code>
    );
  },
};


function parseAgentIssues(content) {
  if (!content || typeof content !== 'string') return [];
  const issues = [];

  const lines = content.trim().split('\n');
  const tableRows = lines.filter(l => l.trim().startsWith('|') && l.trim().endsWith('|'));
  if (tableRows.length >= 3 && tableRows[0].toLowerCase().includes('severity')) {
    for (let i = 2; i < tableRows.length; i++) {
      const cols = tableRows[i].split('|').map(c => c.trim()).filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);
      if (cols.length >= 4) {
        const rawSev = cols[0].replace(/\*+/g, '').trim().toUpperCase();
        if (['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'].includes(rawSev)) {
          issues.push({
            id: `issue-table-${i}`,
            severity: rawSev,
            issueType: cols[1].replace(/\*+/g, '').trim(),
            logEntry: cols[2].replace(/^`|`$/g, '').trim(),
            remediation: cols[3].trim(),
            raw: tableRows[i]
          });
        }
      }
    }
    if (issues.length > 0) return issues;
  }

  // Paragraph format: split by '---' first, or by Severity lines
  let blocks = content.split(/\n\s*---\s*\n/);
  if (blocks.length === 1) {
    const splitBySev = content.split(/(?=(?:^|\n)\s*(?:\*\*Severity:\*\*|Severity:))/i);
    if (splitBySev.length > 1) {
      blocks = splitBySev;
    }
  }

  blocks.forEach((block, idx) => {
    const trimmed = block.trim();
    if (!trimmed) return;

    // Severity match
    const sevMatch = trimmed.match(/(?:\*\*Severity:\*\*|Severity:|\*\*\[)\s*(CRITICAL|HIGH|MEDIUM|LOW|INFO)\b/i);
    if (!sevMatch) return;
    const severity = sevMatch[1].toUpperCase();

    // Issue Type
    let issueType = '';
    const typeMatch = trimmed.match(/(?:\*\*Issue Type:\*\*|Issue Type:|\s*—\s*)\s*([^\n]+)/i);
    if (typeMatch) {
      issueType = typeMatch[1].replace(/^\*\*|\*\*$/g, '').trim();
    }

    // Log Entry
    let logEntry = '';
    const logMatch = trimmed.match(/(?:\*\*Log Entry:\*\*|Log Entry:)\s*([\s\S]*?)(?=\n\s*(?:\*\*Remediation:\*\*|Remediation:)|\n\s*---|$)/i);
    if (logMatch) {
      logEntry = logMatch[1].trim();
    }

    // Remediation
    let remediation = '';
    const remMatch = trimmed.match(/(?:\*\*Remediation:\*\*|Remediation:)\s*([\s\S]*?)(?=\n\s*---|$)/i);
    if (remMatch) {
      remediation = remMatch[1].trim();
    }

    issues.push({
      id: `issue-${idx}`,
      severity,
      issueType: issueType || 'Issue',
      logEntry: logEntry || '',
      remediation: remediation || '',
      raw: trimmed
    });
  });

  return issues;
}

// Component that renders the filtered issues without internal scrollbars
function AgentResponseViewer({ content, isError, activeSeverity = 'ALL', onResetFilter }) {
  const issues = useMemo(() => parseAgentIssues(content), [content]);

  if (isError) {
    return <div style={{ color: 'var(--error-color)' }}>{content}</div>;
  }

  // Fallback to standard ReactMarkdown if not structured into issues
  if (issues.length === 0) {
    return (
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={paragraphComponents}>
        {content || ''}
      </ReactMarkdown>
    );
  }

  const filteredIssues = (!activeSeverity || activeSeverity === 'ALL')
    ? issues
    : issues.filter(i => i.severity === activeSeverity);

  return (
    <div className="agent-issues-wrapper">
      {filteredIssues.length === 0 ? (
        <div className="no-issues-placeholder">
          No <strong>{activeSeverity}</strong> severity errors found in this analysis.
          <div style={{ marginTop: '8px' }}>
            <button
              type="button"
              className="btn btn-primary"
              style={{ padding: '0.35rem 0.85rem', fontSize: '0.8rem', margin: '0 auto' }}
              onClick={onResetFilter}
            >
              Show All ({issues.length})
            </button>
          </div>
        </div>
      ) : (
        <div className="issues-container">
          {filteredIssues.map((issue, idx) => (
            <div key={issue.id || idx} className="issue-paragraph-card">
              <div className="issue-row">
                <span className="issue-label">Severity:</span>
                <span className={`severity-tag sev-${issue.severity.toLowerCase()}`}>
                  {issue.severity}
                </span>
              </div>
              <div className="issue-row">
                <span className="issue-label">Issue Type:</span>
                <span className="issue-type-value">{issue.issueType}</span>
              </div>
              {issue.logEntry && (
                <div className="issue-row">
                  <span className="issue-label">Log Entry:</span>
                  <pre className="issue-log-box">
                    <code>{issue.logEntry.replace(/^`|`$/g, '').trim()}</code>
                  </pre>
                </div>
              )}
              {issue.remediation && (
                <div className="issue-row">
                  <span className="issue-label">Remediation:</span>
                  <span className="issue-remediation-value">{issue.remediation}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const ApplicationAgent = ({ initialFilter }) => {
  const [sessions, setSessions] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [loadingSessions, setLoadingSessions] = useState(new Set());
  const [mockFiles, setMockFiles] = useState([]);
  const [selectedFile, setSelectedFile] = useState('');
  const [severityFilter, setSeverityFilter] = useState('ALL');
  const [keywordFilter, setKeywordFilter] = useState('');
  const [isInitialized, setIsInitialized] = useState(false);
  const chatEndRef = useRef(null);

  useEffect(() => {
    if (initialFilter) {
      if (initialFilter.severity) setSeverityFilter(initialFilter.severity);
      if (initialFilter.keyword !== undefined) setKeywordFilter(initialFilter.keyword);
      if (initialFilter.provider) {
        setSelectedFile(initialFilter.provider === 'gcp' ? 'live:gcp' : 'live:azure');
      }
    }
  }, [initialFilter]);

  useEffect(() => {
    const fetchInitialData = async () => {
      try {
        const res = await fetch('http://127.0.0.1:5000/api/mockfiles');
        const data = await res.json();
        if (data.files && data.files.length > 0) {
          setMockFiles(data.files);
          setSelectedFile(prev => prev || 'live:azure');
        }
      } catch (e) {
        console.error("Failed to fetch mock files", e);
      }
      
      try {
        const res = await fetch('http://127.0.0.1:5000/api/application/sessions');
        const data = await res.json();
        if (data.sessions) {
          setSessions(data.sessions);
          if (data.sessions.length > 0) {
            setActiveSessionId(data.sessions[0].id);
          }
        }
      } catch (e) {
        console.error("Failed to fetch sessions", e);
      } finally {
        setIsInitialized(true);
      }
    };
    fetchInitialData();
  }, []);

  useEffect(() => {
    if (!isInitialized) return;
    const saveSessions = async () => {
      try {
        await fetch('http://127.0.0.1:5000/api/application/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessions })
        });
      } catch (e) {
        console.error("Failed to save sessions", e);
      }
    };
    saveSessions();
  }, [sessions, isInitialized]);

  const scrollToBottom = () => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const createNewSession = () => {
    setActiveSessionId(null);
  };

  const deleteSession = (e, id) => {
    e.stopPropagation();
    setSessions(prev => {
      const newSessions = prev.filter(s => s.id !== id);
      return newSessions;
    });
    if (activeSessionId === id) {
      setActiveSessionId(null);
    }
  };

  const activeSession = sessions.find(s => s.id === activeSessionId);
  const messages = activeSession ? activeSession.messages : [];

  // Calculate dynamic issue counts for the severity dropdown
  const latestAgentMsg = [...messages].reverse().find(m => m.role === 'agent' && !m.isError);
  const currentIssues = useMemo(() => {
    return latestAgentMsg ? parseAgentIssues(latestAgentMsg.content) : [];
  }, [latestAgentMsg]);

  const severityCounts = useMemo(() => {
    const c = { ALL: currentIssues.length, CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
    currentIssues.forEach(i => {
      if (c[i.severity] !== undefined) {
        c[i.severity]++;
      }
    });
    return c;
  }, [currentIssues]);

  const updateSessionMessages = (id, newMessages) => {
    setSessions(prev => prev.map(s => s.id === id ? { ...s, messages: newMessages } : s));
  };

  const analyzeLogs = async () => {
    let currentId = activeSessionId;
    let currentMessages = messages;

    if (!currentId) {
      currentId = Date.now().toString();
      const newSession = {
        id: currentId,
        name: 'Analyzing...',
        messages: []
      };
      setSessions(prev => [newSession, ...prev]);
      setActiveSessionId(currentId);
      currentMessages = [];
    }

    const updatedMessages = [...currentMessages];
    
    setLoadingSessions(prev => new Set(prev).add(currentId));

    const isGcpLive = selectedFile === 'live:gcp';
    const isAzureLive = !selectedFile || selectedFile === 'live' || selectedFile === 'live:azure';
    const isLiveLogs = isGcpLive || isAzureLive;

    let analyzePayload = isGcpLive 
      ? "analyze:live:gcp" 
      : isAzureLive 
      ? "analyze:live:azure" 
      : `analyze:${selectedFile}`;

    try {
      const params = new URLSearchParams({ text: analyzePayload });
      params.append('cloud_provider', isGcpLive ? 'gcp' : 'azure');

      if (severityFilter && severityFilter !== 'ALL') {
        params.append('severity_filter', severityFilter);
      }
      if (keywordFilter && keywordFilter.trim()) {
        params.append('keyword_filter', keywordFilter.trim());
      }

      const response = await fetch('http://127.0.0.1:5000/api/application/analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params,
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      
      if (data.file_name) {
        setSessions(prev => prev.map(s => s.id === currentId ? { ...s, name: data.file_name } : s));
      }
      
      const messagesToUpdate = [...updatedMessages];
      
      if (isLiveLogs && data.analyzed_logs) {
        messagesToUpdate.push({ 
          role: 'user', 
          content: `Analyzed the following logs:\n\n${data.analyzed_logs}` 
        });
      }
      
      messagesToUpdate.push({ role: 'agent', content: data.response });
      
      updateSessionMessages(currentId, messagesToUpdate);
    } catch (error) {
      updateSessionMessages(currentId, [...updatedMessages, { 
        role: 'agent', 
        isError: true,
        content: 'Failed to analyze logs. Please ensure the backend is running on port 5000.\n\nDetails: ' + error.message
      }]);
    } finally {
      setLoadingSessions(prev => {
        const newSet = new Set(prev);
        newSet.delete(currentId);
        return newSet;
      });
      setTimeout(scrollToBottom, 100);
    }
  };

  return (
    <div className="page-layout fade-in">
      {/* Sidebar */}
      <div className="history-sidebar">
        <div className="sidebar-header">
          <button className="new-chat-btn" onClick={createNewSession}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            New Analysis
          </button>
        </div>
        <div className="history-list">
          {sessions.map((session) => (
            <div 
              key={session.id} 
              className={`history-item ${activeSessionId === session.id ? 'active' : ''}`}
              onClick={() => { setActiveSessionId(session.id); }}
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
                <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{session.name}</span>
              </div>
              <button 
                onClick={(e) => deleteSession(e, session.id)}
                style={{ 
                  background: 'none', 
                  border: 'none', 
                  color: 'rgba(255, 255, 255, 0.65)', 
                  cursor: 'pointer',
                  padding: '4px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
                title="Delete Session"
                className="delete-session-btn"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6"></polyline>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                  <line x1="10" y1="11" x2="10" y2="17"></line>
                  <line x1="14" y1="11" x2="14" y2="17"></line>
                </svg>
              </button>
            </div>
          ))}
          {sessions.length === 0 && (
            <div style={{ padding: '1rem', textAlign: 'center', color: 'rgba(255, 255, 255, 0.6)', fontSize: '0.85rem' }}>
              No history
            </div>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="chat-content">
        <div className="agent-container" style={{ margin: 0, height: '100%', borderRadius: 0, boxShadow: 'none' }}>
          <div className="agent-header">
            <h2>Application Reliability Agent</h2>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexShrink: 0 }}>
              {/* Log Source Dropdown */}
              <select 
                value={selectedFile === 'live' ? 'live:azure' : selectedFile} 
                onChange={(e) => setSelectedFile(e.target.value)}
                style={{
                  padding: '0.42rem 1.8rem 0.42rem 0.75rem',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color)',
                  backgroundColor: 'var(--surface-color)',
                  color: 'var(--text-color)',
                  fontSize: '0.84rem'
                }}
                title="Select Log Source"
              >
                <option value="live:azure">Live Logs</option>
                {/* <option value="live:gcp">GCP Live Logs (Compute Engine)</option> */}
                {mockFiles.length > 0 && (
                  <optgroup label="Mock Files">
                    {mockFiles.map(file => (
                      <option key={file} value={file}>{file}</option>
                    ))}
                  </optgroup>
                )}
              </select>

              {/* Severity Filter Dropdown - right next to Live Logs */}
              <select
                value={severityFilter}
                onChange={(e) => setSeverityFilter(e.target.value)}
                style={{
                  padding: '0.42rem 1.8rem 0.42rem 0.75rem',
                  borderRadius: '8px',
                  border: severityFilter !== 'ALL' ? '1px solid #2368a0' : '1px solid var(--border-color)',
                  backgroundColor: severityFilter !== 'ALL' ? 'rgba(35, 104, 160, 0.08)' : 'var(--surface-color)',
                  color: severityFilter !== 'ALL' ? '#2368a0' : 'var(--text-color)',
                  fontSize: '0.84rem',
                  fontWeight: severityFilter !== 'ALL' ? '600' : 'normal'
                }}
                title="Filter by Error Severity"
              >
                <option value="ALL">
                  All Severities {currentIssues.length > 0 ? `(${severityCounts.ALL})` : ''}
                </option>
                <option value="CRITICAL">
                  Critical {currentIssues.length > 0 ? `(${severityCounts.CRITICAL})` : ''}
                </option>
                <option value="HIGH">
                  High {currentIssues.length > 0 ? `(${severityCounts.HIGH})` : ''}
                </option>
                <option value="MEDIUM">
                  Medium {currentIssues.length > 0 ? `(${severityCounts.MEDIUM})` : ''}
                </option>
                <option value="LOW">
                  Low {currentIssues.length > 0 ? `(${severityCounts.LOW})` : ''}
                </option>
              </select>

              {/* Analyze Button */}
              <button 
                className="btn btn-primary" 
                onClick={analyzeLogs}
                disabled={loadingSessions.has(activeSessionId)}
                style={{ padding: '0.42rem 1.15rem', fontSize: '0.85rem' }}
              >
                {loadingSessions.has(activeSessionId) ? 'Analyzing...' : 'Analyze'}
              </button>
            </div>
          </div>

          <div className="chat-area">
            {messages.length === 0 && (
              <div style={{ textAlign: 'center', color: 'var(--text-secondary)', marginTop: '2rem' }}>
                Click "Analyze" to begin.
              </div>
            )}
            
            {messages.map((msg, idx) => (
              <div key={idx} className={`message ${msg.role}`}>
                <div className="message-bubble">
                  {msg.role === 'user' ? (
                    <div className="user-log-wrapper">
                      <div className="user-log-header">
                        <div className="user-log-title">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
                          </svg>
                          <span>Analyzed Log Content</span>
                        </div>
                        <span className="user-log-line-count">
                          {msg.content.split('\n').filter(Boolean).length} lines
                        </span>
                      </div>
                      <div className="user-log-content">
                        {msg.content}
                      </div>
                    </div>
                  ) : (
                    <div className={`agent-response ${msg.isError ? 'error-text' : ''}`}>
                      <AgentResponseViewer 
                        content={msg.content} 
                        isError={msg.isError} 
                        activeSeverity={severityFilter}
                        onResetFilter={() => setSeverityFilter('ALL')}
                      />
                    </div>
                  )}
                </div>
              </div>
            ))}
            {loadingSessions.has(activeSessionId) && (
              <div className="message agent">
                <div className="message-bubble">
                  <span className="loader"></span> <span style={{ marginLeft: '10px' }}>Analyzing logs...</span>
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default ApplicationAgent;
