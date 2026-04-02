export default function SpecLoading() {
  return (
    <div className="spec-screen">
      {/* Header skeleton */}
      <div
        style={{
          background: 'var(--black)',
          height: 'var(--header-h)',
          position: 'fixed',
          top: 0, left: 0, right: 0,
          zIndex: 100,
          display: 'flex',
          alignItems: 'center',
          padding: '0 16px',
          gap: 12,
        }}
      >
        <div className="skeleton" style={{ width: 120, height: 28, background: '#333', animation: 'none', borderRadius: 4 }} />
        <div style={{ display: 'flex', gap: 6 }}>
          <div className="skeleton" style={{ width: 28, height: 28, background: '#333', animation: 'none', borderRadius: 4 }} />
          <div className="skeleton" style={{ width: 28, height: 28, background: '#333', animation: 'none', borderRadius: 4 }} />
        </div>
        <div className="skeleton" style={{ width: 200, height: 16, background: '#333', animation: 'none', borderRadius: 4, marginLeft: 8 }} />
        <div style={{ flex: 1 }} />
        <div className="skeleton" style={{ width: 80, height: 28, background: '#333', animation: 'none', borderRadius: 6 }} />
        <div className="skeleton" style={{ width: 90, height: 16, background: '#333', animation: 'none', borderRadius: 4 }} />
        <div className="skeleton" style={{ width: 70, height: 28, background: '#333', animation: 'none', borderRadius: 9999 }} />
      </div>

      {/* Toolbar skeleton */}
      <div className="spec-toolbar">
        {[140, 120, 90, 80].map((w, i) => (
          <div key={i} className="skeleton" style={{ width: w, height: 32, borderRadius: 6 }} />
        ))}
        <div style={{ flex: 1 }} />
        <div className="skeleton" style={{ width: 260, height: 20, borderRadius: 4 }} />
      </div>

      {/* Brand bar skeleton */}
      <div className="spec-brand-bar">
        {[70, 50, 55, 70, 65, 55, 65, 50].map((w, i) => (
          <div key={i} className="skeleton" style={{ width: w, height: 26, borderRadius: 13 }} />
        ))}
      </div>

      {/* Sheet tabs skeleton */}
      <div className="sheet-tabs">
        {[90, 80, 100].map((w, i) => (
          <div key={i} style={{ padding: '8px 14px', display: 'flex', alignItems: 'center' }}>
            <div className="skeleton" style={{ width: w, height: 16, borderRadius: 4 }} />
          </div>
        ))}
      </div>

      {/* Table skeleton */}
      <div className="spec-table-wrap" style={{ padding: '0 0 16px' }}>
        {/* Table header */}
        <div style={{ display: 'flex', gap: 1, padding: '8px 6px', borderBottom: '2px solid var(--border)', background: 'var(--white)' }}>
          {[30, 360, 90, 120, 60, 60, 80, 90, 80, 90].map((w, i) => (
            <div key={i} className="skeleton" style={{ width: w, height: 14, borderRadius: 3, flexShrink: 0 }} />
          ))}
        </div>
        {/* Table rows */}
        {Array.from({ length: 18 }).map((_, i) => (
          <div
            key={i}
            style={{
              display: 'flex', gap: 1, padding: '7px 6px',
              background: i % 2 === 0 ? 'var(--row-odd)' : 'var(--row-even)',
              borderBottom: '1px solid #f0f0f0',
            }}
          >
            <div className="skeleton" style={{ width: 30, height: 13, borderRadius: 3, flexShrink: 0, opacity: 0.5 }} />
            <div className="skeleton" style={{ width: 360 - (i % 3) * 40, height: 13, borderRadius: 3, flexShrink: 0 }} />
            <div className="skeleton" style={{ width: 90, height: 13, borderRadius: 3, flexShrink: 0, opacity: i % 4 === 0 ? 0 : 0.7 }} />
            <div className="skeleton" style={{ width: 120 - (i % 2) * 30, height: 13, borderRadius: 3, flexShrink: 0, opacity: i % 3 === 0 ? 0.4 : 1 }} />
            {[60, 60, 80, 90, 80, 90].map((w, j) => (
              <div key={j} className="skeleton" style={{ width: w, height: 13, borderRadius: 3, flexShrink: 0, opacity: i % 4 === 0 && j > 2 ? 0 : 0.6 }} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
