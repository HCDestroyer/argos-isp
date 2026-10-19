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
    {
        titulo: 'un periodo con bloqueo duro rechaza cualquier asiento',
        fase: 'localización fiscal, fase 5',
        criterio:
            'Contrato §9.2: con ledger.bloqueos duro hasta F, todo asiento con fecha ≤ F → 422 periodo_cerrado (acción y trigger), también reversos; reabrir_periodo → 409 bloqueo_duro; un bloqueo duro nuevo nunca retrocede.',
    },
    {
        titulo: 'libros emitidos solo bajo bloqueo, con folios correlativos',
        fase: 'localización fiscal, fase 5',
        criterio:
            'Contrato §7: fiscal.libros_emisiones con folios sin huecos por (empresa, libro) dentro del rango habilitado; 422 sin bloqueo; sha256 guardado igual al del archivo.',
    },
    {
        titulo: '2.9.01 Saldos de apertura queda en 0 después de la importación y el cierre',
        fase: 'localización fiscal, fase 5 (cierre; estudio Odoo n.º 39)',
        criterio:
            'Contrato de importación + estudio Odoo n.º 39: terminada la importación de una empresa, la acción de cierre de apertura traslada el saldo de 2.9.01 a patrimonio (3.x) y, después del cierre, 2.9.01 = 0 en la empresa; total de facturas abiertas importadas = CxC inicial.',
    },
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
    {
        titulo: 'el bloqueo duro exige cero líneas del extracto sin conciliar',
        fase: 'localización fiscal, fase 5 (bloqueos; estudio Odoo n.º 19)',
        criterio:
            'Con ledger.bloqueos duro hasta F, ninguna línea de extracto con fecha ≤ F queda sin conciliación vigente; poner el bloqueo con líneas pendientes responde 422.',
    },
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
