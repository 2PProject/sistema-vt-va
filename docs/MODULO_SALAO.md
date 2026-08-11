# Módulo Salão — Controle de NFS-e

Módulo **isolado e reversível** acoplado ao sistema de VT/VA. Reaproveita o
mesmo login e as mesmas empresas cadastradas. Controla a emissão mensal de
NFS-e pelos profissionais autônomos de salões de beleza.

## O que faz
- **Certificados A1 (.pfx)** por empresa, guardados no servidor (nunca no
  frontend), com a senha criptografada.
- **Profissionais** por empresa (nome + CPF/CNPJ), com importação CSV/colagem.
- **Importação mensal** de comissões via planilha `.xlsx` (uma aba por empresa).
- **Sincronização com o gov.br** (botão manual) que consulta a NFS-e nacional
  (ADN) por empresa via mTLS e cruza pelas CPF/CNPJ dos prestadores, guardando o
  ponto (NSU) para buscar só o que é novo.
- **Confirmação manual** de NF (fallback) e **relatórios** (PDF/Excel).

## Como LIGAR
1. Rodar `supabase_salao.sql` no SQL Editor do Supabase.
2. Definir variáveis de ambiente (no Vercel / `.env.local`):
   - `SUPABASE_SERVICE_ROLE_KEY` — chave service_role (server-only) usada para
     ler/gravar certificados e o NSU (tabelas protegidas por RLS).
   - `SALON_ENC_KEY` — segredo (>= 32 chars) para criptografar a senha do .pfx.
   - `SALON_ADN_BASE_URL` *(opcional, para a sync real)* — URL base da API ADN
     NFS-e nacional. Sem ela, o botão Sincronizar funciona e reporta "0 notas
     novas" (não quebra nada) até o endpoint ser configurado.
3. (Opcional) `NEXT_PUBLIC_SALAO_ENABLED=true` — já é o padrão.

## Como DESLIGAR (sem remover)
- Defina `NEXT_PUBLIC_SALAO_ENABLED=false`. O item some do menu e as páginas
  redirecionam. Nada de VT/VA é afetado.

## Como REMOVER por completo
1. Banco: rodar `supabase_salao_rollback.sql` (dropa só as tabelas `salon_*`).
2. Código: apagar estes caminhos (todos exclusivos do módulo):
   - `app/salao/` (páginas)
   - `app/api/nfse/` e `app/api/salao/` (rotas de servidor)
   - `lib/salao/` (regras/dados)
   - `components/salao/` (se houver)
   - `supabase_salao.sql`, `supabase_salao_rollback.sql`, este `docs/MODULO_SALAO.md`
3. Sidebar: remover o bloco demarcado por
   `// #region MÓDULO SALÃO` … `// #endregion MÓDULO SALÃO` em
   `components/Sidebar.tsx` (única alteração feita em arquivo existente).
4. Dependência opcional: `node-forge` foi adicionada só para validar o .pfx;
   pode remover de `package.json` se nada mais usar.

Nenhuma tabela, rota ou arquivo do sistema de VT/VA depende do módulo Salão.
