---
description: Regra permanente de sincronização automática com o GitHub ao final de cada tarefa
trigger: model_decision
---

# SINCRONIZAÇÃO AUTOMÁTICA COM GITHUB — REGRA PERMANENTE

Este workspace é o próprio repositório Git oficial do projeto.

1. **Repositório**: Este workspace é o próprio repositório Git oficial do projeto.
2. **Branch**: A branch oficial de trabalho é `main`.
3. **Remote**: O remote oficial é `origin`.

4. **Antes de qualquer tarefa que altere arquivos**:
   - Executar `git status`.
   - Verificar se existem alterações anteriores/desconhecidas.
   - Se houver alterações não relacionadas à tarefa atual, NÃO sobrescrever, restaurar, apagar ou incluir essas alterações no commit.
   - Nesse caso, PARAR e informar o usuário.

5. **Durante a implementação**:
   - NÃO criar commits intermediários.
   - NÃO fazer push enquanto a tarefa estiver incompleta.

6. **Após concluir uma tarefa que altere o projeto**:
   - Executar todas as validações/testes exigidos pela tarefa.
   - Somente continuar se os testes obrigatórios passarem.
   - Executar `git status`.
   - Executar `git diff --stat`.
   - Revisar `git diff`.
   - Confirmar que somente arquivos pertencentes à tarefa foram alterados.

7. **Restauração de Artefatos**: Se `prisma/dev.db` tiver sido alterado exclusivamente pela execução dos testes, restaurá-lo ao estado anterior antes do commit.

8. **Itens Proibidos no Commit**: Não incluir:
   - logs (ex: *.log);
   - sedXXXXX;
   - bancos de dados locais (`prisma/dev.db`);
   - arquivos temporários;
   - artefatos acidentais.

9. **Staging**: Adicionar ao staging SOMENTE os arquivos pertencentes à tarefa.
   - Preferir: `git add <arquivos específicos>`
   - NÃO usar `git add .` indiscriminadamente quando existirem arquivos não relacionados.

10. **Commit**: Criar UM único commit ao final da tarefa, com mensagem curta e descritiva da alteração realizada.

11. **Push**: Após commit bem-sucedido, executar automaticamente:
    `git push origin main`

12. **Validação Final**: Após o push, executar `git status` e confirmar que:
    - main está sincronizada com origin/main;
    - working tree está limpo.

13. **Tarefas de Auditoria/Análise**: Para tarefas exclusivamente de auditoria, inspeção, análise, execução de testes ou geração de relatório (se nenhum arquivo precisar ser alterado):
    - NÃO criar commit vazio.
    - NÃO fazer push desnecessário.
    - Apenas confirmar que `git status` está limpo.

14. **Comandos Perigosos Proibidos**: NUNCA executar automaticamente:
    - `git push --force`
    - `git push -f`
    - `git reset --hard`
    - `git clean -fd`
    - `git checkout -- .`
    - `git restore .`
    - `git rebase`
    - `git merge`
    - `git branch -D`

15. **Ações Proibidas**: NÃO:
    - alterar o remote;
    - alterar a branch oficial;
    - reescrever histórico;
    - apagar alterações desconhecidas;
    - resolver conflitos de forma destrutiva;
    - criar nova branch sem solicitação explícita;
    - fazer commit/push se testes obrigatórios falharem.

16. **Em caso de falha**: Se:
    - testes obrigatórios falharem;
    - push falhar;
    - origin/main tiver divergido;
    - surgir conflito;
    - existirem alterações desconhecidas;
    - o diff contiver arquivos não relacionados;
    PARAR. Não tentar resolver destrutivamente. Informar o usuário exatamente sobre o problema.

17. **Relatório Final**: Ao final de qualquer tarefa que tenha alterado o projeto, informar o resumo abaixo:
    Arquivos alterados: [...]
    Validações executadas: [...]
    Commit criado: <SHA curto>
    Mensagem do commit: <mensagem>
    Push para origin/main: SUCESSO/FALHA
    Working tree final limpo: SIM/NÃO

    Em caso de sucesso, finalizar obrigatoriamente com:
    GITHUB SINCRONIZADO AUTOMATICAMENTE.
