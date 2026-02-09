import React, { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { addCaseComment, assignException, ExceptionDetail, fetchExceptionDetail, snoozeException, updateExceptionStatus } from '../api';
import { LoginPrompt } from './common';

function hoursRemaining(slaDueAt?: string) {
  if (!slaDueAt) return null;
  const diffMs = new Date(slaDueAt).getTime() - Date.now();
  return Math.round(diffMs / (1000 * 60 * 60));
}

export function ExceptionDetailPage() {
  const { exception_id = '' } = useParams();
  const [detail, setDetail] = useState<ExceptionDetail | null>(null);
  const [assignee, setAssignee] = useState('ops');
  const [status, setStatus] = useState('investigating');
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(true);
  const [savingAssign, setSavingAssign] = useState(false);
  const [savingStatus, setSavingStatus] = useState(false);
  const [savingComment, setSavingComment] = useState(false);
  const [savingSnooze, setSavingSnooze] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);

  const load = async () => {
    const id = Number(exception_id);
    if (Number.isNaN(id) || id <= 0) {
      setError('Invalid exception id');
      setLoading(false);
      return;
    }
    try {
      const data = await fetchExceptionDetail(id);
      setDetail(data);
      setAssignee(data.assignee ?? 'ops');
      setStatus(data.status ?? 'open');
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load exception');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [exception_id]);

  const relatedLinks = useMemo(() => {
    if (!detail) return [] as JSX.Element[];
    const links: JSX.Element[] = [];
    detail.related_refs.sku.forEach((sku) => links.push(<li key={`sku-${sku}`}><Link to={`/inventory/${sku}`}>Inventory {sku}</Link></li>));
    detail.related_refs.po.forEach((po) => links.push(<li key={`po-${po}`}><Link to={`/purchase/${po}`}>Purchase {po}</Link></li>));
    detail.related_refs.shipment.forEach((shipment) => links.push(<li key={`shipment-${shipment}`}><Link to={`/logistics/${shipment}`}>Shipment {shipment}</Link></li>));
    return links;
  }, [detail]);

  const onAssign = async () => {
    if (!detail) return;
    setSavingAssign(true);
    setActionError(null);
    try {
      const updated = await assignException(detail.id, assignee);
      setDetail(updated);
      setLastSavedAt(new Date().toISOString());
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : 'Assign failed');
    } finally {
      setSavingAssign(false);
    }
  };

  const onStatus = async () => {
    if (!detail) return;
    setSavingStatus(true);
    setActionError(null);
    try {
      const updated = await updateExceptionStatus(detail.id, status);
      setDetail(updated);
      setLastSavedAt(new Date().toISOString());
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : 'Status update failed');
    } finally {
      setSavingStatus(false);
    }
  };

  const onComment = async () => {
    if (!detail || !comment.trim()) return;
    setSavingComment(true);
    setActionError(null);
    try {
      const updated = await addCaseComment(detail.id, comment);
      setDetail(updated);
      setComment('');
      setLastSavedAt(new Date().toISOString());
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : 'Comment failed');
    } finally {
      setSavingComment(false);
    }
  };

  const onSnooze = async () => {
    if (!detail) return;
    setSavingSnooze(true);
    setActionError(null);
    try {
      const updated = await snoozeException(detail.id, 8);
      setDetail(updated);
      setLastSavedAt(new Date().toISOString());
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : 'Snooze failed');
    } finally {
      setSavingSnooze(false);
    }
  };

  if (loading) return <p>Loading…</p>;
  if (error) return <>{error === 'Not logged in' ? <LoginPrompt /> : <p>Error: {error}</p>}</>;
  if (!detail) return <p>No exception found</p>;

  const slaHours = hoursRemaining(detail.sla_due_at);
  const slaColor = slaHours === null ? 'inherit' : slaHours < 0 ? 'red' : slaHours < 4 ? 'orange' : 'green';

  return (
    <div>
      <h3>Exception #{detail.id}</h3>
      <p><strong>{detail.type}</strong> ({detail.severity}) - {detail.status}</p>
      <p>Source: {detail.source}</p>
      <p>Reason: {detail.reason ?? 'n/a'}</p>
      <p style={{ color: slaColor }}>SLA remaining: {slaHours === null ? 'n/a' : `${slaHours}h`}</p>
      {lastSavedAt ? <p>Last saved: {lastSavedAt}</p> : null}
      {actionError ? <p>Error: {actionError}</p> : null}

      <h4>Related</h4>
      {relatedLinks.length === 0 ? <p>No related links</p> : <ul>{relatedLinks}</ul>}

      <h4>Actions</h4>
      <div>
        <input value={assignee} onChange={(e) => setAssignee(e.target.value)} />
        <button onClick={onAssign} disabled={savingAssign}>{savingAssign ? 'Saving…' : 'Assign'}</button>
      </div>
      <div>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="open">open</option>
          <option value="investigating">investigating</option>
          <option value="resolved">resolved</option>
          <option value="closed">closed</option>
        </select>
        <button onClick={onStatus} disabled={savingStatus}>{savingStatus ? 'Saving…' : 'Update status'}</button>
        <button onClick={onSnooze} disabled={savingSnooze}>{savingSnooze ? 'Saving…' : 'Snooze +8h'}</button>
      </div>
      <div>
        <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Add comment" />
        <button onClick={onComment} disabled={savingComment}>{savingComment ? 'Saving…' : 'Comment'}</button>
      </div>
      <h4>Comments timeline</h4>
      {detail.comments.length === 0 ? <p>No comments yet</p> : (
        <table><thead><tr><th>When</th><th>Author</th><th>Comment</th></tr></thead><tbody>
          {detail.comments.map((c) => <tr key={c.id}><td>{c.created_at}</td><td>{c.author}</td><td>{c.comment}</td></tr>)}
        </tbody></table>
      )}
    </div>
  );
}
