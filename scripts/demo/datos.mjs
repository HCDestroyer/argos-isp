#!/usr/bin/env node
// Datos de demostración cargados por la API real: pasan por las acciones de dominio, la
// auditoría y el outbox, igual que si los capturara un operador.
//
//   pnpm demo:datos
//
// Requiere la API levantada con el seed aplicado. Es idempotente: cada paso busca primero lo que
// ya existe (por nombre, NIT, número, código o identificador) y solo crea lo que falta, así que se
// puede correr dos veces sin duplicar nada. Variables: API_URL (http://localhost:3333), DEMO_EMAIL
// y DEMO_PASSWORD (por defecto, el admin de desarrollo de apps/api/.env.example).
//
// Crea:
// - 2 empresas (la principal y «Cable Norte»), 4 zonas, 2 routers con redes IPv4 e IPv6;
// - 4 planes con su tipo (2 residenciales, 1 empresarial y 1 dedicado simétrico 1:1), implementados
//   en ambos routers; el «Hogar 50 Mb» trae Netflix incluido;
// - un catálogo de adicionales por empresa (Netflix, IPTV, Disney+) y un motivo de cortesía propio
//   de cada empresa, además de los comunes;
// - 2 plantillas, 8 clientes (NIT con dígito verificador o CF) y 8 servicios:
//   adicionales incluidos (por el plan), una cortesía, cobrados prorrateados y uno con
//   `primer_periodo: sin_costo`; un servicio suspendido con su adicional bloqueado; dos servicios de
//   «Cable Norte», uno de ellos retirado;
// - una cuenta bancaria propia (Banrural · Monetaria) y un pago por transferencia que deja al día
//   a un cliente con servicio activo (facturado hasta hoy).
// DEMO_FEL=falso (y DEMO_FEL_MODO) configura la FEL con el certificador falso de pruebas; sin ella
// no se toca la FEL.
const B = (process.env.API_URL ?? 'http://localhost:3333') + '/api/v1'
let token
async function api(m, p, body) {
    const r = await fetch(B + p, {
        method: m,
        headers: {
            'content-type': 'application/json',
            ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(`${m} ${p} → ${r.status} ${JSON.stringify(j)}`)
    return j
}
/** Todas las páginas de una lista con cursor. */
async function todas(p) {
    const filas = []
    let cursor = null
    do {
        const sep = p.includes('?') ? '&' : '?'
        const r = await api(
            'GET',
            `${p}${sep}limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
        )
        filas.push(...r.data)
        cursor = r.nextCursor
    } while (cursor)
    return filas
}
const creados = {}
function contar(que) {
    creados[que] = (creados[que] ?? 0) + 1
}
/** Busca con `buscar()`; si no está, lo crea con `crear()` y lo cuenta. */
async function obtenerOCrear(que, buscar, crear) {
    const existente = await buscar()
    if (existente) return existente
    contar(que)
    return crear()
}
function nit(base) {
    const d = String(base).split('').reverse()
    const s = d.reduce((a, x, i) => a + Number(x) * (i + 2), 0)
    const v = (11 - (s % 11)) % 11
    return `${base}-${v === 10 ? 'K' : v}`
}
const sinGuion = (valor) => valor.replace(/-/g, '').toUpperCase()

token = (
    await api('POST', '/auth/login', {
        email: process.env.DEMO_EMAIL ?? 'admin@argosisp.local',
        password: process.env.DEMO_PASSWORD ?? 'admin12345',
    })
).token
// FEL (fase 3): sin DEMO_FEL la empresa queda como esté (sin configuración = FEL desactivada) y
// nada se certifica. Con DEMO_FEL=falso se configura el certificador falso en ambiente de pruebas
// (nunca INFILE ni producción) con el modo DEMO_FEL_MODO (opcional por defecto; obligatoria u
// opcional): los avisos pagados se certifican en memoria cuando corre `fiscal:worker`.
if (process.env.DEMO_FEL) {
    if (process.env.DEMO_FEL !== 'falso')
        throw new Error('DEMO_FEL solo admite "falso" (certificador de pruebas)')
    const modo = process.env.DEMO_FEL_MODO ?? 'opcional'
    if (!['opcional', 'obligatoria'].includes(modo)) throw new Error('DEMO_FEL_MODO: opcional u obligatoria')
    const fel = await api('GET', '/fel/configuracion')
    await api('PUT', '/fel/configuracion', {
        proveedor: 'falso',
        ambiente: 'pruebas',
        modo,
        version: fel.version,
    })
    await api('PUT', '/fel/credenciales/pruebas', {
        proveedor: 'falso',
        credenciales: { usuario: 'demo', llave: 'demo-no-secreta' },
    })
}

// Empresas: la principal (1) y una segunda, si la instalación tiene una sola.
const NIT_NORTE = nit(8812345)
const empresasActivas = (await api('GET', '/empresas')).filter((e) => e.activa)
const principal = empresasActivas.find((e) => e.id === 1) ?? empresasActivas[0]
const norte = await obtenerOCrear(
    'empresas',
    async () =>
        empresasActivas.find((e) => e.id !== principal.id && e.nit === sinGuion(NIT_NORTE)) ??
        empresasActivas.find((e) => e.id !== principal.id),
    () =>
        api('POST', '/empresas', {
            nit: NIT_NORTE,
            razon_social: 'Cable Norte, Sociedad Anónima',
            nombre_comercial: 'Cable Norte',
            direccion_fiscal: '4a. calle 3-20 zona 1, Mixco',
            municipio: 'Mixco',
            departamento: 'Guatemala',
            telefono: '2433-1100',
            correo: 'facturacion@cablenorte.gt',
        }),
)

const zonasExistentes = await api('GET', '/zonas')
const zonas = {}
for (const n of ['Centro', 'Zona 10', 'Mixco', 'Villa Nueva']) {
    zonas[n] = (
        await obtenerOCrear(
            'zonas',
            async () => zonasExistentes.find((z) => z.nombre === n),
            () => api('POST', '/zonas', { nombre: n }),
        )
    ).id
}

const routersExistentes = await todas('/routers')
const routerDe = (nombre, datos) =>
    obtenerOCrear(
        'routers',
        async () => routersExistentes.find((r) => r.nombre === nombre),
        () => api('POST', '/routers', { nombre, ...datos }),
    )
const router = await routerDe('RB-Centro', {
    host: '10.20.0.1',
    nas_ip: '10.20.0.1',
    api_usuario: 'argos',
    api_password: 'demo-api',
    radius_secret: 'demo-radius',
    modo_seguridad: 'radius',
    modo_velocidad: 'simple',
})
const router2 = await routerDe('CCR-Mixco', {
    host: '10.30.0.1',
    nas_ip: '10.30.0.1',
    radius_secret: 'demo-radius-2',
})
for (const [r, cidr, gateway] of [
    [router, '100.64.10.0/24', '100.64.10.1'],
    [router2, '100.64.20.0/24', '100.64.20.1'],
]) {
    const redes = await api('GET', `/routers/${r.id}/redes-ipv4`)
    if (!redes.some((red) => red.cidr === cidr)) {
        contar('redes_ipv4')
        await api('POST', `/routers/${r.id}/redes-ipv4`, { cidr, gateway, tipo: 'estatico' })
    }
}
const bloques = await api('GET', `/routers/${router.id}/ipv6-bloques`)
const bloque = await obtenerOCrear(
    'ipv6_bloques',
    async () => bloques.find((b) => b.prefijo === '2001:db8:100::/40'),
    () => api('POST', `/routers/${router.id}/ipv6-bloques`, { prefijo: '2001:db8:100::/40' }),
)
const pools = await api('GET', `/ipv6-bloques/${bloque.id}/pools`)
for (const pool of [
    { prefijo: '2001:db8:100::/48', tipo: 'enlace', tamano_entrega: 64, nombre_en_router: 'argos-v6-enlace' },
    { prefijo: '2001:db8:180::/44', tipo: 'delegacion', tamano_entrega: 56, nombre_en_router: 'argos-v6-pd' },
]) {
    if (!pools.some((p) => p.prefijo === pool.prefijo)) {
        contar('ipv6_pools')
        await api('POST', `/ipv6-bloques/${bloque.id}/pools`, pool)
    }
}

// Planes con su tipo (residencial, empresarial y dedicado)
const planesExistentes = await todas('/planes')
const planes = {}
for (const [nombre, precio, bajada, subida, tipo, reuso] of [
    ['Hogar 20 Mb', '175.00', 20, 10, 'residencial', 8],
    ['Hogar 50 Mb', '250.00', 50, 25, 'residencial', 8],
    ['Empresa 100 Mb', '600.00', 100, 50, 'empresarial', 4],
    ['Dedicado 50 Mb', '1500.00', 50, 50, 'dedicado', 1],
]) {
    let p = planesExistentes.find((x) => x.nombre === nombre)
    if (!p) {
        contar('planes')
        p = await api('POST', '/planes', {
            nombre,
            precio,
            tipo,
            reuso,
            bajada_kbps: bajada * 1000,
            subida_kbps: subida * 1000,
            bajada_limitada_kbps: 1024,
            subida_limitada_kbps: 512,
            dual_stack: 'ambos',
            tamano_prefijo_delegado: 56,
            global: true,
        })
    } else if (p.tipo !== tipo) {
        // planes de una demo anterior (sin tipo): se les pone por la acción, con version
        p = await api('PUT', `/planes/${p.id}`, { version: p.version, tipo })
    }
    planes[nombre] = p
    const implementaciones = await api('GET', `/planes/${p.id}/routers`)
    for (const r of [router, router2]) {
        if (implementaciones.some((i) => i.router_id === r.id)) continue
        contar('implementaciones')
        await api('PUT', `/planes/${p.id}/routers/${r.id}`, {
            profile_ppp: 'default',
            pool_ipv6_enlace: 'argos-v6-enlace',
            pool_ipv6_delegacion: 'argos-v6-pd',
        })
    }
}

// Catálogo de adicionales por empresa y motivos de cortesía (los comunes vienen de la migración)
const catalogo = await todas('/adicionales?empresas=todas')
const adicionales = {}
for (const [empresa, codigo, nombre, precio] of [
    [principal.id, 'NETFLIX', 'Netflix Estándar', '75.00'],
    [principal.id, 'IPTV', 'IPTV 120 canales', '35.00'],
    [principal.id, 'DISNEY', 'Disney+', '60.00'],
    [norte.id, 'IPTV', 'IPTV Norte 80 canales', '30.00'],
]) {
    adicionales[`${empresa}:${codigo}`] = await obtenerOCrear(
        'adicionales',
        async () => catalogo.find((a) => a.empresa_id === empresa && a.codigo === codigo),
        () =>
            api('POST', '/adicionales', {
                empresa_id: empresa,
                codigo,
                nombre,
                precio_sugerido: precio,
                descripcion: `${nombre} para clientes de internet`,
            }),
    )
}
const motivos = await api('GET', '/adicionales/motivos?empresas=todas')
for (const [empresa, codigo, nombre] of [
    [principal.id, 'ANIVERSARIO', 'Aniversario del cliente'],
    [norte.id, 'REFERIDO', 'Cliente referido'],
]) {
    await obtenerOCrear(
        'motivos_cortesia',
        async () => motivos.find((m) => m.empresa_id === empresa && m.codigo === codigo),
        () => api('POST', '/adicionales/motivos', { empresa_id: empresa, codigo, nombre }),
    )
}
const motivoComun = (codigo) => motivos.find((m) => m.empresa_id === null && m.codigo === codigo).id

// El «Hogar 50 Mb» trae Netflix incluido (se asigna solo al crear el servicio)
const netflix = adicionales[`${principal.id}:NETFLIX`]
const hogar50 = planes['Hogar 50 Mb']
const incluidosPlan = await api('GET', `/planes/${hogar50.id}/adicionales`)
if (!incluidosPlan.some((a) => a.adicional_id === netflix.id && a.cantidad === 1)) {
    contar('planes_adicionales')
    const actual = await api('GET', `/planes/${hogar50.id}`)
    await api('PUT', `/planes/${hogar50.id}/adicionales`, {
        version: actual.version,
        adicionales: [{ adicional_id: netflix.id, cantidad: 1 }],
    })
}

const plantillas = await api('GET', '/plantillas-facturacion')
const plantillaDe = (nombre, datos) =>
    obtenerOCrear(
        'plantillas',
        async () => plantillas.find((p) => p.nombre === nombre),
        () => api('POST', '/plantillas-facturacion', { nombre, ...datos }),
    )
const plantilla = await plantillaDe('Mensual día 1', {
    ciclo: 'dia_fijo',
    dia: 1,
    prorrateo: true,
    dias_gracia: 5,
    facturas_para_limitar: 1,
    facturas_para_cortar: 2,
    mora_tipo: 'fija',
    mora_valor: '25.00',
    hora_corte: '08:00',
    certificar_al: 'pagar',
})
await plantillaDe('Aniversario empresas', {
    ciclo: 'aniversario',
    dias_gracia: 10,
    facturas_para_limitar: 2,
    facturas_para_cortar: 3,
    mora_tipo: 'ninguna',
    hora_corte: '09:00',
    certificar_al: 'emitir',
})

const clientes = [
    ['María José López', 'persona', nit(4521873), 'Centro', '5512-3344', 'correo'],
    ['Carlos Enrique Pérez', 'persona', nit(7788123), 'Zona 10', '4123-9087', 'telegram'],
    ['Distribuidora El Quetzal, S.A.', 'empresa', nit(9876541), 'Zona 10', '2230-4455', 'correo'],
    ['Ana Lucía Morales', 'persona', 'CF', 'Mixco', '3011-2299', 'correo'],
    ['Jorge Alberto Castillo', 'persona', nit(3456712), 'Villa Nueva', '5599-1010', 'correo'],
    ['Farmacia La Esperanza', 'empresa', nit(1239874), 'Centro', '2440-8899', 'correo'],
    ['Sofía Hernández Ruiz', 'persona', 'CF', 'Mixco', '4770-6612', 'telegram'],
    ['Roberto Méndez', 'persona', nit(6543219), 'Villa Nueva', '3322-1188', 'correo'],
]
const ids = []
for (const [nombre, tipo, nitcui, zona, tel, canal] of clientes) {
    const c = await obtenerOCrear(
        'clientes',
        async () =>
            (await todas(`/clientes?q=${encodeURIComponent(nombre)}`)).find((x) => x.nombre === nombre),
        () =>
            api('POST', '/clientes', {
                nombre,
                tipo,
                nit_cui: nitcui,
                nombre_fiscal: nitcui === 'CF' ? null : nombre,
                direccion_fiscal: 'Ciudad de Guatemala',
                email:
                    nombre
                        .toLowerCase()
                        .normalize('NFD')
                        .replace(/[^a-z ]/g, '')
                        .trim()
                        .split(' ')
                        .slice(0, 2)
                        .join('.') + '@ejemplo.gt',
                telefono: tel,
                zona_id: zonas[zona],
                canal_preferido: canal,
                direccion: `${zona}, Guatemala`,
            }),
    )
    ids.push(c.id)
}

// Un servicio por cliente: [cliente, plan, router, empresa]
const servicios = []
for (const [i, plan, r, empresa] of [
    [0, 'Hogar 50 Mb', router, principal],
    [1, 'Hogar 20 Mb', router, principal],
    [2, 'Empresa 100 Mb', router, principal],
    [3, 'Hogar 20 Mb', router2, principal],
    [4, 'Hogar 50 Mb', router, principal],
    [5, 'Dedicado 50 Mb', router, principal],
    [6, 'Hogar 20 Mb', router2, norte],
    [7, 'Hogar 20 Mb', router2, norte],
]) {
    const s = await obtenerOCrear(
        'servicios',
        async () => (await api('GET', `/servicios?cliente_id=${ids[i]}&empresas=todas&limit=1`)).data.at(0),
        () =>
            api('POST', '/servicios', {
                cliente_id: ids[i],
                empresa_id: empresa.id,
                router_id: r.id,
                plan_id: planes[plan].id,
                plantilla_facturacion_id: plantilla.id,
                fecha_instalacion: '2026-09-15',
                ipv6_modo: r === router ? 'radius_servicio' : 'ninguno',
                direccion: 'Instalación principal',
            }),
    )
    servicios.push(s)
}

/**
 * Asegura que el servicio tenga el adicional (por adicional, modalidad e identificador); solo lo
 * agrega si falta. Los incluidos del plan ya los asignó el alta del servicio.
 */
async function adicionalDe(servicio, codigo, datos) {
    const adicional = adicionales[`${servicio.empresa_id}:${codigo}`]
    const vigentes = await todas(`/servicios/${servicio.id}/adicionales?estado=activo`)
    const ya = vigentes.find(
        (a) =>
            a.adicional_id === adicional.id &&
            a.modalidad === datos.modalidad &&
            (a.identificador ?? null) === (datos.identificador ?? null),
    )
    if (ya) return ya
    contar(`adicionales_${datos.modalidad}`)
    return api('POST', `/servicios/${servicio.id}/adicionales`, { adicional_id: adicional.id, ...datos })
}
// María José (Hogar 50 Mb): Netflix incluido por el plan + Disney+ de cortesía (promoción)
await adicionalDe(servicios[0], 'DISNEY', {
    modalidad: 'cortesia',
    motivo_id: motivoComun('PROMOCION'),
    motivo_detalle: 'Promoción de lanzamiento, 3 meses',
    identificador: 'maria.lopez@ejemplo.gt',
})
// Carlos: IPTV cobrado agregado a mitad de periodo, sin costo el periodo en curso
await adicionalDe(servicios[1], 'IPTV', {
    modalidad: 'cobrado',
    precio: '35.00',
    primer_periodo: 'sin_costo',
    identificador: 'iptv-carlos-01',
    credencial: 'demo-iptv-1234',
})
// Distribuidora: dos usuarios de IPTV cobrados (prorrateados)
for (const usuario of ['iptv-quetzal-01', 'iptv-quetzal-02']) {
    await adicionalDe(servicios[2], 'IPTV', { modalidad: 'cobrado', precio: '35.00', identificador: usuario })
}
// Ana Lucía: Netflix cobrado; su servicio se suspende y el adicional queda bloqueado
await adicionalDe(servicios[3], 'NETFLIX', {
    modalidad: 'cobrado',
    precio: '75.00',
    identificador: 'ana.morales@ejemplo.gt',
})
// Sofía (Cable Norte): IPTV cobrado de su empresa
await adicionalDe(servicios[6], 'IPTV', {
    modalidad: 'cobrado',
    precio: '30.00',
    identificador: 'norte-sofia',
})

const estadoDe = async (s) => (await api('GET', `/servicios/${s.id}`)).estado
if ((await estadoDe(servicios[3])) !== 'suspendido') {
    contar('suspensiones')
    await api('POST', `/servicios/${servicios[3].id}/suspender`, {
        motivo: 'Suspensión por mora (demostración)',
    })
}
if ((await estadoDe(servicios[7])) !== 'retirado') {
    contar('retiros')
    await api('POST', `/servicios/${servicios[7].id}/retirar`, {
        motivo: 'Cliente se mudó fuera de cobertura',
    })
}

// Cobro por transferencia: cuenta bancaria propia de destino, facturas de Jorge y su pago
const bancos = await api('GET', '/bancos')
const banco = (nombre) => bancos.find((b) => b.nombre === nombre).id
const cuenta = await obtenerOCrear(
    'cuentas_bancarias',
    async () =>
        (await api('GET', '/cuentas-bancarias?empresas=todas')).find((c) => c.numero === '3-123-45678-9'),
    () =>
        api('POST', '/cuentas-bancarias', {
            empresa_id: principal.id,
            banco_id: banco('Banrural'),
            numero: '3-123-45678-9',
            alias: 'Monetaria',
        }),
)
const pagado = servicios[4]
await api('POST', '/facturas/generar', { servicio_id: pagado.id })
const { saldo } = await api('GET', `/clientes/${pagado.cliente_id}/estado-cuenta`)
let pago = null
if (Number(saldo) > 0) {
    contar('pagos')
    pago = await api('POST', '/pagos', {
        cliente_id: pagado.cliente_id,
        metodo: 'transferencia',
        monto: saldo,
        banco_origen_id: banco('Banco Industrial'),
        cuenta_bancaria_id: cuenta.id,
        referencia: 'TRF-884512',
        nota: 'Transferencia desde Banca Virtual BI',
    })
}
const bloqueados = (await todas(`/servicios/${servicios[3].id}/adicionales?estado=activo`)).filter(
    (a) => a.bloqueo === 'bloqueado',
).length
console.log('ok', {
    creados,
    empresas: [principal.id, norte.id],
    clientes: ids.length,
    servicios: servicios.length,
    planes: Object.fromEntries(Object.values(planes).map((p) => [p.nombre, p.tipo])),
    adicionales_bloqueados_del_suspendido: bloqueados,
    cuenta_bancaria: cuenta.id,
    pago: pago?.id ?? 'ya estaba al día',
})
