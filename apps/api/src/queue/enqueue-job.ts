import { Logger, ServiceUnavailableException } from '@nestjs/common';
import type { JobsOptions, Queue } from 'bullmq';

const logger = new Logger('QueueProducer');

// Enfileiramento NUNCA fail-open: com a fila indisponivel, o handler do webhook do
// Stripe precisa responder erro para o Stripe reenviar o evento, e uma importacao
// precisa falhar visivel em vez de sumir. Por isso uma falha de enqueue vira 503 (nao
// null): engolir o erro faria o handler dar ack 200 e o evento se perderia sem rastro.
// A message traduzida do contrato de erro (RF-63) entra com o ExceptionFilter global.
//
// Queue<T, unknown, string, T, unknown, string> (nao Queue<T> sozinho): em bullmq, o
// generico NameType efetivamente usado por Queue e' o SEXTO parametro de tipo — o terceiro
// (DefaultNameType) so alimenta ExtractNameType<DataTypeOrJob, DefaultNameType>, que fica
// deferido/nao resolvido quando DataTypeOrJob e' o proprio T generico de enqueueJob (nao
// um tipo concreto), entao TypeScript nao consegue provar que 'string' e' atribuivel a esse
// tipo. So fixar o terceiro parametro NAO resolve — e' necessario fixar o sexto (NameType)
// tambem.
export async function enqueueJob<T>(
  queue: Queue<T, unknown, string, T, unknown, string>,
  name: string,
  data: T,
  opts?: JobsOptions,
) {
  try {
    return await queue.add(name, data, opts);
  } catch (error) {
    logger.error(
      `Failed to enqueue job "${name}" on queue "${queue.name}": ${(error as Error).message}`,
    );
    throw new ServiceUnavailableException({
      error: 'Service Unavailable',
      code: 'QUEUE_UNAVAILABLE',
    });
  }
}
