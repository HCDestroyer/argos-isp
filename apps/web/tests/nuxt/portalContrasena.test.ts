import type { Schema } from '@argosisp/contracts'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { defineComponent, h, type Component } from 'vue'
import UApp from '@nuxt/ui/components/App.vue'
import { reiniciarFixtures, sesionFixture, simularFalla } from '~~/fixtures'
import { bd } from '~~/fixtures/bd'
import * as comun from '~~/fixtures/comun'
import { meAdmin, meCajero } from '~~/fixtures/auth/sesiones'
import PaginaContrasena from '~/pages/configuracion/portal-contrasena.vue'
import ClientePortal from '~/components/ClientePortal.vue'
import { esperar } from '../ayudas/esperar'

/**
 * Contraseña del portal (pedido del PM, contrato A5 en `.claude/integration/a5.md`):
 * - Configuración → Contraseña del portal: estado sin mostrar nunca la contraseña, formulario con
 *   esquema espejo (8 a 128 y confirmación), 409 que relee, 422 `empresa_requerida`, solo lectura
 *   sin `portal.configurar_contrasena_defecto` y error con «Reintentar».
 * - Ficha del cliente: propia o por defecto, «Restaurar contraseña por defecto» con confirmación,
 *   aviso de sesiones cerradas, aviso sin contraseña de empresa y sin botón sin el permiso.
 */
type Me = Schema<'Me'>

function enApp(componente: Component, props: Record<string, unknown> = {}) {
    return defineComponent({ render: () => h(UApp, null, { default: () => h(componente, props) }) })
}

const montadas: { unmount: () => void }[] = []

async function montarPagina() {
    const vista = await mountSuspended(enApp(PaginaContrasena), { route: '/configuracion/portal-contrasena', attachTo: document.body })
    montadas.push(vista)
    return vista
}

async function montarTarjeta(clienteId: number) {
    const vista = await mountSuspended(enApp(ClientePortal, { clienteId }), { route: `/clientes/${clienteId}`, attachTo: document.body })
    montadas.push(vista)
    return vista
}

function enBody(prueba: string): HTMLElement | null {
    return document.body.querySelector<HTMLElement>(`[data-prueba="${prueba}"]`)
}

function boton(texto: string): HTMLButtonElement | undefined {
    return [...document.body.querySelectorAll('button')].find(b => b.textContent?.trim() === texto)
}

async function escribir(prueba: string, valor: string) {
    const campo = document.body.querySelector<HTMLInputElement>(`[data-prueba="${prueba}"] input, input[data-prueba="${prueba}"]`)
    if (!campo) {
        throw new Error(`Sin campo ${prueba}`)
    }
    campo.value = valor
    campo.dispatchEvent(new Event('input'))
    campo.dispatchEvent(new FocusEvent('blur'))
    await flushPromises()
}

async function comoToken(usuario: Me, cuerpo: () => Promise<void>) {
    const original = comun.usuariosPorToken['fixture-admin']
    comun.usuariosPorToken['fixture-admin'] = usuario
    try {
        await cuerpo()
    }
    finally {
        if (original) {
            comun.usuariosPorToken['fixture-admin'] = original
        }
    }
}

beforeEach(async () => {
    reiniciarFixtures()
    sesionFixture('fixture-admin')
    useUsuarioActual().value = meAdmin
    await flushPromises()
    // Después de que el plugin `empresa` arme la elección del usuario («Todas» para el admin).
    useEmpresaActiva().eleccion.value = 1
})

afterEach(() => {
    sesionFixture(null)
    useUsuarioActual().value = null
    useEmpresaActiva().eleccion.value = null
    localStorage.clear()
    for (const vista of montadas.splice(0)) {
        vista.unmount()
    }
})

describe('contraseña del portal · esquema espejo de configurarContrasenaDefectoValidator', () => {
    it('8 a 128 caracteres, sin recortar, y la confirmación tiene que coincidir', () => {
        const ok = esquemaContrasenaDefecto.safeParse({ contrasena: 'Bienvenido2026', confirmacion: 'Bienvenido2026' })
        expect(ok.success && ok.data).toEqual({ contrasena: 'Bienvenido2026', confirmacion: 'Bienvenido2026' })
        expect(esquemaContrasenaDefecto.safeParse({ contrasena: 'a'.repeat(8), confirmacion: 'a'.repeat(8) }).success).toBe(true)
        expect(esquemaContrasenaDefecto.safeParse({ contrasena: 'a'.repeat(128), confirmacion: 'a'.repeat(128) }).success).toBe(true)
        expect(esquemaContrasenaDefecto.safeParse({ contrasena: 'a'.repeat(7), confirmacion: 'a'.repeat(7) }).success).toBe(false)
        expect(esquemaContrasenaDefecto.safeParse({ contrasena: 'a'.repeat(129), confirmacion: 'a'.repeat(129) }).success).toBe(false)
        // Como VineJS: los espacios cuentan y no se recortan.
        const conEspacios = esquemaContrasenaDefecto.safeParse({ contrasena: ' clave 1 ', confirmacion: ' clave 1 ' })
        expect(conEspacios.success && conEspacios.data.contrasena).toBe(' clave 1 ')
        const distinta = esquemaContrasenaDefecto.safeParse({ contrasena: 'Bienvenido2026', confirmacion: 'Bienvenido2025' })
        expect(distinta.success).toBe(false)
        expect(!distinta.success && distinta.error.issues.map(i => i.path.join('.'))).toEqual(['confirmacion'])
    })

    it('textos de estado y de sesiones cerradas', () => {
        expect(textoEstadoDefecto({ configurada: false, actualizada_en: null }, formatearFechaHora)).toBe('Sin configurar: los clientes sin contraseña propia solo pueden entrar con código.')
        expect(textoEstadoDefecto({ configurada: true, actualizada_en: '2026-11-02T15:30:00.000Z' }, formatearFechaHora)).toBe(`Configurada el ${formatearFechaHora('2026-11-02T15:30:00.000Z')}.`)
        expect(textoSesionesCerradas(0)).toBe('No tenía sesiones abiertas en el portal.')
        expect(textoSesionesCerradas(1)).toBe('Se cerró 1 sesión del portal.')
        expect(textoSesionesCerradas(3)).toBe('Se cerraron 3 sesiones del portal.')
    })
})

describe('contraseña del portal · contra la API (fixtures)', () => {
    it('la por defecto es de la empresa activa: nunca se devuelve y version 0 = sin configurar', async () => {
        const leida = await usePortalContrasena().verDefecto()
        expect(leida.ok && leida.data).toEqual({ empresa_id: 1, configurada: true, actualizada_en: '2026-11-02T15:30:00.000Z', version: 1 })
        useEmpresaActiva().eleccion.value = 2
        const otra = await usePortalContrasena().verDefecto()
        expect(otra.ok && otra.data).toEqual({ empresa_id: 2, configurada: false, actualizada_en: null, version: 0 })
        useEmpresaActiva().eleccion.value = 'todas'
        const sinEmpresa = await usePortalContrasena().verDefecto()
        expect(!sinEmpresa.ok && sinEmpresa.problema.status).toBe(422)
        expect(!sinEmpresa.ok && codigoProblema(sinEmpresa.problema)).toBe('empresa_requerida')
    })

    it('configurar: version 0 la crea, la auditoría la guarda como ***, 409 con versión vieja y 422 en contrasena', async () => {
        useEmpresaActiva().eleccion.value = 2
        const creada = await usePortalContrasena().configurarDefecto({ contrasena: 'FibraSur2026', version: 0 })
        expect(creada.ok && creada.data).toMatchObject({ empresa_id: 2, configurada: true, version: 1 })
        expect(JSON.stringify(creada.ok && creada.data)).not.toContain('FibraSur2026')
        expect(bd.acciones.at(-1)).toMatchObject({ accion: 'portal.configurar_contrasena_defecto', entidad_tipo: 'empresa', entidad_id: 2, entrada: { contrasena: '***', version: 0 } })
        const vieja = await usePortalContrasena().configurarDefecto({ contrasena: 'OtraClave2026', version: 0 })
        expect(!vieja.ok && vieja.problema.status).toBe(409)
        expect(!vieja.ok && codigoProblema(vieja.problema)).toBe('conflicto_version')
        const corta = await usePortalContrasena().configurarDefecto({ contrasena: 'corta', version: 1 })
        expect(!corta.ok && corta.problema.status).toBe(422)
        expect(!corta.ok && erroresDeFormulario(corta.problema).map(e => e.name)).toEqual(['contrasena'])
    })

    it('restaurar borra la propia, cierra sus sesiones y es idempotente; 404 si el cliente no existe', async () => {
        const antes = await usePortalContrasena().verCliente(1)
        expect(antes.ok && antes.data).toEqual({ cliente_id: 1, propia: true, actualizada_en: '2026-11-10T21:05:00.000Z', defecto_configurada: true, sesiones_cerradas: 0 })
        const restaurada = await usePortalContrasena().restaurarCliente(1)
        expect(restaurada.ok && restaurada.data).toEqual({ cliente_id: 1, propia: false, actualizada_en: null, defecto_configurada: true, sesiones_cerradas: 2 })
        expect(bd.acciones.at(-1)).toMatchObject({ accion: 'clientes.restaurar_contrasena_portal', entidad_tipo: 'cliente', entidad_id: 1 })
        const otraVez = await usePortalContrasena().restaurarCliente(1)
        expect(otraVez.ok && otraVez.data).toMatchObject({ propia: false, sesiones_cerradas: 0 })
        const noExiste = await usePortalContrasena().verCliente(99_999)
        expect(!noExiste.ok && noExiste.problema.status).toBe(404)
    })

    it('permisos: el cajero ve el estado del cliente pero no restaura ni ve la de la empresa', async () => {
        await comoToken(meCajero, async () => {
            expect((await usePortalContrasena().verCliente(1)).ok).toBe(true)
            const restaurar = await usePortalContrasena().restaurarCliente(1)
            expect(!restaurar.ok && restaurar.problema.status).toBe(403)
            const defecto = await usePortalContrasena().verDefecto()
            expect(!defecto.ok && defecto.problema.status).toBe(403)
        })
        await comoToken({ ...meAdmin, permisos: meAdmin.permisos.filter(p => p !== 'portal.configurar_contrasena_defecto') }, async () => {
            const sinPermiso = await usePortalContrasena().configurarDefecto({ contrasena: 'Bienvenido2026', version: 1 })
            expect(!sinPermiso.ok && sinPermiso.problema.status).toBe(403)
        })
    })
})

describe('contraseña del portal · configuración', () => {
    it('configurada: muestra la fecha, el aviso de cambio obligatorio y nunca la contraseña', async () => {
        await montarPagina()
        await esperar(() => expect(enBody('estado-contrasena-defecto')?.dataset.estado).toBe('configurada'))
        expect(enBody('estado-contrasena-defecto')?.textContent).toContain(`Configurada el ${formatearFechaHora('2026-11-02T15:30:00.000Z')}`)
        expect(enBody('aviso-cambio-obligatorio')?.textContent).toContain('El cliente debe cambiarla la primera vez que entre')
        const campo = document.body.querySelector<HTMLInputElement>('[data-prueba="contrasena-defecto"] input, input[data-prueba="contrasena-defecto"]')
        expect(campo?.value).toBe('')
        expect(campo?.type).toBe('password')
    })

    it('sin configurar: lo dice y guarda con version 0; luego queda configurada y el formulario vacío', async () => {
        useEmpresaActiva().eleccion.value = 2
        await montarPagina()
        await esperar(() => expect(enBody('estado-contrasena-defecto')?.dataset.estado).toBe('sin-configurar'))
        expect(enBody('estado-contrasena-defecto')?.textContent).toContain('Sin configurar: los clientes sin contraseña propia solo pueden entrar con código')
        await escribir('contrasena-defecto', 'FibraSur2026')
        await escribir('confirmacion-defecto', 'FibraSur2026')
        document.body.querySelector('form')!.requestSubmit()
        await esperar(() => expect(bd.portalContrasenas.defecto[2]?.version).toBe(1))
        await esperar(() => expect(enBody('estado-contrasena-defecto')?.dataset.estado).toBe('configurada'))
        expect(document.body.textContent).toContain('Contraseña del portal configurada')
        expect(document.body.querySelector<HTMLInputElement>('[data-prueba="contrasena-defecto"] input, input[data-prueba="contrasena-defecto"]')?.value).toBe('')
    })

    it('valida antes de enviar: corta o sin confirmar no llega a la API', async () => {
        await montarPagina()
        await esperar(() => expect(enBody('contrasena-defecto')).not.toBeNull())
        await escribir('contrasena-defecto', 'corta')
        await escribir('confirmacion-defecto', 'otra')
        document.body.querySelector('form')!.requestSubmit()
        await esperar(() => expect(document.body.textContent).toContain('Al menos 8 caracteres'))
        expect(document.body.textContent).toContain('No coincide con la contraseña')
        expect(bd.portalContrasenas.defecto[1]?.version).toBe(1)
    })

    it('409: relee la versión actual, lo avisa y al volver a guardar sí se aplica', async () => {
        await montarPagina()
        await esperar(() => expect(enBody('contrasena-defecto')).not.toBeNull())
        // Otra sesión la cambió después de leerla.
        bd.portalContrasenas.defecto[1] = { actualizada_en: '2026-11-18T16:00:00.000Z', version: 4 }
        await escribir('contrasena-defecto', 'Bienvenido2026')
        await escribir('confirmacion-defecto', 'Bienvenido2026')
        document.body.querySelector('form')!.requestSubmit()
        await esperar(() => expect(enBody('conflicto-version')).not.toBeNull())
        await esperar(() => expect(enBody('estado-contrasena-defecto')?.textContent).toContain(formatearFechaHora('2026-11-18T16:00:00.000Z')))
        expect(bd.portalContrasenas.defecto[1]?.version).toBe(4)
        document.body.querySelector('form')!.requestSubmit()
        await esperar(() => expect(bd.portalContrasenas.defecto[1]?.version).toBe(5))
        await esperar(() => expect(enBody('conflicto-version')).toBeNull())
    })

    it('con «Todas las empresas» pide elegir una, con «Reintentar»', async () => {
        useEmpresaActiva().eleccion.value = 'todas'
        await montarPagina()
        await esperar(() => expect(document.body.textContent).toContain('Elige una empresa'))
        expect(document.body.textContent).toContain('elige una en el selector de empresa')
        expect(boton('Reintentar')).toBeDefined()
        expect(enBody('contrasena-defecto')).toBeNull()
    })

    it('si la API falla se ve el error con «Reintentar» y ningún estado supuesto', async () => {
        simularFalla('GET /api/v1/empresa/contrasena-portal', 500)
        await montarPagina()
        await esperar(() => expect(boton('Reintentar')).toBeDefined())
        expect(enBody('estado-contrasena-defecto')).toBeNull()
        bd.fallas = {}
        boton('Reintentar')!.click()
        await esperar(() => expect(enBody('estado-contrasena-defecto')).not.toBeNull())
    })

    it('sin portal.configurar_contrasena_defecto se ve el estado en solo lectura', async () => {
        useUsuarioActual().value = { ...meAdmin, permisos: meAdmin.permisos.filter(p => p !== 'portal.configurar_contrasena_defecto') }
        await montarPagina()
        await esperar(() => expect(enBody('solo-lectura')).not.toBeNull())
        expect(enBody('contrasena-defecto')).toBeNull()
        expect(enBody('estado-contrasena-defecto')).not.toBeNull()
    })

    it('la entrada del menú pide empresa.ver y vive en Configuración', () => {
        expect(obtenerSeccion('portal-contrasena')).toMatchObject({ ruta: '/configuracion/portal-contrasena', permiso: 'empresa.ver', etiqueta: 'Contraseña del portal' })
        expect(grupoDeRuta('/configuracion/portal-contrasena')?.id).toBe('configuracion')
    })
})

describe('contraseña del portal · ficha del cliente', () => {
    it('contraseña propia con su fecha; restaurar confirma, cierra sesiones y lo avisa', async () => {
        await montarTarjeta(1)
        await esperar(() => expect(enBody('portal-contrasena-tipo')?.textContent).toContain('Contraseña propia'))
        expect(enBody('portal-contrasena-detalle')?.textContent).toContain(`Último cambio: ${formatearFechaHora('2026-11-10T21:05:00.000Z')}`)
        enBody('abrir-restaurar-contrasena')!.click()
        await esperar(() => expect(document.body.textContent).toContain('Se cerrarán sus sesiones del portal.'))
        expect(bd.portalContrasenas.propias[1]).toBeDefined()
        enBody('confirmar-accion')!.click()
        await esperar(() => expect(enBody('portal-contrasena-tipo')?.textContent).toContain('Contraseña por defecto'))
        await esperar(() => expect(document.body.textContent).toContain('Se cerraron 2 sesiones del portal.'))
        expect(document.body.textContent).toContain('Contraseña del portal restaurada')
        expect(bd.portalContrasenas.propias[1]).toBeUndefined()
    })

    it('sin contraseña de empresa: avisa que solo entra con código, también al confirmar', async () => {
        bd.portalContrasenas.defecto = {}
        await montarTarjeta(2)
        await esperar(() => expect(enBody('portal-sin-defecto')).not.toBeNull())
        expect(enBody('portal-sin-defecto')?.textContent).toContain('Solo puede entrar con código')
        enBody('abrir-restaurar-contrasena')!.click()
        await esperar(() => expect(document.body.textContent).toContain('solo podrá entrar con código'))
    })

    it('el cajero ve el estado pero no el botón de restaurar', async () => {
        useUsuarioActual().value = meCajero
        await montarTarjeta(2)
        await esperar(() => expect(enBody('portal-contrasena-tipo')?.textContent).toContain('Contraseña por defecto'))
        expect(enBody('abrir-restaurar-contrasena')).toBeNull()
    })

    it('si la API falla se ve el error con «Reintentar», sin un estado supuesto', async () => {
        simularFalla('GET /api/v1/clientes/:id/contrasena-portal', 500)
        await montarTarjeta(1)
        await esperar(() => expect(boton('Reintentar')).toBeDefined())
        expect(enBody('portal-contrasena-tipo')).toBeNull()
        bd.fallas = {}
        boton('Reintentar')!.click()
        await esperar(() => expect(enBody('portal-contrasena-tipo')).not.toBeNull())
    })
})
