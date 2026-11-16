import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Armazenamento de arquivos (fotos, comprovantes). Chaves sempre prefixadas pela empresa.
 * Implementação atual: disco local (um servidor). Para vários servidores/produção em nuvem,
 * implementar esta mesma interface com armazenamento de objetos S3 compatível (pendente).
 */
export interface Storage {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}

export class LocalDiskStorage implements Storage {
  constructor(private readonly root: string) {}

  private resolve(key: string): string {
    // Impede "path traversal": a chave é gerada pelo servidor, mas validamos de novo.
    if (!/^[0-9a-f-]{36}\/[a-z]+\/[0-9a-f-]{36}\.(jpg|png|webp|pdf)$/.test(key)) throw new Error('Chave de arquivo inválida');
    const full = path.resolve(this.root, key);
    if (!full.startsWith(path.resolve(this.root) + path.sep)) throw new Error('Chave fora do armazenamento');
    return full;
  }

  async put(key: string, data: Buffer): Promise<void> {
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, data, { flag: 'wx' });
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.resolve(key));
  }

  async remove(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }
}

export type StoredMime = 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf';
const EXT: Record<StoredMime, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };

/** Detecta o tipo REAL pelo conteúdo (assinatura binária), não pelo cabeçalho enviado. */
export function detectFileMime(buf: Buffer): StoredMime | null {
  if (buf.length < 12) return null;
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  if (buf.toString('latin1', 0, 5) === '%PDF-') return 'application/pdf';
  return null;
}

export function newStorageKey(tenantId: string, folder: 'photos' | 'receipts', mime: StoredMime): string {
  return `${tenantId}/${folder}/${randomUUID()}.${EXT[mime]}`;
}

/** Store em memória (testes). */
export class MemoryStorage implements Storage {
  readonly files = new Map<string, Buffer>();
  async put(key: string, data: Buffer) {
    this.files.set(key, data);
  }
  async get(key: string) {
    const f = this.files.get(key);
    if (!f) throw new Error('não encontrado');
    return f;
  }
  async remove(key: string) {
    this.files.delete(key);
  }
}
