/**
 * Vector close “×” - never depends on font glyphs (× / ▭ often render as empty boxes).
 */
export function CloseIcon({ size = 10, className = '' }: { size?: number; className?: string }): JSX.Element {
 return (
 <svg
 className={`close-icon-svg ${className}`.trim()}
 width={size}
 height={size}
 viewBox="0 0 12 12"
 fill="none"
 xmlns="http://www.w3.org/2000/svg"
 aria-hidden
 focusable="false"
 >
 <path
 d="M2.2 2.2l7.6 7.6M9.8 2.2l-7.6 7.6"
 stroke="currentColor"
 strokeWidth="1.6"
 strokeLinecap="round"
 />
 </svg>
 )
}
