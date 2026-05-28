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


function getImageUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  const filename = String(path).split(/[\\/]/).pop();
  return `${process.env.NEXT_PUBLIC_API_URL}/uploads/${filename}`;
}

/**
 * Tariff tile grid for the public pricing page.
 * When an admin uploads a cover image, that image fills the tile body (no cropping,
 * objectFit: contain). The only code-generated overlay is the price/button footer
 * at the very bottom — all other text (plan name, features) lives inside the image.
 */
export default function PricingTilesGrid({ tariffs, loadingPlanKey, onBuy }: Props) {
  const sorted = [...tariffs].sort((a, b) =>
    (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0) || a.id - b.id);

  // Calculate actual columns needed so tiles are centered
  // (sum of all widths, capped at 4 — mirrors the admin 4-col grid)
  const totalSpan = sorted.reduce((s, t) => s + Math.max(1, Math.min(4, Number(t.width) || 1)), 0);
  const colCount = Math.min(4, totalSpan) || 1;

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${colCount}, minmax(0, 320px))`,
        gridAutoRows: 'auto',
        gridAutoFlow: 'dense',
        gap: 14,
        margin: '0 auto',
        justifyContent: 'center',
      }}
    >
      {sorted.map(t => {
        const w = Math.max(1, Math.min(colCount, Number(t.width) || 1));
        const img = getImageUrl(t.image_path);
        const isLoading = loadingPlanKey === t.plan_key;

        return (
          <button
            key={t.id}
            onClick={() => onBuy(t.plan_key)}
            disabled={isLoading}
            style={{
              gridColumn: `span ${w}`,
              border: 'none',
              borderRadius: 14,
              padding: 0,
              textAlign: 'left',
              cursor: isLoading ? 'wait' : 'pointer',
              position: 'relative',
              overflow: 'hidden',
              background: img ? 'transparent' : '#1a1a1a',
              color: '#fff',
              boxShadow: '0 4px 20px rgba(0,0,0,0.14)',
              display: 'block',
              transition: 'transform 0.15s ease, box-shadow 0.15s ease',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.transform = 'translateY(-3px)';
              e.currentTarget.style.boxShadow = '0 10px 28px rgba(0,0,0,0.22)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.transform = '';
              e.currentTarget.style.boxShadow = '0 4px 20px rgba(0,0,0,0.14)';
            }}
          >
            {img ? (
              /* Full image — height is natural (no cropping, no empty space) */
              <img
                src={img}
                alt={t.name}
                style={{ width: '100%', height: 'auto', display: 'block', borderRadius: 14 }}
              />
            ) : (
              /* Fallback when no image uploaded */
              <div style={{
                minHeight: 320,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '24px 20px',
                gap: 8,
              }}>
                <div style={{ fontSize: 20, fontWeight: 800, textAlign: 'center' }}>{t.name}</div>
              </div>
            )}

            {/* Loading overlay */}
            {isLoading && (
              <div style={{
                position: 'absolute', inset: 0,
                background: 'rgba(0,0,0,0.45)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 16, fontWeight: 700, color: '#fff',
                borderRadius: 14,
              }}>
                Открываю оплату…
              </div>
            )}
          </button>
        );
      })}

      {sorted.length === 0 && (
        <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: 60, color: '#6b7280', fontSize: 14 }}>
          Тарифы пока не настроены — обратитесь к администратору.
        </div>
      )}
    </div>
  );
}
