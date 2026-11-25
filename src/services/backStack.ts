/**
 * The back button closes what is open before it leaves the app.
 *
 * A phone's back button (and the browser's) walks the history, and a web app that never writes to
 * it is left in one step: with a card or a panel open, «back» closed MeteoMapGal instead of the
 * card. Each thing that opens holds a SLOT here: one history entry while it is open. Back pops the
 * newest slot and calls its close; closing from the interface takes the entry back out, so the
 * history never grows with use.
 *
 * A slot is a place, not a thing: opening another card while one is open keeps the same entry
 * (and swaps its address), so ten cards in a row are still one step back, not ten.
 */

export interface BackSlotOptions {
  /** Address of the entry while the slot is held, so what is open can be shared and reloaded. */
  url?: string;
  /** Runs once the entry is gone after a close from the interface (not after a back press). */
  onReleased?: () => void;
}

interface HistoryLike {
  pushState(data: unknown, unused: string, url?: string | URL | null): void;
  replaceState(data: unknown, unused: string, url?: string | URL | null): void;
  back(): void;
}

interface WindowLike {
  history: HistoryLike;
  /** Where the page is: the address under a slot, put back when a holder with no address of its own takes it. */
  location?: { href: string };
  addEventListener(type: 'popstate', listener: () => void): void;
  setTimeout(handler: () => void, ms: number): unknown;
  clearTimeout(id: never): void;
}

interface Slot {
  name: string;
  onBack: () => void;
  onReleased?: () => void;
  pending: unknown | null;
  /** The address before the slot was pushed (the map's). */
  baseUrl?: string;
  /** The current holder wrote its own address. */
  hasUrl: boolean;
}

export function createBackStack(win: WindowLike) {
  const stack: Slot[] = [];
  /** Releases waiting for their own `back()` to land: that popstate is ours, not the user's. */
  const awaited: Array<(() => void) | undefined> = [];
  /**
   * Entries left under what is on top: a menu that closes itself to open the guide cannot take its
   * entry out without dragging the guide's address with it. They go when what is on top goes.
   */
  let buried = 0;
  let listening = false;

  const dropBuried = () => {
    while (buried > 0) {
      buried--;
      awaited.push(undefined);
      win.history.back();
    }
  };

  const onPop = () => {
    if (awaited.length > 0) {
      awaited.shift()?.();
      return;
    }
    const top = stack.pop();
    if (!top) return;
    if (top.pending != null) win.clearTimeout(top.pending as never);
    top.onBack();
    if (stack.length === 0) dropBuried();
  };

  /**
   * Hold a slot while something is open. Returns the release, to call when it closes for any
   * reason: after a back press it does nothing, the entry is already gone.
   */
  function hold(name: string, onBack: () => void, options: BackSlotOptions = {}): () => void {
    if (!listening) {
      win.addEventListener('popstate', onPop);
      listening = true;
    }
    let slot = stack.find((s) => s.name === name);
    if (slot) {
      // The same place changing hands (another card, or the same one remounting): keep the entry.
      if (slot.pending != null) win.clearTimeout(slot.pending as never);
      slot.pending = null;
      slot.onBack = onBack;
      slot.onReleased = options.onReleased;
      if (options.url) win.history.replaceState({ mmSlot: name }, '', options.url);
      // A holder with no address of its own after one with it (a station card after a spot card): the
      // address under the slot comes back, or «?spot=» stayed in the bar for a station (P3 review, 19-nov).
      else if (slot.hasUrl && slot.baseUrl) win.history.replaceState({ mmSlot: name }, '', slot.baseUrl);
      slot.hasUrl = !!options.url;
    } else {
      slot = { name, onBack, onReleased: options.onReleased, pending: null, baseUrl: win.location?.href, hasUrl: !!options.url };
      stack.push(slot);
      win.history.pushState({ mmSlot: name }, '', options.url);
    }
    const mine = slot;
    return () => {
      if (!stack.includes(mine) || mine.onBack !== onBack || mine.pending != null) return;
      // Not at once: a card that is being swapped for another releases and holds in the same tick.
      mine.pending = win.setTimeout(() => {
        mine.pending = null;
        const i = stack.indexOf(mine);
        if (i === -1) return;
        const onTop = i === stack.length - 1;
        stack.splice(i, 1);
        if (!onTop) {
          buried++;
          mine.onReleased?.();
          return;
        }
        awaited.push(mine.onReleased);
        win.history.back();
        if (stack.length === 0) dropBuried();
      }, 0);
    };
  }

  return { hold, depth: () => stack.length };
}

const shared = typeof window === 'undefined' ? null : createBackStack(window as unknown as WindowLike);

/** Hold a slot in the app's own back stack. Without a window (tests of pure code) it does nothing. */
export function holdBackSlot(name: string, onBack: () => void, options?: BackSlotOptions): () => void {
  return shared ? shared.hold(name, onBack, options) : () => {};
}
