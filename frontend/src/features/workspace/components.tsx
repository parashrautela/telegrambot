import type { ReactNode } from 'react';
import { ArrowUpRight, Link2, MessageCircle } from 'lucide-react';
import type { Attachment } from './api';
import { initials, safeLink } from './format';

export function Avatar({ name, small = false }: { name: string; small?: boolean }) {
  return <span className={`staff-avatar ${small ? 'small' : ''}`}>{initials(name)}</span>;
}
export function Badge({ value }: { value: string }) {
  return (
    <span className={`status-badge status-${value.toLowerCase().replaceAll(' ', '-')}`}>
      {value}
    </span>
  );
}
export function Empty({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="empty-state">
      <MessageCircle size={30} />
      <h2>{title}</h2>
      <p>{children}</p>
    </div>
  );
}
export function Attachments({ items }: { items: Attachment[] }) {
  return (
    <div className="attachment-links">
      {items.map((item, index) => {
        const link = safeLink(item.url);
        return link ? (
          <a key={index} href={link} target="_blank" rel="noreferrer">
            <Link2 size={14} />
            {item.fileName || 'Open reference'}
            <ArrowUpRight size={13} />
          </a>
        ) : (
          <span key={index} className="attachment-reference">
            <Link2 size={14} />
            {item.fileName || item.type} · Telegram reference
          </span>
        );
      })}
    </div>
  );
}
