import { readFile } from 'node:fs/promises'
import { Decimal } from 'decimal.js'
import { leerDumpMysql } from '#importacion/mysql_dump'
import {
    normalizarFuente,
    type ArchivoOrigen,
    type Entidad,
    type FilasPorEntidad,
    type FuenteCanonica,
    type ProblemaFila,
} from '#importacion/canonico'
import {
    agrupar,
    filasCanonicas,
    montoSeguro,
    normalizarId,
    ProblemasOrigen,
    tablasDelEsquema,
    texto,
    TrazaOrigen,
    type DefTabla,
    type FilaOrigen,
} from '#importacion/origenes/esquema_sql'

/**
 * Adaptador de origen `smartisp`: lee un volcado SQL de la base de **SmartISP** (`mysqldump` o
 * phpMyAdmin) y lo traduce al formato canónico (`canonico.ts`).
 *
 * Esquema real: `scripts/importacion/esquemas/smartisp.sql`. Mapeo columna por columna, con sus
 * transformaciones y lo que confirmaron los diagnósticos sobre los datos reales
 * (`docs/importacion/diagnostico*-smartisp.sql`): `docs/importacion/mapeo-smartisp.md`. Todo el
 * conocimiento de SmartISP vive en este archivo.
 *
 * Lo esencial (confirmado con los datos reales, segunda ronda de diagnóstico):
 * - Routers en `routers` (secreto en `radius`, tipo de control en `control_routers`), redes en
 *   `address_routers`, planes en `plans`, clientes en `clients` (zona en `zone`), servicios en
 *   `client_services` (usuario y clave en `user_hot` / `pass_hot`), facturas en `bill_customers`
 *   (+ `bill_customer_item`), pagos en `payment_news` (sin los borrados), saldo a favor en
 *   `clients.wallet_balance`.
 * - SmartISP tiene tablas de dos versiones: `invoices` y `payments` vienen vacías; si traen filas,
 *   el reporte lo avisa (quedan en el archivo).
 * - `bill_customers.status`: 1 pagada (con `paid_on`), 2 sin cargo (total 0), 3 pendiente; no hay
 *   4. La columna `open` no significa pendiente: se ignora. Una pagada sin ningún `payment_news`
 *   entra saldada en el origen (`saldada_en_origen` de A3: pagada sin asiento ni pago).
 * - Un `payment_news` cuyo `num_bill` no existe entra como pago sin factura (a favor del cliente).
 * - `clients.balance` no siempre es lo pendiente de sus facturas: el reporte lista cada cliente
 *   distinto con los dos montos; manda lo de las facturas.
 * - `client_services.status`: `ac` activo; `de` y `manually_cortado` suspendido. `typeauth` es
 *   siempre `userpass` y `control_routers.type_control = ps` → PPPoE.
 * - `plans.cost` sin IVA (`iva` 0): el precio entra tal cual. `download`/`upload` en kbps.
 * - `routers.password` está cifrada por SmartISP (88 caracteres): no se importa; el router queda
 *   con credenciales pendientes.
 * - Un código desconocido omite la fila con su valor en el mensaje: nunca se adivina.
 * - Toda fila de toda tabla del volcado va al archivo del origen (`importacion.filas_origen`).
 */
export const ESQUEMA = {
    routers: { tabla: 'routers', columnas: ['id', 'name', 'ip', 'login', 'password'] },
    radius: { tabla: 'radius', columnas: ['router_id', 'secret'], opcional: true },
    control: {
        tabla: 'control_routers',
        columnas: ['router_id', 'type_control', 'dhcp', 'arpmac'],
        opcional: true,
    },
    redes: {
        tabla: 'address_routers',
        columnas: ['router_id', 'network', 'mask', 'gateway', 'type'],
        opcional: true,
    },
    planes: { tabla: 'plans', columnas: ['id', 'name', 'cost', 'iva', 'download', 'upload'] },
    clientes: {
        tabla: 'clients',
        columnas: [
            'id',
            'name',
            'email',
            'phone',
            'address',
            'coordinates',
            'dni',
            'balance',
            'wallet_balance',
            'zona_id',
        ],
    },
    zonas: { tabla: 'zone', columnas: ['id', 'name'], opcional: true },
    servicios: {
        tabla: 'client_services',
        columnas: [
            'id',
            'client_id',
            'ip',
            'mac',
            'date_in',
            'plan_id',
            'router_id',
            'status',
            'user_hot',
            'pass_hot',
        ],
    },
    facturas: {
        tabla: 'bill_customers',
        columnas: [
            'id',
            'num_bill',
            'period',
            'release_date',
            'expiration_date',
            'iva',
            'cost',
            'total_pay',
            'status',
            'client_id',
            'service_id',
            'paid_on',
            'start_date',
        ],
        opcional: true,
    },
    items: { tabla: 'bill_customer_item', columnas: ['bill_customer_id', 'description'], opcional: true },
    pagos: {
        tabla: 'payment_news',
        columnas: ['id', 'client_id', 'way_to_pay', 'date', 'amount', 'num_bill', 'deleted_at'],
        opcional: true,
    },
    invoices: { tabla: 'invoices', columnas: ['id'], opcional: true },
    payments: { tabla: 'payments', columnas: ['id'], opcional: true },
} as const satisfies Record<string, DefTabla>

/** `bill_customers.status` (confirmado con los datos reales: 1, 2 y 3; no existe 4). */
export const ESTADOS_FACTURA: Record<string, 'pagada' | 'sin_cargo' | 'pendiente'> = {
    '1': 'pagada',
    '2': 'sin_cargo',
    '3': 'pendiente',
}

/** `client_services.status` → estado canónico (confirmado: `ac`, `de` y `manually_cortado`). */
export const ESTADOS_SERVICIO: Record<string, 'activo' | 'suspendido' | 'retirado'> = {
    ac: 'activo',
    de: 'suspendido',
    manually_cortado: 'suspendido',
}

/** `control_routers.type_control` (en los datos reales, `ps`); lo demás (colas simples...) = IP estática. */
export const TIPOS_CONTROL = {
    pppoe: ['pp', 'ps', 'pt', 'pa', 'ra'],
    hotspot: ['ho', 'ha'],
    dhcp: ['dl'],
} as const

const MAC_VACIA = /^0{2}([:-]?0{2}){5}$/

export async function leerDumpSmartisp(archivo: string): Promise<FuenteCanonica> {
    return fuenteDesdeDumpSmartisp(await readFile(archivo, 'utf8'), archivo.split('/').at(-1) ?? archivo)
}

/** Igual que `leerDumpSmartisp` con el texto del volcado (pruebas). */
export function fuenteDesdeDumpSmartisp(contenido: string, nombre = 'smartisp.sql'): FuenteCanonica {
    const { filas, duenosFacturas, problemas, archivo } = filasDesdeDumpSmartisp(contenido, nombre)
    const fuente = normalizarFuente(filas)
    fuente.problemas.push(...problemas)
    fuente.duenosFacturas = duenosFacturas
    fuente.archivo = archivo
    return fuente
}

/** La traducción sola (filas canónicas sin validar) y los problemas propios del origen. */
export function filasDesdeDumpSmartisp(
    contenido: string,
    nombre = 'smartisp.sql',
): {
    filas: FilasPorEntidad
    duenosFacturas: Map<string, string>
    problemas: ProblemaFila[]
    archivo: ArchivoOrigen
} {
    const todas = leerDumpMysql(contenido)
    const t = tablasDelEsquema(todas, ESQUEMA, {
        nombre,
        origen: 'smartisp',
        archivo: 'apps/api/app/importacion/origenes/smartisp.ts',
    })
    const problemas = new ProblemasOrigen(nombre)
    const traza = new TrazaOrigen()
    traza.tabla(ESQUEMA.radius.tabla, 'secreto RADIUS: va en el router')
    traza.tabla(
        ESQUEMA.control.tabla,
        'tipo de control del router: decide el tipo de conexión de sus servicios',
    )
    traza.tabla(ESQUEMA.zonas.tabla, 'las zonas se crean por nombre al importar los clientes')
    traza.tabla(ESQUEMA.items.tabla, 'detalle de la factura: va en su concepto')
    traza.tabla(ESQUEMA.invoices.tabla, 'tabla de otra versión de SmartISP: se leen bill_customers')
    traza.tabla(ESQUEMA.payments.tabla, 'tabla de otra versión de SmartISP: se leen payment_news')

    for (const vieja of ['invoices', 'payments'] as const) {
        const n = t[vieja].filas.length
        if (n === 0) continue
        problemas.avisar(
            ESQUEMA[vieja].tabla,
            0,
            null,
            `${ESQUEMA[vieja].tabla} trae ${n} ${n === 1 ? 'fila que no se importa' : 'filas que no se importan'} (se leen ${ESQUEMA.facturas.tabla} ` +
                `y ${ESQUEMA.pagos.tabla}); confirmar con el ISP cuál usa`,
        )
    }

    // Pagos vigentes (sin borrado lógico) y lo pagado por número de factura
    const pagosVigentes = t.pagos.filas
        .map((fila, i) => ({ fila, linea: i + 1 }))
        .filter(({ fila, linea }) => {
            if (!texto(fila.deleted_at)) return true
            traza.soloArchivo(
                ESQUEMA.pagos.tabla,
                linea,
                `borrado en el origen (deleted_at ${texto(fila.deleted_at)})`,
            )
            return false
        })
    const pagadoPorNumero = new Map<string, Decimal>()
    for (const { fila } of pagosVigentes) {
        const num = texto(fila.num_bill)
        if (!num) continue
        pagadoPorNumero.set(num, (pagadoPorNumero.get(num) ?? new Decimal(0)).plus(montoSeguro(fila.amount)))
    }
    const facturaPorNumero = new Map<string, string>()
    for (const b of t.facturas.filas) {
        const num = texto(b.num_bill)
        if (num && !facturaPorNumero.has(num)) facturaPorNumero.set(num, normalizarId(b.id))
    }
    const conceptos = agrupar(t.items.filas, 'bill_customer_id')

    const duenosFacturas = new Map<string, string>()
    const pendientePorCliente = new Map<string, Decimal>()
    const facturas: FilaOrigen[] = []
    t.facturas.filas.forEach((b, i) => {
        const id = normalizarId(b.id)
        const cliente = normalizarId(b.client_id)
        duenosFacturas.set(id, cliente)
        const tabla = ESQUEMA.facturas.tabla
        const estado = ESTADOS_FACTURA[texto(b.status)]
        if (!estado) {
            problemas.omitir(
                tabla,
                i + 1,
                id,
                `status "${texto(b.status)}" desconocido (se esperaba 1 pagada, 2 sin cargo o 3 pendiente)`,
            )
            return
        }
        const pagadaEl = texto(b.paid_on)
        if (estado === 'pagada' && !pagadaEl) {
            problemas.avisar(
                tabla,
                i + 1,
                id,
                `status ${texto(b.status)} (pagada) sin paid_on: revisar el significado del estado`,
            )
        }
        if (estado === 'pendiente' && pagadaEl && !pagadaEl.startsWith('0000')) {
            problemas.avisar(
                tabla,
                i + 1,
                id,
                `status ${texto(b.status)} (pendiente) con paid_on ${pagadaEl}: revisar el significado del estado`,
            )
        }
        const calculado =
            b.total_pay === null || texto(b.total_pay) === ''
                ? montoSeguro(b.cost).plus(montoSeguro(b.iva))
                : montoSeguro(b.total_pay)
        if (estado === 'sin_cargo' && !calculado.isZero()) {
            problemas.avisar(
                tabla,
                i + 1,
                id,
                `status 2 (sin cargo) con total ${calculado.toFixed(2)}: entra con total 0`,
            )
        }
        const total = estado === 'sin_cargo' ? new Decimal(0) : calculado
        const pagado =
            estado === 'pagada'
                ? total
                : Decimal.min(total, pagadoPorNumero.get(texto(b.num_bill)) ?? new Decimal(0))
        const items = (conceptos.get(id) ?? []).map((x) => texto(x.description)).filter(Boolean)
        facturas.push({
            __linea: String(i + 1),
            id,
            cliente_id: cliente,
            servicio_id: normalizarId(b.service_id) || null,
            periodo: mes(b.start_date) ?? mes(b.release_date),
            total: total.toFixed(2),
            pagado: pagado.toFixed(2),
            vence: b.expiration_date,
            emitida: b.release_date,
            concepto: items.join(' · ') || texto(b.period) || null,
            fecha_pago: estado === 'pagada' ? b.paid_on : null,
            nota: estado === 'sin_cargo' ? 'sin cargo en el origen (status 2)' : null,
        })
        traza.vincular(tabla, i + 1, 'facturas', id)
        const pendiente = total.minus(pagado)
        if (pendiente.gt(0)) {
            pendientePorCliente.set(
                cliente,
                (pendientePorCliente.get(cliente) ?? new Decimal(0)).plus(pendiente),
            )
        }
    })

    // Saldo del origen: pendiente − saldo a favor (wallet_balance), solo si hay saldo a favor.
    // `balance` (pending invoice balance) se compara con lo pendiente de sus facturas.
    const saldos: FilaOrigen[] = []
    t.clientes.filas.forEach((c, i) => {
        const id = normalizarId(c.id)
        const pendiente = pendientePorCliente.get(id) ?? new Decimal(0)
        if (texto(c.balance) !== '' && !montoSeguro(c.balance).eq(pendiente)) {
            problemas.avisar(
                `${ESQUEMA.clientes.tabla}.balance`,
                i + 1,
                id,
                `balance del origen ${montoSeguro(c.balance).toFixed(2)} y lo pendiente de sus facturas ` +
                    `${pendiente.toFixed(2)} no coinciden; se importa lo de las facturas`,
            )
        }
        const favor = montoSeguro(c.wallet_balance)
        if (favor.isZero()) return
        saldos.push({ cliente_id: id, saldo: pendiente.minus(favor).toFixed(2) })
    })

    const control = new Map(t.control.filas.map((c) => [normalizarId(c.router_id), c]))
    const secretos = new Map(t.radius.filas.map((r) => [normalizarId(r.router_id), r.secret]))
    const zonas = new Map(t.zonas.filas.map((z) => [normalizarId(z.id), texto(z.name)]))

    t.planes.filas.forEach((p, i) => {
        if (montoSeguro(p.iva).gt(0)) {
            problemas.avisar(
                ESQUEMA.planes.tabla,
                i + 1,
                normalizarId(p.id),
                `iva ${texto(p.iva)}: el precio entra como cost (${texto(p.cost)}); revisar si lleva IVA`,
            )
        }
    })

    const servicios: FilaOrigen[] = t.servicios.filas.map((s, i) => {
        traza.vincular(ESQUEMA.servicios.tabla, i + 1, 'servicios', normalizarId(s.id))
        const ctl = control.get(normalizarId(s.router_id))
        const usuario = texto(s.user_hot)
        const tipoControl = texto(ctl?.type_control).toLowerCase()
        let tipo: string
        if ((TIPOS_CONTROL.hotspot as readonly string[]).includes(tipoControl)) tipo = 'hotspot'
        else if ((TIPOS_CONTROL.pppoe as readonly string[]).includes(tipoControl) || (!ctl && usuario)) {
            tipo = 'pppoe'
        } else if (
            texto(ctl?.dhcp) === '1' ||
            (TIPOS_CONTROL.dhcp as readonly string[]).includes(tipoControl)
        ) {
            tipo = 'dhcp_fija'
        } else tipo = 'ip_estatica'
        const mac = texto(s.mac)
        const status = texto(s.status).toLowerCase()
        return {
            __linea: String(i + 1),
            id: normalizarId(s.id),
            cliente_id: normalizarId(s.client_id),
            router_id: normalizarId(s.router_id),
            plan_id: normalizarId(s.plan_id),
            tipo_conexion: tipo,
            user_ppp: tipo === 'pppoe' ? usuario : null,
            pass_ppp: tipo === 'pppoe' ? s.pass_hot : null,
            ip: s.ip,
            mac: MAC_VACIA.test(mac) ? null : mac,
            amarre_ip_mac: tipo !== 'pppoe' && texto(ctl?.arpmac) === '1' ? 'si' : 'no',
            fecha_instalacion: s.date_in,
            estado: ESTADOS_SERVICIO[status] ?? s.status,
        }
    })

    t.routers.filas.forEach((r, i) => {
        traza.vincular(ESQUEMA.routers.tabla, i + 1, 'routers', normalizarId(r.id))
        if (texto(r.password)) {
            problemas.avisar(
                ESQUEMA.routers.tabla,
                i + 1,
                normalizarId(r.id),
                'la clave de la API (routers.password) está cifrada por SmartISP: no se importa; cargarla en el panel (credenciales pendientes)',
            )
        }
    })
    t.redes.filas.forEach((_n, i) => traza.vincular(ESQUEMA.redes.tabla, i + 1, 'redes', `L${i + 1}`))
    t.planes.filas.forEach((p, i) =>
        traza.vincular(ESQUEMA.planes.tabla, i + 1, 'planes', normalizarId(p.id)),
    )
    t.clientes.filas.forEach((c, i) =>
        traza.vincular(ESQUEMA.clientes.tabla, i + 1, 'clientes', normalizarId(c.id)),
    )

    const entidades: Record<Entidad, FilaOrigen[]> = {
        routers: t.routers.filas.map((r, i) => ({
            __linea: String(i + 1),
            id: normalizarId(r.id),
            nombre: r.name,
            host: r.ip,
            nas_ip: r.ip,
            // routers.password está cifrada: usuario y clave de la API quedan pendientes
            api_usuario: null,
            api_password: null,
            radius_secret: secretos.get(normalizarId(r.id)) ?? null,
        })),
        redes: t.redes.filas.map((n, i) => {
            const red = texto(n.network)
            const mascara = texto(n.mask).replace(/^\//, '')
            return {
                __linea: String(i + 1),
                router_id: normalizarId(n.router_id),
                cidr: red.includes('/') ? red : red && mascara ? `${red}/${mascara}` : null,
                gateway: n.gateway,
                tipo: texto(n.type).toLowerCase().includes('pool') ? 'pool' : 'estatico',
            }
        }),
        planes: t.planes.filas.map((p, i) => ({
            __linea: String(i + 1),
            id: normalizarId(p.id),
            nombre: p.name,
            precio: p.cost,
            bajada: p.download,
            subida: p.upload,
        })),
        clientes: t.clientes.filas.map((c, i) => ({
            __linea: String(i + 1),
            id: normalizarId(c.id),
            nombre: c.name,
            nit: c.dni,
            email: c.email,
            telefono: c.phone,
            direccion: c.address,
            coordenadas: c.coordinates,
            zona: zonas.get(normalizarId(c.zona_id)) || null,
        })),
        servicios,
        facturas,
        saldos,
        pagos: pagosVigentes.map(({ fila: p, linea }) => {
            const num = texto(p.num_bill)
            const factura = num ? (facturaPorNumero.get(num) ?? null) : null
            if (num && !factura) {
                problemas.avisar(
                    ESQUEMA.pagos.tabla,
                    linea,
                    normalizarId(p.id),
                    `num_bill ${num} no existe en bill_customers: entra como pago sin factura (a favor del cliente)`,
                )
            }
            traza.vincular(ESQUEMA.pagos.tabla, linea, 'pagos', normalizarId(p.id))
            return {
                __linea: String(linea),
                id: normalizarId(p.id),
                cliente_id: normalizarId(p.client_id),
                factura_id: factura,
                monto: p.amount,
                fecha: p.date,
                metodo: p.way_to_pay,
            }
        }),
        promesas: [],
    }

    const filas = filasCanonicas(
        entidades,
        {
            routers: ESQUEMA.routers.tabla,
            redes: ESQUEMA.redes.tabla,
            planes: ESQUEMA.planes.tabla,
            clientes: ESQUEMA.clientes.tabla,
            servicios: ESQUEMA.servicios.tabla,
            facturas: ESQUEMA.facturas.tabla,
            saldos: `${ESQUEMA.clientes.tabla}.wallet_balance`,
            pagos: ESQUEMA.pagos.tabla,
            promesas: 'promesas',
        },
        nombre,
    )
    return { filas, duenosFacturas, problemas: problemas.lista, archivo: traza.archivo(todas) }
}

/** Fecha → `YYYY-MM` (primer día del mes en el formato canónico); vacía o `0000-00-00` → null. */
function mes(v: string | null | undefined): string | null {
    const t = texto(v)
    return /^\d{4}-\d{2}/.test(t) && !t.startsWith('0000') ? t.slice(0, 7) : null
}
