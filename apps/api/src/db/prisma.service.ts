import { TransactionContext, TransactionManager } from '@hypomna/shared';
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';

import { Prisma, PrismaClient } from '../generated/prisma/client.js';

export interface PrismaTransactionContext extends TransactionContext {
  client: Prisma.TransactionClient;
}

@Injectable()
export class PrismaService
  implements
    OnModuleInit,
    OnModuleDestroy,
    TransactionManager<PrismaTransactionContext>
{
  readonly client: PrismaClient;

  constructor() {
    this.client = new PrismaClient({
      adapter: new PrismaPg({
        connectionString: process.env.DATABASE_URL!,
      }),
    });
  }

  async onModuleInit() {
    await this.client.$connect();
  }

  async onModuleDestroy() {
    await this.client.$disconnect();
  }

  async runInTransaction<T>(
    operation: (context: PrismaTransactionContext) => Promise<T>,
  ): Promise<T> {
    return this.client.$transaction(async (tx) => {
      return operation({ client: tx });
    });
  }
}
