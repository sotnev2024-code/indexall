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

  // Determine the number of columns dynamically so tiles fill the space nicely
  const colCount = Math.min(4, Math.max(1, sorted.length));

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${colCount}, 1fr)`,
        gridAutoRows: '160px',
        gridAutoFlow: 'dense',
        gap: 14,
        maxWidth: Math.min(colCount * 320, 1100),
        margin: '0 auto',
      }}
    >
      {sorted.map(t => {
        const w = Math.max(1, Math.min(4, Number(t.width) || 1));
        const h = Math.max(1, Math.min(6, Number(t.height) || 3));
        const img = getImageUrl(t.image_path);
        const isLoading = loadingPlanKey === t.plan_key;

        return (
          <button
            key={t.id}
            onClick={() => onBuy(t.plan_key)}
            disabled={isLoading}
            style={{
              gridColumn: `span ${w}`,
              gridRow: `span ${h}`,
              border: 'none',
              borderRadius: 14,
              padding: 0,
              textAlign: 'left',
              cursor: isLoading ? 'wait' : 'pointer',
              position: 'relative',
              overflow: 'hidden',
              background: '#1a1a1a',
              color: '#fff',
              boxShadow: '0 4px 20px rgba(0,0,0,0.14)',
              display: 'flex',
              flexDirection: 'column',
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
            {/* Image body — fills all space above the footer */}
            {img ? (
              <div style={{ flex: 1, overflow: 'hidden' }}>
                <img
                  src={img}
                  alt={t.name}
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    objectPosition: 'center top',
                    display: 'block',
                  }}
                />
              </div>
            ) : (
              /* Fallback when no image uploaded */
              <div style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '20px 16px',
                gap: 8,
              }}>
                <div style={{ fontSize: 20, fontWeight: 800, textAlign: 'center' }}>{t.name}</div>
              </div>
            )}

            {/* Invisible click target — price/button are shown inside the image */}
            {isLoading && (
              <div style={{
                position: 'absolute', inset: 0,
                background: 'rgba(0,0,0,0.45)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 16, fontWeight: 700, color: '#fff',
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
