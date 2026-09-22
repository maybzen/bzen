export default function Icon({ name, size = 20, className = '', strokeWidth = 1.7 }) {
  const common = {
    viewBox: '0 0 24 24',
    width: size,
    height: size,
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    className,
    'aria-hidden': 'true',
    focusable: 'false',
  }
  return <svg {...common}>{PATHS[name] || PATHS.dot}</svg>
}

const PATHS = {
  dot: <circle cx="12" cy="12" r="3" />,

  dashboard: (
    <>
      <rect x="3" y="3" width="7.5" height="9.5" rx="1.6" />
      <rect x="13.5" y="3" width="7.5" height="5.5" rx="1.6" />
      <rect x="13.5" y="11.5" width="7.5" height="9.5" rx="1.6" />
      <rect x="3" y="15.5" width="7.5" height="5.5" rx="1.6" />
    </>
  ),
  'trending-up': (
    <>
      <polyline points="3 17 9.5 10.5 13.5 14.5 21 7" />
      <polyline points="15 7 21 7 21 13" />
    </>
  ),
  cart: (
    <>
      <circle cx="9.5" cy="20" r="1.3" />
      <circle cx="18" cy="20" r="1.3" />
      <path d="M2.5 3.5h2.3l2.4 12.1a1.8 1.8 0 0 0 1.8 1.4h8.4a1.8 1.8 0 0 0 1.8-1.5L21 7.5H5.6" />
    </>
  ),
  receipt: (
    <>
      <path d="M5.5 3h13v18l-2.2-1.5L14.1 21 12 19.5 9.9 21l-2.2-1.5L5.5 21V3z" />
      <line x1="9" y1="8" x2="15" y2="8" />
      <line x1="9" y1="12" x2="15" y2="12" />
    </>
  ),
  folder: (
    <path d="M3 7.4A2.4 2.4 0 0 1 5.4 5h3.1a2 2 0 0 1 1.6.8l1 1.3h7.5A2.4 2.4 0 0 1 21 9.5v8.1A2.4 2.4 0 0 1 18.6 20H5.4A2.4 2.4 0 0 1 3 17.6V7.4z" />
  ),
  chart: (
    <>
      <line x1="3.5" y1="20.5" x2="20.5" y2="20.5" />
      <rect x="5.5" y="11" width="3.6" height="6.5" rx="1.1" />
      <rect x="10.2" y="6.5" width="3.6" height="11" rx="1.1" />
      <rect x="14.9" y="14" width="3.6" height="3.5" rx="1.1" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.3" />
      <path d="M2.8 19.6a6.2 6.2 0 0 1 12.4 0" />
      <path d="M16.4 5.5a3.3 3.3 0 0 1 0 6.2" />
      <path d="M17.5 14.1a6.2 6.2 0 0 1 3.7 5.5" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3.1" />
      <path d="M12 2.6v2.3M12 19.1v2.3M21.4 12h-2.3M4.9 12H2.6M18.6 5.4l-1.6 1.6M7 17l-1.6 1.6M18.6 18.6 17 17M7 7 5.4 5.4" />
    </>
  ),
  plus: (
    <>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </>
  ),
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <line x1="15.4" y1="15.4" x2="21" y2="21" />
    </>
  ),
  close: (
    <>
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </>
  ),
  pencil: (
    <>
      <path d="M4 20.2h4L18.6 9.6a2.15 2.15 0 0 0-3-3L5 17.2v3z" />
      <line x1="14.6" y1="6.5" x2="17.5" y2="9.4" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16" />
      <path d="M9.2 7V4.9A1.4 1.4 0 0 1 10.6 3.5h2.8a1.4 1.4 0 0 1 1.4 1.4V7" />
      <path d="M6.6 7l.85 12.1A1.8 1.8 0 0 0 9.25 20.9h5.5a1.8 1.8 0 0 0 1.8-1.8L17.4 7" />
    </>
  ),
  download: (
    <>
      <path d="M12 3.5v11" />
      <polyline points="7.6 10 12 14.4 16.4 10" />
      <path d="M4 20.5h16" />
    </>
  ),
  upload: (
    <>
      <path d="M12 15V4" />
      <polyline points="7.6 8.4 12 4 16.4 8.4" />
      <path d="M4 20.5h16" />
    </>
  ),
  paperclip: (
    <path d="M19.8 11.6l-7.9 7.9a4.6 4.6 0 0 1-6.5-6.5l8.4-8.4a3 3 0 0 1 4.3 4.3l-8.4 8.4a1.4 1.4 0 0 1-2-2l7.6-7.6" />
  ),
  'chevron-down': <polyline points="6 9.5 12 15.5 18 9.5" />,
  'chevron-left': <polyline points="14.5 6 8.5 12 14.5 18" />,
  'chevron-right': <polyline points="9.5 6 15.5 12 9.5 18" />,
  'arrow-up': <polyline points="5 15 12 8 19 15" />,
  'arrow-down': <polyline points="5 9 12 16 19 9" />,
  logout: (
    <>
      <path d="M14.8 4h3.7A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-3.7" />
      <polyline points="9.5 8 5.5 12 9.5 16" />
      <line x1="5.5" y1="12" x2="15.5" y2="12" />
    </>
  ),
  menu: (
    <>
      <line x1="3.5" y1="7" x2="20.5" y2="7" />
      <line x1="3.5" y1="12" x2="20.5" y2="12" />
      <line x1="3.5" y1="17" x2="20.5" y2="17" />
    </>
  ),
  check: <polyline points="5 12.5 10 17.5 19 7" />,
  alert: (
    <>
      <path d="M12 3.4 21 19.6H3L12 3.4z" />
      <line x1="12" y1="9.6" x2="12" y2="13.6" />
      <circle cx="12" cy="16.6" r="0.55" fill="currentColor" stroke="none" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.2" />
      <line x1="3.5" y1="10" x2="20.5" y2="10" />
      <line x1="8" y1="3" x2="8" y2="6.6" />
      <line x1="16" y1="3" x2="16" y2="6.6" />
    </>
  ),
  lock: (
    <>
      <rect x="4.5" y="10.4" width="15" height="10.1" rx="2.2" />
      <path d="M8.2 10.4V7.9a3.8 3.8 0 0 1 7.6 0v2.5" />
    </>
  ),
  building: (
    <>
      <rect x="4" y="3.5" width="10" height="17" rx="1.6" />
      <path d="M14 9.5h5.2a1.3 1.3 0 0 1 1.3 1.3V20.5" />
      <line x1="7.2" y1="7.5" x2="10.8" y2="7.5" />
      <line x1="7.2" y1="11.5" x2="10.8" y2="11.5" />
      <line x1="7.2" y1="15.5" x2="10.8" y2="15.5" />
    </>
  ),
  card: (
    <>
      <rect x="2.5" y="5.5" width="19" height="13" rx="2.2" />
      <line x1="2.5" y1="10" x2="21.5" y2="10" />
      <line x1="6" y1="15" x2="10.5" y2="15" />
    </>
  ),
  coins: (
    <>
      <ellipse cx="12" cy="6.6" rx="7" ry="3.1" />
      <path d="M5 6.6v10.8c0 1.7 3.1 3.1 7 3.1s7-1.4 7-3.1V6.6" />
      <path d="M5 12c0 1.7 3.1 3.1 7 3.1s7-1.4 7-3.1" />
    </>
  ),
  file: (
    <>
      <path d="M13.6 3.5H7.2A1.7 1.7 0 0 0 5.5 5.2v13.6a1.7 1.7 0 0 0 1.7 1.7h9.6a1.7 1.7 0 0 0 1.7-1.7V8.4L13.6 3.5z" />
      <polyline points="13.6 3.5 13.6 8.4 18.5 8.4" />
    </>
  ),
  image: (
    <>
      <rect x="3.5" y="5" width="17" height="14" rx="2.2" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="M4.6 17.8l4.6-4.1 3.5 3 3-2.6 3.7 3.3" />
    </>
  ),
  filter: <path d="M4 5h16l-6.2 7.4V19l-3.6-2v-4.6L4 5z" />,
  refresh: (
    <>
      <path d="M20 12a8 8 0 1 1-2.4-5.7" />
      <polyline points="20 4 20 9.5 14.5 9.5" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <line x1="12" y1="11" x2="12" y2="16.4" />
      <circle cx="12" cy="8.1" r="0.6" fill="currentColor" stroke="none" />
    </>
  ),
}
