import React, { useEffect, useMemo, useRef, useState } from 'react';
import './App.css';

/**
 * Build a URL with query parameters appended derived from headers.
 * Many browsers do not allow setting custom headers in WebSocket connections;
 * This helper adds headers as query parameters as a practical alternative for servers that support it.
 */
function buildUrlWithParams(rawUrl, headers) {
  try {
    const url = new URL(rawUrl);
    headers.forEach(({ key, value }) => {
      if (key && value) {
        // encode header key name with a 'header_' prefix to avoid collisions
        url.searchParams.set(key, value);
      }
    });
    return url.toString();
  } catch {
    return rawUrl;
  }
}

/**
 * Normalize URL to ws/wss if user pasted http/https.
 */
function normalizeWsUrl(input) {
  try {
    const url = new URL(input);
    if (url.protocol === 'http:') {
      url.protocol = 'ws:';
      return url.toString();
    }
    if (url.protocol === 'https:') {
      url.protocol = 'wss:';
      return url.toString();
    }
    if (url.protocol === 'ws:' || url.protocol === 'wss:') {
      return url.toString();
    }
    return input;
  } catch {
    // If not a full URL, try to infer ws protocol
    if (input.startsWith('http://')) return input.replace(/^http:\/\//i, 'ws://');
    if (input.startsWith('https://')) return input.replace(/^https:\/\//i, 'wss://');
    if (input.startsWith('ws://') || input.startsWith('wss://')) return input;
    return input;
  }
}

/**
 * Format timestamp as HH:MM:SS.mmm
 */
function formatTime(d = new Date()) {
  const pad = (n, z = 2) => String(n).padStart(z, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

/**
 * Try to stringify payload nicely, handling objects and binary safely.
 */
function stringifyPayload(data) {
  if (data == null) return '';
  if (typeof data === 'string') return data;
  if (data instanceof ArrayBuffer) return `[ArrayBuffer ${data.byteLength} bytes]`;
  if (data instanceof Blob) return `[Blob ${data.size} bytes]`;
  try {
    return JSON.stringify(data, null, 2);
  } catch {
    return String(data);
  }
}

/**
 * Convert Blob or other possible message types to text for display.
 */
async function toDisplayText(data) {
  if (typeof data === 'string') return data;
  if (data instanceof Blob) {
    try {
      return await data.text();
    } catch {
      return stringifyPayload(data);
    }
  }
  if (data instanceof ArrayBuffer) {
    try {
      const dec = new TextDecoder('utf-8', { fatal: false });
      return dec.decode(data);
    } catch {
      return stringifyPayload(data);
    }
  }
  return stringifyPayload(data);
}

/**
 * Render a small colored dot for status
 */
function StatusDot({ status }) {
  const color =
    status === 'connected' ? 'var(--color-success)' :
    status === 'connecting' ? 'var(--color-warning)' :
    'var(--color-muted)';
  return <span className="status-dot" style={{ backgroundColor: color }} aria-hidden="true" />;
}

// PUBLIC_INTERFACE
export default function App() {
  /**
   * This is the main WebSocket Tester application.
   * It provides:
   * - URL input and Connect/Disconnect controls
   * - Custom headers (via query params due to browser limitation) and subprotocols
   * - Message input/send
   * - Scrollable event/message log with copy/clear actions
   * - Connection status indicator
   */

  const [url, setUrl] = useState('wss://echo.websocket.events');
  const [connectionStatus, setConnectionStatus] = useState('disconnected'); // 'disconnected' | 'connecting' | 'connected'
  const [message, setMessage] = useState('');
  const [logs, setLogs] = useState(() => []);
  const [autoScroll, setAutoScroll] = useState(true);

  // Headers management
  const [headers, setHeaders] = useState([{ id: 1, key: '', value: '' }]);
  const [attachHeadersAsQuery, setAttachHeadersAsQuery] = useState(true);
  const [protocolsInput, setProtocolsInput] = useState('');

  const socketRef = useRef(null);
  const logEndRef = useRef(null);
  const nextHeaderIdRef = useRef(2);

  const parsedProtocols = useMemo(
    () => protocolsInput
      .split(',')
      .map(s => s.trim())
      .filter(Boolean),
    [protocolsInput]
  );

  useEffect(() => {
    if (autoScroll && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll]);

  const addLog = (entry) => {
    setLogs(prev => [
      ...prev,
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        time: new Date(),
        ...entry
      }
    ]);
  };

  // PUBLIC_INTERFACE
  const connect = () => {
    /**
     * Connect to the provided WebSocket URL using optional subprotocols.
     * Due to browser limitations, custom headers are optionally appended as query parameters.
     */
    if (connectionStatus === 'connected' || connectionStatus === 'connecting') return;

    let targetUrl = normalizeWsUrl(url.trim());
    if (!targetUrl) {
      addLog({ type: 'error', direction: 'system', text: 'Please enter a valid WebSocket URL.' });
      return;
    }

    // Append headers as query string if enabled
    const filteredHeaders = headers.filter(h => h.key && h.value);
    if (attachHeadersAsQuery && filteredHeaders.length > 0) {
      targetUrl = buildUrlWithParams(targetUrl, filteredHeaders);
    }

    try {
      setConnectionStatus('connecting');
      addLog({ type: 'event', direction: 'system', text: `Connecting to ${targetUrl} ...` });

      const ws = parsedProtocols.length > 0 ? new WebSocket(targetUrl, parsedProtocols) : new WebSocket(targetUrl);
      socketRef.current = ws;

      ws.onopen = () => {
        setConnectionStatus('connected');
        addLog({ type: 'open', direction: 'system', text: `Connected to ${targetUrl}` });
      };

      ws.onmessage = async (event) => {
        const text = await toDisplayText(event.data);
        addLog({ type: 'message', direction: 'in', text });
      };

      ws.onerror = () => {
        addLog({ type: 'error', direction: 'system', text: 'WebSocket encountered an error.' });
      };

      ws.onclose = (e) => {
        setConnectionStatus('disconnected');
        let reason = 'Connection closed';
        if (e && typeof e.code !== 'undefined') {
          reason = `Closed (code=${e.code}${e.reason ? `, reason=${e.reason}` : ''})`;
        }
        addLog({ type: 'close', direction: 'system', text: reason });
        socketRef.current = null;
      };
    } catch (err) {
      setConnectionStatus('disconnected');
      addLog({ type: 'error', direction: 'system', text: `Failed to connect: ${err?.message || err}` });
      socketRef.current = null;
    }
  };

  // PUBLIC_INTERFACE
  const disconnect = () => {
    /**
     * Disconnect from current WebSocket session if open.
     */
    if (socketRef.current && (connectionStatus === 'connected' || connectionStatus === 'connecting')) {
      socketRef.current.close(1000, 'Client disconnect');
      // onclose handler will update status and log
    }
  };

  // PUBLIC_INTERFACE
  const sendMessage = () => {
    /**
     * Send a message through the open WebSocket connection.
     */
    if (!socketRef.current || connectionStatus !== 'connected') {
      addLog({ type: 'error', direction: 'system', text: 'Not connected. Connect first before sending messages.' });
      return;
    }
    const trimmed = message;
    try {
      socketRef.current.send(trimmed);
      addLog({ type: 'message', direction: 'out', text: trimmed });
      // Keep input for convenience; uncomment to clear:
      // setMessage('');
    } catch (err) {
      addLog({ type: 'error', direction: 'system', text: `Send failed: ${err?.message || err}` });
    }
  };

  // PUBLIC_INTERFACE
  const copyLogs = async () => {
    /**
     * Copy the current message/event log to clipboard as plain text.
     */
    const text = logs.map(l => {
      const ts = formatTime(l.time);
      const dir = l.direction === 'out' ? '→' : l.direction === 'in' ? '←' : '•';
      const type = (l.type || 'log').toUpperCase();
      return `[${ts}] ${dir} ${type} ${l.text}`;
    }).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      addLog({ type: 'event', direction: 'system', text: 'Logs copied to clipboard.' });
    } catch {
      addLog({ type: 'error', direction: 'system', text: 'Failed to copy logs. Permissions denied?' });
    }
  };

  // PUBLIC_INTERFACE
  const clearLogs = () => {
    /**
     * Clear the current log entries.
     */
    setLogs([]);
  };

  const onKeyDownMessage = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const addHeaderRow = () => {
    setHeaders(prev => [...prev, { id: nextHeaderIdRef.current++, key: '', value: '' }]);
  };

  const removeHeaderRow = (id) => {
    setHeaders(prev => prev.length > 1 ? prev.filter(h => h.id !== id) : prev);
  };

  const changeHeaderKey = (id, val) => {
    setHeaders(prev => prev.map(h => h.id === id ? { ...h, key: val } : h));
  };

  const changeHeaderValue = (id, val) => {
    setHeaders(prev => prev.map(h => h.id === id ? { ...h, value: val } : h));
  };

  const isConnected = connectionStatus === 'connected';
  const isConnecting = connectionStatus === 'connecting';

  return (
    <div className="ws-app">
      <header className="ws-header">
        <div className="title-row">
          <h1 className="app-title">WebSocket Tester</h1>
          <div className="status">
            <StatusDot status={connectionStatus} />
            <span className="status-text">
              {connectionStatus.charAt(0).toUpperCase() + connectionStatus.slice(1)}
            </span>
          </div>
        </div>

        <div className="connect-row">
          <input
            className="url-input"
            type="text"
            placeholder="ws://localhost:8080 or wss://echo.websocket.events"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={isConnected || isConnecting}
            aria-label="WebSocket URL"
          />
          {isConnected ? (
            <button className="btn btn-danger" onClick={disconnect} aria-label="Disconnect">
              Disconnect
            </button>
          ) : (
            <button className="btn btn-primary" onClick={connect} disabled={isConnecting} aria-label="Connect">
              {isConnecting ? 'Connecting…' : 'Connect'}
            </button>
          )}
        </div>

        <details className="advanced" open={false}>
          <summary>Advanced options</summary>

          <div className="advanced-grid">
            <div className="headers-section">
              <div className="section-title">Custom headers</div>
              <div className="note">
                Note: Browsers do not allow setting arbitrary WebSocket request headers.
                As a workaround, these are appended as query parameters during connection.
              </div>
              <div className="headers-list">
                {headers.map((h) => (
                  <div className="header-row" key={h.id}>
                    <input
                      className="input"
                      placeholder="Header key (e.g. Authorization)"
                      value={h.key}
                      onChange={(e) => changeHeaderKey(h.id, e.target.value)}
                      disabled={isConnected || isConnecting}
                    />
                    <input
                      className="input"
                      placeholder="Header value"
                      value={h.value}
                      onChange={(e) => changeHeaderValue(h.id, e.target.value)}
                      disabled={isConnected || isConnecting}
                    />
                    <button
                      className="icon-btn"
                      onClick={() => removeHeaderRow(h.id)}
                      title="Remove header"
                      disabled={isConnected || isConnecting || headers.length === 1}
                      aria-label="Remove header"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
              <div className="headers-actions">
                <button
                  className="btn btn-secondary"
                  onClick={addHeaderRow}
                  disabled={isConnected || isConnecting}
                >
                  + Add header
                </button>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={attachHeadersAsQuery}
                    onChange={(e) => setAttachHeadersAsQuery(e.target.checked)}
                    disabled={isConnected || isConnecting}
                  />
                  Append as query parameters
                </label>
              </div>
            </div>

            <div className="protocols-section">
              <div className="section-title">Subprotocols</div>
              <div className="note">
                Optional, comma-separated. E.g. json, protobuf
              </div>
              <input
                className="input"
                placeholder="json, my-protocol, v2"
                value={protocolsInput}
                onChange={(e) => setProtocolsInput(e.target.value)}
                disabled={isConnected || isConnecting}
                aria-label="Subprotocols"
              />
            </div>
          </div>
        </details>
      </header>

      <main className="ws-main">
        <div className="log-toolbar">
          <div className="toolbar-left">
            <button className="btn btn-outline" onClick={copyLogs}>Copy logs</button>
            <button className="btn btn-outline" onClick={clearLogs}>Clear</button>
          </div>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
            />
            Auto-scroll
          </label>
        </div>

        <div className="log-panel" role="log" aria-live="polite">
          {logs.length === 0 ? (
            <div className="empty-log">
              No events yet. Connect to a WebSocket server to begin.
            </div>
          ) : (
            logs.map(entry => (
              <div
                key={entry.id}
                className={[
                  'log-entry',
                  `type-${entry.type}`,
                  entry.direction ? `dir-${entry.direction}` : 'dir-system'
                ].join(' ')}
              >
                <div className="log-meta">
                  <span className="log-time">{formatTime(entry.time)}</span>
                  <span className="log-kind">
                    {entry.direction === 'out' ? '→ Sent' :
                      entry.direction === 'in' ? '← Received' :
                        (entry.type || 'event').toUpperCase()}
                  </span>
                </div>
                <pre className="log-text">{entry.text}</pre>
              </div>
            ))
          )}
          <div ref={logEndRef} />
        </div>
      </main>

      <footer className="ws-footer">
        <textarea
          className="msg-input"
          placeholder="Type a message... (Enter to send, Shift+Enter for newline)"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={onKeyDownMessage}
          rows={3}
          aria-label="Message"
        />
        <button className="btn btn-accent" onClick={sendMessage} disabled={!isConnected}>
          Send
        </button>
      </footer>
    </div>
  );
}
