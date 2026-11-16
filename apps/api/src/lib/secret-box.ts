import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Cifra credenciais guardadas no banco (AES-256-GCM, nonce aleatório de 12 bytes, tag de 16).
 * Formato: v1.<nonce>.<tag>.<cifrado> em base64url. A chave vem de SECRETS_KEY (32 bytes em base64).
 */
export class SecretBox {
  constructor(private readonly key: Buffer) {
    if (key.length !== 32) throw new Error('SECRETS_KEY precisa ter 32 bytes (em base64).');
  }

  seal(plain: string): string {
    const nonce = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.key, nonce);
    const data = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
    return ['v1', nonce.toString('base64url'), c.getAuthTag().toString('base64url'), data.toString('base64url')].join('.');
  }

  open(sealed: string): string {
    const [v, nonce, tag, data] = sealed.split('.');
    if (v !== 'v1' || !nonce || !tag || data === undefined) throw new Error('Credencial cifrada em formato desconhecido.');
    const d = createDecipheriv('aes-256-gcm', this.key, Buffer.from(nonce, 'base64url'));
    d.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([d.update(Buffer.from(data, 'base64url')), d.final()]).toString('utf8');
  }
}
