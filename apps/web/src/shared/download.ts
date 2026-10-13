/** Saves text as a file through the browser's download (an object URL on a temporary link). */
export function downloadText(fileName: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  // Revoke after the click has been handled, so the download can start.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
