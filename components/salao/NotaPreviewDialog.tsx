'use client'

import * as Dialog from '@radix-ui/react-dialog'
import { Download, Eye, FileText, Printer, X } from 'lucide-react'
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
function dadosXml(xml?: string | null) {
  if (!xml) return null
  const prestador = bloco(xml, ['PrestadorServico', 'Prestador', 'emit'])
  const tomador = bloco(xml, ['TomadorServico', 'Tomador', 'toma'])
  const servico = bloco(xml, ['Servico', 'serv'])
  const enderecoPrestador = bloco(prestador, ['Endereco', 'enderNac', 'enderEmit'])
  const enderecoTomador = bloco(tomador, ['Endereco', 'enderNac', 'enderToma'])
  return {
    prestadorNome: tag(prestador, ['RazaoSocial', 'xNome', 'NomeFantasia', 'xFant']),
    prestadorDoc: tag(prestador, ['Cnpj', 'CPF', 'Cpf']),
    prestadorIm: tag(prestador, ['InscricaoMunicipal', 'IM']),
    prestadorEndereco: [tag(enderecoPrestador, ['Endereco', 'xLgr']), tag(enderecoPrestador, ['Numero', 'nro']), tag(enderecoPrestador, ['Bairro', 'xBairro']), tag(enderecoPrestador, ['Municipio', 'xMun'])].filter(Boolean).join(', '),
    tomadorNome: tag(tomador, ['RazaoSocial', 'xNome', 'NomeFantasia']),
    tomadorDoc: tag(tomador, ['Cnpj', 'CPF', 'Cpf']),
    tomadorIm: tag(tomador, ['InscricaoMunicipal', 'IM']),
    tomadorEndereco: [tag(enderecoTomador, ['Endereco', 'xLgr']), tag(enderecoTomador, ['Numero', 'nro']), tag(enderecoTomador, ['Bairro', 'xBairro']), tag(enderecoTomador, ['Municipio', 'xMun'])].filter(Boolean).join(', '),
    discriminacao: tag(servico || xml, ['Discriminacao', 'xDescServ', 'Descricao']),
    codigoServico: tag(servico || xml, ['ItemListaServico', 'cTribNac', 'CodigoTributacaoMunicipio']),
    codigoVerificacao: tag(xml, ['CodigoVerificacao', 'cVerif']),
    valorServicos: tag(servico || xml, ['ValorServicos', 'vServ', 'vLiq']),
    iss: tag(servico || xml, ['ValorIss', 'vISSQN']),
    municipioIncidencia: tag(servico || xml, ['MunicipioIncidencia', 'xLocPrestacao', 'cLocIncid']),
  }
}
function Campo({ rotulo, valor, destaque = false }: { rotulo: string; valor: React.ReactNode; destaque?: boolean }) {
  return <div className={`rounded-lg border px-3 py-2 ${destaque ? 'border-blue-200 bg-blue-50' : 'border-slate-200 bg-white'}`}>
    <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{rotulo}</dt>
    <dd className={`mt-1 text-sm ${destaque ? 'font-bold text-blue-950' : 'font-medium text-slate-900'}`}>{valor || '—'}</dd>
  </div>
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
  function imprimir() {
    const w = window.open('', '_blank', 'noopener,noreferrer')
    if (!w) return
    const linhas = [
      ['Número da NFS-e', nota.numero], ['Código de verificação', xml?.codigoVerificacao],
      ['Emissão', data(nota.emissao)], ['Competência', nota.competencia],
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
      <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b bg-slate-950 px-5 py-3 text-white"><div className="flex items-center gap-3"><FileText className="h-5 w-5" /><div><Dialog.Title className="font-bold">{nota.xmlOriginal ? 'DANFSe' : 'Dados da NFS-e'} {nota.numero || 'sem número'}</Dialog.Title><Dialog.Description className="text-xs text-slate-300">{nota.xmlOriginal ? 'Documento auxiliar gerado pelo XML original' : 'XML original não disponível para esta nota'}</Dialog.Description></div></div><div className="flex items-center gap-1">{nota.xmlOriginal && <><button onClick={baixarXml} title="Baixar XML" className="rounded-lg p-2 hover:bg-white/10"><Download className="h-4 w-4" /></button><button onClick={imprimir} title="Imprimir DANFSe" className="rounded-lg p-2 hover:bg-white/10"><Printer className="h-4 w-4" /></button></>}<Dialog.Close className="rounded-lg p-2 hover:bg-white/10"><X className="h-5 w-5" /></Dialog.Close></div></header>
      <div className="p-4 sm:p-6"><article className="overflow-hidden rounded-xl border border-slate-300 bg-white shadow-sm">
        <div className="border-b-2 border-slate-800 p-5 text-center"><h2 className="text-2xl font-black tracking-tight">DANFSe</h2><p className="text-xs text-slate-500">Documento Auxiliar da Nota Fiscal de Serviço eletrônica</p></div>
        <dl className="grid gap-2 border-b p-4 sm:grid-cols-3"><Campo rotulo="Número da NFS-e" valor={nota.numero} destaque /><Campo rotulo="Data de emissão" valor={data(nota.emissao)} /><Campo rotulo="Código de verificação" valor={xml?.codigoVerificacao || '—'} /></dl>
        <section className="border-b p-4"><h3 className="mb-2 text-xs font-black uppercase tracking-wider text-slate-700">Prestador do serviço</h3><dl className="grid gap-2 sm:grid-cols-3"><Campo rotulo="Nome / Razão social" valor={xml?.prestadorNome || nota.emitente} /><Campo rotulo="CNPJ / CPF" valor={doc(xml?.prestadorDoc || nota.documento)} /><Campo rotulo="Inscrição municipal" valor={xml?.prestadorIm || '—'} />{xml?.prestadorEndereco && <div className="sm:col-span-3"><Campo rotulo="Endereço" valor={xml.prestadorEndereco} /></div>}</dl></section>
        <section className="border-b p-4"><h3 className="mb-2 text-xs font-black uppercase tracking-wider text-slate-700">Tomador do serviço</h3><dl className="grid gap-2 sm:grid-cols-3"><Campo rotulo="Nome / Razão social" valor={xml?.tomadorNome || nota.unidade} /><Campo rotulo="CNPJ / CPF" valor={doc(xml?.tomadorDoc)} /><Campo rotulo="Inscrição municipal" valor={xml?.tomadorIm || '—'} />{xml?.tomadorEndereco && <div className="sm:col-span-3"><Campo rotulo="Endereço" valor={xml.tomadorEndereco} /></div>}</dl></section>
        <section className="border-b p-4"><h3 className="mb-2 text-xs font-black uppercase tracking-wider text-slate-700">Serviço</h3><p className="min-h-20 whitespace-pre-wrap rounded-lg border bg-slate-50 p-3 text-sm leading-relaxed text-slate-800">{xml?.discriminacao || 'Descrição não localizada no XML.'}</p><dl className="mt-2 grid gap-2 sm:grid-cols-3"><Campo rotulo="Código do serviço" valor={xml?.codigoServico || '—'} /><Campo rotulo="Município de incidência" valor={xml?.municipioIncidencia || '—'} /><Campo rotulo={nota.competenciaOficial ? 'Competência oficial da planilha' : 'Competência informada na nota'} valor={nota.competencia} destaque={!!nota.competenciaOficial} /></dl></section>
        <section className="p-4"><h3 className="mb-2 text-xs font-black uppercase tracking-wider text-slate-700">Valores</h3><dl className="grid gap-2 sm:grid-cols-3"><Campo rotulo="Valor dos serviços" valor={formatarMoeda(Number(xml?.valorServicos || nota.valor || 0))} destaque /><Campo rotulo="ISS" valor={xml?.iss ? formatarMoeda(Number(xml.iss.replace(',', '.'))) : '—'} /><Campo rotulo="Situação no módulo" valor={nota.situacao} /></dl></section>
      </article>{!nota.xmlOriginal && <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">Esta nota foi gravada sem o XML original. Reimporte o XML para habilitar a DANFSe completa.</p>}</div>
    </Dialog.Content></Dialog.Portal>
  </Dialog.Root>
}
