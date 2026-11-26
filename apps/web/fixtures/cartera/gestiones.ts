/**
 * Gestiones de cobro de un cliente (A3, `gestiones_cobro.*`): `POST` desde el panel (origen
 * `panel`, nota libre de hasta 280) y `GET` de su historial. Como la API: lo ocurrido entre hace 7
 * días y 5 minutos adelante (422 `fuera_de_ventana`) y `carta` solo desde el panel.
 */
import type { Schema } from '@argosisp/contracts'
import type { RutasFixture } from '~/utils/fetchFixtures'
import { bd, siguienteId } from '../bd'
import { regla422, invalido } from '../cobros/rutas'
import { ahora, conIdempotencia, empresaActivaDe, conPermiso, cuerpoObjeto, idDe, noEncontrado, paginar, registrarAccion, usuariosPorToken } from '../comun'

type Gestion = Schema<'GestionCobro'>

const TIPOS = ['llamada', 'mensaje', 'visita', 'promesa', 'carta']
const RESULTADOS = ['contesto', 'no_contesto', 'numero_equivocado', 'promete_pagar', 'rechaza', 'pago_informado', 'visita_sin_contacto']
const DIA_MS = 24 * 60 * 60 * 1000

export const rutasGestionesCobro: RutasFixture = {
    'GET /api/v1/clientes/:id/gestiones-cobro': conPermiso('gestiones_cobro.ver', (solicitud) => {
        const id = idDe(solicitud)
        if (!bd.clientes.some(c => c.id === id)) {
            return noEncontrado('el cliente')
        }
        const filas = bd.gestionesCobro.filter(g => g.cliente_id === id).sort((a, b) => b.id - a.id)
        return { status: 200, cuerpo: paginar(filas, solicitud) }
    }),

    'POST /api/v1/clientes/:id/gestiones-cobro': conPermiso('gestiones_cobro.registrar', conIdempotencia((solicitud) => {
        const cliente = bd.clientes.find(c => c.id === idDe(solicitud))
        if (!cliente) {
            return noEncontrado('el cliente')
        }
        const { tipo, resultado, ocurrido_en: ocurrido, nota, servicio_id: servicioId } = cuerpoObjeto(solicitud)
        const errores: { field: string, message: string, rule: string }[] = []
        if (typeof tipo !== 'string' || !TIPOS.includes(tipo)) {
            errores.push({ field: 'tipo', message: 'Elige cómo fue la gestión', rule: 'enum' })
        }
        if (typeof resultado !== 'string' || !RESULTADOS.includes(resultado)) {
            errores.push({ field: 'resultado', message: 'Elige qué pasó', rule: 'enum' })
        }
        if (typeof ocurrido !== 'string' || Number.isNaN(Date.parse(ocurrido))) {
            errores.push({ field: 'ocurrido_en', message: 'La fecha y hora no son válidas', rule: 'date' })
        }
        if (typeof nota === 'string' && nota.length > 280) {
            errores.push({ field: 'nota', message: 'Máximo 280 caracteres', rule: 'maxLength' })
        }
        if (errores.length) {
            return invalido(errores)
        }
        const momento = Date.parse(ocurrido as string)
        const ahoraMs = Date.parse(ahora())
        if (momento < ahoraMs - 7 * DIA_MS || momento > ahoraMs + 5 * 60 * 1000) {
            return regla422('fuera_de_ventana', 'Regla de negocio', 'La gestión debe haber ocurrido en los últimos 7 días')
        }
        const usuario = solicitud.token ? usuariosPorToken[solicitud.token] : undefined
        const id = siguienteId(bd.gestionesCobro)
        const gestion: Gestion = {
            id,
            gestion_id: id,
            empresa_id: empresaActivaDe(solicitud) ?? 1,
            cliente_id: cliente.id,
            servicio_id: typeof servicioId === 'number' ? servicioId : null,
            contacto_id: null,
            tipo: tipo as Gestion['tipo'],
            resultado: resultado as Gestion['resultado'],
            ocurrido_en: new Date(momento).toISOString(),
            origen_tipo: 'panel',
            origen_id: null,
            sistema_origen: null,
            iris_gestion_id: null,
            iris_actor: null,
            nota: typeof nota === 'string' && nota.trim() ? nota.trim() : null,
            tiene_adjunto: false,
            adjunto_tipo: null,
            registrado_por: usuario?.id ?? null,
            registrado_por_nombre: usuario?.nombre ?? null,
            created_at: ahora(),
        }
        bd.gestionesCobro.push(gestion)
        registrarAccion(solicitud, 'gestiones_cobro.registrar', { tipo: 'gestion_cobro', id }, { tipo, resultado })
        return { status: 201, cuerpo: { ...gestion, repetida: false } satisfies Schema<'GestionCobroRegistrada'> }
    })),
}
