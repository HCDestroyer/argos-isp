import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { Problema } from '#shared/errores'
import { REGLAS_PROMESA_POR_DEFECTO } from '#billing/reglas_promesa'
import { CAMPOS_EXCEPCION, aplicarExcepciones, validarExcepcion } from '#billing/excepciones'
import { obtenerPlantilla } from '#billing/plantillas'
import { estado, unico, usuarioConRoles } from '#tests/ayudas'

const RUTA = '/api/v1/plantillas-facturacion'

async function contabilidad() {
    const { token } = await usuarioConRoles(['contabilidad'])
    return token
}

test.group('Plantillas de facturación (API)', () => {
    test('crear con lo mínimo aplica valores por defecto y reglas de promesa completas', async ({
        client,
        assert,
    }) => {
        const token = await contabilidad()
        const nombre = unico('Mensual día 5')
        const requestId = unico('req')
        const respuesta = await estado(
            client
                .post(RUTA)
                .bearerToken(token)
                .header('X-Request-Id', requestId)
                .json({ nombre, ciclo: 'dia_fijo', dia: 5 }),
            201,
        )
        const plantilla = respuesta.body()
        assert.containSubset(plantilla, {
            nombre,
            ciclo: 'dia_fijo',
            dia: 5,
            prorrateo: true,
            dias_gracia: 0,
            facturas_para_limitar: 1,
            facturas_para_cortar: 1,
            mora_tipo: 'ninguna',
            mora_valor: '0.00',
            mora_recurrente: false,
            hora_corte: '08:00',
            certificar_al: 'pagar',
            version: 1,
        })
        assert.deepEqual(plantilla.reglas_promesa, REGLAS_PROMESA_POR_DEFECTO)
        assert.notProperty(plantilla, 'plantilla_id')

        const accion = await db
            .from('audit.acciones')
            .where('request_id', requestId)
            .where('accion', 'plantillas.crear')
            .firstOrFail()
        assert.equal(accion.resultado, 'ok')
        assert.equal(accion.entidad_tipo, 'plantilla_facturacion')
        assert.equal(accion.entidad_id, plantilla.id)
        const cambios = await db
            .from('audit.cambios')
            .where('entidad_tipo', 'plantilla_facturacion')
            .where('entidad_id', plantilla.id)
            .select('campo')
        assert.includeMembers(
            cambios.map((c) => c.campo),
            ['nombre', 'ciclo', 'dia', 'dias_gracia', 'reglas_promesa'],
        )

        const ver = await estado(client.get(`${RUTA}/${plantilla.id}`).bearerToken(token), 200)
        assert.deepEqual(ver.body(), plantilla)
        const listado = await estado(client.get(RUTA).bearerToken(token), 200)
        assert.isTrue(listado.body().some((p: { id: number }) => p.id === plantilla.id))
    })

    test('crear con todos los campos y reglas de promesa parciales por canal', async ({ client, assert }) => {
        const token = await contabilidad()
        const respuesta = await estado(
            client
                .post(RUTA)
                .bearerToken(token)
                .json({
                    nombre: unico('Aniversario'),
                    ciclo: 'aniversario',
                    dia: 12,
                    prorrateo: false,
                    dias_gracia: 5,
                    facturas_para_limitar: 1,
                    facturas_para_cortar: 2,
                    mora_tipo: 'porcentaje',
                    mora_valor: '10',
                    mora_recurrente: true,
                    hora_corte: '06:30',
                    certificar_al: 'pagar',
                    reglas_promesa: {
                        plazo_max_dias: 7,
                        deuda_maxima: '500.00',
                        canales: { portal: { requiere_aprobacion: true }, ia: { permitido: false } },
                        clave_desconocida: 1,
                    },
                }),
            201,
        )
        const plantilla = respuesta.body()
        assert.isNull(plantilla.dia, 'en aniversario el día es el de instalación')
        assert.equal(plantilla.mora_valor, '10.00')
        assert.equal(plantilla.hora_corte, '06:30')
        assert.equal(plantilla.reglas_promesa.plazo_max_dias, 7)
        assert.equal(plantilla.reglas_promesa.deuda_maxima, '500.00')
        assert.notProperty(plantilla.reglas_promesa, 'clave_desconocida')
        assert.deepEqual(plantilla.reglas_promesa.canales.portal, {
            ...REGLAS_PROMESA_POR_DEFECTO.canales.portal,
            requiere_aprobacion: true,
        })
        assert.isFalse(plantilla.reglas_promesa.canales.ia.permitido)
        assert.deepEqual(
            plantilla.reglas_promesa.canales.supervisor,
            REGLAS_PROMESA_POR_DEFECTO.canales.supervisor,
        )
    })

    test('coherencia entre campos → 422 con el campo exacto', async ({ client, assert }) => {
        const token = await contabilidad()
        const crear = async (cuerpo: Record<string, unknown>) => {
            const respuesta = await estado(
                client
                    .post(RUTA)
                    .bearerToken(token)
                    .json({ nombre: unico('Incoherente'), ...cuerpo }),
                422,
            )
            return respuesta.body().errors.map((e: { field: string }) => e.field)
        }

        assert.deepEqual(await crear({ ciclo: 'dia_fijo' }), ['dia'])
        assert.deepEqual(
            await crear({ ciclo: 'dia_fijo', dia: 1, facturas_para_limitar: 3, facturas_para_cortar: 2 }),
            ['facturas_para_limitar'],
        )
        assert.deepEqual(
            await crear({ ciclo: 'dia_fijo', dia: 1, mora_tipo: 'porcentaje', mora_valor: '150' }),
            ['mora_valor'],
        )
        assert.deepEqual(await crear({ ciclo: 'dia_fijo', dia: 1, mora_tipo: 'fija' }), ['mora_valor'])
        assert.deepEqual(
            await crear({
                ciclo: 'dia_fijo',
                dia: 1,
                reglas_promesa: { max_por_periodo: 3, max_por_periodo_buen_historial: 1 },
            }),
            ['reglas_promesa.max_por_periodo_buen_historial'],
        )
        // del validador VineJS
        assert.include(await crear({ ciclo: 'dia_fijo', dia: 31 }), 'dia')
        assert.include(await crear({ ciclo: 'dia_fijo', dia: 1, hora_corte: '25:00' }), 'hora_corte')
        assert.include(
            await crear({ ciclo: 'dia_fijo', dia: 1, reglas_promesa: { plazo_max_dias: 0 } }),
            'reglas_promesa.plazo_max_dias',
        )

        // mora "ninguna" ignora el valor
        const sinMora = await estado(
            client
                .post(RUTA)
                .bearerToken(token)
                .json({ nombre: unico('Sin mora'), ciclo: 'dia_fijo', dia: 1, mora_valor: '25' }),
            201,
        )
        assert.equal(sinMora.body().mora_valor, '0.00')
    })

    test('nombre duplicado → 409', async ({ client }) => {
        const token = await contabilidad()
        const nombre = unico('Duplicada')
        await estado(client.post(RUTA).bearerToken(token).json({ nombre, ciclo: 'dia_fijo', dia: 1 }), 201)
        await estado(client.post(RUTA).bearerToken(token).json({ nombre, ciclo: 'dia_fijo', dia: 2 }), 409)
    })

    test('editar con version: cambia solo lo enviado, registra el diff y 409 con versión vieja', async ({
        client,
        assert,
    }) => {
        const token = await contabilidad()
        const creada = await estado(
            client
                .post(RUTA)
                .bearerToken(token)
                .json({
                    nombre: unico('Editable'),
                    ciclo: 'dia_fijo',
                    dia: 10,
                    reglas_promesa: { plazo_max_dias: 9 },
                }),
            201,
        )
        const original = creada.body()

        const editada = await estado(
            client
                .put(`${RUTA}/${original.id}`)
                .bearerToken(token)
                .json({ version: 1, dias_gracia: 3, facturas_para_cortar: 2 }),
            200,
        )
        const plantilla = editada.body()
        assert.equal(plantilla.version, 2)
        assert.equal(plantilla.dias_gracia, 3)
        assert.equal(plantilla.facturas_para_cortar, 2)
        assert.equal(plantilla.dia, 10)
        assert.equal(plantilla.reglas_promesa.plazo_max_dias, 9, 'sin reglas_promesa no se tocan')

        const cambios = await db
            .from('audit.cambios')
            .where('entidad_tipo', 'plantilla_facturacion')
            .where('entidad_id', original.id)
            .where('campo', 'dias_gracia')
            .orderBy('id', 'asc')
            .select('antes', 'despues')
        assert.deepEqual(cambios.at(-1), { antes: 0, despues: 3 })

        await estado(
            client.put(`${RUTA}/${original.id}`).bearerToken(token).json({ version: 1, dias_gracia: 4 }),
            409,
        )

        // reglas_promesa reemplaza el objeto completo
        const conReglas = await estado(
            client
                .put(`${RUTA}/${original.id}`)
                .bearerToken(token)
                .json({
                    version: 2,
                    reglas_promesa: { max_por_periodo: 2, max_por_periodo_buen_historial: 3 },
                }),
            200,
        )
        assert.equal(conReglas.body().reglas_promesa.max_por_periodo, 2)
        assert.equal(
            conReglas.body().reglas_promesa.plazo_max_dias,
            REGLAS_PROMESA_POR_DEFECTO.plazo_max_dias,
        )

        // la coherencia se valida contra el resultado combinado
        await estado(
            client
                .put(`${RUTA}/${original.id}`)
                .bearerToken(token)
                .json({ version: 3, facturas_para_limitar: 3 }),
            422,
        )
        await estado(
            client.put(`${RUTA}/999999999`).bearerToken(token).json({ version: 1, dias_gracia: 1 }),
            404,
        )
        await estado(client.get(`${RUTA}/999999999`).bearerToken(token), 404)
    })

    test('ACL: soporte ve pero no crea; cajero no ve plantillas', async ({ client }) => {
        const soporte = await usuarioConRoles(['soporte'])
        await estado(client.get(RUTA).bearerToken(soporte.token), 200)
        await estado(
            client
                .post(RUTA)
                .bearerToken(soporte.token)
                .json({ nombre: unico('X'), ciclo: 'dia_fijo', dia: 1 }),
            403,
        )
        const cajero = await usuarioConRoles(['cajero'])
        await estado(client.get(RUTA).bearerToken(cajero.token), 403)
    })
})

test.group('Excepciones por servicio', () => {
    test('validarExcepcion acepta los campos definidos y rechaza el resto', async ({ assert }) => {
        assert.deepEqual(
            [...CAMPOS_EXCEPCION],
            [
                'dia',
                'prorrateo',
                'dias_gracia',
                'facturas_para_limitar',
                'facturas_para_cortar',
                'mora_tipo',
                'mora_valor',
                'mora_recurrente',
                'hora_corte',
                'certificar_al',
                'reglas_promesa',
            ],
        )
        assert.equal(await validarExcepcion('dias_gracia', 10), 10)
        assert.equal(await validarExcepcion('mora_valor', '15.5'), '15.5')
        assert.equal(await validarExcepcion('hora_corte', '07:15'), '07:15')
        assert.deepEqual(await validarExcepcion('reglas_promesa', { plazo_max_dias: 10, otra: 1 }), {
            plazo_max_dias: 10,
        })

        const rechazo = async (campo: string, valor: unknown) => {
            try {
                await validarExcepcion(campo, valor)
            } catch (error) {
                assert.instanceOf(error, Problema)
                assert.equal((error as Problema).status, 422)
                return (error as Problema).errores?.[0]?.field
            }
            throw new Error(`${campo} debió rechazarse`)
        }
        assert.equal(await rechazo('ciclo', 'aniversario'), 'campo')
        assert.equal(await rechazo('nombre', 'otro'), 'campo')
        assert.equal(await rechazo('dias_gracia', 200), 'valor')
        assert.equal(await rechazo('prorrateo', 'si'), 'valor')
        assert.equal(await rechazo('mora_tipo', 'otra'), 'valor')
        assert.equal(await rechazo('reglas_promesa', { plazo_max_dias: 0 }), 'valor.plazo_max_dias')
    })

    test('aplicarExcepciones combina la plantilla con las excepciones del servicio', async ({
        client,
        assert,
    }) => {
        const token = await contabilidad()
        const creada = await estado(
            client
                .post(RUTA)
                .bearerToken(token)
                .json({ nombre: unico('Base'), ciclo: 'dia_fijo', dia: 1, facturas_para_cortar: 2 }),
            201,
        )
        const plantilla = await obtenerPlantilla(creada.body().id)
        const efectiva = aplicarExcepciones(plantilla, [
            { campo: 'dias_gracia', valor: 7 },
            { campo: 'hora_corte', valor: '10:00' },
            {
                campo: 'reglas_promesa',
                valor: { plazo_max_dias: 10, canales: { portal: { permitido: false } } },
            },
            { campo: 'campo_viejo', valor: 1 },
        ])
        assert.equal(efectiva.plantilla_id, plantilla.id)
        assert.equal(efectiva.dias_gracia, 7)
        assert.equal(efectiva.hora_corte, '10:00')
        assert.equal(efectiva.facturas_para_cortar, 2)
        assert.equal(efectiva.reglas_promesa.plazo_max_dias, 10)
        assert.isFalse(efectiva.reglas_promesa.canales.portal.permitido)
        assert.equal(efectiva.reglas_promesa.canales.portal.plazo_max_dias, 3)
        assert.deepEqual(efectiva.excepciones, ['dias_gracia', 'hora_corte', 'reglas_promesa'])
        // la plantilla original no cambia
        assert.equal(plantilla.dias_gracia, 0)
        assert.equal(plantilla.reglas_promesa.plazo_max_dias, REGLAS_PROMESA_POR_DEFECTO.plazo_max_dias)
    })
})
