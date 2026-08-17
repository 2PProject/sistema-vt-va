'use client'

import * as Dialog from '@radix-ui/react-dialog'
import { Eye, FileText, X } from 'lucide-react'
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
}

function data(v?: string | null) {
  if (!v) return 'Não informada'
  const [a, m, d] = v.slice(0, 10).split('-')
  return d ? `${d}/${m}/${a}` : v
}

function Campo({ rotulo, valor, destaque = false }: { rotulo: string; valor: React.ReactNode; destaque?: boolean }) {
  return <div className={`rounded-xl border px-3 py-2.5 ${destaque ? 'border-blue-200 bg-blue-50' : 'border-slate-200 bg-slate-50'}`}>
    <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{rotulo}</dt>
    <dd className={`mt-1 text-sm ${destaque ? 'font-bold text-blue-950' : 'font-medium text-slate-900'}`}>{valor || '—'}</dd>
  </div>
}

export default function NotaPreviewDialog({ nota, compacto = false }: { nota: NotaPreview; compacto?: boolean }) {
  return <Dialog.Root>
    <Dialog.Trigger asChild>
      <button
        type="button"
        aria-label={`Visualizar nota ${nota.numero || ''}`}
        title="Visualizar nota"
        className={compacto
          ? 'inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700'
          : 'inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700'}
      >
        <Eye className="h-4 w-4" aria-hidden="true" />
        {!compacto && <span>Visualizar</span>}
      </button>
    </Dialog.Trigger>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-[80] bg-slate-950/55 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=closed]:animate-out" />
      <Dialog.Content className="fixed left-1/2 top-1/2 z-[90] max-h-[90vh] w-[calc(100vw-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-white/70 bg-white shadow-2xl outline-none">
        <div className="flex items-start justify-between border-b border-slate-200 bg-gradient-to-r from-slate-950 to-blue-950 px-5 py-4 text-white">
          <div className="flex min-w-0 gap-3">
            <span className="mt-0.5 rounded-xl bg-white/10 p-2"><FileText className="h-5 w-5" /></span>
            <div className="min-w-0">
              <Dialog.Title className="truncate text-base font-bold">NFS-e {nota.numero || 'sem número'}</Dialog.Title>
              <Dialog.Description className="mt-1 truncate text-xs text-blue-100">{nota.emitente || 'Emitente não identificado'}</Dialog.Description>
            </div>
          </div>
          <Dialog.Close className="rounded-lg p-2 text-blue-100 transition hover:bg-white/10 hover:text-white" aria-label="Fechar">
            <X className="h-5 w-5" />
          </Dialog.Close>
        </div>
        <div className="space-y-4 p-5">
          <dl className="grid gap-3 sm:grid-cols-2">
            <Campo rotulo="Emitente" valor={nota.emitente} />
            <Campo rotulo="CNPJ / CPF" valor={nota.documento} />
            <Campo rotulo="Valor da nota" valor={formatarMoeda(Number(nota.valor || 0))} destaque />
            <Campo rotulo="Data de emissão" valor={data(nota.emissao)} />
            <Campo
              rotulo={nota.competenciaOficial ? 'Competência oficial da planilha' : 'Competência informada na nota'}
              valor={nota.competencia}
              destaque={!!nota.competenciaOficial}
            />
            <Campo rotulo="Situação" valor={nota.situacao} />
            {nota.unidade && <Campo rotulo="Unidade" valor={nota.unidade} />}
          </dl>
          {nota.competenciaOficial
            ? <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800"><b>Regra aplicada:</b> a competência da planilha é a referência oficial do vínculo.</p>
            : <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">A competência exibida veio da NFS-e e permanece informativa até o vínculo com um profissional importado.</p>}
          {nota.observacao && <div className="rounded-xl border border-slate-200 p-3"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Observação</p><p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{nota.observacao}</p></div>}
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>
}
