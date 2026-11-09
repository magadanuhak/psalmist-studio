import type { SVGProps } from 'react';

const P: Record<string, string> = {
  play: 'M7 4.5v15l12-7.5z',
  pause: 'M7 5h3.5v14H7zM13.5 5H17v14h-3.5z',
  stop: 'M6 6h12v12H6z',
  rec: 'M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10z',
  mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM6 11a6 6 0 0 0 12 0M12 17v4M9 21h6',
  import: 'M12 4v11m0 0-4-4m4 4 4-4M5 19h14',
  export: 'M12 15V4m0 0-4 4m4-4 4 4M5 19h14',
  undo: 'M9 7 4 12l5 5M4 12h10a6 6 0 0 1 0 8',
  redo: 'M15 7l5 5-5 5M20 12H10a6 6 0 0 0 0 8',
  trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13M10 11v6M14 11v6',
  plus: 'M12 5v14M5 12h14',
  up: 'M6 14l6-6 6 6',
  down: 'M6 10l6 6 6-6',
  split: 'M12 3v18M5 8l-2 4 2 4M19 8l2 4-2 4',
  merge: 'M3 12h6m6 0h6M9 8l4 4-4 4M15 8l-4 4 4 4',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  close: 'M6 6l12 12M18 6 6 18',
  loop: 'M17 2l3 3-3 3M20 5H8a4 4 0 0 0-4 4v1M7 22l-3-3 3-3M4 19h12a4 4 0 0 0 4-4v-1',
  metro: 'M9 3h6l3 18H6zM12 17l4-9',
  hand: 'M8 12V6a1.5 1.5 0 0 1 3 0v5m0-1V4.5a1.5 1.5 0 0 1 3 0V11m0-4a1.5 1.5 0 0 1 3 0v8a6 6 0 0 1-6 6h-1a6 6 0 0 1-5-3l-2-3a1.5 1.5 0 0 1 2.5-1.6L8 14',
  cursor: 'M6 3l12 8-5 1.5L11 18z',
  pen: 'M4 20l1-5L16 4l4 4L9 19z',
  info: 'M12 8v.01M11 12h1v5h1M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
  flame: 'M12 2c3.2 4 5.5 7 5.5 10.5A5.5 5.5 0 0 1 12 18a5.5 5.5 0 0 1-5.5-5.5C6.5 10 8 8.5 9 7c.3 1.6 1 2.6 2 3 0-3 .3-5 1-8z',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12l2-1-2-4-2 .5-1.5-1L15 4h-4l-.5 2.5-1.5 1L7 7 5 11l2 1v1l-2 1 2 4 2-.5 1.5 1L11 20h4l.5-2.5 1.5-1 2 .5 2-4-2-1z',
  tap: 'M12 3v6M9 12l3 3 3-3M5 21h14',
  wand: 'M5 19 17 7M14 4l1 2 2 1-2 1-1 2-1-2-2-1 2-1z',
  ear: 'M7 10a5 5 0 0 1 10 0c0 3-3 3-3 6a3 3 0 0 1-6 1',
  back: 'M15 5l-7 7 7 7',
  lock: 'M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6z',
  edit: 'M4 20h4L19 9l-4-4L4 16z',
  help: 'M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17v.01M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
};

export function Icon({ name, size = 18, ...rest }: { name: string; size?: number } & SVGProps<SVGSVGElement>) {
  const filled = name === 'play' || name === 'stop' || name === 'rec' || name === 'pause' || name === 'flame';
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke={filled ? 'none' : 'currentColor'}
      strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...rest}>
      <path d={P[name] ?? P.info} />
    </svg>
  );
}

export function Brand({ size = 26 }: { size?: number }) {
  return (
    <span className="brand-mark" aria-hidden="true">
      <svg width={size} height={size} viewBox="0 0 32 32">
        <path className="flame-outer" d="M16 3c4 5 7 9 7 13.2a7 7 0 0 1-14 0C9 12.8 12 9 16 3z" fill="var(--gold)" />
        <path className="flame-inner" d="M16 14c1.8 2 3 3.5 3 5.3a3 3 0 0 1-6 0c0-1.8 1.2-3.3 3-5.3z" fill="var(--ink-0)" opacity=".85" />
      </svg>
    </span>
  );
}
