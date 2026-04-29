'use client';
import { useState } from 'react';

/**
 * Admin-only floating helper: enter an article (or ETM code) and see the raw
 * ETM /price + /remains response side-by-side. Lets the admin verify what
 * ETM is actually returning for any SKU without having to find that product
 * in the catalog UI first. Reuses the same backend handler as the per-card
 * «Информация» button.
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
        style={{ maxWidth: 900, width: '95vw', maxHeight: '90vh', overflowY: 'auto' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="modal-title">ЭТМ-проверка артикула (админ)</div>
        <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>
          Прямой запрос к ETM iPRO без кэша и без логики приложения. Показывает
          все поля цены и наличия как их вернул ЭТМ.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          <div>
            <label style={{ display: 'block', fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>
              Артикул производителя (type=mnf)
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
              ETM-код (type=etm) — необязательно
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {result.error ? (
              <div style={{ padding: 12, background: '#fef2f2', color: '#991b1b', borderRadius: 6, fontSize: 12 }}>
                {result.error}
              </div>
            ) : (
              <>
                {result.request && (
                  <div style={{ fontSize: 12, color: '#555', background: '#f8f9fa', padding: 10, borderRadius: 6 }}>
                    <div>Артикул: <strong style={{ color: '#1a1a1a' }}>{result.request.article || '—'}</strong></div>
                    <div>ETM-код: <strong style={{ color: '#1a1a1a' }}>{result.request.etm_code || '—'}</strong></div>
                    <div>
                      Тип запроса: <strong style={{ color: '#1a1a1a' }}>{result.request.codeType}</strong>
                      {' → '}
                      <span style={{ fontFamily: 'monospace', color: '#1a1a1a' }}>{result.request.codeUsed}</span>
                    </div>
                    <div>Сессия: <strong style={{ color: '#1a1a1a' }}>{result.request.sessionType}</strong></div>
                  </div>
                )}
                <section>
                  <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, color: '#1a1a1a' }}>/price</h4>
                  <pre style={{ background: '#f8f9fa', color: '#1a1a1a', padding: 10, borderRadius: 6, fontSize: 11, overflow: 'auto', maxHeight: 260, margin: 0 }}>
                    {JSON.stringify(result.priceResponse, null, 2)}
                  </pre>
                </section>
                <section>
                  <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, color: '#1a1a1a' }}>/remains</h4>
                  <pre style={{ background: '#f8f9fa', color: '#1a1a1a', padding: 10, borderRadius: 6, fontSize: 11, overflow: 'auto', maxHeight: 260, margin: 0 }}>
                    {JSON.stringify(result.remainsResponse, null, 2)}
                  </pre>
                </section>
              </>
            )}
          </div>
        )}

        <div className="modal-actions" style={{ marginTop: 16 }}>
          <button className="btn-cancel" onClick={onClose}>Закрыть</button>
        </div>
      </div>
    </div>
  );
}
