import {useEffect, useState, useSyncExternalStore} from 'react';
import {
  BOXING_BUDDY,
  HERO_FIGHTER,
  modelsSettled,
  subscribeModelStatus,
} from '~/lib/modelLoadStatus';

const HOME_MODELS = [HERO_FIGHTER, BOXING_BUDDY] as const;

/**
 * PageLoader
 * Full-screen loader shown until every 3D model on the page has settled
 * (loaded or failed). Sits above the header and the aside overlays so the
 * half-built scene is never visible underneath.
 *
 * On the server it renders nothing — the models only start downloading once
 * the JS runs, so there is nothing to wait for before hydration.
 */
export function PageLoader({keys = HOME_MODELS}: {keys?: readonly string[]}) {
  const settled = useSyncExternalStore(
    subscribeModelStatus,
    () => modelsSettled(keys),
    () => true,
  );
  const [gone, setGone] = useState(false);

  useEffect(() => {
    if (!settled) return;
    // Keep the node mounted just long enough for the fade-out to play.
    const timer = setTimeout(() => setGone(true), 280);
    return () => clearTimeout(timer);
  }, [settled]);

  if (gone) return null;

  return (
    <div
      className="page-loader"
      data-state={settled ? 'leaving' : 'loading'}
      role="status"
      aria-live="polite"
    >
      <div className="page-loader-glove" aria-hidden="true">
        🥊
      </div>
      <p className="page-loader-text">Loading the ring</p>
      <div className="page-loader-bar" aria-hidden="true">
        <span />
      </div>
    </div>
  );
}
