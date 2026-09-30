# Regra Permanente — README e Documentação

## README faz parte da Definition of Done
Toda tarefa futura deve avaliar se suas alterações afetam documentação.
Se a tarefa modificar ou introduzir qualquer:
- funcionalidade;
- comportamento;
- arquitetura;
- rota;
- endpoint;
- variável de ambiente;
- configuração;
- fluxo operacional;
- segurança;
- autorização;
- role/permissão;
- modelo de dados;
- parser;
- integração;
- fonte de dados;
- cobertura geográfica;
- regra de negócio;
- teste relevante;
- fixture relevante;
- instalação;
- deploy;
- operação;
- limitação;
- roadmap;

o `README.md` DEVE ser revisado na mesma tarefa.
Se houver impacto documental: README deve ser atualizado no MESMO COMMIT da implementação.
Se não houver impacto documental: não alterar README artificialmente.

## README deve representar o Estado Final Real
O README deve representar o estado REAL do projeto ao FINAL de cada tarefa.
- Se funcionalidade for implementada: documentá-la.
- Se mudar: atualizar.
- Se for removida: remover/corrigir documentação antiga.
- Se limitação for resolvida: remover ou atualizar.
- Se nova limitação surgir: documentá-la.
- Se item do roadmap for concluído: mover para a seção apropriada.
- Se env var, rota, API ou fluxo mudar: atualizar documentação.
O README NÃO deve acumular informações históricas obsoletas.

## Não inventar documentação
Antes de documentar, verificar o código.
Não documentar funcionalidades planejadas como existentes, testes não executados como PASS, validações ou comportamentos inferidos sem suporte no código.
O que for planejado mas não existir vai apenas para `Próximas etapas` ou `Limitações conhecidas`.

## Distinguir Implementação, Teste e Garantia
- IMPLEMENTADO: existe no código.
- TESTADO: existe teste automatizado correspondente.
- VALIDADO EM HARDWARE/PRODUÇÃO: somente afirmar se realmente ocorreu.
Não transformar cobertura de teste em garantia absoluta de que funcionará em todos os cenários no mundo real (ex: câmeras de todos os celulares).

## Proibir linguagem absoluta
Evitar afirmações como: proteção total, 100% seguro, impossível duplicar, infalível, perfeitamente isolado, garante em qualquer cenário, blindado, segurança absoluta.
Preferir linguagem factual: "o sistema implementa...", "o backend verifica...", "a suíte automatizada verifica...", "tentativas duplicadas são rejeitadas", "os dados de simulação são excluídos da totalização pública".

## Terminologia Eleitoral
Nunca chamar a totalização deste sistema de `resultado oficial` ou `apuração oficial` quando se referir ao sistema.
Utilizar: `apuração paralela`, `resultado não oficial`, `dados processados pelo sistema`.
A palavra `oficial` deve ser usada apenas referindo-se a fontes do TSE (documentação oficial do TSE, fixtures oficiais, base oficial).

## Fontes e Metadados Auxiliares
Quando o projeto passar a utilizar datasets externos, distinguir:
- FONTE DOS VOTOS (ex: QRBU).
- METADADOS AUXILIARES (ex: base de candidaturas para resolver número para nome, partido/sigla). Metadados não devem ser descritos como fonte de votos.

## UTF-8 Permanente
O README.md deve permanecer sempre como UTF-8 válido (preferencialmente sem BOM), sem ocorrência de caracteres de substituição ou mojibake (como Ã). Antes do commit, verificar UTF-8, mas sem substituir cegamente. Revisar o contexto.

## Documentação Detalhada, mas Útil
Evitar repetição, marketing, informações triviais ou ornamentais. Priorizar funcionamento, arquitetura, segurança, operação, limites, fontes.

## Não documentar segredos
Nunca incluir senhas reais, tokens, JWT secrets no README. Apenas exemplos técnicos seguros.

## Checklist de Finalização de Tarefa
Antes de finalizar QUALQUER tarefa futura, responda internamente:
1. Esta mudança alterou algo documentável?
2. README continua factual?
3. Alguma limitação mudou?
4. Algum item do roadmap foi concluído?
5. Alguma rota/API/configuração mudou?
6. Algum teste relevante foi adicionado?
7. README continua UTF-8 válido?

Se qualquer resposta exigir atualização, o README deve ser atualizado antes do commit.

> NOTA: Esta regra é permanente. Prompts futuros não precisarão repetir isso. A partir de agora, toda tarefa assume este compromisso documental.
