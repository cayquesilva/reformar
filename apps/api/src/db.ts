import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client.js';

export type Db = InstanceType<typeof PrismaClient>;
export type Tx = Parameters<Parameters<Db['$transaction']>[0]>[0];

export function createDb(connectionString: string): Db {
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

export { Prisma } from './generated/prisma/client.js';
