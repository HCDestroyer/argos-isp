import { test } from '@japa/runner'

/**
 * Auditor contable · invariantes de lo que **todavía no existe** (contratos `localizacion-fiscal.md`
 * y `lealtad.md`, y la lista de cambios del estudio de Odoo). Quedan escritos con su criterio
 * exacto y en `skip` con la fase que los activa: quien implemente la fase quita el `skip`, escribe
 * el escenario con las acciones nuevas y la prueba tiene que pasar antes de fusionar (PLAN: «una
 * fase no se fusiona con un invariante en rojo»). Cada uno debe terminar en `afirmarLibro`.
 */

interface Pendiente {
    titulo: string
    fase: string
    criterio: string
}

const PENDIENTES: Pendiente[] = [
    // Localización fiscal · fase 2: activados en `fase2.spec.ts` (instalación, vigencia y cadena de hash)
    // Fase 3 (FEL): activados en `fase3.spec.ts`
    // Compras y retenciones (localización fiscal, fase 5 de A3): activados en `fase5.spec.ts`
    // Fase 5 (libros, bloqueos, cierre anual)
    {
        titulo: 'el cierre anual deja los resultados en cero',
        fase: 'localización fiscal, fase 5',
        criterio:
            'Contrato §9.1: después de libro.cerrar_ejercicio, Σ saldo de cuentas de ingreso y gasto del año = 0 en la empresa; 3.3.03 en cero; reserva legal = reserva_legal_pct × base cuando hubo utilidad; diciembre cerrado.',
    },
    // «un periodo con bloqueo duro rechaza cualquier asiento»: activado en `fase6.spec.ts` (fase 6 PR A), con
    // 409 bloqueo_duro según la tabla de errores §11 (desvío (c) de §20), no 422 periodo_cerrado
    // «libros emitidos solo bajo bloqueo, con folios correlativos»: activado en `libros_legales.spec.ts` (fase 6 PR D,
    // inv. 20 de `verificarLibro`)
    // «2.9.01 Saldos de apertura queda en 0 después de la importación y el cierre»: activado en
    // `apertura_h27_canje.spec.ts` (libro.cerrar_apertura, §23)
    // Fase 6 (declaraciones)
    {
        titulo: 'IVA del borrador = libro de ventas − libro de compras − retenciones',
        fase: 'localización fiscal, fase 6',
        criterio:
            'PLAN fase 6: declaración iva_mensual de la empresa y el mes: débito = Σ IVA del libro de ventas (DTE certificados y notas), crédito = Σ IVA del libro de compras (1.1.04), menos constancias recibidas; datos_hash cambia si cambia un documento; 409 al presentar desactualizada.',
    },
    {
        titulo: 'el IVA declarado cuadra con los movimientos etiquetados con impuesto',
        fase: 'localización fiscal, fase 6 (cuadrículas; estudio Odoo n.º 7)',
        criterio:
            'Estudio Odoo n.º 7: Σ de ledger.movimientos con impuesto_codigo = IVA y cuadrícula de cuota en el periodo = IVA de la declaración; Σ de la cuadrícula de base = base declarada; cada asiento de factura y nota etiqueta base y cuota.',
    },
    // Conciliación bancaria (estudio Odoo)
    // «conciliación bancaria solo por inserción»: activado en `fase4.spec.ts` (fase 4, §10.3) salvo el bloqueo duro
    // «el bloqueo duro exige cero líneas del extracto sin conciliar»: activado en `fase6.spec.ts`
    // Lealtad
    // lealtad, fase 1: activados en `lealtad.spec.ts` (2.1.10 = lotes vivos; evento repetido)
    {
        titulo: 'lealtad: el canje como descuento deja la factura con el IVA del neto',
        fase: 'lealtad, fase 2',
        criterio:
            'Contrato de lealtad §10: la factura trae la línea de descuento y su IVA es el del neto; el canje sobre una factura emitida genera nota de crédito por el descuento; el libro cuadra.',
    },
]

test.group('Auditor contable · invariantes de fases pendientes', () => {
    for (const p of PENDIENTES) {
        test(`${p.titulo} · ${p.fase}`, ({ assert }) => {
            assert.fail(`Sin implementar: ${p.criterio}`)
        }).skip(true, `${p.fase} pendiente. Criterio: ${p.criterio}`)
    }
})
