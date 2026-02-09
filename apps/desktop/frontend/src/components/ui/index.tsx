import React from 'react';

export const Card = ({ children }: { children: React.ReactNode }) => <section className="card">{children}</section>;

export const StatCard = ({ label, value }: { label: string; value: string | number }) => (
  <Card><div className="muted">{label}</div><div style={{ fontSize: 28, fontWeight: 700 }}>{value}</div></Card>
);

export const Badge = ({ tone = 'info', children }: { tone?: 'info' | 'success' | 'warning' | 'danger'; children: React.ReactNode }) => <span className={`badge ${tone}`}>{children}</span>;

export const Button = ({ variant = 'ghost', className = '', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' }) => (
  <button className={`btn ${variant} ${className}`} {...props} />
);

export const Input = (props: React.InputHTMLAttributes<HTMLInputElement>) => <input className="input" {...props} />;
export const Select = (props: React.SelectHTMLAttributes<HTMLSelectElement>) => <select className="select" {...props} />;

export const Table = ({ children }: { children: React.ReactNode }) => <div className="table-wrap"><table>{children}</table></div>;

export const EmptyState = ({ title, action }: { title: string; action?: React.ReactNode }) => <Card><p className="muted">{title}</p>{action}</Card>;

export const Skeleton = () => <div className="card" style={{ minHeight: 100, opacity: 0.6 }}>Loading…</div>;

export const Toast = ({ text }: { text: string }) => <div className="card" style={{ borderColor: 'var(--info)' }}>{text}</div>;
