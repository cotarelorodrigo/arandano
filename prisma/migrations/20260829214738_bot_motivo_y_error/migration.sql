-- CreateEnum
CREATE TYPE "motivo_sin_respuesta" AS ENUM ('BOT_APAGADO', 'TOPE_MENSUAL', 'TOPE_CONVERSACION', 'SIN_TEXTO', 'SIN_MODELO');

-- AlterTable
ALTER TABLE "mensajes_bot" ADD COLUMN     "error" TEXT,
ADD COLUMN     "motivo" "motivo_sin_respuesta";
