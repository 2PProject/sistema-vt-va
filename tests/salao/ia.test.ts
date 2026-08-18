import { computeConfidence, isPreselected } from '../../lib/salao/ia'

test('cnpj anchor with dm=2 computes 75 and not preselected', () => {
  const conf = computeConfidence({ anchor: 'cnpj', mesmaComp: false, dm: 2 })
  expect(conf).toBe(75)
  expect(isPreselected(conf, false)).toBe(false)
})

test('nome_id with same competencia computes 85 and preselected', () => {
  const conf = computeConfidence({ anchor: 'nome_id', mesmaComp: true, dm: 0 })
  expect(conf).toBe(85)
  expect(isPreselected(conf, true)).toBe(true)
})

test('nome_parcial with dm=1 computes 62', () => {
  const conf = computeConfidence({ anchor: 'nome_parcial', mesmaComp: false, dm: 1 })
  expect(conf).toBe(62)
})
