import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Contrato Iris 0.8.0 (A1):
 *
 * - `encender_al_confirmar`: el canje directo nació del botón (§1.4, código con `code_challenge`).
 *   La primera llamada autenticada de su `atk_` (`iris.confirmar_canje`) enciende el conector
 *   (`activo = true`) y la apaga. Con el enlace (§1.3) y en una reconexión queda en false.
 * - `sincronizacion`: lo último que informó Iris de su primera sincronización
 *   (`PUT /integraciones/iris/sincronizacion`); es estado de Iris, no de Argos. null = nunca.
 *
 * Las filas existentes quedan con false y null.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE integraciones.iris_conector
                ADD COLUMN encender_al_confirmar boolean NOT NULL DEFAULT false,
                ADD COLUMN sincronizacion jsonb;
        `)
    }

    async down() {
        this.schema.raw(`
            ALTER TABLE integraciones.iris_conector
                DROP COLUMN IF EXISTS sincronizacion,
                DROP COLUMN IF EXISTS encender_al_confirmar;
        `)
    }
}
