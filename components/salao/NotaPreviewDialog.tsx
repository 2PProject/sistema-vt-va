'use client'

import * as Dialog from '@radix-ui/react-dialog'
import { Download, Eye, FileDown, FileText, Printer, X } from 'lucide-react'
import { formatarMoeda } from '../../utils/calculoVT'

export type NotaPreview = {
  numero?: string | null
  emitente?: string | null
  documento?: string | null
  valor?: number | null
  emissao?: string | null
  competencia?: string | null
  competenciaOficial?: boolean
  situacao?: string | null
  observacao?: string | null
  unidade?: string | null
  xmlOriginal?: string | null
  xmlNome?: string | null
}

const dig = (v: string) => (v || '').replace(/\D/g, '')
const texto = (v: string) => v.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/\s+/g, ' ').trim()
const tag = (xml: string, nomes: string[]) => {
  for (const nome of nomes) {
    const valor = xml.match(new RegExp(`<(?:[\\w-]+:)?${nome}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[\\w-]+:)?${nome}>`, 'i'))?.[1]
    if (valor) return texto(valor)
  }
  return ''
}
const bloco = (xml: string, nomes: string[]) => {
  for (const nome of nomes) {
    const valor = xml.match(new RegExp(`<(?:[\\w-]+:)?${nome}(?:\\s[^>]*)?>[\\s\\S]*?<\\/(?:[\\w-]+:)?${nome}>`, 'i'))?.[0]
    if (valor) return valor
  }
  return ''
}
function data(v?: string | null) {
  if (!v) return 'Não informada'
  const [a, m, d] = v.slice(0, 10).split('-')
  return d ? `${d}/${m}/${a}` : v
}
function doc(v?: string | null) {
  const s = dig(v || '')
  if (s.length === 14) return s.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5')
  if (s.length === 11) return s.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
  return v || 'Não informado'
}
// Extrai os campos do XML seguindo o leiaute da DANFSe oficial (NFS-e nacional
// v1.x/v2.0) com fallback para ABRASF. Campos ausentes voltam vazios (viram "-").
function dadosXml(xml?: string | null) {
  if (!xml) return null
  const prestador = bloco(xml, ['PrestadorServico', 'Prestador', 'emit'])
  const tomador = bloco(xml, ['TomadorServico', 'Tomador', 'toma'])
  const servico = bloco(xml, ['Servico', 'serv'])
  const valoresB = bloco(xml, ['valores', 'Valores'])
  const tribB = bloco(xml, ['tribMun', 'trib', 'Tributacao'])
  const enderecoPrestador = bloco(prestador, ['Endereco', 'enderNac', 'enderEmit', 'ender'])
  const enderecoTomador = bloco(tomador, ['Endereco', 'enderNac', 'enderToma', 'ender'])
  const endLinha = (e: string) => [tag(e, ['Endereco', 'xLgr']), tag(e, ['Numero', 'nro']), tag(e, ['Complemento', 'xCpl']), tag(e, ['Bairro', 'xBairro'])].filter(Boolean).join(', ')
  const muni = (e: string) => [tag(e, ['xMun', 'Municipio']) || tag(e, ['cMun', 'CodigoMunicipio']), tag(e, ['UF', 'Uf', 'xUF'])].filter(Boolean).join(' / ')
  const chaveRaw = (xml.match(/<(?:[\w-]+:)?infNFSe[^>]*\bId="([^"]+)"/i)?.[1] || tag(xml, ['chNFSe', 'ChaveAcesso', 'ChaveAcessoNFSe']) || '').replace(/[^0-9A-Za-z]/g, '')
  const sit = tag(xml, ['cSitNFSe', 'situacaoNfse'])
  const amb = tag(xml, ['tpAmb', 'TipoAmbiente'])
  return {
    chave: chaveRaw,
    municipioGerador: muni(xml) || tag(xml, ['xLocEmi', 'xMunEmi']) || '',
    ambiente: amb === '1' ? 'Produção' : amb === '2' ? 'Homologação' : (amb || ''),
    situacao: sit === '1' ? 'NFS-e Gerada' : sit === '2' ? 'Cancelada' : (sit || ''),
    numeroDps: tag(xml, ['nDPS']),
    serieDps: tag(xml, ['serie']),
    dataEmissaoNfse: tag(xml, ['dhProc']),
    dataEmissaoDps: tag(xml, ['dhEmi']),
    prestadorNome: tag(prestador, ['RazaoSocial', 'xNome', 'NomeFantasia', 'xFant']),
    prestadorDoc: tag(prestador, ['Cnpj', 'CPF', 'Cpf', 'CNPJ']),
    prestadorIm: tag(prestador, ['InscricaoMunicipal', 'IM']),
    prestadorEndereco: endLinha(enderecoPrestador),
    prestadorMun: muni(enderecoPrestador),
    prestadorCep: tag(enderecoPrestador, ['CEP', 'Cep']),
    prestadorEmail: tag(prestador, ['Email', 'email']),
    prestadorFone: tag(prestador, ['Telefone', 'fone']),
    tomadorNome: tag(tomador, ['RazaoSocial', 'xNome', 'NomeFantasia']),
    tomadorDoc: tag(tomador, ['Cnpj', 'CPF', 'Cpf', 'CNPJ']),
    tomadorIm: tag(tomador, ['InscricaoMunicipal', 'IM']),
    tomadorEndereco: endLinha(enderecoTomador),
    tomadorMun: muni(enderecoTomador),
    tomadorCep: tag(enderecoTomador, ['CEP', 'Cep']),
    tomadorEmail: tag(tomador, ['Email', 'email']),
    tomadorFone: tag(tomador, ['Telefone', 'fone']),
    discriminacao: tag(servico || xml, ['Discriminacao', 'xDescServ', 'Descricao']),
    codigoServico: tag(servico || xml, ['ItemListaServico', 'cTribNac', 'CodigoTributacaoMunicipio']),
    codigoMunicipal: tag(servico || xml, ['cTribMun']),
    nbs: tag(servico || xml, ['cNBS', 'CodigoNBS']),
    localPrestacao: tag(servico || xml, ['xLocPrestacao', 'MunicipioIncidencia', 'cLocPrestacao']),
    codigoVerificacao: tag(xml, ['CodigoVerificacao', 'cVerif']),
    valorServicos: tag(valoresB || servico || xml, ['ValorServicos', 'vServPrest', 'vServ']),
    valorLiquido: tag(xml, ['ValorLiquidoNfse', 'vLiq', 'vLiqNFSe']),
    iss: tag(tribB || servico || xml, ['ValorIss', 'vISSQN', 'ValorISS']),
    aliquota: tag(tribB || servico || xml, ['Aliquota', 'pAliqAplic', 'pAliq']),
    baseCalculo: tag(tribB || servico || xml, ['BaseCalculo', 'vBC']),
    retencaoIss: (tag(tribB || xml, ['tpRetISSQN']) || '') === '1' ? 'Retido' : (tag(servico || xml, ['IssRetido']) === '1' ? 'Retido' : 'Não retido'),
    descIncond: tag(valoresB || xml, ['vDescIncond', 'DescontoIncondicionado']),
    deducoes: tag(valoresB || xml, ['vDedRed', 'ValorDeducoes']),
    infComplementares: tag(xml, ['xInfComp', 'InformacoesComplementares', 'xOutInf']),
    municipioIncidencia: tag(servico || xml, ['xLocIncid', 'MunicipioIncidencia', 'cLocIncid', 'cLocEmi']),
    dataEmissaoXml: (tag(xml, ['dhProc', 'dhEmi', 'DataEmissao']) || '').slice(0, 10),
  }
}
// Formata data/hora ISO para dd/mm/aaaa hh:mm:ss.
function dhBR(v?: string | null) { if (!v) return ''; const m = v.match(/(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/); if (m) return `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}${m[6] ? ':' + m[6] : ''}`; const d = v.slice(0, 10).split('-'); return d.length === 3 ? `${d[2]}/${d[1]}/${d[0]}` : v }
// Formata a chave de acesso (50 dígitos) em blocos de 4 para leitura.
function fmtChave(c?: string | null) { const s = (c || '').replace(/\s/g, ''); return s ? s.replace(/(.{4})/g, '$1 ').trim() : '' }
function n2(v?: string | null) { const x = Number(String(v ?? '').replace(',', '.')); return Number.isFinite(x) ? x : 0 }
// Célula no padrão da DANFSe oficial: rótulo pequeno em caixa-alta + valor.
function CelulaOf({ rotulo, valor, forte = false, semBorda = false }: { rotulo: string; valor: React.ReactNode; forte?: boolean; semBorda?: boolean }) {
  return <div className={`min-w-0 px-3 py-1.5 ${semBorda ? '' : 'border-b border-r border-slate-300'}`}>
    <dt className="truncate text-[8px] font-bold uppercase tracking-wider text-slate-500">{rotulo}</dt>
    <dd className={`mt-0.5 break-words text-xs ${forte ? 'font-bold text-slate-900' : 'font-medium text-slate-800'}`}>{valor || '—'}</dd>
  </div>
}
function SecaoOf({ titulo }: { titulo: string }) {
  return <div className="border-b border-slate-500 bg-slate-100 px-3 py-1"><h3 className="text-[10px] font-bold uppercase tracking-wider text-slate-700">{titulo}</h3></div>
}
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c] || c))

export default function NotaPreviewDialog({ nota, compacto = false }: { nota: NotaPreview; compacto?: boolean }) {
  const xml = dadosXml(nota.xmlOriginal)
  function baixarXml() {
    if (!nota.xmlOriginal) return
    const url = URL.createObjectURL(new Blob([nota.xmlOriginal], { type: 'application/xml;charset=utf-8' }))
    const a = document.createElement('a'); a.href = url; a.download = nota.xmlNome || `NFS-e-${nota.numero || 'nota'}.xml`; a.click()
    URL.revokeObjectURL(url)
  }
  async function baixarPdf() {
    const { default: jsPDF } = await import('jspdf')
    const d = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    const W = 210, M = 12, areaW = W - 2 * M
    const NAVY: [number, number, number] = [23, 43, 77], TXT: [number, number, number] = [33, 41, 54], SUAVE: [number, number, number] = [100, 116, 139]
    let y = 30
    // Cabeçalho
    d.setFillColor(...NAVY); d.rect(0, 0, W, 24, 'F')
    d.setTextColor(255, 255, 255); d.setFont('helvetica', 'bold'); d.setFontSize(16); d.text('DANFSe', M, 13)
    d.setFont('helvetica', 'normal'); d.setFontSize(8); d.text('Documento Auxiliar da Nota Fiscal de Serviço eletrônica', M, 19)
    d.setFont('helvetica', 'bold'); d.setFontSize(9.5); d.text(`NFS-e nº ${nota.numero || '—'}`, W - M, 12, { align: 'right' })
    d.setFont('helvetica', 'normal'); d.setFontSize(8); d.text(`Emissão ${data(nota.emissao)}`, W - M, 18, { align: 'right' })
    d.setTextColor(...TXT)
    function quebra(esp: number) { if (y + esp > 284) { d.addPage(); y = M } }
    function secTitulo(t: string) { quebra(14); d.setFillColor(238, 242, 247); d.rect(M, y, areaW, 6, 'F'); d.setFont('helvetica', 'bold'); d.setFontSize(8.5); d.setTextColor(...NAVY); d.text(t, M + 2, y + 4.2); y += 9; d.setTextColor(...TXT) }
    function campos(pares: [string, string][]) {
      for (let i = 0; i < pares.length; i += 2) {
        const linha = pares.slice(i, i + 2)
        const alturas = linha.map(p => (d.splitTextToSize(String(p[1] || '—'), areaW / 2 - 4) as string[]).length)
        const h = Math.max(...alturas) * 4 + 5; quebra(h)
        linha.forEach((p, ci) => {
          const x = M + ci * (areaW / 2)
          d.setFont('helvetica', 'normal'); d.setTextColor(...SUAVE); d.setFontSize(6.8); d.text(String(p[0]).toUpperCase(), x, y)
          d.setFont('helvetica', 'bold'); d.setTextColor(...TXT); d.setFontSize(8.5); d.text(d.splitTextToSize(String(p[1] || '—'), areaW / 2 - 4), x, y + 4)
        })
        y += h
      }
    }
    if (xml?.municipioGerador || xml?.ambiente) { d.setFont('helvetica', 'normal'); d.setFontSize(7.5); d.setTextColor(...SUAVE); d.text([xml?.municipioGerador ? `Município gerador: ${xml.municipioGerador}` : '', xml?.ambiente ? `Ambiente: ${xml.ambiente}` : ''].filter(Boolean).join('   ·   '), M, y); y += 5; d.setTextColor(...TXT) }
    if (xml?.chave) { quebra(10); d.setFont('helvetica', 'normal'); d.setTextColor(...SUAVE); d.setFontSize(6.8); d.text('CHAVE DE ACESSO DA NFS-E', M, y); d.setFont('helvetica', 'bold'); d.setTextColor(...TXT); d.setFontSize(8); d.text(d.splitTextToSize(fmtChave(xml.chave), areaW) as string[], M, y + 4); y += 10 }
    campos([['Competência', nota.competencia || '—'], ['Código de verificação', xml?.codigoVerificacao || '—'], ['Nº / Série da DPS', xml?.numeroDps ? `${xml.numeroDps} / ${xml.serieDps || '—'}` : '—'], ['Emissão da DPS', xml?.dataEmissaoDps ? dhBR(xml.dataEmissaoDps) : '—'], ['Emissão da NFS-e', xml?.dataEmissaoNfse ? dhBR(xml.dataEmissaoNfse) : data(nota.emissao)], ['Situação', xml?.situacao || String(nota.situacao || '—')]])
    secTitulo('Prestador / Fornecedor (emitente da NFS-e)')
    campos([['Nome / Nome empresarial', xml?.prestadorNome || nota.emitente || '—'], ['CNPJ / CPF / NIF', doc(xml?.prestadorDoc || nota.documento)], ['Inscrição municipal', xml?.prestadorIm || '—'], ['Município / UF', xml?.prestadorMun || '—'], ['Endereço', xml?.prestadorEndereco || '—'], ['CEP', xml?.prestadorCep || '—'], ['E-mail', xml?.prestadorEmail || '—'], ['Telefone', xml?.prestadorFone || '—']])
    secTitulo('Tomador / Adquirente')
    campos([['Nome / Nome empresarial', xml?.tomadorNome || nota.unidade || '—'], ['CNPJ / CPF / NIF', doc(xml?.tomadorDoc)], ['Inscrição municipal', xml?.tomadorIm || '—'], ['Município / UF', xml?.tomadorMun || '—'], ['Endereço', xml?.tomadorEndereco || '—'], ['CEP', xml?.tomadorCep || '—'], ['E-mail', xml?.tomadorEmail || '—'], ['Telefone', xml?.tomadorFone || '—']])
    secTitulo('Serviço prestado')
    campos([['Cód. tributação nac. / mun.', [xml?.codigoServico, xml?.codigoMunicipal].filter(Boolean).join(' / ') || '—'], ['Código da NBS', xml?.nbs || '—'], ['Local da prestação', xml?.localPrestacao || '—'], ['Local de incidência do ISSQN', xml?.municipioIncidencia || '—']])
    d.setFont('helvetica', 'bold'); d.setFontSize(6.8); d.setTextColor(...SUAVE); quebra(8); d.text('DESCRIÇÃO DO SERVIÇO', M, y); y += 3; d.setTextColor(...TXT)
    d.setFont('helvetica', 'normal'); d.setFontSize(8.5)
    const desc = d.splitTextToSize(xml?.discriminacao || 'Não informada no XML.', areaW - 4) as string[]
    const hd = desc.length * 4 + 4; quebra(hd + 2); d.setDrawColor(210, 216, 224); d.setLineWidth(0.2); d.rect(M, y, areaW, hd); d.text(desc, M + 2, y + 4); y += hd + 3
    secTitulo('Tributação municipal (ISSQN)')
    campos([
      ['Base de cálculo do ISSQN', xml?.baseCalculo ? formatarMoeda(n2(xml.baseCalculo)) : '—'],
      ['Alíquota aplicada', xml?.aliquota ? `${xml.aliquota}%` : '—'],
      ['ISSQN apurado', xml?.iss ? formatarMoeda(n2(xml.iss)) : '—'],
      ['Retenção do ISSQN', xml?.retencaoIss || '—'],
    ])
    secTitulo('Valor total da NFS-e')
    campos([
      ['Valor da operação / serviço', formatarMoeda(n2(xml?.valorServicos) || Number(nota.valor || 0))],
      ['Descontos', xml?.descIncond ? formatarMoeda(n2(xml.descIncond)) : '—'],
      ['Deduções / reduções', xml?.deducoes ? formatarMoeda(n2(xml.deducoes)) : '—'],
      ['Valor líquido da NFS-e', formatarMoeda(xml?.valorLiquido ? n2(xml.valorLiquido) : (n2(xml?.valorServicos) || Number(nota.valor || 0)))],
    ])
    if (xml?.infComplementares) { secTitulo('Informações complementares'); d.setFont('helvetica', 'normal'); d.setFontSize(7.5); d.setTextColor(...TXT); const ic = d.splitTextToSize(xml.infComplementares, areaW - 4) as string[]; quebra(ic.length * 3.5 + 4); d.text(ic, M, y + 2); y += ic.length * 3.5 + 4 }
    d.setDrawColor(226, 232, 240); d.setLineWidth(0.2); d.line(M, 288, W - M, 288)
    d.setFont('helvetica', 'normal'); d.setFontSize(7); d.setTextColor(...SUAVE)
    d.text('Representação visual gerada a partir do XML original da NFS-e.', M, 292)
    d.text(`Gerado em ${new Date().toLocaleString('pt-BR')}`, W - M, 292, { align: 'right' })
    const slug = String(xml?.prestadorNome || nota.emitente || 'nota').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase().slice(0, 40)
    d.save(`DANFSe_${nota.numero || 'nota'}${slug ? '_' + slug : ''}.pdf`)
  }
  function imprimir() {
    const w = window.open('', '_blank', 'noopener,noreferrer')
    if (!w) return
    const linhas = [
      ['Número da NFS-e', nota.numero], ['Código de verificação', xml?.codigoVerificacao],
      ['Chave de acesso', fmtChave(xml?.chave)], ['Nº DPS / Série', xml?.numeroDps ? `${xml.numeroDps}${xml.serieDps ? ` / ${xml.serieDps}` : ''}` : ''],
      ['Emissão', data(xml?.dataEmissaoXml || nota.emissao)], ['Competência', nota.competencia],
      ['Prestador', xml?.prestadorNome || nota.emitente], ['CNPJ/CPF do prestador', doc(xml?.prestadorDoc || nota.documento)],
      ['Inscrição municipal', xml?.prestadorIm], ['Tomador', xml?.tomadorNome || nota.unidade],
      ['CNPJ/CPF do tomador', doc(xml?.tomadorDoc)], ['Valor dos serviços', formatarMoeda(Number(xml?.valorServicos || nota.valor || 0))],
      ['ISS', xml?.iss ? formatarMoeda(Number(xml.iss.replace(',', '.'))) : '—'], ['Código do serviço', xml?.codigoServico]
    ]
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>DANFSe ${esc(nota.numero)}</title><style>@page{size:A4 portrait;margin:12mm}*{box-sizing:border-box}body{font:12px Arial;color:#111;margin:0}.doc{border:1px solid #222}.head{padding:14px;text-align:center;border-bottom:2px solid #222}.head h1{font-size:20px;margin:0}.head p{margin:4px 0 0}.grid{display:grid;grid-template-columns:1fr 1fr}.c{padding:9px;border-right:1px solid #bbb;border-bottom:1px solid #bbb;min-height:52px}.c:nth-child(2n){border-right:0}.l{font-size:9px;text-transform:uppercase;color:#555;font-weight:bold}.v{margin-top:5px;font-weight:bold}.section{padding:10px;border-bottom:1px solid #bbb}.section h2{font-size:11px;text-transform:uppercase;margin:0 0 7px}.desc{white-space:pre-wrap;line-height:1.45}.foot{text-align:center;padding:10px;color:#555;font-size:10px}</style></head><body><div class="doc"><div class="head"><h1>DANFSe</h1><p>Documento Auxiliar da Nota Fiscal de Serviço eletrônica</p></div><div class="grid">${linhas.map(([l,v])=>`<div class="c"><div class="l">${esc(l)}</div><div class="v">${esc(v || '—')}</div></div>`).join('')}</div><div class="section"><h2>Discriminação dos serviços</h2><div class="desc">${esc(xml?.discriminacao || 'Não informada no XML.')}</div></div><div class="foot">Representação visual gerada a partir do XML original da NFS-e.</div></div><script>window.onload=()=>window.print()<\/script></body></html>`)
    w.document.close()
  }
  return <Dialog.Root>
    <Dialog.Trigger asChild><button type="button" aria-label={`Visualizar DANFSe ${nota.numero || ''}`} title={nota.xmlOriginal ? 'Visualizar DANFSe' : 'Visualizar dados da nota'} className={compacto ? 'inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700' : 'inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700'}><Eye className="h-4 w-4" />{!compacto && <span>Visualizar</span>}</button></Dialog.Trigger>
    <Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-[80] bg-slate-950/60 backdrop-blur-[2px]" /><Dialog.Content className="fixed left-1/2 top-1/2 z-[90] max-h-[94vh] w-[calc(100vw-1rem)] max-w-4xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl bg-slate-100 shadow-2xl outline-none">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b bg-slate-950 px-5 py-3 text-white"><div className="flex items-center gap-3"><FileText className="h-5 w-5" /><div><Dialog.Title className="font-bold">{nota.xmlOriginal ? 'DANFSe' : 'Dados da NFS-e'} {nota.numero || 'sem número'}</Dialog.Title><Dialog.Description className="text-xs text-slate-300">{nota.xmlOriginal ? 'Documento auxiliar gerado pelo XML original' : 'XML original não disponível para esta nota'}</Dialog.Description></div></div><div className="flex items-center gap-1">{nota.xmlOriginal && <><button onClick={baixarPdf} title="Baixar DANFSe em PDF" className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-2.5 py-1.5 text-xs font-semibold hover:bg-white/20"><FileDown className="h-4 w-4" /><span className="hidden sm:inline">Baixar PDF</span></button><button onClick={baixarXml} title="Baixar XML" className="rounded-lg p-2 hover:bg-white/10"><Download className="h-4 w-4" /></button><button onClick={imprimir} title="Imprimir DANFSe" className="rounded-lg p-2 hover:bg-white/10"><Printer className="h-4 w-4" /></button></>}<Dialog.Close className="rounded-lg p-2 hover:bg-white/10"><X className="h-5 w-5" /></Dialog.Close></div></header>
      <div className="p-3 sm:p-5"><article className="overflow-hidden rounded-md border border-slate-500 bg-white text-slate-900 shadow-sm">
        {/* Cabeçalho oficial */}
        <div className="flex items-stretch border-b border-slate-500">
          <div className="flex w-20 shrink-0 flex-col items-center justify-center border-r border-slate-500 p-2 text-center sm:w-28"><span className="text-lg font-black leading-none tracking-tight sm:text-xl">NFS-e</span><span className="mt-1 text-[7px] leading-tight text-slate-500 sm:text-[8px]">Nota Fiscal de<br/>Serviço eletrônica</span></div>
          <div className="flex flex-1 flex-col justify-center px-3 py-2"><h2 className="text-sm font-black uppercase leading-tight sm:text-base">DANFSe</h2><p className="text-[9px] leading-tight text-slate-500 sm:text-[10px]">Documento Auxiliar da NFS-e</p>{(xml?.municipioGerador || xml?.ambiente) && <p className="mt-1 text-[9px] leading-tight text-slate-500">{xml?.municipioGerador ? `Município gerador: ${xml.municipioGerador}` : ''}{xml?.ambiente ? ` · Ambiente: ${xml.ambiente}` : ''}</p>}</div>
          <div className="grid w-40 shrink-0 grid-cols-1 border-l border-slate-500 sm:w-72 sm:grid-cols-2"><CelulaOf rotulo="Número da NFS-e" valor={nota.numero} forte /><CelulaOf rotulo="Competência" valor={nota.competencia} /><CelulaOf rotulo="Emissão da NFS-e" valor={xml?.dataEmissaoNfse ? dhBR(xml.dataEmissaoNfse) : data(xml?.dataEmissaoXml || nota.emissao)} /><CelulaOf rotulo="Situação" valor={xml?.situacao || nota.situacao || '—'} semBorda /></div>
        </div>
        {/* Chave de acesso */}
        <div className="border-b border-slate-500 px-3 py-2"><p className="text-[8px] font-bold uppercase tracking-wider text-slate-500">Chave de acesso da NFS-e</p><p className="break-all font-mono text-[11px] font-semibold tracking-wider text-slate-800 sm:text-xs">{fmtChave(xml?.chave) || '—'}</p><p className="mt-0.5 text-[9px] text-slate-400">Código de verificação: {xml?.codigoVerificacao || '—'} · Consulte a autenticidade em www.gov.br/nfse</p></div>
        <dl className="grid grid-cols-2 border-b border-slate-500 sm:grid-cols-4"><CelulaOf rotulo="Número da DPS" valor={xml?.numeroDps || '—'} /><CelulaOf rotulo="Série da DPS" valor={xml?.serieDps || '—'} /><CelulaOf rotulo="Emissão da DPS" valor={xml?.dataEmissaoDps ? dhBR(xml.dataEmissaoDps) : '—'} /><CelulaOf rotulo="Finalidade" valor="NFS-e regular" semBorda /></dl>
        {/* Prestador / Fornecedor */}
        <SecaoOf titulo="Prestador / Fornecedor (emitente da NFS-e)" />
        <dl className="grid grid-cols-2 border-b border-slate-500 sm:grid-cols-4"><div className="col-span-2"><CelulaOf rotulo="Nome / Nome empresarial" valor={xml?.prestadorNome || nota.emitente} /></div><CelulaOf rotulo="CNPJ / CPF / NIF" valor={doc(xml?.prestadorDoc || nota.documento)} /><CelulaOf rotulo="Inscrição municipal" valor={xml?.prestadorIm || '—'} /><div className="col-span-2 sm:col-span-2"><CelulaOf rotulo="Endereço" valor={xml?.prestadorEndereco || '—'} /></div><CelulaOf rotulo="Município / UF" valor={xml?.prestadorMun || '—'} /><CelulaOf rotulo="CEP" valor={xml?.prestadorCep || '—'} /><CelulaOf rotulo="E-mail" valor={xml?.prestadorEmail || '—'} /><CelulaOf rotulo="Telefone" valor={xml?.prestadorFone || '—'} semBorda /></dl>
        {/* Tomador / Adquirente */}
        <SecaoOf titulo="Tomador / Adquirente" />
        <dl className="grid grid-cols-2 border-b border-slate-500 sm:grid-cols-4"><div className="col-span-2"><CelulaOf rotulo="Nome / Nome empresarial" valor={xml?.tomadorNome || nota.unidade} /></div><CelulaOf rotulo="CNPJ / CPF / NIF" valor={doc(xml?.tomadorDoc)} /><CelulaOf rotulo="Inscrição municipal" valor={xml?.tomadorIm || '—'} /><div className="col-span-2 sm:col-span-2"><CelulaOf rotulo="Endereço" valor={xml?.tomadorEndereco || '—'} /></div><CelulaOf rotulo="Município / UF" valor={xml?.tomadorMun || '—'} /><CelulaOf rotulo="CEP" valor={xml?.tomadorCep || '—'} /><CelulaOf rotulo="E-mail" valor={xml?.tomadorEmail || '—'} /><CelulaOf rotulo="Telefone" valor={xml?.tomadorFone || '—'} semBorda /></dl>
        {/* Serviço prestado */}
        <SecaoOf titulo="Serviço prestado" />
        <dl className="grid grid-cols-2 border-b border-slate-500 sm:grid-cols-4"><CelulaOf rotulo="Cód. tributação nac. / mun." valor={[xml?.codigoServico, xml?.codigoMunicipal].filter(Boolean).join(' / ') || '—'} /><CelulaOf rotulo="Código da NBS" valor={xml?.nbs || '—'} /><CelulaOf rotulo="Local da prestação" valor={xml?.localPrestacao || '—'} /><CelulaOf rotulo="Local de incidência do ISSQN" valor={xml?.municipioIncidencia || '—'} semBorda /></dl>
        <div className="border-b border-slate-500 px-3 py-2"><p className="text-[8px] font-bold uppercase tracking-wider text-slate-500">Descrição do serviço</p><p className="mt-1 min-h-10 whitespace-pre-wrap text-xs leading-relaxed text-slate-800">{xml?.discriminacao || 'Não informada no XML.'}</p></div>
        {/* Tributação municipal (ISSQN) */}
        <SecaoOf titulo="Tributação municipal (ISSQN)" />
        <dl className="grid grid-cols-2 border-b border-slate-500 sm:grid-cols-4"><CelulaOf rotulo="Base de cálculo do ISSQN" valor={xml?.baseCalculo ? formatarMoeda(n2(xml.baseCalculo)) : '—'} /><CelulaOf rotulo="Alíquota aplicada" valor={xml?.aliquota ? `${xml.aliquota}%` : '—'} /><CelulaOf rotulo="ISSQN apurado" valor={xml?.iss ? formatarMoeda(n2(xml.iss)) : '—'} /><CelulaOf rotulo="Retenção do ISSQN" valor={xml?.retencaoIss || '—'} semBorda /></dl>
        {/* Valor total da NFS-e */}
        <SecaoOf titulo="Valor total da NFS-e" />
        <dl className="grid grid-cols-2 sm:grid-cols-4"><CelulaOf rotulo="Valor da operação / serviço" valor={formatarMoeda(n2(xml?.valorServicos) || Number(nota.valor || 0))} forte /><CelulaOf rotulo="Descontos" valor={xml?.descIncond ? formatarMoeda(n2(xml.descIncond)) : '—'} /><CelulaOf rotulo="Deduções / reduções" valor={xml?.deducoes ? formatarMoeda(n2(xml.deducoes)) : '—'} /><CelulaOf rotulo="Valor líquido da NFS-e" valor={formatarMoeda(xml?.valorLiquido ? n2(xml.valorLiquido) : (n2(xml?.valorServicos) || Number(nota.valor || 0)))} forte semBorda /></dl>
        {xml?.infComplementares && <><SecaoOf titulo="Informações complementares" /><div className="px-3 py-2"><p className="whitespace-pre-wrap text-[11px] leading-relaxed text-slate-700">{xml.infComplementares}</p></div></>}
      </article>
      <p className="mt-2 px-1 text-center text-[10px] text-slate-400">Representação visual (DANFSe) gerada a partir do XML original da NFS-e.{nota.situacao ? ` · Situação no módulo: ${nota.situacao}` : ''}</p>
      {!nota.xmlOriginal && <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">Esta nota foi gravada sem o XML original. Use <b>Completar XML faltantes</b> na tela de notas para recuperá-lo e habilitar a DANFSe completa.</p>}</div>
    </Dialog.Content></Dialog.Portal>
  </Dialog.Root>
}
