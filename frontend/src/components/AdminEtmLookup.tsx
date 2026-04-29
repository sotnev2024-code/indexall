'use client';
import { useState } from 'react';

/**
 * Admin-only ETM lookup. Enter article (or ETM code) → see exactly what gets
 * pulled into the spec from ETM: личная цена, ритейл цена, дата (срок).
 * No raw JSON — just the three fields the platform actually uses.
 */
export default function AdminEtmLookup({ onClose }: { onClose: () => void }) {
  const [article, setArticle] = useState('');
  const [etmCode, setEtmCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any | null>(null);

  async function handleLookup() {
    const a = article.trim();
    const e = etmCode.trim();
    if (!a && !e) return;
    setLoading(true);
    setResult(null);
    try {
      const params = new URLSearchParams();
      if (a) params.set('article', a);
      if (e) params.set('etm_code', e);
      const base = process.env.NEXT_PUBLIC_API_URL || '/api';
      const res = await fetch(`${base}/catalog/admin/etm-lookup?${params.toString()}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
      });
      const json = await res.json();
      setResult(json);
    } catch (err: any) {
      setResult({ error: err?.message || 'Ошибка запроса' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-box"
        style={{ maxWidth: 520, width: '95vw' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="modal-title">ЭТМ-проверка артикула</div>
        <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>
          Прямой запрос к ETM без кэша. Показывает личную цену, ритейл и срок —
          то, что реально подтянется в лист.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          <div>
            <label style={{ display: 'block', fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>
              Артикул производителя
            </label>
            <input
              className="input-field"
              style={{ color: '#1a1a1a', background: '#fff' }}
              value={article}
              onChange={e => setArticle(e.target.value)}
              placeholder="например, mcb47100-4-16C-pro"
              autoFocus
              onKeyDown={e => { if (e.key === 'Enter' && !loading) handleLookup(); }}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>
              ETM-код (необязательно)
            </label>
            <input
              className="input-field"
              style={{ color: '#1a1a1a', background: '#fff' }}
              value={etmCode}
              onChange={e => setEtmCode(e.target.value)}
              placeholder="например, 7687607"
              onKeyDown={e => { if (e.key === 'Enter' && !loading) handleLookup(); }}
            />
          </div>
        </div>

        <div style={{ marginBottom: 16, display: 'flex', gap: 8 }}>
          <button
            onClick={handleLookup}
            disabled={loading || (!article.trim() && !etmCode.trim())}
            style={{
              padding: '8px 18px', background: '#1a1a1a', color: '#fff',
              border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600,
              cursor: 'pointer', opacity: loading ? 0.6 : 1,
            }}
          >
            {loading ? 'Запрос…' : 'Запросить ЭТМ'}
          </button>
          <button
            onClick={() => { setArticle(''); setEtmCode(''); setResult(null); }}
            style={{
              padding: '8px 18px', background: '#fff', color: '#1a1a1a',
              border: '1px solid var(--border)', borderRadius: 8, fontSize: 13,
              cursor: 'pointer',
            }}
          >
            Очистить
          </button>
        </div>

        {result && (
          result.error ? (
            <div style={{ padding: 12, background: '#fef2f2', color: '#991b1b', borderRadius: 6, fontSize: 12 }}>
              {result.error}
            </div>
          ) : (
            <EtmSummaryBlock summary={result.summary} />
          )
        )}

        <div className="modal-actions" style={{ marginTop: 16 }}>
          <button className="btn-cancel" onClick={onClose}>Закрыть</button>
        </div>
      </div>
    </div>
  );
}

/** Renders the three fields we actually pull into the spec. Reused by the
 *  product-card «Информация» modal so both views look identical. */
export function EtmSummaryBlock({ summary }: { summary: any }) {
  if (!summary) return null;
  const fmt = (v: number | null) => v != null ? `${v.toLocaleString('ru-RU')} ₽` : '—';
  const rows: { label: string; value: string; muted?: boolean }[] = [
    { label: 'Личная цена', value: fmt(summary.personal), muted: summary.personal == null },
    { label: 'Ритейл цена', value: fmt(summary.retail), muted: summary.retail == null },
    { label: 'Дата (срок)', value: summary.date || '—', muted: !summary.date },
  ];
  return (
    <div style={{ background: '#f8f9fa', borderRadius: 6, padding: 12 }}>
      <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
        <tbody>
          {rows.map(r => (
            <tr key={r.label} style={{ borderBottom: '1px solid #eee' }}>
              <td style={{ padding: '8px 4px', color: 'var(--muted)', width: 140 }}>{r.label}</td>
              <td style={{ padding: '8px 4px', fontWeight: 600, color: r.muted ? '#aaa' : '#1a1a1a' }}>{r.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {(summary.priceError || summary.remainsError) && (
        <div style={{ fontSize: 11, color: '#991b1b', marginTop: 8 }}>
          {summary.priceError && <div>Цена: {summary.priceError}</div>}
          {summary.remainsError && <div>Срок: {summary.remainsError}</div>}
        </div>
      )}
    </div>
  );
}
