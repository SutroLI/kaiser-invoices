/** Sutro Li brand accent — header bar uses solid top + tinted stripes below. */
const BRAND = '#1fb8e9'

function tintBrand(whiteMix: number): string {
  const r = parseInt(BRAND.slice(1, 3), 16)
  const g = parseInt(BRAND.slice(3, 5), 16)
  const b = parseInt(BRAND.slice(5, 7), 16)
  const mix = (c: number) => Math.round(c + (255 - c) * whiteMix)
  const hex = (n: number) => n.toString(16).padStart(2, '0')
  return `#${hex(mix(r))}${hex(mix(g))}${hex(mix(b))}`
}

const STRIPE_COLORS = [0.16, 0.32, 0.48, 0.64, 0.8].map(tintBrand)

export function BrandLogo() {
  return (
    <img
      src={`${import.meta.env.BASE_URL}SL-arrow-only.png`}
      alt="Sutro Li"
      className="page-logo"
      width={88}
      height={88}
    />
  )
}

export default function BrandBars() {
  return (
    <div className="brand-bars" aria-hidden="true">
      <div className="brand-bars-solid" />
      <div className="brand-bars-stripes">
        {STRIPE_COLORS.flatMap((color, i) => [
          <div key={`gap-${i}`} className="brand-stripe-gap" />,
          <div key={color} className="brand-stripe" style={{ backgroundColor: color }} />,
        ])}
      </div>
    </div>
  )
}
