import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { addCaseComment, assignException, ExceptionDetail, fetchExceptionDetail, updateExceptionStatus } from '../api';
import { LoginPrompt } from './common';

export function ExceptionDetailPage() {
  const { exception_id = '' } = useParams();
  const [detail, setDetail] = useState<ExceptionDetail | null>(null);
  const [assignee, setAssignee] = useState('ops');
  const [status, setStatus] = useState('investigating');
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  const onAssign = async () => {
    if (!detail) return;
    await assignException(detail.id, assignee);
    setLoading(true);
    await load();
  };

  const onStatus = async () => {
    if (!detail) return;
    await updateExceptionStatus(detail.id, status);
    setLoading(true);
    await load();
  };

  const onComment = async () => {
    if (!detail || !comment.trim()) return;
    await addCaseComment(detail.id, comment);
    setComment('');
    setLoading(true);
    await load();
  };

  if (loading) return <p>Loading…</p>;
  if (error) return <>{error === 'Not logged in' ? <LoginPrompt /> : <p>Error: {error}</p>}</>;
  if (!detail) return <p>No exception found</p>;

  return (
    <div>
      <h3>Exception #{detail.id}</h3>
      <p><strong>{detail.type}</strong> ({detail.severity}) - {detail.status}</p>
      <p>Source: {detail.source}</p>
      <p>Reason: {detail.reason ?? 'n/a'}</p>
      <h4>Actions</h4>
      <div>
        <input value={assignee} onChange={(e) => setAssignee(e.target.value)} />
        <button onClick={onAssign}>Assign</button>
      </div>
      <div>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="open">open</option>
          <option value="investigating">investigating</option>
          <option value="resolved">resolved</option>
        </select>
        <button onClick={onStatus}>Update status</button>
      </div>
      <div>
        <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Add comment" />
        <button onClick={onComment}>Comment</button>
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
