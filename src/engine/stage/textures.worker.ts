/** Generates the desk textures off the main thread. Message: { id, kind: 'oak' | 'lino', opts }. */
import { oakTexture, type OakOptions } from './oak';
import { linoTexture, type LinoOptions } from './lino';

interface Request { id: number; kind: 'oak' | 'lino'; opts: Partial<OakOptions> | Partial<LinoOptions> }

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<Request>) => void) | null;
  postMessage(message: unknown, transfer: Transferable[]): void;
};

scope.onmessage = (e) => {
  const { id, kind, opts } = e.data;
  const t = kind === 'oak' ? oakTexture(opts as Partial<OakOptions>) : linoTexture(opts as Partial<LinoOptions>);
  scope.postMessage({ id, ...t }, [t.map.buffer, t.roughness.buffer, t.normal.buffer]);
};
