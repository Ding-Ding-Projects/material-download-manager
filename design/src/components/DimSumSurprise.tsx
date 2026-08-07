import { useEffect } from "react";
import type { DimSumDish } from "../dimSum";
import { getUiCopy } from "../i18n/ui";
import { useAppStore } from "../store/useAppStore";

interface DimSumSurpriseProps {
  dish: DimSumDish;
  onDismiss: () => void;
}

export default function DimSumSurprise({ dish, onDismiss }: DimSumSurpriseProps) {
  const settings = useAppStore((state) => state.settings);
  const copy = getUiCopy(settings);

  useEffect(() => {
    const timeoutId = window.setTimeout(onDismiss, 8_000);
    return () => window.clearTimeout(timeoutId);
  }, [onDismiss]);

  const name = `${dish.nameEn} · ${dish.nameZhHant}`;
  return (
    <aside className="dim-sum-surprise" role="status" aria-live="polite" aria-label={copy.dimSumTitle(name)}>
      <div className="dim-sum-surprise-art" role="img" aria-label={name}>{dish.emoji}</div>
      <div className="dim-sum-surprise-copy">
        <strong>{copy.dimSumTitle(name)}</strong>
        <span>{copy.metadataFallback}</span>
      </div>
      <button type="button" className="notification-dismiss" onClick={onDismiss} aria-label={copy.close}>×</button>
    </aside>
  );
}
