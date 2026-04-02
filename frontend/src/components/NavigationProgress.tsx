'use client';
import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';

export default function NavigationProgress() {
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);
  const [width, setWidth] = useState(0);
  const completeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function startProgress() {
      if (completeTimer.current) clearTimeout(completeTimer.current);
      if (hideTimer.current) clearTimeout(hideTimer.current);
      setWidth(0);
      setVisible(true);
      // Ramp up to 75% over 10s to simulate indeterminate loading
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setWidth(75));
      });
    }
    window.addEventListener('navigation:start', startProgress);
    return () => window.removeEventListener('navigation:start', startProgress);
  }, []);

  // When pathname changes, navigation is done — complete the bar
  const isFirst = useRef(true);
  useEffect(() => {
    if (isFirst.current) { isFirst.current = false; return; }
    if (!visible) return;
    setWidth(100);
    completeTimer.current = setTimeout(() => {
      setVisible(false);
      setWidth(0);
    }, 350);
    return () => {
      if (completeTimer.current) clearTimeout(completeTimer.current);
    };
  }, [pathname]);

  if (!visible) return null;

  return (
    <div className="nav-progress-bar">
      <div
        className="nav-progress-fill"
        style={{
          width: `${width}%`,
          transition: width === 100
            ? 'width 0.2s ease-out'
            : 'width 10s cubic-bezier(0.05, 0.8, 0.1, 1)',
        }}
      />
    </div>
  );
}
