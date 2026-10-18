import vine from '@vinejs/vine'
import { reglasPaginacion } from '#shared/paginacion'
import { dinero, empresasConsulta, fechaIso, idEntidad, motivo, versionEsperada } from '#shared/validadores'

/**
 * Validadores de cobros y bancos (contrato de localización fiscal §10.3 y §10.9, fase 4).
 */

/** Monto con signo (líneas del extracto: + entra al banco, − sale). */
const montoConSigno = () =>
    vine
        .string()
        .trim()
        .regex(/^-?\d{1,12}(\.\d{1,2})?$/)
        .meta({
            description: 'Monto con signo y hasta 2 decimales: + entra a la cuenta, − sale',
            examples: ['-15.00'],
        })

/** Cuenta bancaria del libro: una de las tres formas (`#ledger/cuentas_banco`). */
const cuentaBanco = (quien: string) => ({
    cuenta_bancaria_id: idEntidad()
        .nullable()
        .optional()
        .meta({ description: `${quien}: cuenta bancaria propia (GET /cuentas-bancarias)` }),
    banco_id: idEntidad()
        .nullable()
        .optional()
        .meta({ description: `${quien}: banco del libro (GET /libro/bancos)` }),
    cuenta_id: idEntidad()
        .nullable()
        .optional()
        .meta({ description: `${quien}: subcuenta 1.1.02.NN del libro (una sola de las tres formas)` }),
})

const texto = (max: number) => vine.string().trim().maxLength(max)

/*
| Cobros por liquidar
*/

export const crearProveedorCobroValidator = vine.compile(
    vine.object({
        empresa_id: idEntidad().nullable().optional().meta({ description: 'Por defecto la empresa activa' }),
        metodo: vine.enum(['pasarela', 'agente', 'debito'] as const),
        pasarela: texto(60)
            .nullable()
            .optional()
            .meta({ description: 'Solo pasarela: el nombre que trae el pago (falsa, recurrente…)' }),
        nombre: vine.string().trim().minLength(2).maxLength(80),
        desde: fechaIso()
            .nullable()
            .optional()
            .meta({ description: 'Fecha de corte (por defecto hoy; no anterior a hoy)' }),
        ...cuentaBanco('Banco que recibe las liquidaciones'),
    }),
)

export const editarProveedorCobroValidator = vine.compile(
    vine.object({
        version: versionEsperada(),
        nombre: vine.string().trim().minLength(2).maxLength(80).nullable().optional(),
        activo: vine.boolean().nullable().optional(),
        desde: fechaIso().nullable().optional().meta({ description: 'No se edita (422 campo_solo_lectura)' }),
        ...cuentaBanco('Banco que recibe las liquidaciones'),
    }),
)

export const liquidarCobrosValidator = vine.compile(
    vine.object({
        proveedor_cobro_id: idEntidad(),
        fecha: fechaIso().nullable().optional().meta({ description: 'Fecha del depósito; por defecto hoy' }),
        referencia: vine.string().trim().minLength(1).maxLength(120),
        bruto: dinero(),
        comision: dinero(),
        neto: dinero().nullable().optional().meta({ description: 'Si se manda, debe ser bruto − comisión' }),
        pagos: vine.array(idEntidad()).minLength(1).maxLength(5000),
        contracargos: vine
            .array(idEntidad())
            .maxLength(5000)
            .nullable()
            .optional()
            .meta({ description: 'Pagos ya liquidados y después anulados que el proveedor descuenta' }),
        archivo: texto(200).nullable().optional(),
        contenido: vine
            .string()
            .maxLength(5_000_000)
            .nullable()
            .optional()
            .meta({ description: 'Contenido del archivo de la liquidación (se guarda su sha256)' }),
        nota: texto(500).nullable().optional(),
        ...cuentaBanco('Banco donde se depositó el neto (por defecto el del proveedor)'),
    }),
)

export const listarLiquidacionesValidator = vine.compile(
    vine.object({
        empresas: empresasConsulta(),
        ...reglasPaginacion,
        proveedor_cobro_id: idEntidad().optional(),
        desde: fechaIso().optional(),
        hasta: fechaIso().optional(),
    }),
)

export const empresasBancosValidator = vine.compile(vine.object({ empresas: empresasConsulta() }))

/*
| Depósitos y traslados
*/

export const depositarCajaValidator = vine.compile(
    vine.object({
        monto: dinero(),
        boleta: vine.string().trim().minLength(1).maxLength(80).meta({ description: 'Número de la boleta' }),
        fecha: fechaIso().nullable().optional().meta({ description: 'Por defecto hoy; no futura' }),
        ...cuentaBanco('Cuenta que recibe el depósito'),
    }),
)

export const trasladarValidator = vine.compile(
    vine.object({
        empresa_id: idEntidad().nullable().optional(),
        monto: dinero(),
        fecha: fechaIso().nullable().optional().meta({ description: 'Por defecto hoy; no futura' }),
        referencia: vine.string().trim().minLength(1).maxLength(120),
        origen: vine.object(cuentaBanco('Cuenta de la que sale')),
        destino: vine.object(cuentaBanco('Cuenta a la que llega')),
    }),
)

export const listarTransitosValidator = vine.compile(
    vine.object({
        empresas: empresasConsulta(),
        ...reglasPaginacion,
        estado: vine.enum(['en_transito', 'acreditado'] as const).optional(),
    }),
)

/*
| Extractos y conciliación
*/

export const importarExtractoValidator = vine.compile(
    vine.object({
        empresa_id: idEntidad().nullable().optional(),
        ...cuentaBanco('Cuenta del extracto'),
        desde: fechaIso(),
        hasta: fechaIso(),
        saldo_inicial: montoConSigno(),
        saldo_final: montoConSigno(),
        archivo: texto(200).nullable().optional(),
        contenido: vine
            .string()
            .maxLength(10_000_000)
            .nullable()
            .optional()
            .meta({ description: 'Contenido del archivo original (se guarda su sha256)' }),
        motivo_no_encadena: motivo()
            .nullable()
            .optional()
            .meta({ description: 'Fuerza un saldo inicial distinto del final del extracto anterior' }),
        lineas: vine
            .array(
                vine.object({
                    fecha: fechaIso(),
                    descripcion: vine.string().trim().minLength(1).maxLength(300),
                    referencia: texto(120).nullable().optional(),
                    monto: montoConSigno(),
                    saldo: montoConSigno().nullable().optional(),
                }),
            )
            .minLength(1)
            .maxLength(20000),
    }),
)

export const listarExtractosValidator = vine.compile(
    vine.object({
        empresas: empresasConsulta(),
        ...reglasPaginacion,
        cuenta_id: idEntidad().optional(),
    }),
)

export const conciliarValidator = vine.compile(
    vine.object({
        linea_id: idEntidad(),
        movimientos: vine.array(idEntidad()).maxLength(500).nullable().optional().meta({
            description:
                'Movimientos del libro en la cuenta del extracto (GET /bancos/movimientos-sin-conciliar)',
        }),
        depositos: vine.array(idEntidad()).maxLength(500).nullable().optional().meta({
            description: 'Depósitos de caja en tránsito que llegan con esta línea (asiento Banco / 1.1.11)',
        }),
        traslados: vine
            .array(idEntidad())
            .maxLength(500)
            .nullable()
            .optional()
            .meta({ description: 'Traslados en tránsito que llegan a esta cuenta con esta línea' }),
    }),
)

export const anularConciliacionValidator = vine.compile(vine.object({ motivo: motivo() }))

export const registrarDesdeExtractoValidator = vine.compile(
    vine.object({
        cuenta: vine.string().trim().maxLength(40).nullable().optional().meta({
            description:
                'Código de la contrapartida; por defecto 5.3.07 Gastos y comisiones bancarias en un cargo (obligatoria en un abono)',
        }),
        descripcion: texto(300).nullable().optional(),
    }),
)

export const movimientosSinConciliarValidator = vine.compile(
    vine.object({
        empresas: empresasConsulta(),
        cuenta_id: idEntidad(),
        hasta: fechaIso().optional(),
    }),
)

const condicionRegla = {
    nombre: vine.string().trim().minLength(2).maxLength(80),
    cuenta_id: idEntidad()
        .nullable()
        .optional()
        .meta({ description: 'Solo en esta cuenta bancaria; null = todas' }),
    tipo_condicion: vine.enum(['contiene', 'regex'] as const),
    patron: vine.string().trim().minLength(1).maxLength(200),
    monto_min: montoConSigno().nullable().optional(),
    monto_max: montoConSigno().nullable().optional(),
    accion: vine.enum(['contrapartida', 'cliente'] as const),
    contrapartida: vine
        .string()
        .trim()
        .maxLength(40)
        .nullable()
        .optional()
        .meta({ description: 'Código de la cuenta (acción contrapartida)' }),
    prioridad: vine.number().withoutDecimals().range([0, 1000]).optional(),
    activa: vine.boolean().optional(),
}

export const crearReglaConciliacionValidator = vine.compile(
    vine.object({ empresa_id: idEntidad().nullable().optional(), ...condicionRegla }),
)

export const editarReglaConciliacionValidator = vine.compile(
    vine.object({ version: versionEsperada(), ...condicionRegla }),
)

export const reporteConciliacionValidator = vine.compile(
    vine.object({
        empresas: empresasConsulta(),
        cuenta_id: idEntidad().optional(),
        fecha: fechaIso().optional().meta({ description: 'Al día (por defecto hoy, Guatemala)' }),
    }),
)

/*
| Cartera y diferencias de cobro (§10.9)
*/

export const cerrarDiferenciaValidator = vine.compile(vine.object({ motivo: motivo().nullable().optional() }))

export const provisionarCarteraValidator = vine.compile(
    vine.object({
        empresa_id: idEntidad().nullable().optional(),
        anio: vine.number().withoutDecimals().range([2000, 2100]),
        fecha: fechaIso().nullable().optional().meta({
            description:
                'Corte de los saldos deudores; por defecto el 31-dic del año (o hoy si es el año en curso)',
        }),
    }),
)

export const castigarCarteraValidator = vine.compile(
    vine.object({
        facturas: vine.array(idEntidad()).minLength(1).maxLength(500),
        motivo: vine.string().trim().maxLength(500),
        evidencia: vine.string().trim().maxLength(4000).meta({
            description: 'Gestión de cobro documentada (llamadas, cartas, avisos) del art. 21.20 de la LAT',
        }),
    }),
)

export const listarCarteraValidator = vine.compile(
    vine.object({ empresas: empresasConsulta(), ...reglasPaginacion }),
)
