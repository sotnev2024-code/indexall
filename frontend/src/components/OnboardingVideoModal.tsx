'use client';

interface Props {
  src: string;
  onClose: () => void;
}

/** Converts a YouTube/Vimeo watch URL to its embeddable form. Returns null
 *  for direct file URLs (mp4 etc.), which are played with a <video> tag. */
function toEmbedUrl(src: string): string | null {
  try {
    const u = new URL(src);
    const host = u.hostname.replace(/^www\./, '');
    if (host === 'youtu.be') {
      return `https://www.youtube.com/embed/${u.pathname.slice(1)}?autoplay=1`;
    }
    if (host === 'youtube.com' || host === 'm.youtube.com') {
      const id = u.searchParams.get('v');
      if (id) return `https://www.youtube.com/embed/${id}?autoplay=1`;
    }
    if (host === 'vimeo.com') {
      return `https://player.vimeo.com/video/${u.pathname.split('/').filter(Boolean)[0]}?autoplay=1`;
    }
  } catch { /* not a parseable URL — treat as direct file */ }
  return null;
}

/**
 * Onboarding video shown once to new users ~2s after the spec page opens.
 * Skippable via the close button or backdrop click. The trigger/once-only
 * logic lives in SpecPageClient (localStorage flags), not here.
 */
export default function OnboardingVideoModal({ src, onClose }: Props) {
  const embed = toEmbedUrl(src);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 10000,
        background: 'rgba(0,0,0,0.7)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          position: 'relative', width: '100%', maxWidth: 820,
          background: '#000', borderRadius: 14, overflow: 'hidden',
          boxShadow: '0 12px 50px rgba(0,0,0,0.45)',
        }}
      >
        <button
          onClick={onClose}
          title="Пропустить"
          style={{
            position: 'absolute', top: 10, right: 10, zIndex: 2,
            background: 'rgba(0,0,0,0.6)', color: '#fff',
            border: 'none', borderRadius: 8, padding: '6px 14px',
            fontSize: 13, fontWeight: 700, cursor: 'pointer',
          }}
        >
          Пропустить ✕
        </button>

        <div style={{ position: 'relative', width: '100%', aspectRatio: '16 / 9' }}>
          {embed ? (
            <iframe
              src={embed}
              title="Онбординг"
              allow="autoplay; fullscreen; picture-in-picture"
              allowFullScreen
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 'none' }}
            />
          ) : (
            <video
              src={src}
              controls
              autoPlay
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', background: '#000' }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
