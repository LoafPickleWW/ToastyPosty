// Pera/Defly's connect libraries read the global Buffer, which browsers don't have.
import { Buffer } from 'buffer';
if (!globalThis.Buffer) globalThis.Buffer = Buffer;
export { Buffer };
