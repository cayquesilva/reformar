import type { FastifyBaseLogger } from 'fastify';

export interface Mailer {
  /** false quando não há provedor de e-mail configurado (a UI deve informar isso ao usuário). */
  readonly enabled: boolean;
  sendPasswordReset(to: string, link: string): Promise<void>;
}

/** Nenhum provedor configurado: o envio não acontece. */
export class DisabledMailer implements Mailer {
  readonly enabled = false;
  async sendPasswordReset(): Promise<void> {
    /* intencionalmente vazio */
  }
}

/**
 * SOMENTE DESENVOLVIMENTO: escreve o link no log do servidor.
 * Bloqueado em produção por loadConfig(). Não é um envio real de e-mail.
 */
export class ConsoleMailer implements Mailer {
  readonly enabled = true;
  constructor(private readonly log: FastifyBaseLogger) {}
  async sendPasswordReset(to: string, link: string): Promise<void> {
    this.log.warn({ to }, `[DEV] Link de redefinição de senha (e-mail NÃO enviado): ${link}`);
  }
}

/** Captura mensagens em memória (testes automatizados). */
export class MemoryMailer implements Mailer {
  readonly enabled = true;
  readonly sent: { to: string; link: string }[] = [];
  async sendPasswordReset(to: string, link: string): Promise<void> {
    this.sent.push({ to, link });
  }
}
