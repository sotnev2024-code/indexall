'use client';

interface TariffConfig {
  id: number;
  plan_key: string;
  name: string;
  price: number;
  duration_value: number;
  duration_unit: 'day' | 'month' | string;
  description?: string;
  sort_order?: number;
  width?: number;
  height?: number;
  parent_id?: number | null;
  image_path?: string | null;
}

interface Props {
  tariffs: TariffConfig[];
  loadingPlanKey?: string | null;
  onBuy: (planKey: string) => void;
}

function fmt(n: number) { return Number(n).toLocaleString('ru-RU'); }

function durationLabel(t: TariffConfig): string {
  const v = Number(t.duration_value);
  if (t.duration_unit === 'month') {
    if (v === 1) return '/месяц';
    if (v === 12) return '/год';
    return `/${v} мес`;
  }
  if (v === 30) return '/месяц';
  if (v === 365) return '/год';
  if (v === 7) return '/неделя';
  return `/${v} дн`;
}

function getImageUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  const filename = String(path).split(/[\\/]/).pop();
  // Static assets are served from /api/uploads/ (NEXT_PUBLIC_API_URL already
  // includes the /api segment), so this matches the catalog tile pattern.
  return `${process.env.NEXT_PUBLIC_API_URL}/uploads/${filename}`;
}

/**
 * Tile grid for pricing/paywall — mirrors the admin tile layout
 * (`width × height`, `parent_id` for sub-blocks). Each tile is clickable
 * and triggers the YooKassa buy flow for its `plan_key` directly.
 */
export default function PricingTilesGrid({ tariffs, loadingPlanKey, onBuy }: Props) {
  // Sort by admin's sort_order so the visual order on the public site
  // mirrors the tile manager exactly.
  const sorted = [...tariffs].sort((a, b) =>
    (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0) || a.id - b.id);

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gridAutoRows: '120px',
        gridAutoFlow: 'dense',
        gap: 10,
        maxWidth: 980,
        margin: '0 auto',
      }}
    >
      {sorted.map(t => {
        const w = Math.max(1, Math.min(4, Number(t.width) || 1));
        const h = Math.max(1, Math.min(6, Number(t.height) || 3));
        const img = getImageUrl(t.image_path);
        const isLoading = loadingPlanKey === t.plan_key;
        const isChild = t.parent_id != null;

        return (
          <button
            key={t.id}
            onClick={() => onBuy(t.plan_key)}
            disabled={isLoading}
            style={{
              gridColumn: `span ${w}`,
              gridRow: `span ${h}`,
              border: 'none',
              borderRadius: 12,
              padding: 16,
              textAlign: 'left',
              cursor: isLoading ? 'wait' : 'pointer',
              position: 'relative',
              overflow: 'hidden',
              background: img
                ? `linear-gradient(180deg, rgba(0,0,0,0.05) 0%, rgba(0,0,0,0.55) 100%), url("${img}") center/cover`
                : '#1a1a1a',
              color: '#fff',
              boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
              outline: isChild ? '2px dashed rgba(245,200,0,0.7)' : 'none',
              outlineOffset: -3,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              transition: 'transform 0.15s ease, box-shadow 0.15s ease',
            }}
            onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 6px 18px rgba(0,0,0,0.18)'; }}
            onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)'; }}
          >
            <div style={{ fontSize: w >= 2 || h >= 3 ? 18 : 15, fontWeight: 800, textShadow: '0 1px 3px rgba(0,0,0,0.6)' }}>
              {t.name}
            </div>
            <div>
              <div style={{ fontSize: w >= 2 || h >= 3 ? 28 : 20, fontWeight: 800, color: '#f5c800', textShadow: '0 1px 3px rgba(0,0,0,0.6)' }}>
                {fmt(Number(t.price))} ₽
                <span style={{ fontSize: 12, fontWeight: 500, color: '#fff', marginLeft: 4 }}>
                  {durationLabel(t)}
                </span>
              </div>
              <div style={{
                marginTop: 8, display: 'inline-block',
                background: '#f5c800', color: '#1a1a1a',
                padding: '6px 12px', borderRadius: 6,
                fontSize: 12, fontWeight: 700,
              }}>
                {isLoading ? 'Открываю оплату…' : 'Купить →'}
              </div>
            </div>
          </button>
        );
      })}
      {sorted.length === 0 && (
        <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: 40, color: '#6b7280' }}>
          Тарифы пока не настроены — обратитесь к администратору.
        </div>
      )}
    </div>
  );
}
