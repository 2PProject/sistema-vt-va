import { getAdminClient } from '../../../../lib/salao/server'
import * as XLSX from 'xlsx'
import { reconciliar } from '../../../../lib/salao/conferencia-core'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

type NotaXml = {
  chave: string; documento: string; emitente_nome: string; numero: string
  valor: number; data_emissao: string; competencia: string
  xml_original?: string; xml_nome?: string
}

const soDigitos = (v: string) => (v || '').replace(/\D/g, '')
const tag = (xml: string, nome: string) =>
  xml.match(new RegExp(`<(?:[\\w-]+:)?${nome}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[\\w-]+:)?${nome}>`, 'i'))?.[1]?.trim() || ''
const bloco = (xml: string, nome: string) =>
  xml.match(new RegExp(`<(?:[\\w-]+:)?${nome}(?:\\s[^>]*)?>[\\s\\S]*?<\\/(?:[\\w-]+:)?${nome}>`, 'i'))?.[0] || ''
const texto = (v: string) => v
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'").trim()

function todosBlocos(xml: string, nome: string) { return Array.from(xml.matchAll(new RegExp(`<(?:[\\w-]+:)?${nome}(?:\\s[^>]*)?>[\\s\\S]*?<\\/(?:[\\w-]+:)?${nome}>`, 'gi'))).map(m => m[0]) }
function parseNota(xml: string): { nota?: NotaXml; tomador?: string; tomadores?: string[]; erro?: string } {
  const inf = bloco(xml, 'InfNfse')
  if (!inf) return { erro: 'Não contém InfNfse/infNFSe.' }

  // O ZIP do ISS-DF pode misturar ABRASF 2.04 e o leiaute nacional RTC 1.01.
  const nacional = /<(?:(?:[\w-]+):)?infNFSe\b/i.test(inf) && /<(?:(?:[\w-]+):)?nNFSe>/i.test(inf)
  const prestadorIdent = bloco(inf, 'Prestador') || bloco(xml, 'Prestador')
  const prestadorDados = bloco(inf, 'PrestadorServico') || bloco(xml, 'PrestadorServico')
  const emitente = bloco(inf, 'emit')
  const tomadorDados = bloco(inf, 'TomadorServico') || bloco(xml, 'TomadorServico')
  const tomadorNacional = bloco(bloco(inf, 'infDPS'), 'toma') || bloco(inf, 'toma')

  const origemPrestador = nacional ? emitente : (prestadorIdent || prestadorDados)
  const documento = soDigitos(tag(origemPrestador, 'Cnpj') || tag(origemPrestador, 'Cpf'))
  const tomadorOrigem = nacional ? tomadorNacional : tomadorDados
  const candidatosTomador = nacional
    ? [tomadorNacional, ...todosBlocos(inf, 'toma')]
    : [tomadorDados, ...todosBlocos(inf, 'TomadorServico'), ...todosBlocos(xml, 'TomadorServico')]
  const tomadores = Array.from(new Set(candidatosTomador.map(b => soDigitos(tag(b, 'Cnpj') || tag(b, 'Cpf'))).filter(Boolean)))
  const tomador = tomadores[0] || soDigitos(tag(tomadorOrigem, 'Cnpj') || tag(tomadorOrigem, 'Cpf'))
  const numero = texto(tag(inf, 'nNFSe') || tag(inf, 'Numero'))
  const dataEmissao = (tag(inf, 'dhProc') || tag(inf, 'DataEmissao') || tag(inf, 'dhEmi')).slice(0, 10)
  const competenciaData = (tag(inf, 'dCompet') || tag(inf, 'Competencia') || dataEmissao).slice(0, 10)
  const competencia = competenciaData.slice(0, 7)
  const valorTexto = tag(bloco(inf, 'valores'), 'vLiq')
    || tag(bloco(inf, 'ValoresNfse'), 'ValorLiquidoNfse')
    || tag(bloco(inf, 'Valores'), 'ValorServicos') || '0'
  const valor = Number(valorTexto.replace(',', '.'))
  const emitente_nome = texto(nacional
    ? (tag(emitente, 'xNome') || tag(emitente, 'xFant'))
    : (tag(prestadorDados, 'RazaoSocial') || tag(prestadorDados, 'NomeFantasia')))
  if (!numero || !dataEmissao || !documento) return { tomador, tomadores, erro: 'Número, emissão ou documento do prestador não identificado.' }
  if (!Number.isFinite(valor)) return { tomador, erro: 'Valor da nota inválido.' }
  const idNacional = inf.match(/<(?:(?:[\w-]+):)?infNFSe\b[^>]*\bId="([^"]+)"/i)?.[1] || ''
  const verificacao = texto(tag(inf, 'CodigoVerificacao'))
  return {
    tomador, tomadores,
    nota: {
      chave: idNacional || `XML-ABRASF|${documento}|${numero}|${dataEmissao}|${verificacao}`,
      documento, emitente_nome, numero, valor, data_emissao: dataEmissao, competencia,
    },
  }
}

async function extrairArquivos(arquivos: File[]) {
  const xmls: { nome: string; xml: string }[] = []
  for (const arquivo of arquivos) {
    const buffer = Buffer.from(await arquivo.arrayBuffer())
    if (arquivo.name.toLowerCase().endsWith('.xml')) {
      xmls.push({ nome: arquivo.name, xml: buffer.toString('utf8') })
      continue
    }
    if (!arquivo.name.toLowerCase().endsWith('.zip')) continue
    // O leitor CFB incluído no SheetJS também abre contêineres ZIP.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cfb: any = (XLSX as any).CFB.read(buffer, { type: 'buffer' })
    for (const entrada of cfb.FileIndex || []) {
      const nome = String(entrada.name || entrada.FullPath || '')
      if (!nome.toLowerCase().endsWith('.xml') || !entrada.content) continue
      xmls.push({ nome, xml: Buffer.from(entrada.content).toString('utf8') })
    }
  }
  return xmls
}

export async function POST(req: Request) {
  try {
    const form = await req.formData()
    const empresaId = String(form.get('empresa_id') || '')
    const arquivos = form.getAll('arquivos').filter((v): v is File => v instanceof File)
    if (!empresaId) return Response.json({ erro: 'Selecione a unidade tomadora.' }, { status: 400 })
    if (!arquivos.length) return Response.json({ erro: 'Selecione um ZIP ou arquivos XML.' }, { status: 400 })
    if (arquivos.some(a => a.size > 20 * 1024 * 1024)) return Response.json({ erro: 'Cada arquivo deve ter no máximo 20 MB.' }, { status: 400 })

    const admin = getAdminClient()
    const { data: empresa, error: erroEmpresa } = await admin.from('empresas')
      .select('cnpj, razao_social, apelido').eq('id', empresaId).maybeSingle()
    if (erroEmpresa || !empresa) return Response.json({ erro: 'Unidade não encontrada.' }, { status: 404 })
    const cnpjEmpresa = soDigitos(String(empresa.cnpj || ''))
    if (cnpjEmpresa.length !== 14) return Response.json({ erro: 'Cadastre o CNPJ da unidade antes de importar.' }, { status: 400 })

    const xmls = await extrairArquivos(arquivos)
    if (!xmls.length) return Response.json({ erro: 'Nenhum XML foi encontrado nos arquivos enviados.' }, { status: 400 })

    const erros: string[] = []
    const lidas: NotaXml[] = []
    for (const item of xmls) {
      const r = parseNota(item.xml)
      if (r.erro) { erros.push(`${item.nome}: ${r.erro}`); continue }
      const tomadores = r.tomadores?.length ? r.tomadores : (r.tomador ? [r.tomador] : [])
      if (!tomadores.includes(cnpjEmpresa)) {
        erros.push(`${item.nome}: tomador ${tomadores.join(', ') || 'não identificado'} não corresponde ao CNPJ cadastrado da unidade ${empresa.apelido || empresa.razao_social} (${cnpjEmpresa}).`)
        continue
      }
      if (r.nota) lidas.push({ ...r.nota, xml_original: item.xml, xml_nome: item.nome })
    }

    const { data: existentes, error: erroExistentes } = await admin.from('salon_notas')
      .select('chave, documento, numero, data_emissao, valor').eq('empresa_id', empresaId)
    if (erroExistentes) throw erroExistentes
    const identidade = (n: { chave?: string | null; documento?: string | null; numero?: string | null; data_emissao?: string | null; valor?: number | null }) =>
      n.chave || `${n.documento || ''}|${n.numero || ''}|${n.data_emissao || ''}|${Number(n.valor || 0).toFixed(2)}`
    const jaExiste = new Set((existentes || []).flatMap(n => [identidade(n), `${n.documento || ''}|${n.numero || ''}|${n.data_emissao || ''}|${Number(n.valor || 0).toFixed(2)}`]))
    const novas: NotaXml[] = []
    for (const n of lidas) {
      const alternativa = `${n.documento}|${n.numero}|${n.data_emissao}|${n.valor.toFixed(2)}`
      if (jaExiste.has(n.chave) || jaExiste.has(alternativa)) continue
      jaExiste.add(n.chave); jaExiste.add(alternativa); novas.push(n)
    }

    for (let i = 0; i < novas.length; i += 300) {
      const payload = novas.slice(i, i + 300).map(n => ({
        empresa_id: empresaId, nsu: null, ...n,
        observacao: 'Importação manual de XML', classificacao: 'profissional',
      }))
      const { error } = await admin.from('salon_notas').insert(payload)
      if (error) throw error
    }

    let conferidas = 0, pendentes = 0, divergencias = 0
    const competencias = Array.from(new Set(novas.map(n => n.competencia).filter(Boolean))).sort()
    for (const competencia of competencias) {
      const resultado = await reconciliar(admin, competencia, empresaId)
      conferidas += resultado.conferidas
      pendentes += resultado.pendentes
      divergencias += resultado.divergencias
    }

    return Response.json({
      ok: true, empresa: empresa.apelido || empresa.razao_social,
      arquivos: xmls.length, validas: lidas.length, importadas: novas.length,
      duplicadas: lidas.length - novas.length, rejeitadas: erros.length, erros: erros.slice(0, 30),
      conferencia: { competencias, conferidas, pendentes, divergencias },
    })
  } catch (e) {
    return Response.json({ erro: e instanceof Error ? e.message : 'Falha ao importar XML.' }, { status: 500 })
  }
}
