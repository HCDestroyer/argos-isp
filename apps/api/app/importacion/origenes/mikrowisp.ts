import { readFile } from 'node:fs/promises'
import { Decimal } from 'decimal.js'
import { leerDumpMysql, type FilaSql } from '#importacion/mysql_dump'
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
 * Adaptador de origen `mikrowisp`: lee un volcado SQL de la base de **Mikrowisp 6** (`mysqldump`,
 * Adminer o phpMyAdmin) y lo traduce al formato canónico (`canonico.ts`). No decide nada: la
 * validación es la del formato canónico y las reglas de negocio, las del importador.
 *
 * Esquema real: `scripts/importacion/esquemas/mikrowisp6.sql`. Mapeo columna por columna, con sus
 * transformaciones y lo que confirmaron los diagnósticos sobre los datos reales
 * (`docs/importacion/diagnostico*-mikrowisp.sql`): `docs/importacion/mapeo-mikrowisp.md`. Todo el
 * conocimiento de Mikrowisp vive en este archivo.
 *
 * Lo esencial (confirmado con los datos reales, segunda ronda de diagnóstico):
 * - Routers en `server`; la IP NAS es `server.ip_radius` (la tabla `nas` viene vacía). La clave
 *   de la API (`server.pass`) está cifrada por Mikrowisp (32 caracteres): no se importa y el
 *   router queda con credenciales pendientes.
 * - Redes en `ipv4`, planes en `perfiles` (`costo` con IVA incluido; `velocidad` = `subida/bajada`
 *   con K o M; `limit_down`/`limit_up` no se usan), clientes en `usuarios` (zona por
 *   `tblavisouser`; un solo correo), servicios en `tblservicios`, facturas en `facturas`
 *   (+ `facturaitems`), pagos en `operaciones`, promesas en `credito`.
 * - El estado es **del cliente** (`usuarios.estado`: ACTIVO, SUSPENDIDO, RETIRADO).
 * - Tipo de conexión: con `pppuser` → PPPoE; sin `pppuser` → IP estática con su IP y MAC, **sin
 *   amarre** (`server.seguridad` no dice el tipo de conexión: el router con `seguridad = 1` tiene
 *   solo PPPoE). `seguridad` y `seguridad2` del router quedan en el archivo del origen y el
 *   reporte dice cuántos servicios entraron como IP estática por router.
 * - Facturas: prepago, **periodo = mes del vencimiento**. `tipo = 1` son cargos únicos
 *   (instalación, TV adicional) → sin periodo. Una segunda factura de servicio del mismo cliente
 *   con vencimiento en el mismo mes entra como cargo único con nota. Estados `pagado`,
 *   `No pagado` y `anulado`; `cobrado` = suma de `operaciones`; `facturas.saldo` siempre 0.
 * - `saldos`: solo traslados entre facturas (`facturado`, ya reflejados en `cobrado`): no hay saldo
 *   a favor; quedan en el archivo.
 * - Promesas (`credito`): las vigentes (`fecha_limite` ≥ hoy) sobre facturas `No pagado`.
 * - Ids `zerofill`: se quitan los ceros a la izquierda (`000001` = `1`).
 * - Con `tipoipv4` 1 o 2 la IP del servicio es dinámica (la escribe un trigger de `radacct`): no se
 *   importa como IP fija.
 * - Toda fila de toda tabla del volcado va al archivo del origen (`importacion.filas_origen`).
 * - La clave PPPoE nunca sale en el reporte: viaja a `CrearServicio`, que la cifra.
 */
export const ESQUEMA = {
    routers: {
        tabla: 'server',
        columnas: [
            'id',
            'nodo',
            'ip',
            'user',
            'pass',
            'secret_radius',
            'ip_radius',
            'seguridad',
            'seguridad2',
        ],
    },
    nas: { tabla: 'nas', columnas: ['idserver', 'nasname', 'secret'], opcional: true },
    redes: { tabla: 'ipv4', columnas: ['nodo', 'red', 'cidr', 'tipo'], opcional: true },
    perfiles: {
        tabla: 'perfiles',
        columnas: ['id', 'plan', 'costo', 'velocidad', 'profile'],
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
        columnas: [
            'id',
            'idcliente',
            'emitido',
            'vencimiento',
            'pago',
            'total',
            'estado',
            'tipo',
            'cobrado',
            'moneda',
        ],
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
    credito: {
        tabla: 'credito',
        columnas: ['id', 'idcliente', 'idfactura', 'fechaingreso', 'fecha_limite', 'descripcion'],
        opcional: true,
    },
} as const satisfies Record<string, DefTabla>

/** `facturas.tipo`: 1 = cargo único (instalación, TV adicional, un cobro suelto); 2 = servicio. */
export const TIPO_FACTURA_CARGO_UNICO = '1'

/** `ipv4.tipo` y `tblservicios.tipoipv4`: 0 = estática; 1 y 2 = pool (IP dinámica, triggers de radacct). */
const TIPOS_IP_DINAMICA = ['1', '2']

export interface OpcionesMikrowisp {
    /** día de hoy (YYYY-MM-DD) para decidir qué promesas siguen vigentes; por defecto, hoy */
    hoy?: string
}

export async function leerDumpMikrowisp(
    archivo: string,
    opciones: OpcionesMikrowisp = {},
): Promise<FuenteCanonica> {
    return fuenteDesdeDump(await readFile(archivo, 'utf8'), archivo.split('/').at(-1) ?? archivo, opciones)
}

/** Igual que `leerDumpMikrowisp` con el texto del volcado (pruebas). */
export function fuenteDesdeDump(
    contenido: string,
    nombre = 'dump.sql',
    opciones: OpcionesMikrowisp = {},
): FuenteCanonica {
    const { filas, duenosFacturas, problemas, notas, archivo } = filasDesdeDump(contenido, nombre, opciones)
    const fuente = normalizarFuente(filas)
    fuente.problemas.push(...problemas)
    fuente.duenosFacturas = duenosFacturas
    fuente.notas = notas
    fuente.archivo = archivo
    return fuente
}

/**
 * La traducción sola: filas con las columnas canónicas, sin validar (así se escriben como CSV
 * con `escribirCsv`, p. ej. el juego `scripts/importacion/sintetico-csv/`), los problemas propios
 * del origen, las notas para el reporte y el archivo con todas las filas del volcado.
 */
export function filasDesdeDump(
    contenido: string,
    nombre = 'dump.sql',
    opciones: OpcionesMikrowisp = {},
): {
    filas: FilasPorEntidad
    duenosFacturas: Map<string, string>
    problemas: ProblemaFila[]
    notas: string[]
    archivo: ArchivoOrigen
} {
    const todas = leerDumpMysql(contenido)
    const t = tablasDelEsquema(todas, ESQUEMA, {
        nombre,
        origen: 'mikrowisp',
        archivo: 'apps/api/app/importacion/origenes/mikrowisp.ts',
    })
    const hoy = opciones.hoy ?? new Date().toISOString().slice(0, 10)
    const problemas = new ProblemasOrigen(nombre)
    const traza = new TrazaOrigen()
    const notas: string[] = []
    const monedaAjena = monedasAjenas(t.monedas.filas)

    traza.tabla(ESQUEMA.nas.tabla, 'la IP NAS sale de server.ip_radius (nas se lee solo como respaldo)')
    traza.tabla(ESQUEMA.avisos.tabla, 'zona del cliente: va en el cliente')
    traza.tabla(ESQUEMA.zonas.tabla, 'las zonas se crean por nombre al importar los clientes')
    traza.tabla(ESQUEMA.items.tabla, 'detalle de la factura: va en su concepto')
    traza.tabla(ESQUEMA.radcheck.tabla, 'la clave PPPoE va al servicio (cifrada)')
    traza.tabla(ESQUEMA.monedas.tabla, 'catálogo de monedas: solo se importa en quetzales')

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
        traza.vincular(ESQUEMA.operaciones.tabla, i + 1, 'pagos', id)
        const f = normalizarId(op.nfactura)
        if (!f || f === '0') return
        pagadoPorFactura.set(f, (pagadoPorFactura.get(f) ?? new Decimal(0)).plus(montoSeguro(op.cobrado)))
    })

    const conceptos = agrupar(t.items.filas, 'idfactura')

    // Facturas. Anuladas: solo archivo. Pagadas: pagado = total (pendiente 0); sin ninguna
    // operación que la cubra, el importador la marca saldada en el origen.
    const facturas: FilaOrigen[] = []
    const estadoFactura = new Map<string, string>()
    const pendientePorCliente = new Map<string, Decimal>()
    const duenosFacturas = new Map<string, string>()
    /** cliente + mes de vencimiento de las facturas de servicio, para la segunda del mismo mes */
    const periodosUsados = new Set<string>()
    t.facturas.filas.forEach((f, i) => {
        const linea = i + 1
        const tabla = ESQUEMA.facturas.tabla
        const id = normalizarId(f.id)
        const cliente = normalizarId(f.idcliente)
        duenosFacturas.set(id, cliente)
        const estado = texto(f.estado).toLowerCase()
        estadoFactura.set(id, estado)
        if (estado.startsWith('anulad')) {
            traza.soloArchivo(tabla, linea, 'anulada en el origen')
            return
        }
        const ajena = monedaAjena(f.moneda)
        if (ajena) {
            problemas.omitir(
                tabla,
                linea,
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
                    tabla,
                    linea,
                    id,
                    `cobrado ${cobrado.toFixed(2)} y la suma de sus operaciones ${operado.toFixed(2)} no ` +
                        `coinciden; se importa lo cobrado`,
                )
            }
        } else {
            problemas.omitir(
                tabla,
                linea,
                id,
                `estado "${texto(f.estado)}" desconocido (se esperaba pagado, No pagado o anulado)`,
            )
            return
        }

        // Periodo = mes del vencimiento (prepago). Cargo único (tipo 1) o segunda del mismo mes: sin periodo.
        let periodo = mesDe(f.vencimiento) ?? mesDe(f.emitido)
        let nota: string | null = null
        if (texto(f.tipo) === TIPO_FACTURA_CARGO_UNICO) {
            periodo = null
            nota = 'cargo único en el origen (facturas.tipo = 1): entra sin periodo'
        } else if (periodo) {
            const clave = `${cliente}:${periodo}`
            if (periodosUsados.has(clave)) {
                nota = `segunda factura de servicio del cliente con vencimiento en ${periodo}: entra como cargo único sin periodo`
                periodo = null
            } else periodosUsados.add(clave)
        }
        const items = (conceptos.get(id) ?? []).map((x) => texto(x.descripcion)).filter(Boolean)
        facturas.push({
            __linea: String(linea),
            id,
            cliente_id: cliente,
            servicio_id: null,
            periodo,
            total: f.total,
            pagado: pagado.toFixed(2),
            vence: f.vencimiento,
            emitida: f.emitido,
            concepto: items.join(' · ') || null,
            fecha_pago: estado === 'pagado' ? f.pago : null,
            nota,
        })
        traza.vincular(tabla, linea, 'facturas', id)
        const pendiente = total.minus(pagado)
        if (pendiente.gt(0)) {
            pendientePorCliente.set(
                cliente,
                (pendientePorCliente.get(cliente) ?? new Decimal(0)).plus(pendiente),
            )
        }
    })

    // Saldo a favor: saldos sin aplicar (`no cobrado`) del cliente, en quetzales. En los datos
    // reales solo hay `facturado` (traslados entre facturas, ya reflejados en cobrado).
    const favorPorCliente = new Map<string, Decimal>()
    t.saldos.filas.forEach((s, i) => {
        const tabla = ESQUEMA.saldos.tabla
        const estado = texto(s.estado).toLowerCase()
        if (estado !== 'no cobrado') {
            traza.soloArchivo(
                tabla,
                i + 1,
                estado === 'facturado'
                    ? 'traslado entre facturas: ya está en lo cobrado de las facturas'
                    : `saldo ${texto(s.estado)}: ya aplicado en el origen`,
            )
            return
        }
        const cliente = normalizarId(s.iduser)
        const ajena = monedaAjena(s.moneda)
        if (ajena) {
            problemas.omitir(tabla, i + 1, cliente, `saldo a favor en ${ajena}: no se importa`)
            return
        }
        traza.soloArchivo(tabla, i + 1, 'saldo a favor: entra en el saldo inicial del cliente')
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

    // Promesas vigentes sobre facturas No pagado
    const promesas: FilaOrigen[] = []
    t.credito.filas.forEach((c, i) => {
        const tabla = ESQUEMA.credito.tabla
        const id = normalizarId(c.id)
        const limite = texto(c.fecha_limite).slice(0, 10)
        const factura = normalizarId(c.idfactura)
        if (!limite || limite.startsWith('0000') || limite < hoy) {
            traza.soloArchivo(
                tabla,
                i + 1,
                `promesa vencida en el origen (fecha_limite ${limite || 'vacía'})`,
            )
            return
        }
        const estado = estadoFactura.get(factura)
        if (estado !== 'no pagado') {
            traza.soloArchivo(
                tabla,
                i + 1,
                estado
                    ? `la factura ${factura} está ${estado}: la promesa ya no aplica`
                    : `la factura ${factura} no existe`,
            )
            return
        }
        promesas.push({
            __linea: String(i + 1),
            id,
            cliente_id: normalizarId(c.idcliente),
            factura_id: factura,
            vence: limite,
            fecha: c.fechaingreso,
            monto: null,
            descripcion: c.descripcion,
        })
        traza.vincular(tabla, i + 1, 'promesas', id)
    })

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
    const estaticosPorRouter = new Map<string, number>()
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
        // Regla confirmada con los datos reales: sin usuario PPPoE = IP estática (con IP y MAC), sin amarre.
        const tipo = pppuser ? 'pppoe' : 'ip_estatica'
        const router = normalizarId(s.nodo)
        if (!pppuser) estaticosPorRouter.set(router, (estaticosPorRouter.get(router) ?? 0) + 1)

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
            __linea: String(i + 1),
            id,
            cliente_id: normalizarId(s.idcliente),
            router_id: router,
            plan_id: normalizarId(s.idperfil),
            tipo_conexion: tipo,
            user_ppp: pppuser,
            pass_ppp: pppuser ? texto(s.ppppass) || (claveRadius.get(pppuser.toLowerCase()) ?? null) : null,
            ip: dinamica ? null : (ips[0] ?? null),
            mac: s.mac,
            amarre_ip_mac: 'no',
            direccion: s.direccion,
            coordenadas: s.coordenadas,
            fecha_instalacion: s.instalado,
            estado: estadoCliente.get(normalizarId(s.idcliente)) ?? null,
        })
        traza.vincular(tabla, i + 1, 'servicios', id)
    })

    for (const [router, n] of [...estaticosPorRouter.entries()].sort(([a], [b]) => Number(a) - Number(b))) {
        const r = routers.get(router)
        notas.push(
            `Router ${router}${r ? ` ${texto(r.nodo)} (seguridad ${texto(r.seguridad) || '-'}, seguridad2 ${texto(r.seguridad2) || '-'})` : ''}: ` +
                `${n} ${n === 1 ? 'servicio sin usuario PPPoE entra' : 'servicios sin usuario PPPoE entran'} como IP estática con su IP y MAC, sin amarre`,
        )
    }

    t.routers.filas.forEach((r, i) => {
        traza.vincular(ESQUEMA.routers.tabla, i + 1, 'routers', normalizarId(r.id))
        if (texto(r.pass)) {
            problemas.avisar(
                ESQUEMA.routers.tabla,
                i + 1,
                normalizarId(r.id),
                'la clave de la API (server.pass) está cifrada por Mikrowisp: no se importa; cargarla en el panel (credenciales pendientes)',
            )
        }
    })
    t.redes.filas.forEach((_r, i) => traza.vincular(ESQUEMA.redes.tabla, i + 1, 'redes', `L${i + 1}`))
    t.perfiles.filas.forEach((p, i) =>
        traza.vincular(ESQUEMA.perfiles.tabla, i + 1, 'planes', normalizarId(p.id)),
    )
    usuarios.forEach((u, i) => traza.vincular(ESQUEMA.usuarios.tabla, i + 1, 'clientes', normalizarId(u.id)))

    const entidades: Record<Entidad, FilaOrigen[]> = {
        routers: t.routers.filas.map((r, i) => {
            const nas = nasDe.get(normalizarId(r.id))?.[0]
            return {
                __linea: String(i + 1),
                id: normalizarId(r.id),
                nombre: r.nodo,
                host: r.ip,
                nas_ip: texto(r.ip_radius) || texto(nas?.nasname) || r.ip,
                // server.pass está cifrada: usuario y clave de la API quedan pendientes
                api_usuario: null,
                api_password: null,
                radius_secret: texto(r.secret_radius) || nas?.secret,
            }
        }),
        redes: t.redes.filas.map((r, i) => {
            const red = texto(r.red)
            const tipo = texto(r.tipo)
            return {
                __linea: String(i + 1),
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
        planes: t.perfiles.filas.map((p, i) => {
            const [subida, bajada] = velocidades(p.velocidad)
            return {
                __linea: String(i + 1),
                id: normalizarId(p.id),
                nombre: p.plan,
                // perfiles.costo ya trae el IVA (12 % incluido), igual que el precio de ArgosIsp
                precio: p.costo,
                bajada,
                subida,
                perfil_ppp: p.profile,
                pool_ipv4: null,
            }
        }),
        clientes: usuarios.map((u, i) => ({
            __linea: String(i + 1),
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
        pagos: operaciones.map(({ fila: o, linea }) => ({
            __linea: String(linea),
            id: normalizarId(o.id),
            cliente_id: normalizarId(o.idcliente),
            factura_id: normalizarId(o.nfactura),
            monto: o.cobrado,
            fecha: o.fecha_pago,
            metodo: o.forma_pago,
        })),
        promesas,
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
            // calculado (pendiente − saldo a favor): no es una fila de la tabla saldos
            saldos: `${ESQUEMA.saldos.tabla} (calculado)`,
            pagos: ESQUEMA.operaciones.tabla,
            promesas: ESQUEMA.credito.tabla,
        },
        nombre,
    )
    return { filas, duenosFacturas, problemas: problemas.lista, notas, archivo: traza.archivo(todas) }
}

/**
 * Moneda que no es quetzal, o null. Sin tabla `monedas` o sin fila para el id, se asume
 * quetzales (moneda 1, la de por defecto en Mikrowisp; los datos reales tienen una sola).
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

/** `2026-09-15` → `2026-09`; vacío o `0000-00-00` → null. */
function mesDe(fecha: string | null | undefined): string | null {
    const v = texto(fecha)
    return /^\d{4}-\d{2}/.test(v) && !v.startsWith('0000') ? v.slice(0, 7) : null
}

/** `5M/10M` o `3000K/5000K` (max-limit de MikroTik: subida/bajada) → ['5M', '10M']; `10M` → ['10M', '10M']. */
function velocidades(v: string | null | undefined): [string | null, string | null] {
    const valor = texto(v)
    if (!valor) return [null, null]
    const [subida, bajada] = valor.split('/').map((x) => x.trim())
    return [subida ?? null, bajada ?? subida ?? null]
}
