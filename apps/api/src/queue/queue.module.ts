import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { createQueueConnectionOptions } from '../lib/redis.js';

// Fila de execucao assincrona (PRD 6.2): importacao, recalculo de status de
// mesa, exportacao, e-mails e webhooks rodam aqui como jobs, nunca de forma
// sincrona dentro de um handler HTTP. Todo job carrega o tenantId no payload
// assinado pelo produtor e restabelece o TenantContext antes de acessar dado
// (PRD 3.2). Jobs com falha sao reprocessados com backoff exponencial; falha
// permanente (apos QUEUE_MAX_ATTEMPTS) fica registrada para observabilidade
// (RF-84), nunca silenciosa.
//
// Filas concretas sao registradas por submodulos importados abaixo (um por
// "--queue <nome>" rodado nesta skill) — nao adicione registerQueue() direto
// aqui, para nao conflitar com a injecao automatica de imports desta skill.
@Module({
  imports: [
    BullModule.forRootAsync({
      useFactory: () => ({
        connection: createQueueConnectionOptions(),
        defaultJobOptions: {
          attempts: Number(process.env.QUEUE_MAX_ATTEMPTS ?? 5),
          backoff: {
            type: 'exponential',
            delay: Number(process.env.QUEUE_BACKOFF_DELAY_MS ?? 2000),
          },
          removeOnComplete: true,
        },
      }),
    }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
