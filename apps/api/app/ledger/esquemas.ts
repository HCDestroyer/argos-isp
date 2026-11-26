import { DENOMINACIONES } from '#ledger/resumen_turno'
import { CLAVES_CATEGORIA_EGRESO, CLAVES_CATEGORIA_EGRESO_CONSULTA } from '#ledger/plan_cuentas'
import {
    Dinero,
    Problem,
    auditable,
    booleano,
    definirEsquema,
    entero,
    enumerado,
    fecha,
    id,
    instante,
    lista,
    nulable,
    objeto,
    texto,
} from '#shared/openapi/esquemas'

/**
 * Schemas de respuesta del módulo ledger (libro, cajas).
 */

export const Cuenta = definirEsquema(
    'Cuenta',
    objeto(
        {
            empresa_id: {
                ...nulable(id),
                description: 'Empresa de la subcuenta (caja o cuenta bancaria); null = cuenta común',
            },
            id,
            codigo: texto,
            nombre: texto,
            tipo: enumerado(['activo', 'pasivo', 'patrimonio', 'ingreso', 'gasto']),
            padre_id: nulable(id),
            imputable: { ...booleano, description: 'Recibe movimientos (false = cuenta de agrupación)' },
            auxiliar_cliente: {
                ...booleano,
                description: 'Lleva auxiliar por cliente (CxC, anticipos): cada movimiento exige cliente_id',
            },
            activa: booleano,
            pais: { ...texto, description: 'País del catálogo (GT); el código es único por país' },
            naturaleza: {
                ...enumerado(['deudora', 'acreedora']),
                description: 'Lado en que crece el saldo (al revés del tipo en las contracuentas)',
            },
            contracuenta: booleano,
            reinicia_anual: {
                ...booleano,
                description: 'El saldo vuelve a cero cada ejercicio (ingresos y gastos)',
            },
            auxiliar_proveedor: booleano,
            categoria_fiscal: nulable(texto),
            libro_inventario: booleano,
            categoria_flujo: {
                ...nulable(enumerado(['efectivo', 'operacion', 'inversion', 'financiamiento'])),
                description: 'Clasificación del flujo de efectivo (método indirecto)',
            },
            ...auditable,
        },
        [
            'empresa_id',
            'pais',
            'naturaleza',
            'contracuenta',
            'reinicia_anual',
            'auxiliar_proveedor',
            'categoria_fiscal',
            'libro_inventario',
            'categoria_flujo',
        ],
    ),
)

export const Movimiento = definirEsquema(
    'Movimiento',
    objeto(
        {
            id,
            cuenta_id: id,
            cuenta_codigo: texto,
            cuenta_nombre: texto,
            debe: Dinero,
            haber: Dinero,
            cliente_id: nulable(id),
            cliente_nombre: { ...nulable(texto), description: 'Cliente del auxiliar (CxC, anticipos)' },
            proveedor_id: { ...nulable(id), description: 'Proveedor del auxiliar (2.1.03 Proveedores)' },
            proveedor_nombre: nulable(texto),
            impuesto_codigo: { ...nulable(texto), description: 'Impuesto de la partida (fiscal.impuestos)' },
            cuadricula: {
                ...nulable(texto),
                description: 'Etiqueta de impuesto (base o cuota) para cuadrar lo declarado con el libro',
            },
        },
        ['cliente_nombre', 'proveedor_id', 'proveedor_nombre', 'impuesto_codigo', 'cuadricula'],
    ),
)

export const Asiento = definirEsquema(
    'Asiento',
    objeto(
        {
            empresa_id: {
                ...id,
                description: 'Empresa (NIT) (multiempresa)',
            },
            id,
            fecha,
            descripcion: texto,
            origen_tipo: enumerado([
                'factura',
                'pago',
                'mora',
                'nota_credito',
                'egreso',
                'cierre_caja',
                'entrega_caja',
                'reposicion_caja',
                'conteo_caja',
                'ajuste',
                'reclasificacion',
                'liquidacion_cobro',
                'deposito',
                'traslado',
                'banco',
                'provision',
                'castigo',
                'diferencia_cobro',
                'compra',
                'pago_proveedor',
                'depreciacion',
                'baja_activo',
                'diferido',
                'alta_activo',
                'lealtad',
                'sorteo',
                'bonificacion',
            ]),
            origen_id: nulable(id),
            reversa_de: {
                ...nulable(id),
                description: 'Asiento que este revierte (correcciones por reverso)',
            },
            revertido_por: { ...nulable(id), description: 'Asiento de reverso de este, si ya se revirtió' },
            fecha_documento: {
                ...nulable(fecha),
                description:
                    'Fecha real de un asiento automático que se registró en el primer día abierto porque la suya estaba cerrada o bloqueada (§10.4); null si no se trasladó',
            },
            excepcion_id: {
                ...nulable(id),
                description:
                    'Excepción de bloqueo por la que entró el asiento (§10.4); null si no hizo falta',
            },
            diario: {
                ...nulable(texto),
                description: 'Código del diario (VEN, COB, COM, IMP, CIE, VAR, CAJ-<caja>, BAN-<cuenta>)',
            },
            numero: {
                ...nulable(entero),
                description: 'Número del asiento en su diario y año, guardado al registrar; nunca cambia',
            },
            partida: {
                ...nulable(entero),
                description:
                    'Partida del Libro Diario (correlativo por empresa y año), asignada al cerrar el mes; null mientras el mes esté abierto',
            },
            revertible: {
                ...booleano,
                description:
                    'Si POST /libro/asientos/:id/revertir lo acepta (sin documento, no revertido, no es reverso)',
            },
            motivo_no_revertible: {
                ...nulable(texto),
                description: 'Por qué no se revierte directo (p. ej. «anula el pago»); null si revertible',
            },
            created_by: nulable(id),
            created_at: instante,
            movimientos: lista(Movimiento),
        },
        [
            'revertido_por',
            'revertible',
            'motivo_no_revertible',
            'numero',
            'partida',
            'fecha_documento',
            'excepcion_id',
        ],
    ),
)

export const LineaMayor = definirEsquema(
    'LineaMayor',
    objeto(
        {
            empresa_id: {
                ...id,
                description:
                    'Empresa (NIT) (multiempresa). Siempre viene; opcional en el esquema para no romper clientes tipados',
            },
            movimiento_id: id,
            asiento_id: id,
            fecha,
            descripcion: texto,
            debe: Dinero,
            haber: Dinero,
            saldo: Dinero,
            cliente_id: nulable(id),
        },
        ['empresa_id'],
    ),
)

export const Mayor = definirEsquema(
    'Mayor',
    objeto({
        cuenta: Cuenta,
        saldo_inicial: Dinero,
        saldo_final: Dinero,
        data: lista(LineaMayor),
        nextCursor: { type: ['string', 'null'] },
    }),
)

export const Caja = definirEsquema(
    'Caja',
    objeto(
        {
            empresa_id: {
                ...id,
                description:
                    'Empresa (NIT) (multiempresa). Siempre viene; opcional en el esquema para no romper clientes tipados',
            },
            id,
            nombre: texto,
            cajero_id: nulable(id),
            cajero_nombre: { ...nulable(texto), description: 'Cajero asignado a la caja' },
            cuenta_id: id,
            activa: booleano,
            turno_abierto_id: nulable(id),
            turno_abierto_por: { ...nulable(id), description: 'Usuario que abrió el turno abierto' },
            turno_abierto_por_nombre: nulable(texto),
            formato_recibo: {
                ...enumerado(['pos_80', 'carta']),
                description: 'Decisión del PM 20: formato del recibo de esta caja (pos_80 de fábrica)',
            },
            formato_factura: {
                ...enumerado(['pos_80', 'carta']),
                description: 'Decisión del PM 20: formato de la factura de esta caja (carta de fábrica)',
            },
            tipo: {
                ...enumerado(['cobros', 'gastos']),
                description: 'B1: cobros (turno, cierre y entrega) o gastos (caja chica, B9)',
            },
            fondo_fijo: { ...nulable(Dinero), description: 'Fondo fijo propio; null = el de la empresa' },
            fondo_fijo_efectivo: {
                ...Dinero,
                description: 'Fondo con el que abre la caja (el propio o el fondo de cambio de la empresa)',
            },
            ...auditable,
        },
        // empresa_id y los formatos siempre vienen; opcionales para no romper clientes tipados
        [
            'cajero_nombre',
            'turno_abierto_por',
            'turno_abierto_por_nombre',
            'empresa_id',
            'formato_recibo',
            'formato_factura',
            'tipo',
            'fondo_fijo',
            'fondo_fijo_efectivo',
        ],
    ),
)

export const Diario = definirEsquema(
    'Diario',
    objeto({
        id,
        empresa_id: id,
        codigo: { ...texto, description: 'VEN, COB, COM, IMP, CIE, VAR, CAJ-<caja>, BAN-<cuenta bancaria>' },
        nombre: texto,
        tipo: enumerado(['ventas', 'cobros', 'caja', 'banco', 'compras', 'impuestos', 'cierre', 'varios']),
        cuenta_por_defecto: nulable(id),
        cuenta_por_defecto_codigo: nulable(texto),
        caja_id: nulable(id),
        cuenta_bancaria_id: nulable(id),
        activo: booleano,
        secuencias: {
            ...lista(objeto({ anio: entero, ultimo: entero })),
            description: 'Numeración guardada por año: último número asignado (el siguiente es ultimo + 1)',
        },
        version: entero,
        created_at: instante,
        updated_at: instante,
    }),
)

export const BancoLibro = definirEsquema(
    'BancoLibro',
    objeto(
        {
            empresa_id: {
                ...id,
                description:
                    'Empresa (NIT) (multiempresa). Siempre viene; opcional en el esquema para no romper clientes tipados',
            },
            id: { ...id, description: 'banco_id que acepta POST /egresos con metodo banco' },
            nombre: texto,
            banco_id: { ...nulable(id), description: 'Banco del catálogo (GET /bancos), si se conoce' },
            banco: { ...nulable(texto), description: 'Nombre del banco del catálogo' },
            numero_enmascarado: {
                ...nulable(texto),
                description: 'Número de cuenta con solo los últimos 4 caracteres visibles',
            },
            cuenta_id: id,
            cuenta_codigo: { ...texto, description: 'Cuenta contable del plan (1.1.02.xx)' },
            cuenta_nombre: texto,
        },
        ['empresa_id'],
    ),
)

export const CajaTurno = definirEsquema(
    'CajaTurno',
    objeto(
        {
            id,
            caja_id: id,
            abierto_en: instante,
            fondo_inicial: Dinero,
            cerrado_en: nulable(instante),
            esperado: nulable(Dinero),
            contado: nulable(Dinero),
            diferencia: nulable(Dinero),
            motivo: nulable(texto),
            abierto_por: { ...nulable(id), description: 'Usuario que abrió el turno' },
            cerrado_por: { ...nulable(id), description: 'Usuario que cerró el turno' },
            abierto_por_nombre: nulable(texto),
            cerrado_por_nombre: nulable(texto),
            denominaciones: {
                ...nulable(lista(objeto({ valor: enumerado(DENOMINACIONES), cantidad: entero }))),
                description: 'Conteo del cierre por billete y moneda (null si se escribió solo el total)',
            },
            fondo_siguiente: {
                ...nulable(Dinero),
                description: 'Efectivo que quedó en la caja para abrir el turno siguiente',
            },
            entregado_a: {
                ...nulable(id),
                description: 'Usuario que recibió el efectivo que no quedó de fondo',
            },
            entregado_a_nombre: nulable(texto),
            entregado_monto: { ...nulable(Dinero), description: 'contado − fondo_siguiente' },
            fondo_esperado: {
                ...nulable(Dinero),
                description:
                    'B1: lo que debía haber al abrir (lo que quedó del turno anterior o el fondo fijo); null en turnos de antes',
            },
            entrega_id: {
                ...nulable(id),
                description: 'B1: entrega vigente del turno (GET /cajas/entregas)',
            },
            entrega_estado: { ...nulable(enumerado(['por_recibir', 'recibida'])), description: 'B1' },
            ...auditable,
        },
        [
            'abierto_por',
            'cerrado_por',
            'abierto_por_nombre',
            'cerrado_por_nombre',
            'denominaciones',
            'fondo_siguiente',
            'entregado_a',
            'entregado_a_nombre',
            'entregado_monto',
            'fondo_esperado',
            'entrega_id',
            'entrega_estado',
        ],
    ),
)

/*
| B1 del plan de contabilidad (§5.7): entregas, custodia y ajustes de cajas
*/

export const EntregaCaja = definirEsquema(
    'EntregaCaja',
    objeto({
        id,
        empresa_id: id,
        caja_id: id,
        caja_nombre: texto,
        turno_id: id,
        monto: { ...Dinero, description: 'Lo que no quedó de fondo al cerrar el turno' },
        entregado_por: nulable(id),
        entregado_por_nombre: nulable(texto),
        recibe_id: { ...id, description: 'Quien debe decir «Recibí»' },
        recibe_nombre: nulable(texto),
        autoentrega: { ...booleano, description: '«Lo deposito yo»: se recibió en el acto' },
        origen: {
            ...enumerado(['cierre', 'reentrega', 'migracion']),
            description: 'migracion = entrega de un cierre de antes de B1 (sin asiento hasta recibirla)',
        },
        estado: {
            ...enumerado(['por_recibir', 'recibida', 'rechazada']),
            description: 'por_recibir: el efectivo sigue a nombre del cajero (cuenta de la caja)',
        },
        recibido_por: nulable(id),
        recibido_en: nulable(instante),
        contado: nulable(Dinero),
        diferencia: { ...nulable(Dinero), description: 'contado − monto, a cargo de quien entregó' },
        motivo: nulable(texto),
        created_at: instante,
    }),
)

const AjustesCajasPropiedades = {
    empresa_id: id,
    fondo_cobros: { ...Dinero, description: 'Fondo de cambio de cada caja de cobros (Q200 de fábrica)' },
    custodia_plazo_dias: { ...entero, description: 'Días hábiles para depositar (1 de fábrica)' },
    custodia_tope: { ...Dinero, description: 'Efectivo máximo en custodia por persona (Q5,000 de fábrica)' },
    autoentrega: { ...booleano, description: '«Lo deposito yo» permitido (de fábrica sí)' },
    fondo_caja_chica: {
        ...Dinero,
        description: 'B9: fondo fijo de cada caja chica (Q2,000 de fábrica; sin tope por gasto)',
    },
    de_fabrica: { ...booleano, description: 'La empresa usa los valores de fábrica' },
    version: { ...entero, description: '0 = de fábrica; se envía en PUT /cajas/ajustes' },
    updated_at: nulable(instante),
}

export const AjustesCajas = definirEsquema('AjustesCajas', objeto(AjustesCajasPropiedades))

const Conteo0 = objeto({ cantidad: entero, monto: Dinero })

export const CustodiaEfectivo = definirEsquema(
    'CustodiaEfectivo',
    objeto({
        empresa_id: id,
        ajustes: objeto(AjustesCajasPropiedades),
        total: { ...Dinero, description: 'Total en custodia de la empresa (= saldo de 1.1.15)' },
        por_recibir: { ...Conteo0, description: 'Entregas sin «Recibí» (siguen en las cajas de cobros)' },
        personas: lista(
            objeto({
                empresa_id: id,
                usuario_id: id,
                usuario_nombre: nulable(texto),
                saldo: { ...Dinero, description: 'Recibido − depositado − repuesto a cajas chicas (B9)' },
                desde: { ...nulable(fecha), description: 'Recepción más vieja aún sin depositar' },
                vence: { ...nulable(fecha), description: 'Último día hábil para depositarla' },
                fuera_de_plazo: { ...booleano, description: 'Avisa, no bloquea' },
                sobre_tope: { ...booleano, description: 'Avisa, no bloquea' },
                por_recibir: { ...Conteo0, description: 'Entregas que esta persona aún no confirma' },
            }),
        ),
    }),
)

const Conteo = objeto({ cantidad: entero, monto: Dinero })

export const ResumenTurnoCaja = definirEsquema(
    'ResumenTurnoCaja',
    objeto({
        caja_id: id,
        caja_nombre: texto,
        empresa_id: id,
        turno_id: id,
        abierto_en: instante,
        abierto_por: nulable(id),
        abierto_por_nombre: nulable(texto),
        cerrado_en: nulable(instante),
        fondo_inicial: Dinero,
        cobros: {
            ...objeto({
                cantidad: entero,
                monto: Dinero,
                por_metodo: lista(objeto({ metodo: texto, cantidad: entero, monto: Dinero })),
            }),
            description: 'Cobros vigentes del turno: en efectivo y por otros medios del cajero',
        },
        efectivo_cobrado: { ...Conteo, description: 'Cobros en efectivo (monto − retenido)' },
        otros_medios: {
            ...Conteo,
            description: 'Cobros por otros medios que registró el cajero mientras el turno estuvo abierto',
        },
        ingresos: {
            ...objeto({ cantidad: entero, monto: Dinero, cobros_efectivo: Conteo }),
            description: 'Efectivo que entró a la caja (sin el fondo)',
        },
        retiros: {
            ...objeto({
                cantidad: entero,
                monto: Dinero,
                egresos: Conteo,
                depositos: Conteo,
                pagos_proveedores: Conteo,
            }),
            description: 'Efectivo que salió: egresos, depósitos al banco y pagos a proveedores',
        },
        esperado: { ...Dinero, description: 'Debe haber en efectivo: fondo + ingresos − retiros' },
    }),
)

export const CategoriaEgreso = definirEsquema(
    'CategoriaEgreso',
    objeto({
        id,
        clave: enumerado(CLAVES_CATEGORIA_EGRESO),
        nombre: texto,
        cuenta_id: id,
        cuenta_codigo: texto,
        cuenta_nombre: texto,
    }),
)

export const Egreso = definirEsquema(
    'Egreso',
    objeto(
        {
            empresa_id: {
                ...id,
                description:
                    'Empresa (NIT) (multiempresa). Siempre viene; opcional en el esquema para no romper clientes tipados',
            },
            id,
            fecha,
            categoria: {
                ...enumerado(CLAVES_CATEGORIA_EGRESO_CONSULTA),
                description:
                    'Categoría del egreso; premios es interna (la crea la entrega de un premio de sorteo en efectivo, 5.1.03) y no se usa en POST /egresos',
            },
            categoria_nombre: texto,
            cuenta_codigo: { ...texto, description: 'Cuenta de gasto del plan' },
            proveedor: nulable(texto),
            descripcion: nulable(texto),
            comprobante: { ...nulable(texto), description: 'Número o serie del documento del proveedor' },
            monto: Dinero,
            metodo: enumerado(['caja', 'banco', 'cuenta_bancaria']),
            caja_id: nulable(id),
            caja_nombre: nulable(texto),
            turno_id: { ...nulable(id), description: 'Turno de caja abierto cuando salió el efectivo' },
            banco_id: nulable(id),
            banco_nombre: nulable(texto),
            cuenta_bancaria_id: nulable(id),
            cuenta_bancaria_nombre: nulable(texto),
            asiento_id: nulable(id),
            compra_id: {
                ...nulable(id),
                description:
                    'Compra al contado que paga este egreso (fase 5): su asiento es el de la compra y se anula con la compra',
            },
            estado: enumerado(['registrado', 'anulado']),
            registrado_por: nulable(id),
            registrado_por_nombre: nulable(texto),
            anulado_en: nulable(instante),
            anulado_por: nulable(id),
            motivo_anulacion: nulable(texto),
            asiento_reverso_id: nulable(id),
            con_comprobante: {
                ...booleano,
                description: 'B9: tiene el archivo de su comprobante (GET /egresos/:id/comprobante)',
            },
            reposicion_id: {
                ...nulable(id),
                description: 'B9: gasto de caja chica ya repuesto (sellado: no se anula)',
            },
            ...auditable,
        },
        ['empresa_id', 'compra_id', 'con_comprobante', 'reposicion_id'],
    ),
)

/*
| B9 del plan de contabilidad (§5.7): caja chica
*/

export const EstadoCajaChica = definirEsquema(
    'EstadoCajaChica',
    objeto({
        caja_id: id,
        empresa_id: id,
        nombre: texto,
        encargado_id: { ...nulable(id), description: 'Encargado (el cajero_id de la caja)' },
        encargado_nombre: nulable(texto),
        fondo_fijo: { ...Dinero, description: 'Fondo fijo configurado (el que deja la próxima reposición)' },
        fondo_vigente: { ...Dinero, description: 'Fondo de la última reposición (0 antes de la primera)' },
        efectivo: { ...Dinero, description: 'Efectivo que debe haber (saldo de su cuenta en el libro)' },
        comprobantes: {
            ...objeto({ cantidad: entero, monto: Dinero, sin_archivo: entero }),
            description: 'Gastos vigentes sin reponer (sin_archivo: los que aún no tienen su comprobante)',
        },
        diferencias: {
            ...objeto({ cantidad: entero, monto: Dinero }),
            description: 'Diferencias de conteo sin reponer (contado − esperado)',
        },
        cuadra: { ...booleano, description: 'efectivo + comprobantes − diferencias = fondo vigente' },
        por_reponer: {
            ...Dinero,
            description: 'Lo que repone la siguiente reposición (fondo fijo − efectivo)',
        },
        porcentaje: {
            ...entero,
            description: 'Efectivo / fondo fijo en %; bajo 30 el panel avisa para reponer',
        },
        ultima_reposicion: nulable(objeto({ id, fecha, monto: Dinero })),
        ultimo_conteo: nulable(objeto({ id, fecha, diferencia: Dinero })),
    }),
)

export const GastoCajaChica = definirEsquema(
    'GastoCajaChica',
    objeto({
        egreso: Egreso,
        caja_chica: EstadoCajaChica,
        pasar_a_compras: {
            ...booleano,
            description: 'Con factura a nombre de la empresa: sigue POST /compras/desde-egreso/:egreso_id',
        },
    }),
)

export const ReposicionCaja = definirEsquema(
    'ReposicionCaja',
    objeto({
        id,
        empresa_id: id,
        caja_id: id,
        caja_nombre: texto,
        origen: enumerado(['custodia', 'banco']),
        custodio_id: { ...nulable(id), description: 'De cuya custodia salió (null desde el banco)' },
        custodio_nombre: nulable(texto),
        banco_id: nulable(id),
        cuenta_bancaria_id: nulable(id),
        cuenta_codigo: { ...texto, description: 'Cuenta del libro de la que salió (1.1.15 o el banco)' },
        referencia: nulable(texto),
        monto: Dinero,
        fondo: { ...Dinero, description: 'Fondo fijo con el que queda la caja' },
        efectivo_antes: Dinero,
        fecha,
        gastos: { ...entero, description: 'Gastos que sella' },
        conteos: { ...entero, description: 'Diferencias de conteo que sella' },
        asiento_id: nulable(id),
        registrado_por: nulable(id),
        registrado_por_nombre: nulable(texto),
        created_at: instante,
    }),
)

export const ConteoCaja = definirEsquema(
    'ConteoCaja',
    objeto({
        id,
        empresa_id: id,
        caja_id: id,
        esperado: { ...Dinero, description: 'Efectivo en el libro al contar' },
        contado: Dinero,
        diferencia: { ...Dinero, description: 'contado − esperado, a cargo del encargado' },
        comprobantes: { ...Dinero, description: 'Gastos sin reponer al contar' },
        fondo: { ...Dinero, description: 'Fondo vigente al contar' },
        motivo: nulable(texto),
        responsable_id: nulable(id),
        responsable_nombre: nulable(texto),
        contado_por: nulable(id),
        contado_por_nombre: nulable(texto),
        fecha,
        asiento_id: nulable(id),
        repuesto: { ...booleano, description: 'La diferencia ya se repuso' },
        created_at: instante,
    }),
)

export const CierrePeriodo = definirEsquema(
    'CierrePeriodo',
    objeto(
        {
            empresa_id: {
                ...id,
                description:
                    'Empresa (NIT) (multiempresa). Siempre viene; opcional en el esquema para no romper clientes tipados',
            },
            id,
            periodo: { type: 'string', pattern: '^\\d{4}-\\d{2}$', description: 'YYYY-MM' },
            estado: enumerado(['cerrado', 'reabierto']),
            cerrado_en: instante,
            cerrado_por: nulable(id),
            cerrado_por_nombre: nulable(texto),
            resumen: {
                type: ['object', 'null'],
                additionalProperties: true,
                description:
                    'Al cerrar: desde, hasta, asientos, debe, haber y cuentas[] (codigo, nombre, debe, haber) del mes',
            },
            reabierto_en: nulable(instante),
            reabierto_por: nulable(id),
            reabierto_por_nombre: nulable(texto),
            motivo_reapertura: nulable(texto),
            ultimo_sello: {
                type: ['integer', 'null'],
                description:
                    'Último sello de la cadena de hash de la empresa al cerrar el mes (§10.10); null en cierres anteriores a la cadena',
            },
            ultimo_hash: {
                type: ['string', 'null'],
                pattern: '^[0-9a-f]{64}$',
                description: 'Hash de ese sello (SHA-256 en hexadecimal)',
            },
        },
        ['empresa_id', 'ultimo_sello', 'ultimo_hash'],
    ),
)

const lineaEstado = objeto(
    {
        cuenta_id: id,
        codigo: texto,
        nombre: texto,
        tipo: enumerado(['activo', 'pasivo', 'patrimonio', 'ingreso', 'gasto']),
        naturaleza: enumerado(['deudora', 'acreedora']),
        debe: Dinero,
        haber: Dinero,
        saldo: { ...Dinero, description: 'Según la naturaleza de la cuenta' },
    },
    ['naturaleza'],
)

const totalesBalance = objeto(
    {
        debe: Dinero,
        haber: Dinero,
        activo: { ...Dinero, description: 'Neto: las contracuentas (depreciación acumulada) restan' },
        pasivo: Dinero,
        patrimonio: Dinero,
        ingresos: Dinero,
        gastos: Dinero,
        resultado: { ...Dinero, description: 'ingresos − gastos' },
        cuadra: { ...booleano, description: 'debe = haber y activo = pasivo + patrimonio + resultado' },
        resultado_ejercicios_sin_cerrar: {
            ...Dinero,
            description:
                'Parte de resultado de años anteriores al de hasta sin cierre anual («Resultado de ejercicios sin cerrar», §10.8)',
        },
        resultado_ejercicio: { ...Dinero, description: 'resultado del año de hasta' },
    },
    ['patrimonio', 'resultado_ejercicios_sin_cerrar', 'resultado_ejercicio'],
)

const totalesResultados = objeto({ ingresos: Dinero, gastos: Dinero, resultado: Dinero })

function seccion(totales: ReturnType<typeof objeto>) {
    return objeto({
        empresa_id: nulable(id),
        nombre_comercial: nulable(texto),
        nit: nulable(texto),
        cuentas: lista(lineaEstado),
        totales,
    })
}

export const BalanceSaldos = definirEsquema(
    'BalanceSaldos',
    objeto({
        hasta: fecha,
        consolidado: { ...booleano, description: 'true sin filtro de empresa (empresas=todas)' },
        empresas: { ...lista(seccion(totalesBalance)), description: 'Una sección por empresa (libro)' },
        total: {
            ...objeto({ cuentas: lista(lineaEstado), totales: totalesBalance }),
            description: 'Total del grupo',
        },
    }),
)

export const EstadoResultados = definirEsquema(
    'EstadoResultados',
    objeto({
        desde: fecha,
        hasta: fecha,
        consolidado: booleano,
        empresas: lista(seccion(totalesResultados)),
        total: objeto({ cuentas: lista(lineaEstado), totales: totalesResultados }),
    }),
)

const hashHex = { type: 'string', pattern: '^[0-9a-f]{64}$', description: 'SHA-256 en hexadecimal' }

export const IntegridadLibro = definirEsquema(
    'IntegridadLibro',
    objeto({
        empresa_id: id,
        version: { ...texto, description: 'Versión del JSON canónico de la cadena (`v1`)' },
        verificado: {
            ...booleano,
            description: 'true si toda la cadena encadena y cada hash recalculado coincide con el guardado',
        },
        sellos: { ...entero, description: 'Sellos de toda la cadena de la empresa' },
        verificados: {
            ...entero,
            description: 'Sellos cuyo hash se recalculó (asientos con fecha en el rango)',
        },
        sin_sellar: {
            ...entero,
            description: 'Asientos del rango sin sello todavía (el sellador corre cada minuto)',
        },
        primer_sello: nulable(entero),
        ultimo_sello: nulable(entero),
        primer_hash: nulable(hashHex),
        ultimo_hash: nulable(hashHex),
        ruptura: nulable(
            objeto({
                sello: entero,
                asiento_id: nulable(id),
                motivo: enumerado([
                    'hash_distinto',
                    'encadenamiento',
                    'sello_faltante',
                    'asiento_inexistente',
                    'cierre_distinto',
                    'asiento_en_mes_cerrado',
                ]),
                esperado: { ...texto, description: 'Valor guardado (hash, sello o hash del cierre)' },
                obtenido: { ...texto, description: 'Valor recalculado o encontrado' },
            }),
        ),
    }),
)

const TareaInicio = objeto({
    clave: {
        ...enumerado([
            'comprobantes_por_revisar',
            'lineas_banco_sin_pareja',
            'depositos_en_camino',
            'compras_por_revisar',
            'facturas_por_certificar',
            'asientos_por_aprobar',
            'compras_por_pagar',
            'obligaciones_proximas',
            'turnos_abiertos_anteriores',
        ]),
        description: 'Qué espera por alguien',
    },
    cantidad: { ...entero, description: 'Siempre mayor que cero: las tareas sin pendientes no se devuelven' },
    monto: { ...nulable(Dinero), description: 'Monto asociado si la tarea mueve dinero' },
    fecha: {
        ...nulable(fecha),
        description:
            'Más antigua o más cercana (comprobantes, depósitos, turnos, vencimientos); en lineas_banco_sin_pareja, la del último estado de cuenta',
    },
    proveedores: { ...nulable(entero), description: 'Solo en compras_por_pagar' },
    urgencia: enumerado(['alta', 'media', 'baja']),
    permiso: { ...texto, description: 'Permiso de la acción que resuelve la tarea' },
})

const PasoInicio = objeto({
    numero: { ...entero, description: '1 a 7, en el orden del mes' },
    clave: enumerado([
        'facturar',
        'cobrar_y_cerrar_cajas',
        'compras_y_gastos',
        'conciliar_bancos',
        'revisar_el_mes',
        'declarar_impuestos',
        'cerrar_el_mes',
    ]),
    estado: {
        ...enumerado(['listo', 'pendiente', 'sin_datos', 'error']),
        description:
            'Calculado de los datos. sin_datos = no hay con qué decidirlo (sin extractos, sin obligación fiscal, sin cajas); error = la consulta falló (sin cifras)',
    },
    cantidad: {
        ...nulable(entero),
        description: 'Pendientes (pendiente) o hechos (listo) según el paso; null si no aplica',
    },
    fecha: nulable(fecha),
    error: { ...nulable(Problem), description: 'Solo con estado error' },
})

const IndicadorInicio = objeto({
    estado: {
        ...enumerado(['bien', 'atencion', 'urgente', 'sin_datos', 'sin_permiso', 'error']),
        description:
            'sin_datos = la empresa no tiene con qué calcularlo; sin_permiso = el usuario no tiene el permiso del dato; error = falló (sin cifras)',
    },
    valor: { ...nulable(Dinero), description: 'null salvo con bien, atencion o urgente' },
    cantidad: nulable(entero),
    monto_alerta: nulable(Dinero),
    fecha: nulable(fecha),
    permiso: { ...nulable(texto), description: 'El permiso que faltó (solo con sin_permiso)' },
    error: { ...nulable(Problem), description: 'Solo con estado error' },
})

export const InicioContabilidad = definirEsquema(
    'InicioContabilidad',
    objeto({
        hoy: fecha,
        periodo: { ...texto, description: 'Mes de los pasos (YYYY-MM)' },
        generado_en: instante,
        empresas: lista(objeto({ id, nombre: texto })),
        consolidado: booleano,
        pendientes: { ...entero, description: 'Suma de las cantidades de `tareas`' },
        tareas: {
            ...lista(TareaInicio),
            description:
                'Qué toca hoy: solo lo que el rol puede atender y solo con pendientes, lo más urgente primero',
        },
        tareas_con_error: lista(objeto({ clave: texto, error: Problem })),
        pasos: { ...lista(PasoInicio), description: 'Los 7 pasos del mes, calculados' },
        paso_actual: { ...nulable(entero), description: 'Primer paso pendiente; null si ninguno lo está' },
        indicadores: objeto({
            te_deben: IndicadorInicio,
            debes_proveedores: IndicadorInicio,
            dinero_disponible: IndicadorInicio,
            impuestos_mes: IndicadorInicio,
        }),
    }),
)
