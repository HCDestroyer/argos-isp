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
    // Localización fiscal · fase 2 (módulo fiscal, paquete gt-2026.1, cuentas GT)
    {
        titulo: 'instalar gt-2026.1 dos veces no agrega cuentas ni cambia CUENTAS.*',
        fase: 'localización fiscal, fase 2',
        criterio:
            'Contrato §12: la segunda instalación no inserta filas en ledger.cuentas; los códigos de CUENTAS de hoy conservan id, tipo y naturaleza; las cuentas nuevas de patrimonio no tienen movimientos.',
    },
    {
        titulo: 'un parámetro con vigencia futura no cambia el pasado',
        fase: 'localización fiscal, fase 2',
        criterio:
            'Contrato §4: recalcular una declaración vieja usa el valor vigente en su fecha; fiscal.parametros_valores rechaza UPDATE/DELETE.',
    },
    // Fase 3 (FEL)
    {
        titulo: '2.1.11 IVA por certificar = IVA de los avisos de cobro sin DTE',
        fase: 'localización fiscal, fase 3 (FEL)',
        criterio:
            'Contrato §8.3 (certificar_al = pagar): por empresa, saldo acreedor de 2.1.11 = Σ iva de las facturas emitidas sin fiscal.dte certificado (menos lo acreditado por notas); al certificar, reclasificación 2.1.11 / 2.1.02 por el IVA del DTE; un pago anulado NO revierte un DTE certificado (estudio Odoo §3.3).',
    },
    {
        titulo: 'FEL obligatoria + emitir: la factura por_certificar no tiene asiento ni evento',
        fase: 'localización fiscal, fase 3 (FEL)',
        criterio:
            'Contrato §8.3: estado por_certificar ⇒ ningún asiento con origen factura; al certificar, un solo asiento con la fecha de certificación; reintentar tras error_temporal no duplica (idempotente por identificador).',
    },
    {
        titulo: 'anulación de DTE y NCRE: reverso exacto del asiento de la factura',
        fase: 'localización fiscal, fase 3 (FEL)',
        criterio:
            'Contrato §8: anular dentro del plazo revierte el asiento (espejo, fecha de hoy); fuera del plazo, NCRE con su IVA; la factura acreditada al 100 % deja cada cuenta del asiento original en cero (ver hallazgo H1).',
    },
    // Fase 4 (compras y retenciones)
    {
        titulo: 'libro de compras = cuenta 1.1.04 IVA crédito fiscal',
        fase: 'localización fiscal, fase 4 (compras)',
        criterio:
            'PLAN fase 4: por empresa y mes, Σ iva de ledger.compras con credito_fiscal = movimiento del mes de 1.1.04; FPEQ y FCAP no suman; compra desde egreso = reclasificación IVA crédito / gasto sin tocar el asiento original.',
    },
    {
        titulo: 'retención recibida: CxC baja por el total y 1.1.05 por la constancia',
        fase: 'localización fiscal, fase 4 (retenciones)',
        criterio:
            'Contrato §3.5 y §12: asiento del pago = Caja/Banco (neto) + 1.1.05 o 1.1.06 (constancia) / CxC (total); Σ constancias recibidas = saldo de 1.1.05 + 1.1.06 antes de liquidar.',
    },
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
        titulo: 'la cadena de hash de los asientos es íntegra',
        fase: 'localización fiscal, fase 5 (libros con folio; estudio Odoo n.º 35)',
        criterio:
            'ledger.asientos.hash = sha256(hash_anterior + campos fijos del asiento y sus movimientos), calculado en el INSERT por empresa; recalcular toda la cadena desde el primer asiento da el mismo último hash; cualquier alteración (aun como dueño) rompe la verificación.',
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
    {
        titulo: 'conciliación bancaria solo por inserción',
        fase: 'sin fase en PLAN (estudio Odoo n.º 19, propuesta para después de la fase 5)',
        criterio:
            'ledger.extractos, extractos_lineas y conciliaciones rechazan UPDATE/DELETE (trigger y REVOKE); deshacer una conciliación es una fila nueva; nunca se reescribe el asiento conciliado (a diferencia de Odoo); el bloqueo duro exige cero líneas sin conciliar.',
    },
    // Lealtad
    {
        titulo: 'lealtad: 2.1.10 = valor de los lotes vivos cuando diferimiento = true',
        fase: 'lealtad, fase 1',
        criterio:
            'Contrato de lealtad §6: por empresa, saldo acreedor de 2.1.10 = Σ valor de los lotes no consumidos ni vencidos; con diferimiento = false no hay asientos de lealtad; acumulación 4.1.05 / 2.1.10, canje y vencimiento 2.1.10 / 4.1.06.',
    },
    {
        titulo: 'lealtad: un evento repetido no da puntos (ni asientos) dos veces',
        fase: 'lealtad, fase 1',
        criterio:
            'Contrato de lealtad §9: procesar dos veces el mismo pago.registrado deja un solo movimiento de puntos y un solo asiento; el cron de vencimiento repetido no duplica (clave vencimiento:lote:<id>).',
    },
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
