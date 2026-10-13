import { useEffect, useRef } from 'preact/hooks';

/**
 * Textarea that grows with its content up to a max height, then scrolls.
 * Keeps short fields compact while long notes/description stay fully readable
 * without a nested scrollbar grabbing the whole modal.
 */
export function AutoTextarea({
  value,
  onInput,
  placeholder,
  minRows = 2,
  maxRows = 12,
  className = '',
  ariaLabel,
}: {
  value: string;
  onInput: (value: string) => void;
  placeholder?: string;
  minRows?: number;
  maxRows?: number;
  className?: string;
  ariaLabel?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Reset height first so the box can shrink when content is deleted.
    el.style.height = 'auto';
    const styles = typeof getComputedStyle === 'function' ? getComputedStyle(el) : null;
    const lineHeight = parseFloat(styles?.lineHeight || '') || 20;
    const verticalPadding =
      (parseFloat(styles?.paddingTop || '') || 0) + (parseFloat(styles?.paddingBottom || '') || 0);
    const border = (parseFloat(styles?.borderTopWidth || '') || 0) * 2;
    const maxHeight = maxRows * lineHeight + verticalPadding + border;
    const next = Math.min(el.scrollHeight, maxHeight);
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, [value, minRows, maxRows]);

  return (
    <textarea
      ref={ref}
      class={`input w-full ${className}`}
      rows={minRows}
      value={value}
      placeholder={placeholder}
      aria-label={ariaLabel}
      onInput={(e) => onInput((e.target as HTMLTextAreaElement).value)}
    />
  );
}