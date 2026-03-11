# Sistema Web de Gestão de Vale Transporte e Vale Alimentação

Sistema para o Grupo Meire Reis.

Tecnologia:

- Next.js
- Supabase
- Tailwind
- Vercel

## Módulos

### Empresas
Cadastro de empresas com razão social e CNPJ.

### Unidades
Cada empresa pode possuir várias unidades identificadas por código.

### Funcionários
Cadastro com:

- nome
- CTPS
- série
- função
- unidade
- folga semanal

### Competência mensal
Configuração por mês:

- dias úteis
- feriados
- sábados trabalhados
- faltas

### Cálculo automático

VA = dias úteis × valor diário

VT normal = dias úteis × valor VT

VT sábado = dias sábado × valor VT sábado

Descontos:

- feriados
- faltas

### Recibos

Gerar PDF com:

- razão social
- CNPJ
- funcionário
- função
- mês de referência
- tabela de valores
- valor total
