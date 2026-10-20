/** Inline SVG icons (stroke inherits currentColor). Deliberately few. */

const base = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
}

const Svg = ({ size = 18, children, ...props }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base} {...props}>
    {children}
  </svg>
)

export const Play = (p) => (
  <Svg {...p}><path d="M8 5.5v13l10.5-6.5z" fill="currentColor" stroke="none" /></Svg>
)
export const Pause = (p) => (
  <Svg {...p}><path d="M9 5v14M15 5v14" /><path d="M9 5v14M15 5v14" /></Svg>
)
export const Prev = (p) => (
  <Svg {...p}><path d="M17 6v12L9 12z" fill="currentColor" stroke="none" /><path d="M7 6v12" /></Svg>
)
export const Next = (p) => (
  <Svg {...p}><path d="M7 6v12l8-6z" fill="currentColor" stroke="none" /><path d="M17 6v12" /></Svg>
)
export const Volume = (p) => (
  <Svg {...p}><path d="M4 9v6h4l5 4V5L8 9z" /><path d="M16 9a4.5 4.5 0 0 1 0 6" /><path d="M18.5 6.5a8 8 0 0 1 0 11" /></Svg>
)
export const Muted = (p) => (
  <Svg {...p}><path d="M4 9v6h4l5 4V5L8 9z" /><path d="m16 9 5 6M21 9l-5 6" /></Svg>
)
export const Upload = (p) => (
  <Svg {...p}><path d="M12 16V4m0 0-4 4m4-4 4 4" /><path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" /></Svg>
)
export const Link = (p) => (
  <Svg {...p}><path d="M10 14a4 4 0 0 0 6 .5l3-3a4 4 0 0 0-5.5-5.8L12 4.5" /><path d="M14 10a4 4 0 0 0-6-.5l-3 3a4 4 0 0 0 5.5 5.8L12 19.5" /></Svg>
)
export const Trash = (p) => (
  <Svg {...p}><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m3 0-1 12a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L6 7" /></Svg>
)
export const WifiOff = (p) => (
  <Svg {...p}><path d="M2 8.5a15 15 0 0 1 4-2.3M9 9.5a9 9 0 0 1 3-.5 9 9 0 0 1 5 1.5M12.5 13a4 4 0 0 1 2.5.5M12 19h.01" /><path d="m3 3 18 18" /></Svg>
)
export const Phone = (p) => (
  <Svg {...p}><rect x="7" y="2.5" width="10" height="19" rx="2.5" /><path d="M11 19h2" /></Svg>
)
export const Monitor = (p) => (
  <Svg {...p}><rect x="3" y="4" width="18" height="12.5" rx="2" /><path d="M9 20.5h6M12 16.5v4" /></Svg>
)
export const Refresh = (p) => (
  <Svg {...p}><path d="M20 11A8 8 0 0 0 6.6 6M4 13a8 8 0 0 0 13.4 5" /><path d="M20 4v7h-7M4 20v-7h7" /></Svg>
)
export const Unpair = (p) => (
  <Svg {...p}><path d="M9 15 15 9" /><path d="M11.5 6.5 14 4a4.2 4.2 0 0 1 6 6l-2.5 2.5M12.5 17.5 10 20a4.2 4.2 0 0 1-6-6l2.5-2.5" /><path d="m4 4 3 3m10 10 3 3" /></Svg>
)
export const Check = (p) => (
  <Svg {...p}><path d="m5 13 4 4L19 7" /></Svg>
)
export const Warn = (p) => (
  <Svg {...p}><path d="M12 4 2.8 20h18.4z" /><path d="M12 10v4m0 3h.01" /></Svg>
)
export const Music = (p) => (
  <Svg {...p}><path d="M9 18a2.5 2.5 0 1 1-2.5-2.5H7.5M9 18V5.5L19 4v10M9 15.5A2.5 2.5 0 1 1 11.5 18H11M19 14a2 2 0 1 0-1-3.7" /></Svg>
)
export const Download = (p) => (
  <Svg {...p}><path d="M12 4v10m0 0-4-4m4 4 4-4" /><path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" /></Svg>
)
export const Spinner = ({ size = 18, ...p }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" className="animate-spin" {...p} aria-hidden="true">
    <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2.4" />
    <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
  </svg>
)
