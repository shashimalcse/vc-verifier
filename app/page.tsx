'use client';

import { useEffect, useRef, useState } from 'react';

type PageState = 'ready' | 'waiting' | 'checking' | 'verified' | 'failed' | 'expired';
type StatusMode = 'pending' | 'ok' | 'bad';

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
  flightRoute: '-',
  departure: '-',
  originCode: 'CMB',
  destinationCode: 'SIN'
};

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

function formatExpiry(expiresAtMs: number | null) {
  if (!expiresAtMs) {
    return '-';
  }

  const remainingSeconds = Math.max(0, Math.ceil((expiresAtMs - Date.now()) / 1000));
  if (remainingSeconds <= 0) {
    return 'Expired';
  }

  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = String(remainingSeconds % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
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

  const passengerName =
    [toUpperTrim(String(familyName || '')), toUpperTrim(String(givenName || ''))]
      .filter((part) => part && part !== '-')
      .join(' / ') || '-';

  const flightDisplayParts = [];
  if (flightNumber) {
    flightDisplayParts.push(toUpperTrim(String(flightNumber)));
  }
  if (departureAirport || arrivalAirport) {
    flightDisplayParts.push(
      `${toUpperTrim(String(departureAirport || '?'))} -> ${toUpperTrim(String(arrivalAirport || '?'))}`
    );
  }

  return {
    bookingReference: toUpperTrim(String(bookingReference || '-')),
    passengerName,
    flightRoute: flightDisplayParts.join(' | ') || '-',
    departure: departureTime ? String(departureTime) : '-',
    originCode: toUpperTrim(String(departureAirport || 'CMB')),
    destinationCode: toUpperTrim(String(arrivalAirport || 'SIN'))
  };
}

export default function Home() {
  const [pageState, setPageState] = useState<PageState>('ready');
  const [clock, setClock] = useState('--:--');
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [expiresAtMs, setExpiresAtMs] = useState<number | null>(null);
  const [expiryText, setExpiryText] = useState('-');
  const [statusText, setStatusText] = useState('Ready when you are.');
  const [statusMode, setStatusMode] = useState<StatusMode>('pending');
  const [helpText, setHelpText] = useState('-');
  const [scanTitle, setScanTitle] = useState('Scan to find your booking');
  const [scanCopy, setScanCopy] = useState(
    'Open your travel wallet and scan to check in without typing your booking reference.'
  );
  const [verifyTitle, setVerifyTitle] = useState('Ready for check-in');
  const [verifySubtitle, setVerifySubtitle] = useState('Scan to find your booking.');
  const [details, setDetails] = useState(initialDetails);
  const [isCreating, setIsCreating] = useState(false);
  const pollHandle = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = () => {
    if (pollHandle.current) {
      clearInterval(pollHandle.current);
      pollHandle.current = null;
    }
  };

  const setExpiry = (value?: string) => {
    if (!value) {
      setExpiresAtMs(null);
      setExpiryText('-');
      return;
    }

    const parsed = Date.parse(value);
    if (Number.isNaN(parsed)) {
      setExpiresAtMs(null);
      setExpiryText('-');
      return;
    }

    setExpiresAtMs(parsed);
    setExpiryText(formatExpiry(parsed));
  };

  const setStatus = (text: string, mode: StatusMode = 'pending') => {
    setStatusText(text);
    setStatusMode(mode);
  };

  const resetBookingView = () => {
    setPageState('ready');
    setQrDataUrl('');
    setScanTitle('Scan to find your booking');
    setScanCopy('Open your travel wallet and scan to check in without typing your booking reference.');
    setVerifyTitle('Ready for check-in');
    setVerifySubtitle('Scan to find your booking.');
    setDetails(initialDetails);
    setExpiry();
    setHelpText('-');
  };

  const renderLifecycle = (statusPayload: StatusPayload) => {
    setExpiry(statusPayload.expiresAt);
    setHelpText('-');

    if (statusPayload.status === 'ACTIVE') {
      setPageState('waiting');
      setScanTitle('Scan to find your booking');
      setScanCopy('Hold your phone camera over this code. We will find your trip automatically.');
      setVerifyTitle('Waiting for passenger');
      setVerifySubtitle('Scan to find your booking.');
      setStatus('Waiting for scan...', 'pending');
      return false;
    }

    if (statusPayload.status === 'VP_SUBMITTED') {
      setPageState('checking');
      setScanTitle('Booking received');
      setScanCopy('Keep this screen open while we check your flight details.');
      setVerifyTitle('Booking found');
      setVerifySubtitle('Checking flight details...');
      setStatus('Booking found. Checking flight details...', 'pending');
      return false;
    }

    if (statusPayload.status === 'VERIFIED') {
      setPageState('verified');
      setScanTitle('Ready to continue');
      setScanCopy('Your booking is matched. Continue to seat selection when ready.');
      setStatus('Booking matched.', 'ok');
      setVerifyTitle('Booking verified');
      const claims = statusPayload.verificationResult?.claims || {};
      const displayName = firstDefined([
        readPath(claims, ['family_name']),
        readPath(claims, ['last_name']),
        readPath(claims, ['given_name'])
      ]);
      setVerifySubtitle(displayName ? `Welcome aboard, ${displayName}.` : 'Welcome aboard.');
      setDetails(mapClaimsToDetails(claims));
      setHelpText('-');
      return true;
    }

    if (statusPayload.status === 'FAILED') {
      setPageState('failed');
      setScanTitle('Try another scan');
      setScanCopy('Use the latest check-in code, or ask an agent if your booking still cannot be found.');
      setStatus('We could not match this booking.', 'bad');
      setVerifyTitle('We could not match this booking');
      setVerifySubtitle('Please try again or ask an agent for help.');
      setHelpText('Try again or ask an agent for help.');
      return true;
    }

    if (statusPayload.status === 'EXPIRED') {
      setPageState('expired');
      setScanTitle('Code expired');
      setScanCopy('Start again to get a fresh check-in code.');
      setStatus('This check-in session expired.', 'bad');
      setVerifyTitle('Session expired');
      setVerifySubtitle('Start again to get a fresh code.');
      setHelpText('Start again to get a fresh code.');
      return true;
    }

    setPageState('failed');
    setStatus('Something went wrong. Please start again.', 'bad');
    setHelpText('Start again or ask an agent for help.');
    return true;
  };

  const pollStatus = async (requestId: string) => {
    const response = await fetch(`/openid4vp/authorization-request/${encodeURIComponent(requestId)}/status`);
    if (!response.ok) {
      setPageState('failed');
      setStatus('Status lookup failed.', 'bad');
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
    setActiveRequestId(null);
    resetBookingView();
    setPageState('waiting');
    setScanTitle('Preparing your code');
    setScanCopy('A fresh check-in code will appear here in a moment.');
    setStatus('Preparing your check-in code...', 'pending');

    try {
      const response = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });

      if (!response.ok) {
        setPageState('failed');
        setStatus('Could not start check-in.', 'bad');
        setHelpText('Please try again or ask an agent for help.');
        return;
      }

      const payload = (await response.json()) as SessionResponse;
      setActiveRequestId(payload.session.id);
      setQrDataUrl(payload.qrDataUrl);
      setExpiry(payload.session.expiresAt);
      setScanTitle('Scan to find your booking');
      setScanCopy('Hold your phone camera over this code. We will find your trip automatically.');
      setStatus('Waiting for scan...', 'pending');

      pollHandle.current = setInterval(() => {
        void pollStatus(payload.session.id);
      }, 2500);
    } catch {
      setPageState('failed');
      setStatus('Could not start check-in.', 'bad');
      setHelpText('Please try again or ask an agent for help.');
    } finally {
      setIsCreating(false);
    }
  };

  useEffect(() => {
    const tick = () => {
      const now = new Date();
      const hh = String(now.getHours()).padStart(2, '0');
      const mm = String(now.getMinutes()).padStart(2, '0');
      setClock(`${hh}:${mm}`);
      setExpiryText(formatExpiry(expiresAtMs));
    };

    tick();
    const handle = setInterval(tick, 1000);
    return () => clearInterval(handle);
  }, [expiresAtMs]);

  useEffect(() => () => stopPolling(), []);

  const actionsEnabled = pageState === 'verified';

  return (
    <main className="shell">
      <div className="app" data-state={pageState} data-has-qr={qrDataUrl ? 'true' : 'false'}>
        <div className="topbar">
          <div className="brand">
            <div className="logo"><span /></div>
            <div>
              <h1>SkyLink Self Check-in</h1>
              <p>Fast passenger check-in</p>
            </div>
          </div>
          <div className="top-meta">
            <div className="terminal-pill">Terminal 2</div>
            <div className="clock">{clock}</div>
          </div>
        </div>

        <div className="main">
          <div className="layout">
            <section className="panel scan">
              <p className="eyebrow">Step 1</p>
              <h2>{scanTitle}</h2>
              <p>{scanCopy}</p>

              <div className="scanner-stage">
                <div className="scanner-frame">
                  <div className="scanner-placeholder">
                    <div className="scan-glyph"><span /></div>
                    <div>Tap start to show your check-in code.</div>
                  </div>
                  {qrDataUrl ? <img id="wallet-qr" src={qrDataUrl} alt="Check-in scan code" /> : null}
                </div>
              </div>

              <div className="actions">
                <button className="primary-btn" onClick={createRequest} disabled={isCreating}>
                  {activeRequestId ? 'Start over' : 'Start check-in'}
                </button>
                <div className={`status ${statusMode}`}>{statusText}</div>
                <div className="meta-grid">
                  <div className="meta-line"><strong>Code expires</strong><span>{expiryText}</span></div>
                  <div className="meta-line"><strong>Help</strong><span>{helpText}</span></div>
                </div>
              </div>
            </section>

            <section className="panel result">
              <div className="journey-strip">
                <div className="airport-code">{details.originCode}</div>
                <div className="route-line" aria-hidden="true" />
                <div className="airport-code">{details.destinationCode}</div>
              </div>
              <div className="verified-icon"><span /></div>
              <div className="headline">
                <h2>{verifyTitle}</h2>
                <p>{verifySubtitle}</p>
              </div>

              <div className="details">
                <div className="row">
                  <div className="label">Booking reference</div>
                  <div className="value">{details.bookingReference}</div>
                </div>
                <div className="row">
                  <div className="label">Passenger</div>
                  <div className="value">{details.passengerName}</div>
                </div>
                <div className="row">
                  <div className="label">Flight</div>
                  <div className="value">{details.flightRoute}</div>
                </div>
                <div className="row">
                  <div className="label">Departure</div>
                  <div className="value">{details.departure}</div>
                </div>
              </div>

              <div className="footer-actions">
                <button className="outline-btn" disabled={!actionsEnabled}>Choose seat</button>
                <button className="outline-btn" disabled={!actionsEnabled}>-&gt;</button>
              </div>
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}
