// Reexporta o ZodValidationPipe de `nestjs-zod` para manter o caminho de import
// ja convencionado neste backend (`src/common/pipes/zod-validation.pipe.ts`).
// Uso: `@UsePipes(new ZodValidationPipe(createUserSchema))` ou `app.useGlobalPipes(new ZodValidationPipe())`
// com DTOs criados via `createZodDto` de `nestjs-zod`.
export { ZodValidationPipe } from 'nestjs-zod';
