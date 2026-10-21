/**
 * LearnHub brand logo.
 *
 * Renders the SVG assets in `public/`:
 * - variant "full" (default): horizontal lockup — mark + "LearnHub" wordmark
 *   (`/logo.svg`, aspect 190x48). `size` is the rendered height in px.
 * - variant "mark": the square book mark only (`/favicon.svg`, 48x48).
 *   `size` is both width and height.
 */
export function Logo({ size = 32, variant = 'full', className = '', ...rest }) {
  const isMark = variant === 'mark'
  const width = isMark ? size : Math.round((size * 190) / 48)

  return (
    <img
      src={isMark ? '/favicon.svg' : '/logo.svg'}
      alt="LearnHub"
      width={width}
      height={size}
      style={{ width, height: size }}
      className={className}
      draggable={false}
      {...rest}
    />
  )
}

export default Logo
