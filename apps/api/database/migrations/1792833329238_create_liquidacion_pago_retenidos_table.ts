import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A3 · H61 (auditor): con proveedor de cobro, la retención de IVA de la emisora que avisa la pasarela
 * va a 1.1.05 en el pago y el puente 1.1.10.NN recibe `monto − retenido`. La liquidación cuenta cada
 * pago por ese importe: el trigger `ledger.validar_liquidacion_pago` compara con `monto − retenido`
 * (antes, `monto`; sin retención es lo mismo).
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE OR REPLACE FUNCTION ledger.validar_liquidacion_pago() RETURNS trigger
            LANGUAGE plpgsql AS $fn$
            DECLARE
                v_liq record;
                v_pago record;
            BEGIN
                SELECT empresa_id, proveedor_cobro_id INTO v_liq FROM ledger.liquidaciones_cobro WHERE id = NEW.liquidacion_id;
                SELECT empresa_id, proveedor_cobro_id, monto - retenido AS monto, estado INTO v_pago FROM billing.pagos WHERE id = NEW.pago_id;
                IF v_pago.empresa_id <> v_liq.empresa_id OR v_pago.proveedor_cobro_id IS DISTINCT FROM v_liq.proveedor_cobro_id THEN
                    RAISE EXCEPTION 'El pago % no es de la empresa ni del proveedor de la liquidación %', NEW.pago_id, NEW.liquidacion_id
                        USING ERRCODE = 'check_violation', CONSTRAINT = 'liquidacion_de_otro_proveedor';
                END IF;
                IF NEW.monto <> v_pago.monto THEN
                    RAISE EXCEPTION 'El pago % se liquida por su monto menos lo retenido (%), no por %', NEW.pago_id, v_pago.monto, NEW.monto
                        USING ERRCODE = 'check_violation', CONSTRAINT = 'liquidacion_monto';
                END IF;
                IF NEW.tipo = 'cobro' AND v_pago.estado <> 'registrado' THEN
                    RAISE EXCEPTION 'El pago % no está registrado', NEW.pago_id
                        USING ERRCODE = 'check_violation', CONSTRAINT = 'liquidacion_pago_no_vigente';
                END IF;
                IF NEW.tipo = 'contracargo' AND (v_pago.estado <> 'anulado' OR NOT EXISTS (
                    SELECT 1 FROM ledger.liquidaciones_pagos x WHERE x.pago_id = NEW.pago_id AND x.tipo = 'cobro')) THEN
                    RAISE EXCEPTION 'El pago % no es un contracargo: no está anulado o nunca se liquidó', NEW.pago_id
                        USING ERRCODE = 'check_violation', CONSTRAINT = 'liquidacion_contracargo';
                END IF;
                RETURN NEW;
            END
            $fn$;
        `)
    }

    async down() {
        this.schema.raw(`
            CREATE OR REPLACE FUNCTION ledger.validar_liquidacion_pago() RETURNS trigger
            LANGUAGE plpgsql AS $fn$
            DECLARE
                v_liq record;
                v_pago record;
            BEGIN
                SELECT empresa_id, proveedor_cobro_id INTO v_liq FROM ledger.liquidaciones_cobro WHERE id = NEW.liquidacion_id;
                SELECT empresa_id, proveedor_cobro_id, monto, estado INTO v_pago FROM billing.pagos WHERE id = NEW.pago_id;
                IF v_pago.empresa_id <> v_liq.empresa_id OR v_pago.proveedor_cobro_id IS DISTINCT FROM v_liq.proveedor_cobro_id THEN
                    RAISE EXCEPTION 'El pago % no es de la empresa ni del proveedor de la liquidación %', NEW.pago_id, NEW.liquidacion_id
                        USING ERRCODE = 'check_violation', CONSTRAINT = 'liquidacion_de_otro_proveedor';
                END IF;
                IF NEW.monto <> v_pago.monto THEN
                    RAISE EXCEPTION 'El pago % se liquida por su monto (%), no por %', NEW.pago_id, v_pago.monto, NEW.monto
                        USING ERRCODE = 'check_violation', CONSTRAINT = 'liquidacion_monto';
                END IF;
                IF NEW.tipo = 'cobro' AND v_pago.estado <> 'registrado' THEN
                    RAISE EXCEPTION 'El pago % no está registrado', NEW.pago_id
                        USING ERRCODE = 'check_violation', CONSTRAINT = 'liquidacion_pago_no_vigente';
                END IF;
                IF NEW.tipo = 'contracargo' AND (v_pago.estado <> 'anulado' OR NOT EXISTS (
                    SELECT 1 FROM ledger.liquidaciones_pagos x WHERE x.pago_id = NEW.pago_id AND x.tipo = 'cobro')) THEN
                    RAISE EXCEPTION 'El pago % no es un contracargo: no está anulado o nunca se liquidó', NEW.pago_id
                        USING ERRCODE = 'check_violation', CONSTRAINT = 'liquidacion_contracargo';
                END IF;
                RETURN NEW;
            END
            $fn$;
        `)
    }
}
