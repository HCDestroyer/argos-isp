import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { after, before, describe, it } from 'node:test'
import { crearServidor } from '../src/app.ts'

describe('coa', () => {
    const servidor = crearServidor()
    let base = ''

    before(async () => {
        await new Promise<void>((resolve) => servidor.listen(0, '127.0.0.1', resolve))
        base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`
    })

    after(async () => {
        await new Promise<void>((resolve, reject) => servidor.close((e) => (e ? reject(e) : resolve())))
    })

    it('GET /health responde 200', async () => {
        const res = await fetch(`${base}/health`)
        assert.equal(res.status, 200)
        assert.deepEqual(await res.json(), { status: 'ok', servicio: 'coa' })
    })

    it('ruta desconocida responde 404', async () => {
        const res = await fetch(`${base}/nada`)
        assert.equal(res.status, 404)
    })
})
