import type { Network, PostStatus } from '@ms/core';
import { Facebook, Instagram, Linkedin, X } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { NETWORK_LABEL, STATUS_LABEL } from '../lib/format';

export function StatusBadge({ status }: { status: PostStatus }) {
  return (
    <span className={`badge st-${status}`}>
      <span className="dot" />
      {STATUS_LABEL[status]}
    </span>
  );
}

export const STATUS_COLOR: Record<PostStatus, string> = {
  draft: 'var(--muted)',
  in_review: 'var(--warn)',
  changes_requested: 'var(--bad)',
  approved: 'var(--accent)',
  scheduled: 'var(--info)',
  publishing: 'var(--info)',
  published: 'var(--ok)',
  failed: 'var(--bad)',
};

export function NetworkIcon({ network, size = 14 }: { network: Network; size?: number }) {
  const I = { facebook: Facebook, instagram: Instagram, linkedin: Linkedin }[network];
  return <I size={size} aria-label={NETWORK_LABEL[network]} />;
}

export function Networks({ networks, size = 14 }: { networks: Network[]; size?: number }) {
  return (
    <span className="row" style={{ gap: 4, color: 'var(--muted)' }}>
      {networks.map((n) => (
        <NetworkIcon key={n} network={n} size={size} />
      ))}
    </span>
  );
}

export function BrandTag({ brand }: { brand: { name: string; profile: { color: string } } | undefined }) {
  if (!brand) return null;
  return (
    <span className="row" style={{ gap: 6 }}>
      <span className="brand-dot" style={{ background: brand.profile.color }} />
      <span>{brand.name}</span>
    </span>
  );
}

export function Avatar({ name }: { name: string }) {
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return <span className="avatar" aria-hidden>{initials}</span>;
}

export function Modal({ title, onClose, children, footer }: { title: string; onClose(): void; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="btn ghost sm" style={{ marginLeft: 'auto' }} onClick={onClose} aria-label="Zavřít">
            <X size={16} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children}
    </div>
  );
}

export function Loading() {
  return <div className="empty">Načítám…</div>;
}

export function ErrorBox({ error }: { error: string }) {
  return <div className="alert error">{error}</div>;
}

export function PageHead({ title, sub, actions }: { title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {sub && <div className="sub">{sub}</div>}
      </div>
      {actions && <div className="actions">{actions}</div>}
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}
