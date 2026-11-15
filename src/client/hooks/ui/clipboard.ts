/**
 * Safe clipboard copy utility with fallback for sandboxed iframe environments
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (!text) return false;
  
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (err) {
    // Fall back to legacy execCommand
  }

  try {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    textArea.style.top = '-999999px';
    textArea.setAttribute('readonly', '');
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    const successful = document.execCommand('copy');
    document.body.removeChild(textArea);
    return successful;
  } catch (err) {
    console.error('Failed to copy text: ', err);
    return false;
  }
}

/**
 * Read text from the clipboard, or null when the browser refused.
 *
 * There is no fallback, and there cannot be one: `execCommand('paste')` is
 * blocked by every browser and `navigator.clipboard.readText` needs a secure
 * context plus a permission the user grants once — so a denial is reported
 * rather than papered over with an empty paste.
 */
export async function readClipboardText(): Promise<string | null> {
  try {
    if (!navigator.clipboard || !window.isSecureContext) return null;
    return await navigator.clipboard.readText();
  } catch {
    return null;
  }
}

const COPY_ICON =
  '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
const CHECK_ICON =
  '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';

/**
 * Copy a code block's text and flash the checkmark on its button.
 *
 * The button is markup the markdown renderer injected, so the swap is DOM work
 * rather than component state — and it belongs next to the clipboard call it
 * reports, not in the renderer's delegated click handler.
 */
export function copyFromButton(button: HTMLButtonElement): void {
  const text = button.dataset.copy ?? '';
  if (!text) return;
  void copyToClipboard(text).then((ok) => {
    if (!ok) return;
    button.setAttribute('data-copied', 'true');
    button.innerHTML = CHECK_ICON;
    setTimeout(() => {
      button.removeAttribute('data-copied');
      button.innerHTML = COPY_ICON;
    }, 2000);
  });
}
