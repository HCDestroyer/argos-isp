#!/usr/bin/env node
// Datos de demostración cargados por la API real: pasan por las acciones de dominio, la
// auditoría y el outbox, igual que si los capturara un operador.
//
//   pnpm demo:datos
//
// Requiere la API levantada con el seed aplicado y una base sin estos datos (los nombres de zona
// y los usuarios PPP no se repiten). Variables: API_URL (http://localhost:3333),
// DEMO_EMAIL y DEMO_PASSWORD (por defecto, el admin de desarrollo de apps/api/.env.example).
// Crea 4 zonas, 2 routers con redes IPv4 e IPv6, 3 planes implementados en ambos routers,
// 2 plantillas, 8 clientes (NIT con dígito verificador o CF) y 7 servicios, uno retirado; una
// cuenta bancaria propia (Banrural · Monetaria) y un pago por transferencia que deja al día a un
// cliente con servicio activo (facturado hasta hoy).
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
function nit(base) {
    const d = String(base).split('').reverse()
    const s = d.reduce((a, x, i) => a + Number(x) * (i + 2), 0)
    const v = (11 - (s % 11)) % 11
    return `${base}-${v === 10 ? 'K' : v}`
}
token = (
    await api('POST', '/auth/login', {
        email: process.env.DEMO_EMAIL ?? 'admin@argosisp.local',
        password: process.env.DEMO_PASSWORD ?? 'admin12345',
    })
).token
const zonas = {}
for (const n of ['Centro', 'Zona 10', 'Mixco', 'Villa Nueva'])
    zonas[n] = (await api('POST', '/zonas', { nombre: n })).id
const router = await api('POST', '/routers', {
    nombre: 'RB-Centro',
    host: '10.20.0.1',
    nas_ip: '10.20.0.1',
    api_usuario: 'argos',
    api_password: 'demo-api',
    radius_secret: 'demo-radius',
    modo_seguridad: 'radius',
    modo_velocidad: 'simple',
})
const router2 = await api('POST', '/routers', {
    nombre: 'CCR-Mixco',
    host: '10.30.0.1',
    nas_ip: '10.30.0.1',
    radius_secret: 'demo-radius-2',
})
await api('POST', `/routers/${router.id}/redes-ipv4`, {
    cidr: '100.64.10.0/24',
    gateway: '100.64.10.1',
    tipo: 'estatico',
})
await api('POST', `/routers/${router2.id}/redes-ipv4`, {
    cidr: '100.64.20.0/24',
    gateway: '100.64.20.1',
    tipo: 'estatico',
})
const bloque = await api('POST', `/routers/${router.id}/ipv6-bloques`, { prefijo: '2001:db8:100::/40' })
await api('POST', `/ipv6-bloques/${bloque.id}/pools`, {
    prefijo: '2001:db8:100::/48',
    tipo: 'enlace',
    tamano_entrega: 64,
    nombre_en_router: 'argos-v6-enlace',
})
await api('POST', `/ipv6-bloques/${bloque.id}/pools`, {
    prefijo: '2001:db8:180::/44',
    tipo: 'delegacion',
    tamano_entrega: 56,
    nombre_en_router: 'argos-v6-pd',
})
const planes = []
for (const [nombre, precio, mb] of [
    ['Hogar 20 Mb', '175.00', 20],
    ['Hogar 50 Mb', '250.00', 50],
    ['Empresa 100 Mb', '600.00', 100],
]) {
    const p = await api('POST', '/planes', {
        nombre,
        precio,
        bajada_kbps: mb * 1000,
        subida_kbps: Math.round(mb * 500),
        bajada_limitada_kbps: 1024,
        subida_limitada_kbps: 512,
        dual_stack: 'ambos',
        tamano_prefijo_delegado: 56,
        global: true,
    })
    planes.push(p)
    for (const r of [router, router2])
        await api('PUT', `/planes/${p.id}/routers/${r.id}`, {
            profile_ppp: 'default',
            pool_ipv6_enlace: 'argos-v6-enlace',
            pool_ipv6_delegacion: 'argos-v6-pd',
        })
}
const plantilla = await api('POST', '/plantillas-facturacion', {
    nombre: 'Mensual día 1',
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
await api('POST', '/plantillas-facturacion', {
    nombre: 'Aniversario empresas',
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
    const c = await api('POST', '/clientes', {
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
    })
    ids.push(c.id)
}
for (const [i, plan, r] of [
    [0, 1, router],
    [1, 0, router],
    [2, 2, router],
    [3, 0, router2],
    [4, 1, router],
    [5, 2, router],
    [6, 0, router2],
]) {
    await api('POST', '/servicios', {
        cliente_id: ids[i],
        router_id: r.id,
        plan_id: planes[plan].id,
        plantilla_facturacion_id: plantilla.id,
        fecha_instalacion: '2026-09-15',
        ipv6_modo: r === router ? 'radius_servicio' : 'ninguno',
        direccion: 'Instalación principal',
    })
}
const ret = (await api('GET', `/servicios?limit=50`)).data.at(-1)
await api('POST', `/servicios/${ret.id}/retirar`, { motivo: 'Cliente se mudó fuera de cobertura' })
// Cobro por transferencia: cuenta bancaria propia de destino, facturas del primer cliente y su pago
const bancos = await api('GET', '/bancos')
const banco = (nombre) => bancos.find((b) => b.nombre === nombre).id
const cuenta = await api('POST', '/cuentas-bancarias', {
    banco_id: banco('Banrural'),
    numero: '3-123-45678-9',
    alias: 'Monetaria',
})
const servicio = (await api('GET', `/servicios?limit=50`)).data.find((s) => s.estado === 'activo')
await api('POST', '/facturas/generar', { servicio_id: servicio.id })
const { saldo } = await api('GET', `/clientes/${servicio.cliente_id}/estado-cuenta`)
const pago = await api('POST', '/pagos', {
    cliente_id: servicio.cliente_id,
    metodo: 'transferencia',
    monto: saldo,
    banco_origen_id: banco('Banco Industrial'),
    cuenta_bancaria_id: cuenta.id,
    referencia: 'TRF-884512',
    nota: 'Transferencia desde Banca Virtual BI',
})
console.log('ok', { clientes: ids.length, planes: planes.length, cuenta_bancaria: cuenta.id, pago: pago.id })
