# Exemplos Oficiais de Boletins de Urna (QRBU) — Segundo Turno Eleições 2026

**Origem Oficial:** Tribunal Superior Eleitoral (TSE)  
**Fonte:** https://www.tse.jus.br/eleicoes/eleicoes-2026-content/arquivos/exemplos-de-boletins-de-urna-com-qr-code  
**Arquivo Fonte:** `exemplos-de-boletins-de-urna-com-qr-code.zip`  
**Data de Obtenção:** 23/10/2026  
**Natureza dos Dados:** Dados oficiais simulados fornecidos pelo TSE (`FASE:S`) para validação técnica da estrutura dos QR Codes do Segundo Turno.

---

## 1. Estrutura de Arquivos

Os arquivos preservam integralmente os nomes e conteúdos binários/PDF originais distribuídos pelo Tribunal Superior Eleitoral:

| Cenário Eleitoral | Arquivos | Tamanho | SHA-256 |
| :--- | :--- | :--- | :--- |
| **BU_T2_VOTA_Presidente** | `Pres-T2_s02202ac0139200090013-imgbu.dat`<br>`Pres-T2_s02202ac0139200090013-imgbu.pdf` | 5.829 bytes<br>43.941 bytes | `083dbcf02d00c3e8f63f1d1e8dc3f8dfba7cc342ee747fbca92d29b30e79311c`<br>`8467c318e7bbf26cf0c22a251b27f883518ca3ea2dec330e671819b1dcf3ef4f` |
| **BU_T2_VOTA_Presidente_Governador** | `PresGov-T2_s02200ac0139200090013-imgbu.dat`<br>`PresGov-T2_s02200ac0139200090013-imgbu.pdf` | 6.895 bytes<br>44.905 bytes | `ce3131508af46efa6dbe449339fa0dd868a5281803446d4364600887cf93477f`<br>`3f418e131d3682413923926bc434e7d5463254a6fa1d4ad84e622b129ea55e9b` |
| **BU_T2_VOTA_Presidente_Governador_ConsultaPopular** | `PresGovConMunic-T2_s02120ac0139200090013-imgbu.dat`<br>`PresGovConMunic-T2_s02120ac0139200090013-imgbu.pdf` | 7.683 bytes<br>45.816 bytes | `4db34a3feda8fda1d0243f1d4d4b2eda5eaa8c30f326e86585d33247cc16ab6a`<br>`a14f97d6a82d889a5c8f4c0d747c921b62753255862c26ef0883fc48705ddd7e` |
| **BU_T2_VOTA_Presidente_Governador_Prefeito** | `PresGovPrefeito-T2_s18153sp6665603020018-imgbu.dat`<br>`PresGovPrefeito-T2_s18153sp6665603020018-imgbu.pdf` | 7.605 bytes<br>45.622 bytes | `9f3b2f9765d9a1c85fe48f5a5a7999bfb0841676711725c56ddf16b69c8d5012`<br>`ade2c7660bf3b6ff0be5d62c9e350e389d72045a997bf30cf6ca1143e5b0a19a` |

---

## 2. Regra de Negócio e Segurança em Produção

- Todos os exemplos do pacote TSE contêm `FASE:S` (Simulação).
- **Regra de Produção:** A aplicação em ambiente real (`Production`) rejeita rigorosamente qualquer boletim com `FASE:S` (erro HTTP 400 `SIMULATED_QRBU_REJECTED` / `FASE_NAO_OFICIAL`), admitindo exclusivamente `FASE:O` (Oficial).
- Esses arquivos são utilizados exclusivamente para testes automatizados de especificação, integridade de formato e decodificação estrutural do Segundo Turno.
