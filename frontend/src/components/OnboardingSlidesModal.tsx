'use client';
import { useState } from 'react';
import type { OnboardingSlide } from '@/lib/api';

interface Props {
  slides: OnboardingSlide[];
  onClose: () => void;
}

/** Converts a YouTube/Vimeo watch URL to its embeddable form. Returns null
 *  for direct file URLs (mp4 etc.), which are played with a <video> tag. */
function toEmbedUrl(src: string): string | null {
  try {
    const u = new URL(src);
    const host = u.hostname.replace(/^www\./, '');
    if (host === 'youtu.be') {
      return `https://www.youtube.com/embed/${u.pathname.slice(1)}`;
    }
    if (host === 'youtube.com' || host === 'm.youtube.com') {
      const id = u.searchParams.get('v');
      if (id) return `https://www.youtube.com/embed/${id}`;
    }
    if (host === 'vimeo.com') {
      return `https://player.vimeo.com/video/${u.pathname.split('/').filter(Boolean)[0]}`;
    }
  } catch { /* not a parseable URL — treat as direct file */ }
  return null;
}

function SlideMedia({ slide }: { slide: OnboardingSlide }) {
  if (!slide.mediaUrl) return null;
  // Media fills the available space; backgrounds are white so there are no
  // grey letterbox bars around portrait/landscape images.
  const wrapStyle: React.CSSProperties = {
    position: 'relative', flex: 1, minHeight: 0, width: '100%',
    background: '#fff', borderRadius: 10, overflow: 'hidden',
  };
  if (slide.mediaType === 'video') {
    const embed = toEmbedUrl(slide.mediaUrl);
    return (
      <div style={wrapStyle}>
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
            src={slide.mediaUrl}
            controls
            autoPlay
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', background: '#fff', objectFit: 'contain' }}
          />
        )}
      </div>
    );
  }
  return (
    <div style={wrapStyle}>
      <img
        src={slide.mediaUrl}
        alt={slide.title || 'Онбординг'}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain' }}
      />
    </div>
  );
}

/**
 * Step-by-step onboarding shown once per section. Each slide carries an
 * optional image/video plus a title and text. Near-fullscreen and responsive.
 * Skippable at any step. Reused in the admin panel as a live preview.
 */
export default function OnboardingSlidesModal({ slides, onClose }: Props) {
  const [idx, setIdx] = useState(0);
  if (!slides.length) return null;

  const slide = slides[Math.min(idx, slides.length - 1)];
  const isLast = idx >= slides.length - 1;
  const isFirst = idx <= 0;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 10000,
        background: 'rgba(0,0,0,0.7)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '2vh 1.5vw',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          position: 'relative',
          width: '97vw', maxWidth: 1853,
          height: '96vh', maxHeight: 884,
          background: '#fff', borderRadius: 16, overflow: 'hidden',
          boxShadow: '0 12px 50px rgba(0,0,0,0.45)',
          display: 'flex', flexDirection: 'column',
        }}
      >
        <button
          onClick={onClose}
          title="Пропустить"
          style={{
            position: 'absolute', top: 14, right: 14, zIndex: 2,
            background: 'rgba(0,0,0,0.55)', color: '#fff',
            border: 'none', borderRadius: 8, padding: '7px 14px',
            fontSize: 13, fontWeight: 700, cursor: 'pointer',
          }}
        >
          Пропустить ✕
        </button>

        {/* Content area — media fills, text sits beneath */}
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: 24, gap: 8 }}>
          <SlideMedia slide={slide} />

          {(slide.title || slide.description) && (
            <div style={{ flexShrink: 0, maxHeight: '28vh', overflowY: 'auto' }}>
              {slide.title && (
                <h2 style={{ fontSize: 24, fontWeight: 800, margin: '12px 0 6px' }}>{slide.title}</h2>
              )}
              {slide.description && (
                <p style={{ fontSize: 15, color: '#4b5563', lineHeight: 1.6, margin: 0, whiteSpace: 'pre-wrap' }}>
                  {slide.description}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Controls */}
        <div style={{
          flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 12, padding: '14px 24px', borderTop: '1px solid #eee',
        }}>
          {/* Dots */}
          <div style={{ display: 'flex', gap: 6 }}>
            {slides.map((_, i) => (
              <span
                key={i}
                onClick={() => setIdx(i)}
                style={{
                  width: 9, height: 9, borderRadius: '50%', cursor: 'pointer',
                  background: i === idx ? '#f5c800' : '#d1d5db',
                  transition: 'background .15s',
                }}
              />
            ))}
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            {!isFirst && (
              <button
                onClick={() => setIdx(i => Math.max(0, i - 1))}
                style={{
                  padding: '10px 18px', background: '#f3f4f6', color: '#1a1a1a',
                  border: 'none', borderRadius: 9, fontWeight: 700, fontSize: 14, cursor: 'pointer',
                }}
              >
                Назад
              </button>
            )}
            <button
              onClick={() => { if (isLast) onClose(); else setIdx(i => i + 1); }}
              style={{
                padding: '10px 26px', background: '#f5c800', color: '#1a1a1a',
                border: 'none', borderRadius: 9, fontWeight: 800, fontSize: 14, cursor: 'pointer',
              }}
            >
              {isLast ? 'Готово' : 'Далее'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
