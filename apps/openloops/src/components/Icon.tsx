const PATHS = {
  plus: 'M12 5v14M5 12h14',
  check: 'M5 12l5 5L20 7',
  chevron: 'M6 9l6 6 6-6',
  x: 'M18 6L6 18M6 6l12 12',
  clock: 'M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18M12 7v5l3 3',
  user: 'M12 4a4 4 0 1 0 0 8a4 4 0 0 0 0-8M6 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2',
  flag: 'M5 21V5M5 5h11l-2 4 2 4H5',
  edit: 'M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3M13.5 6.5l3 3',
  folder: 'M5 4h4l3 3h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2',
  bolt: 'M13 3L4 14h7l-1 7 9-11h-7l1-7z',
  undo: 'M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
  settings: 'M4 6h16M4 12h16M4 18h16M9 4v4M15 10v4M7 16v4',
  alert: 'M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  repeat: 'M4 12V9a3 3 0 0 1 3-3h13M17 3l3 3-3 3M20 12v3a3 3 0 0 1-3 3H4M7 21l-3-3 3-3',
} as const

export type IconName = keyof typeof PATHS

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  )
}

/** โลโก้: วงที่ยังไม่ปิด พร้อมจุดที่ปลาย = ลูปที่ยังค้าง */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="var(--accent)" />
      <path
        d="M21.4 9.57A8.4 8.4 0 1 0 24.4 16"
        fill="none"
        stroke="var(--on-accent)"
        strokeWidth="2.8"
        strokeLinecap="round"
      />
      <circle cx="24.4" cy="16" r="2.3" fill="var(--on-accent)" />
    </svg>
  )
}
