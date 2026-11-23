import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reiniciarFixtures, sesionFixture, simularFalla } from '~~/fixtures'
import { bd } from '~~/fixtures/bd'
import { meAdmin, meCajero } from '~~/fixtures/auth/sesiones'
import ClienteNitVerificado from '~/components/ClienteNitVerificado.vue'
import PaginaRevision from '~/pages/clientes/titulares/[id].vue'
import PaginaRevisiones from '~/pages/clientes/titulares/index.vue'
import { esperar } from '../ayudas/esperar'

/** Contrato Iris 0.14.1: verificar el NIT y la revisión de titular empresa (A1). */
describe('Iris 0.14.1 · titular empresa', () => {
    beforeEach(() => {
        reiniciarFixtures()
        sesionFixture('fixture-admin')
        useUsuarioActual().value = meAdmin
    })

    afterEach(() => {
        sesionFixture(null)
        useUsuarioActual().value = null
    })

    describe('verificar el NIT', () => {
        it('marca el NIT con quién y cuándo; 409 con una versión vieja y 422 sin NIT válido', async () => {
            const antes = await useClientes().ver(3)
            expect(antes.ok && antes.data).toMatchObject({ nit_verificado_en: null, nit_verificado_por: null, nit_verificado_por_nombre: null })
            const version = antes.ok ? antes.data.version : 0

            const viejo = await useClientes().verificarNit(3, { version: version - 1, metodo: 'documento' })
            expect(!viejo.ok && viejo.problema.type).toBe('urn:argosisp:problema:conflicto_version')

            const hecho = await useClientes().verificarNit(3, { version, metodo: 'consulta_sat' })
            expect(hecho.ok && hecho.data).toMatchObject({ cliente_id: 3, nit_verificado_por: meAdmin.id, version: version + 1 })
            const despues = await useClientes().ver(3)
            expect(despues.ok && despues.data.nit_verificado_por_nombre).toBe(meAdmin.nombre)
            expect(bd.acciones.at(-1)).toMatchObject({ accion: 'clientes.verificar_nit', entidad_tipo: 'cliente', entidad_id: 3 })

            // Farmacia La Bendición: su NIT no pasa el dígito verificador
            const farmacia = await useClientes().ver(6)
            const invalido = await useClientes().verificarNit(6, { version: farmacia.ok ? farmacia.data.version : 0, metodo: 'documento' })
            expect(!invalido.ok && invalido.problema.type).toBe('urn:argosisp:problema:nit_no_verificable')
        })

        it('cambiar el NIT borra la marca (como el trigger de la API)', async () => {
            const cliente = bd.clientes.find(c => c.id === 11)
            expect(cliente?.nit_verificado_en).not.toBeNull()
            const editado = await useClientes().editar(11, { version: cliente?.version ?? 0, nit_cui: '4567890-1' })
            expect(editado.ok && editado.data).toMatchObject({ nit_verificado_en: null, nit_verificado_por: null })
        })

        it('la ficha muestra el estado y el botón solo con el permiso y con NIT', async () => {
            const sinVerificar = bd.clientes.find(c => c.id === 3)
            const verificado = bd.clientes.find(c => c.id === 11)
            if (!sinVerificar || !verificado) {
                throw new Error('Faltan clientes de la semilla')
            }
            const vista = await mountSuspended(ClienteNitVerificado, { props: { cliente: sinVerificar } })
            expect(vista.find('[data-prueba="nit-estado"]').text()).toBe('Sin verificar')
            expect(vista.find('[data-prueba="verificar-nit"]').exists()).toBe(true)

            const listo = await mountSuspended(ClienteNitVerificado, { props: { cliente: verificado } })
            expect(listo.find('[data-prueba="nit-estado"]').text()).toMatch(/^Verificado el .+ por Ana Administradora$/)
            expect(listo.find('[data-prueba="verificar-nit"]').exists()).toBe(false)

            const sinNit = await mountSuspended(ClienteNitVerificado, { props: { cliente: { ...sinVerificar, nit_cui: null } } })
            expect(sinNit.find('[data-prueba="verificar-nit"]').exists()).toBe(false)

            useUsuarioActual().value = { ...meAdmin, permisos: meAdmin.permisos.filter(p => p !== 'clientes.verificar_nit') }
            const sinPermiso = await mountSuspended(ClienteNitVerificado, { props: { cliente: sinVerificar } })
            expect(sinPermiso.find('[data-prueba="nit-estado"]').text()).toBe('Sin verificar')
            expect(sinPermiso.find('[data-prueba="verificar-nit"]').exists()).toBe(false)
        })
    })

    describe('revisiones', () => {
        it('lista por estado sin datos del representante; el cajero no la ve', async () => {
            const pendientes = await useTitularesEmpresa().listar('pendiente')
            expect(pendientes.ok && pendientes.data.data.map(r => r.id)).toEqual([2, 1])
            expect(pendientes.ok && Object.keys(pendientes.data.data[0] ?? {})).not.toContain('representante')
            const rechazadas = await useTitularesEmpresa().listar('rechazada')
            expect(rechazadas.ok && rechazadas.data.data.map(r => r.id)).toEqual([3])

            sesionFixture('fixture-cajero')
            useUsuarioActual().value = meCajero
            const cajero = await useTitularesEmpresa().listar('pendiente')
            expect(!cajero.ok && cajero.problema.status).toBe(403)
        })

        it('el detalle y cada foto quedan en la bitácora', async () => {
            const detalle = await useTitularesEmpresa().ver(1)
            expect(detalle.ok && detalle.data.representante).toMatchObject({ documento_tipo: 'dpi', nombre: 'Rodrigo Andrés Alvarado Pinto' })
            const frente = await useTitularesEmpresa().foto(1, 'frente')
            expect(frente.ok && frente.data.type).toBe('image/png')
            const sinReverso = await useTitularesEmpresa().foto(2, 'reverso')
            expect(!sinReverso.ok && sinReverso.problema.status).toBe(404)
            const vistas = bd.acciones.filter(a => a.accion === 'clientes.ver_identidad' && a.entidad_tipo === 'titular_empresa_revision')
            expect(vistas.map(a => a.entrada)).toEqual([{ revision_id: 1 }, { revision_id: 1, parte: 'frente' }])
            expect(tituloAccion(vistas[1]!)).toBe('Foto del documento del representante consultada (frente)')
            expect(rutaEntidad('titular_empresa_revision', 1)).toBe('/clientes/titulares/1')
        })

        it('aprobar con varias candidatas exige elegir; pasa el servicio y borra al titular sin historia', async () => {
            const revision = bd.revisionesTitularEmpresa.find(r => r.id === 2)
            const sinElegir = await useTitularesEmpresa().aprobar(2, { motivo: 'Confirmado con la gerencia', version: 1 }, nuevaClaveIdempotencia())
            expect(!sinElegir.ok && sinElegir.problema.errors?.[0]?.field).toBe('cliente_id')

            const hecho = await useTitularesEmpresa().aprobar(2, { cliente_id: 29, motivo: 'Confirmado con la gerencia', version: 1 }, nuevaClaveIdempotencia())
            expect(hecho.ok && hecho.data).toMatchObject({ titular: { cliente_id: 29, existente: true }, de_cliente_id: 28, de_cliente_eliminado: true })
            expect(bd.servicios.find(s => s.id === revision?.servicio_id)?.cliente_id).toBe(29)
            expect(bd.clientes.some(c => c.id === 28)).toBe(false)
            expect(revision).toMatchObject({ estado: 'aprobada', cliente_asignado_id: 29, representante: { documento_numero: null, nombre: null }, tiene_frente: false })

            // La otra revisión del mismo servicio: el titular ya cambió (409)
            const otra = await useTitularesEmpresa().aprobar(1, { motivo: 'Confirmado con la gerencia', version: 1 }, nuevaClaveIdempotencia())
            expect(!otra.ok && otra.problema.type).toBe('urn:argosisp:problema:titular_ya_cambiado')
        })

        it('rechazar pide motivo de 10 caracteres y la versión leída', async () => {
            const corto = await useTitularesEmpresa().rechazar(1, { motivo: 'No', version: 1 }, nuevaClaveIdempotencia())
            expect(!corto.ok && corto.problema.status).toBe(422)
            const viejo = await useTitularesEmpresa().rechazar(1, { motivo: 'La patente no la menciona', version: 0 }, nuevaClaveIdempotencia())
            expect(!viejo.ok && viejo.problema.status).toBe(409)
            const hecho = await useTitularesEmpresa().rechazar(1, { motivo: 'La patente no la menciona', version: 1 }, nuevaClaveIdempotencia())
            expect(hecho.ok && hecho.data).toMatchObject({ estado: 'rechazada', version: 2 })
            const otraVez = await useTitularesEmpresa().rechazar(1, { motivo: 'La patente no la menciona', version: 2 }, nuevaClaveIdempotencia())
            expect(!otraVez.ok && otraVez.problema.type).toBe('urn:argosisp:problema:revision_no_pendiente')
        })

        it('esquemas espejo del validador y textos de los errores', () => {
            expect(esquemaRechazarTitular.safeParse({ motivo: 'corto' }).success).toBe(false)
            expect(esquemaAprobarTitular(true).safeParse({ motivo: 'Confirmado con la gerencia' }).success).toBe(false)
            expect(esquemaAprobarTitular(false).safeParse({ motivo: 'Confirmado con la gerencia' }).success).toBe(true)
            expect(mensajeErrorRevision({ type: 'urn:argosisp:problema:conflicto_version', title: 'Conflicto', status: 409 })).toContain('Otra persona cambió esta revisión')
            expect(formatearNitNormalizado('33445567')).toBe('3344556-7')
        })

        it('la pantalla de la lista: pestañas, filas y el error con Reintentar', async () => {
            const vista = await mountSuspended(PaginaRevisiones, { route: '/clientes/titulares' })
            await esperar(() => expect(vista.text()).toContain('INVERSIONES POSADA DEL VALLE, S.A.'))
            expect(vista.text()).toContain('Pendientes')
            expect(vista.text()).toContain('Varias empresas con ese NIT')
            expect(vista.text()).toContain('3344556-7')
            expect(vista.text()).not.toContain('Rodrigo Andrés')

            simularFalla('GET /api/v1/titulares-empresa/revisiones', 500)
            const conError = await mountSuspended(PaginaRevisiones, { route: '/clientes/titulares?estado=rechazada' })
            await esperar(() => expect(conError.text()).toContain('Reintentar'))
            expect(conError.find('table').exists()).toBe(false)
        })

        it('la pantalla del detalle: representante, fotos, candidatas y acciones por permiso', async () => {
            const vista = await mountSuspended(PaginaRevision, { route: '/clientes/titulares/1' })
            await esperar(() => expect(vista.find('[data-prueba="foto-frente"] img').exists()).toBe(true))
            expect(vista.find('[data-prueba="foto-reverso"]').exists()).toBe(true)
            expect(vista.text()).toContain('Rodrigo Andrés Alvarado Pinto')
            expect(vista.text()).toContain('2547896320101')
            await esperar(() => expect(vista.find('[data-prueba="candidatos"]').text()).toContain('Hotel Posada del Valle'))
            expect(vista.find('[data-prueba="aprobar-revision"]').exists()).toBe(true)
            expect(vista.find('[data-prueba="rechazar-revision"]').exists()).toBe(true)

            useUsuarioActual().value = { ...meAdmin, permisos: meAdmin.permisos.filter(p => p !== 'servicios.aprobar_titular_empresa') }
            const sinAprobar = await mountSuspended(PaginaRevision, { route: '/clientes/titulares/1' })
            await esperar(() => expect(sinAprobar.text()).toContain('Rodrigo Andrés'))
            expect(sinAprobar.find('[data-prueba="aprobar-revision"]').exists()).toBe(false)
            expect(sinAprobar.find('[data-prueba="rechazar-revision"]').exists()).toBe(true)

            useUsuarioActual().value = meAdmin
            const decidida = await mountSuspended(PaginaRevision, { route: '/clientes/titulares/3' })
            await esperar(() => expect(decidida.find('[data-prueba="decision-revision"]').exists()).toBe(true))
            expect(decidida.text()).toContain('Datos borrados al decidir')
            expect(decidida.find('[data-prueba="aprobar-revision"]').exists()).toBe(false)
        })
    })
})
