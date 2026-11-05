import { STATUS_LABEL } from '../../shared/statusMachine';
import type { SessionStatus } from '../../shared/types';

/**
 * Cada estado tiene silueta propia, para distinguirlos sin depender del color.
 * Los dos principales repiten los glifos que Claude Code pone en el título: ◐ y ✳.
 */
export function StatusIcon({ status, size = 16 }: { status: SessionStatus; size?: number }) {
  const common = { class: `st st-${status}`, viewBox: '0 0 16 16', width: size, height: size, role: 'img' as const, 'aria-label': STATUS_LABEL[status] };
  switch (status) {
    case 'working':
      return (
        <svg {...common} data-status={status}>
          <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.5" />
          <path class="st-half" d="M8 2a6 6 0 0 1 0 12z" fill="currentColor" />
        </svg>
      );
    case 'starting':
      return (
        <svg {...common} data-status={status}>
          <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="2 3" />
        </svg>
      );
    case 'done':
      return (
        <svg {...common} data-status={status}>
          <g stroke="currentColor" stroke-width="2.1" stroke-linecap="round">
            <path d="M8 1.8v12.4M1.8 8h12.4M3.6 3.6l8.8 8.8M12.4 3.6l-8.8 8.8" />
          </g>
        </svg>
      );
    case 'waiting':
      return (
        <svg {...common} data-status={status}>
          <path d="M8 1.2 15.4 14.2H.6z" fill="currentColor" />
          <path class="st-cut" d="M8 5.8v4.2M8 11.8v.5" stroke-width="1.8" stroke-linecap="round" />
        </svg>
      );
    case 'error':
      return (
        <svg {...common} data-status={status}>
          <path d="M5 1.2h6L14.8 5v6L11 14.8H5L1.2 11V5z" fill="currentColor" />
          <path class="st-cut" d="M5.6 5.6l4.8 4.8M10.4 5.6l-4.8 4.8" stroke-width="1.8" stroke-linecap="round" />
        </svg>
      );
    case 'asleep':
      return (
        <svg {...common} data-status={status}>
          <path d="M13.4 10.2A5.8 5.8 0 0 1 5.8 2.6a5.8 5.8 0 1 0 7.6 7.6z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" />
        </svg>
      );
    case 'exited':
      return (
        <svg {...common} data-status={status}>
          <path d="M4 8h8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
        </svg>
      );
    case 'idle':
    default:
      return (
        <svg {...common} data-status={status}>
          <circle cx="8" cy="8" r="3.5" fill="none" stroke="currentColor" stroke-width="1.6" />
        </svg>
      );
  }
}

export function Chevron({ open }: { open: boolean }) {
  return (
    <svg class={`chev${open ? ' open' : ''}`} viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
      <path d="M4.2 2.6 7.8 6 4.2 9.4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  );
}

export function PlusIcon({ size = 14 }: { size?: number }) {
  return (
    <svg viewBox="0 0 14 14" width={size} height={size} aria-hidden="true">
      <path d="M7 2.5v9M2.5 7h9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
    </svg>
  );
}

export function CloseIcon({ size = 12 }: { size?: number }) {
  return (
    <svg viewBox="0 0 12 12" width={size} height={size} aria-hidden="true">
      <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
    </svg>
  );
}

export function ShellMark() {
  return (
    <svg class="shell-mark" viewBox="0 0 14 14" width="13" height="13" aria-label="PowerShell">
      <path d="M2.5 3.5 6 7l-3.5 3.5M7.5 11h4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  );
}

export function GearIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path
        fill="currentColor"
        fill-rule="evenodd"
        d="M6.9 1h2.2l.3 1.8c.4.1.8.3 1.1.5l1.5-1 1.6 1.5-1.1 1.5c.2.4.4.7.5 1.1l1.9.3v2.2l-1.9.3c-.1.4-.3.8-.5 1.1l1.1 1.5-1.6 1.6-1.5-1.1c-.3.2-.7.4-1.1.5L9.1 15H6.9l-.3-1.9c-.4-.1-.8-.3-1.1-.5l-1.5 1.1-1.6-1.6 1.1-1.5c-.2-.3-.4-.7-.5-1.1L1 9.2V6.9l1.9-.4c.1-.4.3-.7.5-1.1L2.3 3.9l1.6-1.6 1.5 1c.3-.2.7-.4 1.1-.5zM8 5.6a2.4 2.4 0 1 0 0 4.8 2.4 2.4 0 0 0 0-4.8z"
      />
    </svg>
  );
}

export function MoreIcon() {
  return (
    <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true">
      <circle cx="3" cy="7" r="1.2" fill="currentColor" />
      <circle cx="7" cy="7" r="1.2" fill="currentColor" />
      <circle cx="11" cy="7" r="1.2" fill="currentColor" />
    </svg>
  );
}

export function PanelIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <rect x="2" y="3" width="12" height="10" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.3" />
      <path d="M6 3v10" stroke="currentColor" stroke-width="1.3" />
    </svg>
  );
}

/** Vista de 1, 2, 3 o 4 paneles. */
export function LayoutIcon({ count }: { count: 1 | 2 | 3 | 4 }) {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <rect x="2" y="3" width="12" height="10" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.3" />
      {(count === 2 || count === 4) && <path d="M8 3v10" stroke="currentColor" stroke-width="1.3" />}
      {count === 3 && <path d="M6 3v10M10 3v10" stroke="currentColor" stroke-width="1.3" />}
      {count === 4 && <path d="M2 8h12" stroke="currentColor" stroke-width="1.3" />}
    </svg>
  );
}

/** Dos líneas de texto, una que entra y otra que sale. */
export function DiffIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d="M2.5 4.5h7M2.5 8h11M2.5 11.5h7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
      <path d="M13 2.6v3.8M11.1 4.5h3.8M11.1 11.5h3.8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
    </svg>
  );
}

export function RefreshIcon({ spin = false }: { spin?: boolean }) {
  return (
    <svg class={spin ? 'spin' : undefined} viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d="M13.2 8a5.2 5.2 0 1 1-1.6-3.75" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
      <path d="M11.9 1.8v2.7H9.2" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  );
}

/** Se abre fuera de Hilo. */
export function ExternalIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path d="M7 3H3.4A1.4 1.4 0 0 0 2 4.4v8.2A1.4 1.4 0 0 0 3.4 14h8.2a1.4 1.4 0 0 0 1.4-1.4V9" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
      <path d="M9.5 2H14v4.5M14 2 7.5 8.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  );
}

export function ChevronUpDown({ up = false }: { up?: boolean }) {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path d={up ? 'M3.5 10.5 8 6l4.5 4.5' : 'M3.5 5.5 8 10l4.5-4.5'} fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  );
}

export function SearchIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <circle cx="7" cy="7" r="4.2" fill="none" stroke="currentColor" stroke-width="1.4" />
      <path d="M10.2 10.2 13.5 13.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
    </svg>
  );
}
