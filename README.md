# Gerador de Senhas — Urgência e Emergência

Userscript (Tampermonkey) que gera senhas no Painel oficial e imprime o cupom
no mesmo modelo do totem (Senha Simples Totem 3.6.1, `static/offline.html`,
73 x 100 mm).

## Como gera

O script chama `POST /oficial/gerar-senha` no servidor central do Painel de
Senhas (porta 8777). O servidor faz a mesma chamada do totem:
`POST /api/v1/senhas` com `unidade_saude` e `tipo_atendimento`, autenticada
com o usuário do gerador (`SENHAS_GERADOR_LOGIN`/`SENHAS_GERADOR_PASSWORD`
e `SENHAS_UNIDADE_SAUDE_ID` no `.env` do servidor). Nenhuma credencial fica
no userscript.

## Instalação

1. Instale `gerador-senha.user.js` no Tampermonkey.
2. No menu do Tampermonkey (em qualquer página do Saúde Simples):
   - **Configurar servidor central**: host/IP do servidor (padrão `localhost`).
     Se não for `localhost`, o Tampermonkey pede permissão na primeira geração.
   - **Configurar filas (botões)**: `NOME = tipo_atendimento`, separadas por `;`.
     O `tipo_atendimento` é o mesmo id usado pelo totem para a fila.
   - **Configurar cupom**: nome da unidade, textos de cabeçalho/rodapé, imagem.
   - **Ativar gerador neste computador**.
3. Use **Imprimir cupom de teste** para conferir a impressora.

## Impressão sem diálogo

O totem imprimia direto pelo SumatraPDF. No navegador, para não aparecer a
janela de impressão, abra o Chrome com `--kiosk-printing` e deixe a térmica
como impressora padrão (papel 73/80 mm, margens nenhuma).
