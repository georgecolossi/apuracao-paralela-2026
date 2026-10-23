<div align="center">

# Apuração Paralela 2026

**Sistema independente de acompanhamento eleitoral — Concórdia/SC**

[![Next.js](https://img.shields.io/badge/Next.js-16.3-black?style=flat-square&logo=next.js)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19.0-61DAFB?style=flat-square&logo=react)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-3178C6?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-4.0-06B6D4?style=flat-square&logo=tailwindcss)](https://tailwindcss.com/)
[![Prisma](https://img.shields.io/badge/Prisma-5.22-2D3748?style=flat-square&logo=prisma)](https://www.prisma.io/)
[![SQLite](https://img.shields.io/badge/SQLite-3.0-003B57?style=flat-square&logo=sqlite)](https://www.sqlite.org/)
[![Railway](https://img.shields.io/badge/Railway-Deploy-0B0D0E?style=flat-square&logo=railway)](https://railway.app/)
[![Vitest](https://img.shields.io/badge/Vitest-2.1-6E9F18?style=flat-square&logo=vitest)](https://vitest.dev/)
[![Playwright](https://img.shields.io/badge/Playwright-1.63-2EAD33?style=flat-square&logo=playwright)](https://playwright.dev/)

---

### [Acessar Painel Público em Produção](https://apuracao-paralela-2026-production.up.railway.app/apuracao)

</div>

---

## Sobre o Projeto

O **Apuração Paralela 2026** é uma aplicação web independente desenvolvida para coletar, validar, contabilizar e acompanhar os Boletins de Urna (BUs) impressos e fixados nas seções eleitorais ao término da votação.

O sistema permite que cidadãos, fiscais e a comunidade de Concórdia/SC acompanhem em tempo real a evolução da contagem dos votos no município através de um painel público de acesso livre, de forma independente do processamento central da Justiça Eleitoral.

> [!IMPORTANT]
> **Aviso de Isenção:** Esta plataforma é um projeto independente da sociedade civil. Não possui qualquer vínculo com o Tribunal Superior Eleitoral (TSE) ou com Tribunais Regionais Eleitorais (TREs) e **não substitui os resultados oficiais da Justiça Eleitoral**.

---

## Funcionalidades

- **Scanner Ótico de QRBU:** Leitura contínua pela câmera do celular ou desktop (`html5-qrcode`), com suporte adicional a envio manual de payload.
- **Suporte a QR Codes Multipartes:** Montagem automática de boletins impressos em múltiplos fragmentos QR Code (`QRBU:n:m`), tolerante a recepção fora de ordem.
- **Validação Criptográfica de Integridade:** Recálculo e verificação do hash SHA-512 informado no cabeçalho do BU para garantir que nenhum voto ou dado foi adulterado.
- **Prevenção de Duplicidades e Conflitos:** Identificação determinística unívoca (`deterministicId`) por pleito, turno, zona, seção e urna, rejeitando envios repetidos ou conflitantes.
- **Conferência Administrativa de BUs:** Interface visual para conferência lote a lote entre as informações digitadas/escaneadas e a fita física de papel.
- **Cadastro Dinâmico de Seções Elegíveis:** No segundo turno, o sistema cadastra dinamicamente novas seções legítimas do município atendido, sem necessidade de lista estática prévia.
- **Isolamento Estrito de Turnos (RoundContext Isolation):** O 1º turno e o 2º turno operam com contextos de pleito (`plei`), candidatos, regras de apuração e coberturas completamente independentes.
- **Totalização Transparente:** Agregação de votos nominais por candidato, votos brancos, votos nulos, total de votos apurados, comparecimento e abstenção.
- **Indicadores de Cobertura Eleitoral:** Exibição clara das urnas apuradas contra o denominador esperado, com sinalização explícita de cobertura provisória quando aplicável.
- **Projeção Matemática Linear:** Extrapolação provisória de votos com base no percentual apurado; inicia-se a partir do primeiro BU recebido e oculta-se automaticamente ao atingir 100%.
- **Painel Público em Tempo Real:** Atualização automática periódica via polling com cabeçalhos HTTP `Cache-Control: no-store`, garantindo que os dados não fiquem retidos em cache.
- **Trilha de Auditoria (AuditLog):** Registro cronológico de todas as ações administrativas, acessos, ativações de turno e rejeições operacionais.

---

## Como Funciona

O fluxo operacional de ingestão e totalização de votos é estruturado nas seguintes etapas:

```mermaid
flowchart LR
    A["BU Impresso"] --> B["Leitura QRBU"]
    B --> C["Validação SHA-512"]
    C --> D["Conferência Administrativa"]
    D --> E["Persistência SQLite"]
    E --> F["Totalização"]
    F --> G["Painel Público"]
```

1. **BU Impresso:** A urna eletrônica imprime o espelho do Boletim de Urna ao encerrar a votação às 17h00.
2. **Leitura QRBU:** O operador voluntário posiciona a câmera do dispositivo móvel e faz a leitura do QR Code na página 1 do BU.
3. **Validação SHA-512:** O backend valida o cabeçalho (`QRBU`), a fase oficial (`FASE:O`), o pleito ativo e recalcula o hash criptográfico do payload.
4. **Conferência Administrativa:** Fiscais podem confrontar a parcial registrada contra a fita de papel através do painel de conferência.
5. **Persistência SQLite:** O boletim e seus votos associados são gravados em transação única no banco de dados SQLite persistente.
6. **Totalização:** O motor de apuração recalcula a soma de votos nominais, votos brancos, nulos e comparecimento.
7. **Painel Público:** O resultado é disponibilizado instantaneamente no painel `/apuracao`.

---

## Tecnologias Utilizadas

A pilha tecnológica foi selecionada com foco em simplicidade operacional, robustez, ausência de dependências externas pesadas e execução performática:

- **Next.js 16 (App Router):** Framework full-stack com React Server Components e Turbopack.
- **React 19:** Biblioteca de interface reativa para o painel público e consoles administrativos.
- **TypeScript:** Tipagem estrita de ponta a ponta, cobrindo modelos de dados, rotas de API e parsers.
- **Tailwind CSS 4:** Estilização utilitária de alto desempenho e design responsivo.
- **Prisma ORM 5:** Mapeamento objeto-relacional com migrações declarativas para SQLite.
- **SQLite:** Banco de dados relacional em arquivo único, leve e persistido em disco local/volume montado.
- **Vitest:** Suíte de testes unitários e de integração de execução ultra-rápida.
- **Playwright:** Framework de testes ponta a ponta (E2E) e simulação de concorrência com múltiplos dispositivos.
- **Railway:** Plataforma de hospedagem com deploy contínuo e volume persistente dedicado.

---

## Instalação e Desenvolvimento Local

### Pré-requisitos
- **Node.js** (versão 20 ou superior)
- **npm** (versão 10 ou superior)
- **Git**

### Passo a Passo

1. **Clonar o repositório:**
   ```bash
   git clone https://github.com/georgecolossi/apuracao-paralela-2026.git
   cd apuracao-paralela-2026
   ```

2. **Instalar dependências:**
   ```bash
   npm install
   ```

3. **Configurar variáveis de ambiente:**
   ```bash
   cp .env.example .env
   ```
   *Edite o arquivo `.env` para ajustar o `DATABASE_URL` e definir um `JWT_SECRET` para desenvolvimento local.*

4. **Inicializar o banco de dados local:**
   ```bash
   npx prisma db push
   ```

5. **Iniciar o servidor de desenvolvimento:**
   ```bash
   npm run dev
   ```
   O painel público estará disponível em `http://localhost:3000/apuracao` e o acesso administrativo em `http://localhost:3000/login`.

6. **Verificações de qualidade:**
   ```bash
   # Validação de encoding (prevenção de caracteres corrompidos UTF-8)
   npm run check:encoding

   # Checagem de tipos estáticos TypeScript
   npm run typecheck

   # Execução da suíte de testes automatizados
   npm run test

   # Compilação para produção
   npm run build
   ```

---

## Testes Automatizados

O sistema conta com suítes automatizadas cobrindo todos os fluxos críticos de integridade e apuração:

- **Parser e Tokenizer de QRBU:** Verificação da extração de metadados, identificadores eleitorais, candidatos e totais de votos a partir de strings brutas de QRBU.
- **Integridade Criptográfica SHA-512:** Validação matemática do recálculo do hash informado, incluindo rejeição de payloads adulterados (`INVALID_HASH`).
- **Prevenção de Duplicidades e Concorrência:** Testes de envio concorrente de múltiplos BUs e tentativas de retransmissão do mesmo boletim por dispositivos diferentes.
- **Isolamento de Contexto de Turnos:** Garantia de que a apuração do 2º turno não altera votos, totais ou históricos do 1º turno.
- **Testes Multi-Dispositivo com Playwright:** Validação de login simultâneo da mesma conta em múltiplos contextos de navegador (dispositivos móveis e desktop) sem desconexão mútua.
- **Exemplos Oficiais do TSE (2º Turno 2026):** Validação dos fixtures oficiais simulados disponibilizados pelo TSE (`Pres-T2`, `PresGov-T2`, `PresGovConMunic-T2` e `PresGovPrefeito-T2`), com extração real de QR Codes a partir de PDFs e confrontação com arquivos binários ASN.1 (`.dat`).

> [!NOTE]
> Os testes atestam conformidade estrita com o padrão de especificações técnicas do TSE para as Eleições 2026. Novas variantes teóricas não documentadas pelo TSE são tratadas de forma fail-safe pelo parser.

---

## Limitações e Transparência

- **Independência Institucional:** O sistema é uma ferramenta cidadã independente, sem afiliação governamental.
- **Escopo do Hash SHA-512:** A validação do hash SHA-512 comprova que o conteúdo do QR Code escaneado não sofreu alteração desde a sua impressão na seção eleitoral. O sistema não executa verificação de chave assimétrica PKI (ICP-Brasil) da assinatura digital da urna.
- **Fidelidade da Coleta:** Os totais publicados refletem exclusivamente os boletins físicos efetivamente recolhidos e transmitidos pelos operadores locais.
- **Cobertura Provisória:** A referência de 193 urnas para o 2º turno em Concórdia/SC baseia-se na malha histórica do 1º turno até a publicação definitiva das tabelas de correspondência pelo TSE.
- **Caráter da Projeção Linear:** A projeção de votos é uma extrapolação aritmética direta baseada nas urnas lidas até o momento, não constituindo previsão probabilística ou amostragem estatística.
- **Primazia do Resultado Oficial:** Os dados da Apuração Paralela possuem caráter informativo e de transparência cívica, não substituindo a totalização oficial homologada pela Justiça Eleitoral.

---

## Documentação Técnica e Operacional

Para detalhes aprofundados sobre deploy no Railway, volumes persistentes, rotas do painel admin, contingência em campo e procedimentos no dia da eleição, consulte:

📖 **[Manual Operacional e de Infraestrutura (`docs/OPERACAO.md`)](docs/OPERACAO.md)**

---

<div align="center">
Desenvolvido com foco em transparência, rigor técnico e integridade eleitoral.
</div>
