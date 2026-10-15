// Ponto de partida das abstracoes compartilhadas do backend. Distinto de
// packages/contracts (schemas Zod compartilhados com os clientes, PRD secao 6.1):
// este pacote e consumido apenas por apps/api, nunca pelos apps web.

export interface TransactionContext {
  client: unknown;
}

export interface TransactionManager<TContext extends TransactionContext = TransactionContext> {
  runInTransaction<T>(operation: (context: TContext) => Promise<T>): Promise<T>;
}
