import { CLAVES_CATEGORIA_EGRESO, CLAVES_CATEGORIA_EGRESO_CONSULTA } from '#ledger/plan_cuentas'
import {
    Dinero,
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
                description:
                    'Empresa (NIT) (multiempresa). Siempre viene; opcional en el esquema para no romper clientes tipados',
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
        ['revertido_por', 'revertible', 'motivo_no_revertible', 'empresa_id', 'diario', 'numero', 'partida'],
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
            ...auditable,
        },
        ['cajero_nombre', 'turno_abierto_por', 'turno_abierto_por_nombre', 'empresa_id'],
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
            ...auditable,
        },
        ['abierto_por', 'cerrado_por', 'abierto_por_nombre', 'cerrado_por_nombre'],
    ),
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
            ...auditable,
        },
        ['empresa_id', 'compra_id'],
    ),
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
    },
    ['patrimonio'],
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
