import type { Problem, Schema } from '@argosisp/contracts'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it } from 'vitest'
import { reiniciarFixtures, sesionFixture } from '~~/fixtures'
import { meAdmin } from '~~/fixtures/auth/sesiones'
import { bd } from '~~/fixtures/bd'
import * as comun from '~~/fixtures/comun'
import { UApp } from '#components'
import PromocionDetalle from '~/components/PromocionDetalle.vue'
import ServicioPromociones from '~/components/ServicioPromociones.vue'
import { esperar } from '../ayudas/esperar'

type Promocion = Schema<'PromocionVelocidad'>

/** Promoción de ejemplo con los valores por defecto de la API. */
function promocion(datos: Partial<Promocion> = {}): Promocion {
    return {
        id: 1,
        empresa_id: 1,
        nombre: 'Gamer nocturno',
        descripcion: null,
        tipo_velocidad: 'multiplicador',
        multiplicador: '2.00',
        plan_destino_id: null,
        plan_destino_nombre: null,
        modo: 'franja',
        inicio: '2026-12-01T06:00:00.000Z',
        fin: '2027-02-01T06:00:00.000Z',
        franja_inicio: '18:00',
        franja_fin: '23:00',
        dias_semana: [1, 2, 3, 4, 5],
        precio: null,
        estado: 'activa',
        vigencia: 'vigente',
        tramo_actual: null,
        proximo_tramo: null,
        motivo_cancelacion: null,
        cancelada_en: null,
        creado_por: 1,
        servicios: 24,
        version: 1,
        created_at: '2026-11-20T06:00:00.000Z',
        updated_at: '2026-11-20T06:00:00.000Z',
        ...datos,
    }
}

function enApp(componente: Component, props: Record<string, unknown> = {}) {
    return defineComponent({ render: () => h(UApp, null, { default: () => h(componente, props) }) })
}

describe('textos de las promociones de velocidad (tablero PendPromociones)', () => {
    it('días de la semana: seguidos con «a», sueltos con comas, todos o ninguno = todos los días', () => {
        expect(textoDiasSemana([1, 2, 3, 4, 5])).toBe('lun a vie')
        expect(textoDiasSemana([6, 7])).toBe('sáb, dom')
        expect(textoDiasSemana([1, 3, 5])).toBe('lun, mié, vie')
        expect(textoDiasSemana(null)).toBeNull()
        expect(textoDiasSemana([1, 2, 3, 4, 5, 6, 7])).toBeNull()
    })

    it('velocidad, horario, periodo y precio como en la lista', () => {
        const p = promocion()
        expect(velocidadCortaPromocion(p)).toBe('x2')
        expect(velocidadLargaPromocion(p)).toBe('El doble de su plan')
        expect(velocidadLargaPromocion(promocion({ multiplicador: '1.50' }))).toBe('Una vez y media su plan')
        expect(velocidadCortaPromocion(promocion({ tipo_velocidad: 'plan_destino', multiplicador: null, plan_destino_id: 3, plan_destino_nombre: 'Pyme 200' }))).toBe('Pyme 200')
        expect(horarioPromocion(p)).toBe('18:00 a 23:00 · lun a vie')
        expect(horarioPromocion(promocion({ modo: 'dias' }))).toBe('Todo el día')
        // El fin es exclusivo: medianoche del 1 de febrero se lee «31 ene».
        expect(periodoPromocion(p)).toBe('1 dic 2026 – 31 ene 2027')
        expect(periodoPromocion(promocion({ fin: '2027-01-01T06:00:00.000Z' }))).toBe('1 dic – 31 dic 2026')
        expect(precioPromocion(p)).toBe('Gratis')
        expect(precioPromocion(promocion({ precio: '900.00' }))).toBe('Q 900.00 /mes')
    })

    it('estado: aplicada ahora con su tramo, fuera de su horario con cuándo vuelve, programada, terminada y cancelada', () => {
        const hoy = new Date('2026-12-02T20:00:00.000Z')
        const aplicada = estadoPromocion(promocion({ tramo_actual: { inicio: '2026-12-03T00:00:00.000Z', fin: '2026-12-03T05:00:00.000Z' } }), hoy)
        expect(aplicada).toMatchObject({ etiqueta: 'Aplicada ahora', color: 'success' })
        expect(aplicada.ahora).toContain('se quita sola a las 23:00')
        const fuera = estadoPromocion(promocion({ proximo_tramo: { inicio: '2026-12-03T00:00:00.000Z', fin: '2026-12-03T05:00:00.000Z' } }), hoy)
        expect(fuera).toMatchObject({ etiqueta: 'Fuera de su horario', color: 'warning', ahora: 'Vuelve hoy a las 18:00' })
        expect(estadoPromocion(promocion({ vigencia: 'programada' }), hoy).etiqueta).toBe('Empieza el 1 dic')
        expect(estadoPromocion(promocion({ vigencia: 'terminada' }), hoy).etiqueta).toBe('Terminada')
        const cancelada = estadoPromocion(promocion({ vigencia: 'cancelada', estado: 'cancelada', cancelada_en: '2026-11-02T18:00:00.000Z', motivo_cancelacion: 'el router no aguanta' }), hoy)
        expect(cancelada).toMatchObject({ etiqueta: 'Cancelada', color: 'error', ahora: 'Cancelada el 2 nov: «el router no aguanta»' })
        expect(promocionAbierta(promocion())).toBe(true)
        expect(promocionAbierta(promocion({ vigencia: 'terminada' }))).toBe(false)
    })

    it('422 de regla: título, ayuda y el servicio (de `errors[]` o del `detail`)', () => {
        const solapada: Problem = { type: 'urn:argosisp:problema:promocion_solapada', title: 'Regla de negocio', status: 422, detail: 'El servicio 731 ya tiene la promoción «Navidad x2» en esas fechas', errors: [{ field: 'servicio_ids', message: 'Servicio 731', rule: 'servicio' }] }
        expect(fallaPromocion(solapada)).toMatchObject({ titulo: 'Se encima con otra promoción', servicioId: 731 })
        const capacidad: Problem = { type: 'urn:argosisp:problema:promocion_supera_capacidad', title: 'Regla de negocio', status: 422, detail: 'Con la promoción, el servicio 412 tendría 200000/100000 kbps', errors: [{ field: 'servicio_ids', message: 'Supera la capacidad del router', rule: 'capacidad' }] }
        expect(fallaPromocion(capacidad)).toMatchObject({ titulo: 'Supera la capacidad del router', servicioId: 412 })
        // Un 422 por campo no es una regla de promociones: va junto a cada campo.
        expect(fallaPromocion({ type: 'about:blank', title: 'Datos inválidos', status: 422, errors: [{ field: 'nombre', message: 'Corto' }] })).toBeNull()
    })
})

describe('formulario de promoción (espejo de crearPromocionVelocidadValidator)', () => {
    it('gratis sin precio; con «Cobrar» exige el monto; franja con días; fin después del inicio', () => {
        const esquema = esquemaPromocion()
        const base = { ...promocionVacia(new Date('2026-11-25T18:00:00.000Z')), nombre: 'Turbo', fin: '2026-12-31T23:59' }
        expect(esquema.safeParse(base).success).toBe(true)
        expect(datosPromocion(base, [2])).toMatchObject({ precio: null, modo: 'dias', franja_inicio: null, dias_semana: null, multiplicador: 2, inicio: '2026-11-26T06:00:00.000Z', fin: '2027-01-01T05:59:00.000Z', servicio_ids: [2] })

        const sinMonto = esquema.safeParse({ ...base, cobrar: true, precio: '' })
        expect(sinMonto.success).toBe(false)
        expect(sinMonto.error?.issues[0]?.path).toEqual(['precio'])
        const conPrecio = { ...base, cobrar: true, precio: '150', modo: 'franja' as const, dias_semana: [7, 6] }
        expect(esquema.safeParse(conPrecio).success).toBe(true)
        expect(datosPromocion(conPrecio, [])).toMatchObject({ precio: '150.00', franja_inicio: '18:00', franja_fin: '23:00', dias_semana: [6, 7] })

        expect(esquema.safeParse({ ...base, fin: '2026-11-20T00:00' }).error?.issues[0]?.path).toEqual(['fin'])
        expect(esquema.safeParse({ ...base, multiplicador: 11 }).error?.issues[0]?.path).toEqual(['multiplicador'])
        expect(esquema.safeParse({ ...base, tipo_velocidad: 'plan_destino' }).error?.issues[0]?.path).toEqual(['plan_destino_id'])
    })

    it('la semana de «Así queda»: una franja que cruza la medianoche se parte en dos', () => {
        const semana = semanaPromocion({ modo: 'franja', franja_inicio: '22:00', franja_fin: '02:00', dias_semana: [1] })
        expect(semana[0]?.tramos).toEqual([{ desde: 22, hasta: 24 }, { desde: 0, hasta: 2 }])
        expect(semana[1]?.tramos).toEqual([])
    })
})

describe('pantallas de promociones contra los fixtures', () => {
    beforeEach(() => {
        reiniciarFixtures()
        sesionFixture('fixture-admin')
        useUsuarioActual().value = meAdmin
    })

    it('detalle: sus servicios con estado, quitado con su motivo, y sin permisos no hay acciones', async () => {
        const p = (await usePromocionesVelocidad().ver(1))
        expect(p.ok).toBe(true)
        if (!p.ok) {
            return
        }
        const pantalla = await mountSuspended(enApp(PromocionDetalle, { promocion: p.data }))
        await esperar(() => expect(pantalla.text()).toContain('S-000001'))
        expect(pantalla.text()).toContain('Gamer nocturno')
        expect(pantalla.text()).toContain('Quitada')
        expect(pantalla.text()).toContain('«la pidió quitar»')
        expect(pantalla.find('[data-prueba="asignar-servicios"]').exists()).toBe(true)
        expect(pantalla.find('[data-prueba="cancelar-promocion"]').exists()).toBe(true)

        useUsuarioActual().value = { ...meAdmin, permisos: meAdmin.permisos.filter(x => !x.startsWith('promociones_velocidad.') || x === 'promociones_velocidad.ver') }
        const lectura = await mountSuspended(enApp(PromocionDetalle, { promocion: p.data }))
        await esperar(() => expect(lectura.text()).toContain('S-000001'))
        expect(lectura.find('[data-prueba="asignar-servicios"]').exists()).toBe(false)
        expect(lectura.find('[data-prueba="cancelar-promocion"]').exists()).toBe(false)
        expect(lectura.find('[aria-label^="Quitar la promoción"]').exists()).toBe(false)
    })

    it('asignar es todo o nada: un 422 no asigna ninguno', async () => {
        const antes = bd.promociones.asignaciones.length
        const r = await usePromocionesVelocidad().asignar(2, [6, 1], crypto.randomUUID())
        expect(r.ok).toBe(false)
        if (!r.ok) {
            expect(fallaPromocion(r.problema)).toMatchObject({ titulo: 'Se encima con otra promoción', servicioId: 1 })
        }
        expect(bd.promociones.asignaciones.length).toBe(antes)
    })

    it('ficha del servicio: la vigente con Quitar y las anteriores', async () => {
        const servicio = bd.servicios.find(s => s.id === 1)!
        const leido = await useServicios().ver(servicio.id)
        expect(leido.ok).toBe(true)
        if (!leido.ok) {
            return
        }
        const pantalla = await mountSuspended(enApp(ServicioPromociones, { servicio: leido.data }))
        await esperar(() => expect(pantalla.find('[data-prueba="promocion-actual"]').exists()).toBe(true))
        expect(pantalla.find('[data-prueba="promocion-actual"]').text()).toContain('Gamer nocturno')
        expect(pantalla.text()).toContain('Anteriores')
        expect(pantalla.text()).toContain('Mundial 2026')
        expect(pantalla.find('[data-prueba="quitar-promocion-servicio"]').exists()).toBe(true)
    })

    it('ficha del servicio: si la API falla, el error con «Reintentar» y nada inventado', async () => {
        const original = comun.usuariosPorToken['fixture-admin']!
        comun.usuariosPorToken['fixture-admin'] = { ...original, permisos: original.permisos.filter(x => x !== 'servicios.ver') }
        try {
            const pantalla = await mountSuspended(enApp(ServicioPromociones, { servicio: bd.servicios[0] }))
            await esperar(() => expect(pantalla.text()).toContain('Reintentar'))
            expect(pantalla.find('[data-prueba="promocion-actual"]').exists()).toBe(false)
            expect(pantalla.text()).not.toContain('no ha tenido promociones')
        }
        finally {
            comun.usuariosPorToken['fixture-admin'] = original
        }
    })
})
