import toast from 'react-hot-toast';

export function buildPrintUrl(path: string, autoprint = false): string {
  const token = localStorage.getItem('token') || '';
  const sep = path.includes('?') ? '&' : '?';
  const autoprintParam = autoprint ? '&autoprint=1' : '';
  return `${path}${sep}token=${encodeURIComponent(token)}${autoprintParam}`;
}

/** Open print HTML in a new tab (view only — no print dialog). */
export function openPrintTab(printPath: string): void {
  window.open(buildPrintUrl(printPath), '_blank', 'noopener,noreferrer');
}

/** Print from an already-loaded preview iframe (best UX on document view screens). */
export function printFromIframe(iframe: HTMLIFrameElement | null | undefined): boolean {
  try {
    const win = iframe?.contentWindow;
    if (!win) return false;
    win.focus();
    win.print();
    return true;
  } catch {
    return false;
  }
}

function waitForImages(win: Window, then: () => void): void {
  const imgs = win.document.images;
  if (!imgs.length) {
    setTimeout(then, 250);
    return;
  }
  let pending = imgs.length;
  const done = () => {
    pending -= 1;
    if (pending <= 0) setTimeout(then, 150);
  };
  for (let i = 0; i < imgs.length; i++) {
    if (imgs[i].complete) done();
    else {
      imgs[i].addEventListener('load', done);
      imgs[i].addEventListener('error', done);
    }
  }
}

function printViaHiddenIframe(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none';
    iframe.src = url;

    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      setTimeout(() => iframe.remove(), 2000);
      resolve(ok);
    };

    const timeout = window.setTimeout(() => finish(false), 15000);

    iframe.onload = () => {
      window.clearTimeout(timeout);
      try {
        const win = iframe.contentWindow;
        if (!win) {
          finish(false);
          return;
        }
        win.focus();
        waitForImages(win, () => {
          win.print();
          finish(true);
        });
      } catch {
        finish(false);
      }
    };

    iframe.onerror = () => {
      window.clearTimeout(timeout);
      finish(false);
    };

    document.body.appendChild(iframe);
  });
}

async function printViaPopup(printPath: string): Promise<void> {
  const url = buildPrintUrl(printPath);
  const token = localStorage.getItem('token') || '';
  const res = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error('Could not load print document');
  const html = await res.text();

  const printWin = window.open('', '_blank');
  if (!printWin) throw new Error('Popup blocked');

  printWin.document.open();
  printWin.document.write(html);
  printWin.document.close();

  const triggerPrint = () => {
    printWin.focus();
    waitForImages(printWin, () => {
      printWin.print();
    });
  };

  if (printWin.document.readyState === 'complete') triggerPrint();
  else printWin.addEventListener('load', triggerPrint);
}

/**
 * Open the system print dialog for a server-rendered document.
 * Uses a hidden iframe first (stays on current page), then popup fallback.
 */
export async function printDocument(printPath: string): Promise<void> {
  const iframeUrl = buildPrintUrl(printPath, false);
  try {
    const ok = await printViaHiddenIframe(iframeUrl);
    if (ok) return;
  } catch {
    /* try popup */
  }

  try {
    await printViaPopup(printPath);
  } catch {
    toast.error('Print failed — opening document in a new tab');
    openPrintTab(printPath);
  }
}
