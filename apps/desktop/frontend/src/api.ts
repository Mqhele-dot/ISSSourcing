export const API_BASE = (window as any).__SCT_API_BASE__ ?? 'http://127.0.0.1:8000';

export async function fetchHealth(): Promise<{ status: string; service: string }> {
  const res = await fetch(`${API_BASE}/health`);
  if (!res.ok) throw new Error(`health failed: ${res.status}`);
  return res.json();
}
