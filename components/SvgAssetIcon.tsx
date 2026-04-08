import React, { useEffect, useMemo, useState } from 'react';
import type { LucideIcon } from 'lucide-react';

interface SvgAssetIconProps {
  name: string;
  alt: string;
  size?: number;
  className?: string;
  imgClassName?: string;
  fallbackIcon: LucideIcon;
  candidates?: string[];
}

export function SvgAssetIcon({
  name,
  alt,
  size = 18,
  className = '',
  imgClassName = 'h-full w-full object-contain',
  fallbackIcon: FallbackIcon,
  candidates,
}: SvgAssetIconProps) {
  const [failedSources, setFailedSources] = useState<string[]>([]);

  const sources = useMemo(
    () => (candidates && candidates.length > 0 ? candidates : [`/svg/${name}.svg`]),
    [candidates, name]
  );

  useEffect(() => {
    setFailedSources([]);
  }, [name, sources]);

  const source = sources.find((candidate) => !failedSources.includes(candidate));

  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center ${className}`.trim()}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {source ? (
        <img
          src={source}
          alt={alt}
          className={imgClassName}
          onError={() => {
            setFailedSources((prev) => (prev.includes(source) ? prev : [...prev, source]));
          }}
        />
      ) : (
        <FallbackIcon size={size} className="h-full w-full" />
      )}
    </span>
  );
}