'use client';

import { useEffect, useRef, useState } from 'react';

type PageState = 'ready' | 'waiting' | 'checking' | 'verified' | 'failed' | 'expired';

interface VerificationResult {
  valid: boolean;
  reasons?: string[];
  claims?: Record<string, unknown>;
  issuer?: string;
  verifiedAt: string;
}

interface StatusPayload {
  status: 'ACTIVE' | 'VP_SUBMITTED' | 'VERIFIED' | 'FAILED' | 'EXPIRED';
  expiresAt: string;
  verificationResult?: VerificationResult;
}

interface SessionResponse {
  session: {
    id: string;
    expiresAt: string;
  };
  qrDataUrl: string;
}

const initialDetails = {
  bookingReference: '-',
  passengerName: '-',
  passengerShortName: '-',
  flightNumber: '-',
  destination: 'SIN / Singapore',
  departure: '-',
  originCode: 'CMB',
  destinationCode: 'SIN'
};

function PhoneIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="7" y="2.8" width="10" height="18.4" rx="2" />
      <path d="M11.8 18h.4" />
    </svg>
  );
}

function PlaneIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3.4 12.8 21 4.2l-8.6 17.4-2.2-7.8-6.8-1Z" />
      <path d="m10.2 13.8 4.4-4.4" />
    </svg>
  );
}

function toUpperTrim(value: string) {
  if (!value) {
    return '-';
  }
  return value.trim().toUpperCase();
}

function readPath(source: unknown, path: string[]) {
  if (!source || typeof source !== 'object') {
    return undefined;
  }

  let current = source as Record<string, unknown>;
  for (const key of path) {
    if (!current || typeof current !== 'object' || !(key in current)) {
      return undefined;
    }
    current = current[key] as Record<string, unknown>;
  }
  return current;
}

function firstDefined(values: unknown[]) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

function formatClock(date: Date) {
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function formatExpiry(expiresAtMs: number | null) {
  if (!expiresAtMs) {
    return '--:--';
  }

  const remainingSeconds = Math.max(0, Math.ceil((expiresAtMs - Date.now()) / 1000));
  if (remainingSeconds <= 0) {
    return 'expired';
  }

  const minutes = String(Math.floor(remainingSeconds / 60)).padStart(2, '0');
  const seconds = String(remainingSeconds % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function destinationName(code: string) {
  const normalized = code.toUpperCase();
  if (normalized === 'SIN') {
    return 'SIN / Singapore';
  }
  if (normalized === 'CMB') {
    return 'CMB / Colombo';
  }
  return normalized;
}

function cityName(code: string) {
  const normalized = code.toUpperCase();
  if (normalized === 'SIN') {
    return 'Singapore';
  }
  if (normalized === 'CMB') {
    return 'Colombo';
  }
  return normalized;
}

function displayDeparture(value: unknown) {
  if (!value) {
    return '-';
  }

  const text = String(value);
  const parsed = Date.parse(text);
  if (!Number.isNaN(parsed)) {
    return new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).format(new Date(parsed));
  }

  const timeMatch = text.match(/\b([01]?\d|2[0-3]):[0-5]\d\b/);
  return timeMatch ? timeMatch[0] : text;
}

function mapClaimsToDetails(claims: Record<string, unknown>) {
  const bookingReference = firstDefined([
    readPath(claims, ['booking_reference']),
    readPath(claims, ['pnr']),
    readPath(claims, ['reservation_code']),
    readPath(claims, ['work_id'])
  ]);

  const givenName = firstDefined([
    readPath(claims, ['given_name']),
    readPath(claims, ['first_name']),
    readPath(claims, ['passenger', 'given_name'])
  ]);

  const familyName = firstDefined([
    readPath(claims, ['family_name']),
    readPath(claims, ['last_name']),
    readPath(claims, ['passenger', 'family_name'])
  ]);

  const flightNumber = firstDefined([
    readPath(claims, ['flight_number']),
    readPath(claims, ['flight', 'number'])
  ]);

  const departureAirport = firstDefined([
    readPath(claims, ['departure_airport']),
    readPath(claims, ['flight', 'from'])
  ]);

  const arrivalAirport = firstDefined([
    readPath(claims, ['arrival_airport']),
    readPath(claims, ['flight', 'to'])
  ]);

  const departureTime = firstDefined([
    readPath(claims, ['departure_time']),
    readPath(claims, ['flight', 'departure_time'])
  ]);

  const family = toUpperTrim(String(familyName || ''));
  const given = toUpperTrim(String(givenName || ''));
  const passengerName = [family, given].filter((part) => part && part !== '-').join(' / ') || '-';
  const passengerShortName =
    family && family !== '-'
      ? `${given && given !== '-' ? `${given[0]}. ` : ''}${family}`
      : passengerName;
  const destinationCode = toUpperTrim(String(arrivalAirport || 'SIN'));

  return {
    bookingReference: toUpperTrim(String(bookingReference || '-')),
    passengerName,
    passengerShortName,
    flightNumber: toUpperTrim(String(flightNumber || '-')),
    destination: destinationName(destinationCode),
    departure: displayDeparture(departureTime),
    originCode: toUpperTrim(String(departureAirport || 'CMB')),
    destinationCode
  };
}

export default function Home() {
  const [pageState, setPageState] = useState<PageState>('ready');
  const [clock, setClock] = useState('--:--:--');
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [expiresAtMs, setExpiresAtMs] = useState<number | null>(null);
  const [expiryText, setExpiryText] = useState('--:--');
  const [details, setDetails] = useState(initialDetails);
  const [isCreating, setIsCreating] = useState(false);
  const pollHandle = useRef<ReturnType<typeof setInterval> | null>(null);
  const finalTransitionHandle = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopPolling = () => {
    if (pollHandle.current) {
      clearInterval(pollHandle.current);
      pollHandle.current = null;
    }
  };

  const clearFinalTransition = () => {
    if (finalTransitionHandle.current) {
      clearTimeout(finalTransitionHandle.current);
      finalTransitionHandle.current = null;
    }
  };

  const setExpiry = (value?: string) => {
    if (!value) {
      setExpiresAtMs(null);
      setExpiryText('--:--');
      return;
    }

    const parsed = Date.parse(value);
    if (Number.isNaN(parsed)) {
      setExpiresAtMs(null);
      setExpiryText('--:--');
      return;
    }

    setExpiresAtMs(parsed);
    setExpiryText(formatExpiry(parsed));
  };

  const resetSession = () => {
    stopPolling();
    clearFinalTransition();
    setPageState('ready');
    setActiveRequestId(null);
    setQrDataUrl('');
    setDetails(initialDetails);
    setExpiry();
    setIsCreating(false);
  };

  const showVerifiedAfterValidation = (claims: Record<string, unknown>) => {
    clearFinalTransition();
    setPageState('checking');
    finalTransitionHandle.current = setTimeout(() => {
      setDetails(mapClaimsToDetails(claims));
      setPageState('verified');
      finalTransitionHandle.current = null;
    }, 1500);
  };

  const renderLifecycle = (statusPayload: StatusPayload) => {
    setExpiry(statusPayload.expiresAt);

    if (statusPayload.status === 'ACTIVE') {
      setPageState('waiting');
      return false;
    }

    if (statusPayload.status === 'VP_SUBMITTED') {
      setPageState('checking');
      return false;
    }

    if (statusPayload.status === 'VERIFIED') {
      showVerifiedAfterValidation(statusPayload.verificationResult?.claims || {});
      return true;
    }

    if (statusPayload.status === 'FAILED') {
      setPageState('failed');
      return true;
    }

    if (statusPayload.status === 'EXPIRED') {
      setPageState('expired');
      return true;
    }

    setPageState('failed');
    return true;
  };

  const pollStatus = async (requestId: string) => {
    const response = await fetch(`/openid4vp/authorization-request/${encodeURIComponent(requestId)}/status`);
    if (!response.ok) {
      setPageState('failed');
      stopPolling();
      return;
    }

    const statusPayload = (await response.json()) as StatusPayload;
    const shouldStop = renderLifecycle(statusPayload);
    if (shouldStop) {
      stopPolling();
    }
  };

  const createRequest = async () => {
    setIsCreating(true);
    stopPolling();
    clearFinalTransition();
    setActiveRequestId(null);
    setQrDataUrl('');
    setDetails(initialDetails);
    setExpiry();
    setPageState('waiting');

    try {
      const response = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });

      if (!response.ok) {
        setPageState('failed');
        return;
      }

      const payload = (await response.json()) as SessionResponse;
      setActiveRequestId(payload.session.id);
      setQrDataUrl(payload.qrDataUrl);
      setExpiry(payload.session.expiresAt);
      setPageState('waiting');

      pollHandle.current = setInterval(() => {
        void pollStatus(payload.session.id);
      }, 2500);
    } catch {
      setPageState('failed');
    } finally {
      setIsCreating(false);
    }
  };

  useEffect(() => {
    const tick = () => {
      setClock(formatClock(new Date()));
      setExpiryText(formatExpiry(expiresAtMs));
    };

    tick();
    const handle = setInterval(tick, 1000);
    return () => clearInterval(handle);
  }, [expiresAtMs]);

  useEffect(() => () => {
    stopPolling();
    clearFinalTransition();
  }, []);

  const isScanPhase = pageState === 'waiting';
  const isValidating = pageState === 'checking';
  const isComplete = pageState === 'verified';
  const isRecoverableError = pageState === 'failed' || pageState === 'expired';
  const destinationText = `${cityName(details.originCode)} (${details.originCode}) to ${cityName(details.destinationCode)} (${details.destinationCode})`;

  return (
    <main className="kiosk-shell">
      <section className="kiosk" data-state={pageState}>
        <header className="kiosk-header">
          <div className="kiosk-route">
            <span>Terminal 2 / Check-in</span>
            <span className="divider" />
            <span>{destinationText}</span>
          </div>
          <time className="kiosk-clock">{clock}</time>
        </header>

        <div className="kiosk-main">
          <aside className="scanner-rail">
            {pageState === 'ready' ? (
              <div className="rail-panel enter-panel">
                <div className="microcopy green">Welcome to SkyLink</div>
                <h1>Fast Track<br />Check-in</h1>
                <button className="start-btn" onClick={createRequest} disabled={isCreating}>
                  {isCreating ? 'Preparing...' : 'Start Check-in'}
                </button>
              </div>
            ) : null}

            {isScanPhase || isValidating ? (
              <div className="rail-panel scan-panel">
                <div className={`qr-card ${isValidating ? 'qr-card-muted' : ''}`}>
                  {qrDataUrl ? (
                    <img id="wallet-qr" src={qrDataUrl} alt="Check-in scan code" />
                  ) : (
                    <div className="qr-placeholder">Preparing</div>
                  )}
                  {isValidating ? <div className="qr-overlay"><span /></div> : null}
                </div>

                <div className="rail-separator" />
                <div className="rail-status">
                  <div className={isValidating ? 'microcopy amber pulse-text' : 'microcopy green'}>
                    {isValidating ? 'Verifying Booking...' : 'Scan Code'}
                  </div>
                  <p>{isValidating ? 'Processing securely' : `Session expires in ${expiryText}`}</p>
                </div>
              </div>
            ) : null}

            {isComplete ? (
              <div className="rail-panel complete-panel">
                <div className="round-icon"><PlaneIcon /></div>
                <div className="microcopy green">Verification Complete</div>
                <p>Your booking has been securely matched against the passenger manifest.</p>
                <button className="ghost-btn" onClick={resetSession}>Start Over</button>
              </div>
            ) : null}

            {isRecoverableError ? (
              <div className="rail-panel complete-panel">
                <div className="round-icon warning-mark">!</div>
                <div className="microcopy amber">{pageState === 'expired' ? 'Session Expired' : 'Booking Not Found'}</div>
                <p>{pageState === 'expired' ? 'Start again to get a fresh code.' : 'Please try again or ask an agent for help.'}</p>
                <button className="ghost-btn" onClick={resetSession}>Start Over</button>
              </div>
            ) : null}
          </aside>

          <section className="story-stage">
            {pageState === 'ready' ? (
              <div className="stage-panel idle-stage">
                <PlaneIcon />
                <h2>SkyLink<br />Secure</h2>
              </div>
            ) : null}

            {isScanPhase ? (
              <div className="stage-panel instruction-stage">
                <h2>Submit your Digital Pass</h2>
                <p>Open your digital wallet and scan the generated code to verify your booking.</p>
              </div>
            ) : null}

            {isValidating ? (
              <div className="stage-panel validating-stage">
                <div className="validation-spinner" />
                <h2>Validating...</h2>
                <p>Checking passenger and flight details</p>
              </div>
            ) : null}

            {isComplete ? (
              <div className="stage-panel verified-stage">
                <div>
                  <div className="field-label">Passenger Name</div>
                  <h2>{details.passengerShortName}</h2>

                  <div className="manifest-grid">
                    <div>
                      <div className="field-label">Flight</div>
                      <div className="field-value mono">{details.flightNumber}</div>
                    </div>
                    <div>
                      <div className="field-label">Destination</div>
                      <div className="field-value">{details.destination}</div>
                    </div>
                    <div>
                      <div className="field-label">Departure</div>
                      <div className="departure-time mono">{details.departure}</div>
                    </div>
                    <div>
                      <div className="field-label">Booking Ref</div>
                      <div className="field-value mono green-text">{details.bookingReference}</div>
                    </div>
                  </div>
                </div>

                <div className="terminal-status">
                  <div>
                    <div className="status-kicker">Terminal Status</div>
                    <div className="status-title">Boarding Verified</div>
                  </div>
                  <div className="status-diamond"><span /></div>
                </div>
              </div>
            ) : null}

            {isRecoverableError ? (
              <div className="stage-panel validating-stage">
                <div className="validation-spinner danger-spinner" />
                <h2>{pageState === 'expired' ? 'Session Expired' : 'Try Again'}</h2>
                <p>{pageState === 'expired' ? 'Start again to get a fresh check-in code.' : 'We could not match this booking.'}</p>
              </div>
            ) : null}
          </section>
        </div>

        <footer className="kiosk-footer">
          <div className="footer-actions">
            <button onClick={resetSession}>F1: Reset Session</button>
            {isComplete ? <button className="seat-action">F2: Choose Seat <span>-&gt;</span></button> : null}
          </div>
          <div>System Secure • v4.8.2</div>
        </footer>
      </section>
    </main>
  );
}
