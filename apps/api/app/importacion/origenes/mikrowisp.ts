import { readFile } from 'node:fs/promises'
import { Decimal } from 'decimal.js'
import { leerDumpMysql, type FilaSql } from '#importacion/mysql_dump'
import {
    normalizarFuente,
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
    type DefTabla,
    type FilaOrigen,
} from '#importacion/origenes/esquema_sql'

/**
 * Adaptador de origen `mikrowisp`: lee un volcado SQL de la base de **Mikrowisp 6** (`mysqldump`,
 * Adminer o phpMyAdmin) y lo traduce al formato canónico (`canonico.ts`). No decide nada: la
 * validación es la del formato canónico y las reglas de negocio, las del importador.
 *
 * Esquema real: `scripts/importacion/esquemas/mikrowisp6.sql`. Mapeo columna por columna, con sus
 * transformaciones y las dudas que solo resuelven los datos reales:
 * `docs/importacion/mapeo-mikrowisp.md`. Todo el conocimiento de Mikrowisp vive en este archivo.
 *
 * Lo esencial:
 * - Routers en `server` (la IP RADIUS sale de `nas`), redes en `ipv4`, planes en `perfiles`,
 *   clientes en `usuarios` (zona por `tblavisouser`), servicios en `tblservicios`, facturas en
 *   `facturas` (+ `facturaitems`), pagos en `operaciones`, saldo a favor en `saldos`.
 * - El estado es **del cliente** (`usuarios.estado`); el tipo de conexión lo da la seguridad del
 *   router (`server.seguridad`) cuando el servicio no tiene usuario PPPoE.
 * - Ids `zerofill`: se quitan los ceros a la izquierda (`000001` = `1`).
 * - Con `tipoipv4` 1 o 2 la IP del servicio es dinámica (la escribe un trigger de `radacct`): no se
 *   importa como IP fija.
 * - La clave PPPoE nunca sale en el reporte: viaja a `CrearServicio`, que la cifra.
 */
export const ESQUEMA = {
    routers: {
        tabla: 'server',
        columnas: ['id', 'nodo', 'ip', 'user', 'pass', 'secret_radius', 'seguridad'],
    },
    nas: { tabla: 'nas', columnas: ['idserver', 'nasname', 'secret'], opcional: true },
    redes: { tabla: 'ipv4', columnas: ['nodo', 'red', 'cidr', 'tipo'], opcional: true },
    perfiles: {
        tabla: 'perfiles',
        columnas: ['id', 'plan', 'costo', 'velocidad', 'profile', 'limit_down', 'limit_up'],
    },
    usuarios: {
        tabla: 'usuarios',
        columnas: ['id', 'nombre', 'estado', 'correo', 'telefono', 'movil', 'cedula', 'direccion_principal'],
    },
    avisos: { tabla: 'tblavisouser', columnas: ['cliente', 'zona'], opcional: true },
    zonas: { tabla: 'zonas', columnas: ['id', 'zona'], opcional: true },
    servicios: {
        tabla: 'tblservicios',
        columnas: [
            'id',
            'idcliente',
            'idperfil',
            'nodo',
            'costo',
            'mac',
            'ip',
            'instalado',
            'pppuser',
            'ppppass',
            'tiposervicio',
            'tipoipv4',
            'coordenadas',
            'direccion',
            'ipv6',
            'ipv6_duid',
        ],
    },
    radcheck: { tabla: 'radcheck', columnas: ['username', 'attribute', 'value'], opcional: true },
    facturas: {
        tabla: 'facturas',
        columnas: ['id', 'idcliente', 'emitido', 'vencimiento', 'total', 'estado', 'cobrado', 'moneda'],
        opcional: true,
    },
    items: { tabla: 'facturaitems', columnas: ['idfactura', 'descripcion'], opcional: true },
    operaciones: {
        tabla: 'operaciones',
        columnas: ['id', 'nfactura', 'idcliente', 'fecha_pago', 'forma_pago', 'cobrado', 'idmoneda'],
        opcional: true,
    },
    saldos: { tabla: 'saldos', columnas: ['iduser', 'monto', 'estado', 'moneda'], opcional: true },
    monedas: { tabla: 'monedas', columnas: ['id', 'codigo', 'simbolo'], opcional: true },
} as const satisfies Record<string, DefTabla>

/**
 * `server.seguridad` → tipo de conexión de los servicios **sin** usuario PPPoE.
 * SUPUESTO (duda 2 de `docs/importacion/mapeo-mikrowisp.md`): confirmar con los datos reales.
 */
export const SEGURIDAD = {
    /** amarre IP/MAC (ARP estático): `ip_estatica` con `amarre_ip_mac` */
    amarre: ['1'],
    /** DHCP leases: `dhcp_fija` (la MAC amarra el lease) */
    dhcp: ['2'],
} as const

/** `ipv4.tipo` y `tblservicios.tipoipv4`: 0 = estática; 1 y 2 = pool (IP dinámica, triggers de radacct). */
const TIPOS_IP_DINAMICA = ['1', '2']

export async function leerDumpMikrowisp(archivo: string): Promise<FuenteCanonica> {
    return fuenteDesdeDump(await readFile(archivo, 'utf8'), archivo.split('/').at(-1) ?? archivo)
}

/** Igual que `leerDumpMikrowisp` con el texto del volcado (pruebas). */
export function fuenteDesdeDump(contenido: string, nombre = 'dump.sql'): FuenteCanonica {
    const { filas, duenosFacturas, problemas } = filasDesdeDump(contenido, nombre)
    const fuente = normalizarFuente(filas)
    fuente.problemas.push(...problemas)
    fuente.duenosFacturas = duenosFacturas
    return fuente
}

/**
 * La traducción sola: filas con las columnas canónicas, sin validar (así se escriben como CSV
 * con `escribirCsv`, p. ej. el juego `scripts/importacion/sintetico-csv/`), y los problemas
 * propios del origen (filas que no se traducen, datos que no se importan).
 */
export function filasDesdeDump(
    contenido: string,
    nombre = 'dump.sql',
): { filas: FilasPorEntidad; duenosFacturas: Map<string, string>; problemas: ProblemaFila[] } {
    const t = tablasDelEsquema(leerDumpMysql(contenido), ESQUEMA, {
        nombre,
        origen: 'mikrowisp',
        archivo: 'apps/api/app/importacion/origenes/mikrowisp.ts',
    })
    const problemas = new ProblemasOrigen(nombre)
    const monedaAjena = monedasAjenas(t.monedas.filas)

    // Zona del cliente: tblavisouser.zona → zonas.zona
    const zonas = new Map(t.zonas.filas.map((z) => [normalizarId(z.id), texto(z.zona)]))
    const zonaDe = new Map<string, string | null>()
    for (const a of t.avisos.filas) {
        const cliente = normalizarId(a.cliente)
        if (!zonaDe.has(cliente)) zonaDe.set(cliente, zonas.get(normalizarId(a.zona)) || null)
    }

    // Pagos (en quetzales) por factura, para comparar con facturas.cobrado
    const operaciones: Array<{ fila: FilaSql; linea: number }> = []
    const pagadoPorFactura = new Map<string, Decimal>()
    t.operaciones.filas.forEach((op, i) => {
        const id = normalizarId(op.id)
        const ajena = monedaAjena(op.idmoneda)
        if (ajena) {
            problemas.omitir(
                ESQUEMA.operaciones.tabla,
                i + 1,
                id,
                `moneda ${ajena}: solo se importan pagos en quetzales (GTQ)`,
            )
            return
        }
        operaciones.push({ fila: op, linea: i + 1 })
        const f = normalizarId(op.nfactura)
        if (!f || f === '0') return
        pagadoPorFactura.set(f, (pagadoPorFactura.get(f) ?? new Decimal(0)).plus(montoSeguro(op.cobrado)))
    })

    const conceptos = agrupar(t.items.filas, 'idfactura')

    // Facturas: las anuladas no se exportan; las pagadas van con pagado = total (pendiente 0).
    const facturas: FilaOrigen[] = []
    const pendientePorCliente = new Map<string, Decimal>()
    const duenosFacturas = new Map<string, string>()
    t.facturas.filas.forEach((f, i) => {
        const id = normalizarId(f.id)
        const cliente = normalizarId(f.idcliente)
        duenosFacturas.set(id, cliente)
        const estado = texto(f.estado).toLowerCase()
        if (estado.startsWith('anulad')) return
        const ajena = monedaAjena(f.moneda)
        if (ajena) {
            problemas.omitir(
                ESQUEMA.facturas.tabla,
                i + 1,
                id,
                `moneda ${ajena}: solo se importan facturas en quetzales (GTQ)`,
            )
            return
        }
        const total = montoSeguro(f.total)
        let pagado: Decimal
        if (estado === 'pagado') {
            pagado = total
        } else if (estado === 'no pagado') {
            const cobrado = montoSeguro(f.cobrado)
            pagado = Decimal.min(total, cobrado)
            const operado = pagadoPorFactura.get(id) ?? new Decimal(0)
            if (!operado.eq(cobrado)) {
                problemas.avisar(
                    ESQUEMA.facturas.tabla,
                    i + 1,
                    id,
                    `cobrado ${cobrado.toFixed(2)} y la suma de sus operaciones ${operado.toFixed(2)} no ` +
                        `coinciden; se importa lo cobrado`,
                )
            }
        } else {
            problemas.omitir(
                ESQUEMA.facturas.tabla,
                i + 1,
                id,
                `estado "${texto(f.estado)}" desconocido (se esperaba No pagado, Pagado o Anulado)`,
            )
            return
        }
        const items = (conceptos.get(id) ?? []).map((x) => texto(x.descripcion)).filter(Boolean)
        facturas.push({
            id,
            cliente_id: cliente,
            servicio_id: null,
            periodo: periodoDe(f.emitido),
            total: f.total,
            pagado: pagado.toFixed(2),
            vence: f.vencimiento,
            concepto: items.join(' · ') || null,
        })
        const pendiente = total.minus(pagado)
        if (pendiente.gt(0)) {
            pendientePorCliente.set(
                cliente,
                (pendientePorCliente.get(cliente) ?? new Decimal(0)).plus(pendiente),
            )
        }
    })

    // Saldo a favor: saldos sin aplicar (`no cobrado`) del cliente, en quetzales.
    const favorPorCliente = new Map<string, Decimal>()
    t.saldos.filas.forEach((s, i) => {
        if (texto(s.estado).toLowerCase() !== 'no cobrado') return
        const cliente = normalizarId(s.iduser)
        const ajena = monedaAjena(s.moneda)
        if (ajena) {
            problemas.omitir(ESQUEMA.saldos.tabla, i + 1, cliente, `saldo a favor en ${ajena}: no se importa`)
            return
        }
        favorPorCliente.set(
            cliente,
            (favorPorCliente.get(cliente) ?? new Decimal(0)).plus(montoSeguro(s.monto)),
        )
    })

    // Saldo del origen: lo pendiente de sus facturas menos su saldo a favor. Solo se exporta
    // cuando hay saldo a favor; si no, el importador usa la suma de sus facturas pendientes.
    const usuarios = t.usuarios.filas
    const saldos: FilaOrigen[] = []
    for (const u of usuarios) {
        const cliente = normalizarId(u.id)
        const favor = favorPorCliente.get(cliente)
        if (!favor || favor.isZero()) continue
        const saldo = (pendientePorCliente.get(cliente) ?? new Decimal(0)).minus(favor)
        saldos.push({ cliente_id: cliente, saldo: saldo.toFixed(2) })
    }

    const estadoCliente = new Map(usuarios.map((u) => [normalizarId(u.id), u.estado]))
    const routers = new Map(t.routers.filas.map((r) => [normalizarId(r.id), r]))
    const nasDe = agrupar(t.nas.filas, 'idserver')
    const perfiles = new Map(t.perfiles.filas.map((p) => [normalizarId(p.id), p]))
    const claveRadius = new Map(
        t.radcheck.filas
            .filter((r) => texto(r.attribute).toLowerCase() === 'cleartext-password')
            .map((r) => [texto(r.username).toLowerCase(), r.value]),
    )

    const servicios: FilaOrigen[] = []
    t.servicios.filas.forEach((s, i) => {
        const id = normalizarId(s.id)
        const tabla = ESQUEMA.servicios.tabla
        const tipoServicio = texto(s.tiposervicio).toLowerCase() || 'internet'
        if (tipoServicio !== 'internet') {
            problemas.omitir(
                tabla,
                i + 1,
                id,
                `tiposervicio "${texto(s.tiposervicio)}": solo se importan servicios de internet`,
            )
            return
        }
        const pppuser = texto(s.pppuser)
        const seguridad = texto(routers.get(normalizarId(s.nodo))?.seguridad)
        const tipo = pppuser
            ? 'pppoe'
            : (SEGURIDAD.dhcp as readonly string[]).includes(seguridad)
              ? 'dhcp_fija'
              : 'ip_estatica'
        const amarre = !pppuser && (SEGURIDAD.amarre as readonly string[]).includes(seguridad)

        const dinamica = TIPOS_IP_DINAMICA.includes(texto(s.tipoipv4))
        const ips = texto(s.ip)
            .split(/[\s,;]+/)
            .filter(Boolean)
        if (!dinamica && ips.length > 1) {
            problemas.avisar(
                tabla,
                i + 1,
                id,
                `ip trae ${ips.length} direcciones; se importa la primera (${ips[0]})`,
            )
        }
        if (texto(s.ipv6) || texto(s.ipv6_duid)) {
            problemas.avisar(
                tabla,
                i + 1,
                id,
                'IPv6 y DUID del origen no se importan; se configuran en ArgosIsp',
            )
        }
        const plan = perfiles.get(normalizarId(s.idperfil))
        const costo = montoSeguro(s.costo)
        if (plan && !costo.isZero() && !costo.eq(montoSeguro(plan.costo))) {
            problemas.avisar(
                tabla,
                i + 1,
                id,
                `precio del servicio ${costo.toFixed(2)} distinto al del plan ${montoSeguro(plan.costo).toFixed(2)}; ` +
                    'entra con el precio del plan',
            )
        }
        servicios.push({
            id,
            cliente_id: normalizarId(s.idcliente),
            router_id: normalizarId(s.nodo),
            plan_id: normalizarId(s.idperfil),
            tipo_conexion: tipo,
            user_ppp: pppuser,
            pass_ppp: pppuser ? texto(s.ppppass) || (claveRadius.get(pppuser.toLowerCase()) ?? null) : null,
            ip: dinamica ? null : (ips[0] ?? null),
            mac: s.mac,
            amarre_ip_mac: amarre ? 'si' : 'no',
            direccion: s.direccion,
            coordenadas: s.coordenadas,
            fecha_instalacion: s.instalado,
            estado: estadoCliente.get(normalizarId(s.idcliente)) ?? null,
        })
    })

    const entidades: Record<Entidad, FilaOrigen[]> = {
        routers: t.routers.filas.map((r) => {
            const nas = nasDe.get(normalizarId(r.id))?.[0]
            return {
                id: normalizarId(r.id),
                nombre: r.nodo,
                host: r.ip,
                nas_ip: texto(nas?.nasname) || r.ip,
                api_usuario: r.user,
                api_password: r.pass,
                radius_secret: texto(r.secret_radius) || nas?.secret,
            }
        }),
        redes: t.redes.filas.map((r) => {
            const red = texto(r.red)
            const tipo = texto(r.tipo)
            return {
                router_id: normalizarId(r.nodo),
                cidr: red.includes('/')
                    ? red
                    : red && texto(r.cidr)
                      ? `${red}/${texto(r.cidr).replace(/^\//, '')}`
                      : null,
                gateway: null,
                tipo:
                    tipo === '0' || tipo === ''
                        ? 'estatico'
                        : TIPOS_IP_DINAMICA.includes(tipo)
                          ? 'pool'
                          : tipo,
            }
        }),
        planes: t.perfiles.filas.map((p) => {
            const [subida, bajada] = velocidades(p.velocidad)
            return {
                id: normalizarId(p.id),
                nombre: p.plan,
                precio: p.costo,
                bajada,
                subida,
                bajada_limitada: sinCero(p.limit_down),
                subida_limitada: sinCero(p.limit_up),
                perfil_ppp: p.profile,
                pool_ipv4: null,
            }
        }),
        clientes: usuarios.map((u) => ({
            id: normalizarId(u.id),
            nombre: u.nombre,
            nit: u.cedula,
            email: u.correo,
            telefono: u.telefono,
            movil: u.movil,
            direccion: u.direccion_principal,
            zona: zonaDe.get(normalizarId(u.id)) ?? null,
        })),
        servicios,
        facturas,
        saldos,
        pagos: operaciones.map(({ fila: o }) => ({
            id: normalizarId(o.id),
            cliente_id: normalizarId(o.idcliente),
            factura_id: normalizarId(o.nfactura),
            monto: o.cobrado,
            fecha: o.fecha_pago,
            metodo: o.forma_pago,
        })),
    }

    const filas = filasCanonicas(
        entidades,
        {
            routers: ESQUEMA.routers.tabla,
            redes: ESQUEMA.redes.tabla,
            planes: ESQUEMA.perfiles.tabla,
            clientes: ESQUEMA.usuarios.tabla,
            servicios: ESQUEMA.servicios.tabla,
            facturas: ESQUEMA.facturas.tabla,
            saldos: ESQUEMA.saldos.tabla,
            pagos: ESQUEMA.operaciones.tabla,
        },
        nombre,
    )
    return { filas, duenosFacturas, problemas: problemas.lista }
}

/**
 * Moneda que no es quetzal, o null. Sin tabla `monedas` o sin fila para el id, se asume
 * quetzales (moneda 1, la de por defecto en Mikrowisp).
 */
function monedasAjenas(monedas: FilaSql[]): (id: string | null | undefined) => string | null {
    const porId = new Map(monedas.map((m) => [normalizarId(m.id), m]))
    return (id) => {
        const m = porId.get(normalizarId(id) || '1')
        if (!m) return null
        const codigo = texto(m.codigo).toUpperCase()
        const simbolo = texto(m.simbolo)
        if (codigo === 'GTQ' || codigo === 'Q' || simbolo === 'Q') return null
        return codigo || simbolo || normalizarId(id)
    }
}

/** `2026-09-15` → `2026-09` (mes de emisión); vacío o `0000-00-00` → null. */
function periodoDe(emitido: string | null | undefined): string | null {
    const v = texto(emitido)
    return /^\d{4}-\d{2}/.test(v) && !v.startsWith('0000') ? v.slice(0, 7) : null
}

/** `'0'` es el defecto de `limit_down` / `limit_up`: sin dato. */
function sinCero(v: string | null | undefined): string | null {
    const t = texto(v)
    return t === '' || t === '0' ? null : t
}

/** `5M/10M` (max-limit de MikroTik: subida/bajada) → ['5M', '10M']; `10M` → ['10M', '10M']. */
function velocidades(v: string | null | undefined): [string | null, string | null] {
    const valor = texto(v)
    if (!valor) return [null, null]
    const [subida, bajada] = valor.split('/').map((x) => x.trim())
    return [subida ?? null, bajada ?? subida ?? null]
}
