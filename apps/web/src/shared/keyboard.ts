/** True when a key press is typing into a field, so page shortcuts must not react to it. */
export function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
}

/** True when a shortcut should be ignored: typing, or a modifier key is held. */
export function ignoreShortcut(event: { target: EventTarget | null; metaKey: boolean; ctrlKey: boolean; altKey: boolean }): boolean {
  return isTypingTarget(event.target) || event.metaKey || event.ctrlKey || event.altKey;
}
