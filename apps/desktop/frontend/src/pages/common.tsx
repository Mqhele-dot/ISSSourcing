import { useState } from 'react';
import { Link } from 'react-router-dom';
import { resetDemoData } from '../api';

export function LoginPrompt() {
  return <p>Not logged in. <Link to="/login">Go to login</Link></p>;
}

export function LoadDemoDataButton({ onLoaded }: { onLoaded: () => void }) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const run = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const resp = await resetDemoData();
      setMessage(`${resp.message} (canonical: ${resp.seeded.canonical}, exceptions: ${resp.seeded.exceptions}, movements: ${resp.seeded.movements})`);
      onLoaded();
    } catch (e: unknown) {
      setMessage(e instanceof Error ? e.message : 'Failed to load demo data');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <button onClick={run} disabled={loading}>{loading ? 'Loading demo data…' : 'Load demo data'}</button>
      {message ? <p>{message}</p> : null}
    </div>
  );
}
