import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { leerConfig, RATE_LIMIT_SUSPENDIDO_DEFECTO } from '../src/config.ts'

describe('AAA_SUSPENDIDO_RATE_LIMIT', () => {
    it('por defecto es 2M/2M: el corte lo hace el firewall y la página de corte debe cargar rápido', () => {
        assert.equal(RATE_LIMIT_SUSPENDIDO_DEFECTO, '2M/2M')
        assert.equal(leerConfig({}).suspendido.rateLimit, '2M/2M')
    })

    it('vacía o solo espacios toma el valor por defecto', () => {
        assert.equal(leerConfig({ AAA_SUSPENDIDO_RATE_LIMIT: '' }).suspendido.rateLimit, '2M/2M')
        assert.equal(leerConfig({ AAA_SUSPENDIDO_RATE_LIMIT: '  ' }).suspendido.rateLimit, '2M/2M')
    })

    it('con valor, se usa tal cual', () => {
        assert.equal(leerConfig({ AAA_SUSPENDIDO_RATE_LIMIT: '256k/256k' }).suspendido.rateLimit, '256k/256k')
    })
})
