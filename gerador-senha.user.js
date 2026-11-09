// ==UserScript==
// @name         Gerador de Senhas — Urgência e Emergência
// @namespace    om30.guaruja.gerador
// @version      0.1.0
// @description  Gera senhas no Painel oficial (pelo servidor central) e imprime o cupom igual ao do totem.
// @author       Otowm
// @match        https://guaruja.saudesimples.net/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @connect      localhost
// @run-at       document-idle
// ==/UserScript==

/*
 * Como funciona
 * -------------
 * - A senha é criada pelo servidor central do Painel de Senhas
 *   (POST /oficial/gerar-senha), que faz a mesma chamada do totem:
 *   POST /api/v1/senhas com unidade_saude + tipo_atendimento.
 *   A credencial do gerador fica no .env do servidor, nunca neste arquivo.
 * - O cupom repete o modelo "offline.html" do totem (73 x 100 mm).
 * - Nada aparece até ativar o gerador neste computador pelo menu do
 *   Tampermonkey. Os botões (nome da fila + tipo_atendimento) também são
 *   configurados pelo menu.
 *
 * Impressão sem diálogo: abra o Chrome do computador com
 *   --kiosk-printing
 * e defina a impressora térmica como padrão. Sem isso o Chrome mostra a
 * janela de impressão a cada senha.
 */

(function () {
  'use strict';

  const LOG = (...a) => console.log('[gerador-senha]', ...a);

  // ------------------------------------------------------------ CONFIG
  const KEY = {
    api: 'gerador_api_host_v1',
    ativo: 'gerador_ativo_v1',
    filas: 'gerador_filas_v1',
    unidade: 'gerador_unidade_nome_v1',
    cabecalho: 'gerador_texto_cabecalho_v1',
    rodape: 'gerador_texto_rodape_v1',
    imagem: 'gerador_imagem_rodape_v1',
    vias: 'gerador_vias_v1',
  };

  const get = (k, padrao) => GM_getValue(k, padrao);
  const apiHost = String(get(KEY.api, 'localhost')).trim();
  const API = (/^https?:\/\//i.test(apiHost) ? apiHost : `http://${apiHost}:8777`)
    .replace(/\/$/, '');

  function filas() {
    const lista = get(KEY.filas, []);
    return Array.isArray(lista) ? lista.filter(f => f && f.id && f.nome) : [];
  }

  // ------------------------------------------------------------ MENU
  function perguntar(rotulo, chave, padrao = '') {
    const valor = prompt(rotulo, get(chave, padrao));
    if (valor === null) return false;
    GM_setValue(chave, valor.trim());
    return true;
  }

  GM_registerMenuCommand(
    get(KEY.ativo, false) ? 'Desativar gerador neste computador' : 'Ativar gerador neste computador',
    () => { GM_setValue(KEY.ativo, !get(KEY.ativo, false)); location.reload(); }
  );
  GM_registerMenuCommand('Configurar filas (botões)', configurarFilas);
  GM_registerMenuCommand('Configurar cupom', () => {
    if (!perguntar('Nome da unidade (topo do cupom):', KEY.unidade)) return;
    if (!perguntar('Texto abaixo do nome (opcional):', KEY.cabecalho)) return;
    if (!perguntar('Texto do rodapé (opcional):', KEY.rodape)) return;
    if (!perguntar('URL da imagem do rodapé (opcional):', KEY.imagem)) return;
    perguntar('Quantas vias imprimir (1 ou 2):', KEY.vias, '1');
    location.reload();
  });
  GM_registerMenuCommand('Configurar servidor central', () => {
    if (perguntar('Hostname, IP ou URL do servidor central:', KEY.api, 'localhost')) location.reload();
  });
  GM_registerMenuCommand('Imprimir cupom de teste', () => {
    imprimirCupom({ senha: 'UE0000', fila: filas()[0]?.nome || 'URGÊNCIA E EMERGÊNCIA' });
  });

  function configurarFilas() {
    const atual = filas().map(f => `${f.nome} = ${f.id}`).join('\n');
    const texto = prompt(
      'Uma fila por linha, no formato:\n  NOME DA FILA = tipo_atendimento\n' +
      'Separe várias filas com ";". Ex.: URGÊNCIA - COMUM = 123; URGÊNCIA - PREFERENCIAL = 124',
      atual.replace(/\n/g, '; ')
    );
    if (texto === null) return;
    const lista = texto.split(/[;\n]/).map(l => l.trim()).filter(Boolean).map(l => {
      const i = l.lastIndexOf('=');
      return i < 0 ? null : { nome: l.slice(0, i).trim(), id: l.slice(i + 1).trim() };
    }).filter(f => f && f.nome && f.id);
    GM_setValue(KEY.filas, lista);
    alert(`${lista.length} fila(s) salva(s).`);
    location.reload();
  }

  if (!get(KEY.ativo, false)) return;

  // ------------------------------------------------------------ API
  function gerarSenha(tipoId) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'POST',
        url: `${API}/oficial/gerar-senha`,
        headers: { 'Content-Type': 'application/json' },
        data: JSON.stringify({ tipo_atendimento: String(tipoId) }),
        timeout: 30000,
        onload: r => {
          let corpo = null;
          try { corpo = JSON.parse(r.responseText || 'null'); } catch (_) { /* texto */ }
          if (r.status >= 200 && r.status < 300 && corpo?.senha) return resolve(String(corpo.senha).trim());
          reject(new Error(corpo?.detail || `servidor respondeu HTTP ${r.status}`));
        },
        onerror: () => reject(new Error('servidor central inacessível')),
        ontimeout: () => reject(new Error('o servidor central não respondeu a tempo')),
      });
    });
  }

  // ------------------------------------------------------------ CUPOM
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const trunc = (v, n) => { const s = String(v || ''); return s.length > n ? `${s.slice(0, n - 3)}...` : s; };
  const nl2br = v => esc(v).replace(/\n/g, '<br/>');

  function agoraFormatado() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  // Mesmo layout de static/offline.html do totem (Senha Simples Totem 3.6.1).
  function htmlCupom({ senha, fila }) {
    const imagem = String(get(KEY.imagem, '')).trim();
    return `<!doctype html><html><head><meta charset="utf-8"><title>SENHA</title><style>
      @page { size: 73mm 100mm; margin: 0; }
      html, body { margin: 0; padding: 0; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
        font-weight: 500; font-size: 7px; background: white; -webkit-print-color-adjust: exact;
        print-color-adjust: exact; box-sizing: border-box; }
      .page { position: relative; height: 100mm; width: 73mm; display: block; background: white; overflow: hidden; }
      .container { border: 2px solid; min-height: 78%; }
      .health-unit { width: 100%; white-space: nowrap; font-size: 20px; font-weight: bold; text-align: center; }
      .health-unit-subtitle { width: 100%; text-align: center; font-size: 10px; margin-top: -4px; word-wrap: break-word; }
      .number { font-size: 60px; text-align: center; color: white; background-color: black; margin: 5px 10px; white-space: nowrap; }
      .queue { text-align: center; font-size: 15px; }
      .instructions { text-align: center; font-size: 11px; font-style: italic; margin: 5px 20px; }
      .instructions-footer { font-size: 12px; text-align: center; margin: 50px 15px 0 15px; word-wrap: break-word; }
      .logo { height: 60px; width: 100%; object-fit: contain; }
      .footer { margin-top: 5px; }
    </style></head><body>
      <div class="page">
        <div class="container">
          <div class="health-unit">${esc(trunc(String(get(KEY.unidade, '')).toUpperCase(), 22))}</div>
          <div class="health-unit-subtitle">${nl2br(get(KEY.cabecalho, ''))}</div>
          <div class="number">${esc(String(senha).toUpperCase())}</div>
          <div class="queue">${esc(trunc(String(fila).toUpperCase(), 25))}</div>
          <div class="instructions">
            A PREVISÃO DE ATENDIMENTO PODE SER ALTERADA SEM AVISO PRÉVIO.
            <br/>EMISSÃO DESTA SENHA: ${esc(agoraFormatado())}
          </div>
          <div class="instructions-footer">${nl2br(get(KEY.rodape, ''))}</div>
        </div>
        ${imagem ? `<div class="footer"><img class="logo" src="${esc(imagem)}"/></div>` : ''}
      </div>
    </body></html>`;
  }

  // A senha sempre numa linha só: reduz a fonte até caber (igual ao totem).
  function ajustarSenha(doc) {
    const el = doc.querySelector('.number');
    if (!el) return;
    const faixa = doc.createRange();
    faixa.selectNodeContents(el);
    let tamanho = 60;
    while (faixa.getBoundingClientRect().width > el.clientWidth && tamanho > 24) {
      tamanho -= 2;
      el.style.fontSize = `${tamanho}px`;
    }
  }

  function imprimirCupom(dados) {
    return new Promise(resolve => {
      const vias = Math.max(1, Math.min(2, Number(get(KEY.vias, '1')) || 1));
      const iframe = document.createElement('iframe');
      iframe.setAttribute('aria-hidden', 'true');
      iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:73mm;height:100mm;border:0;opacity:0;pointer-events:none;';
      document.body.appendChild(iframe);
      const doc = iframe.contentDocument;
      doc.open();
      doc.write(htmlCupom(dados));
      doc.close();
      if (vias === 2) {
        const pagina = doc.querySelector('.page');
        pagina.style.pageBreakAfter = 'always';
        doc.body.appendChild(pagina.cloneNode(true)).style.pageBreakAfter = 'auto';
      }
      const imprimir = () => {
        ajustarSenha(doc);
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
        setTimeout(() => { iframe.remove(); resolve(); }, 1500);
      };
      const img = doc.querySelector('img');
      if (img && !img.complete) {
        img.onload = img.onerror = imprimir;
        setTimeout(imprimir, 3000);
      } else {
        setTimeout(imprimir, 50);
      }
    });
  }

  // ------------------------------------------------------------ TELA
  GM_addStyle(`
    #gsu-painel { position: fixed; right: 16px; bottom: 16px; z-index: 99999; background: #fff;
      border: 2px solid #b71c1c; border-radius: 8px; box-shadow: 0 4px 16px rgba(0,0,0,.25);
      font: 14px Arial, sans-serif; min-width: 220px; }
    #gsu-painel header { background: #b71c1c; color: #fff; padding: 6px 10px; font-weight: bold;
      display: flex; justify-content: space-between; align-items: center; cursor: pointer; }
    #gsu-painel .corpo { padding: 8px; display: flex; flex-direction: column; gap: 6px; }
    #gsu-painel.recolhido .corpo { display: none; }
    #gsu-painel button.fila { padding: 10px; font-size: 15px; font-weight: bold; border: 0;
      border-radius: 6px; background: #d32f2f; color: #fff; cursor: pointer; }
    #gsu-painel button.fila:disabled { opacity: .5; cursor: wait; }
    #gsu-painel button.fila:focus-visible { outline: 3px solid #000; outline-offset: 2px; }
    #gsu-painel .status { font-size: 13px; min-height: 18px; }
    #gsu-painel .status.erro { color: #b71c1c; font-weight: bold; }
    #gsu-painel .status.ok { color: #1b5e20; font-weight: bold; }
    #gsu-painel .reimprimir { background: none; border: 1px solid #999; border-radius: 4px;
      padding: 4px; cursor: pointer; font-size: 12px; }
  `);

  let ultima = null;
  let ocupado = false;

  function montar() {
    if (document.getElementById('gsu-painel')) return;
    const painel = document.createElement('div');
    painel.id = 'gsu-painel';
    if (get('gerador_recolhido_v1', false)) painel.classList.add('recolhido');
    const lista = filas();
    painel.innerHTML = `
      <header title="Recolher/expandir"><span>Senha — Urgência</span><span aria-hidden="true">▾</span></header>
      <div class="corpo">
        ${lista.length ? lista.map((f, i) =>
          `<button type="button" class="fila" data-i="${i}">${esc(f.nome)}</button>`).join('')
          : '<div class="status erro">Configure as filas no menu do Tampermonkey.</div>'}
        <div class="status" role="status" aria-live="polite"></div>
        <button type="button" class="reimprimir" hidden>Reimprimir última</button>
      </div>`;
    document.body.appendChild(painel);

    const status = painel.querySelector('.status');
    const reimp = painel.querySelector('.reimprimir');
    const mostrar = (msg, tipo = '') => { status.textContent = msg; status.className = `status ${tipo}`; };

    painel.querySelector('header').addEventListener('click', () => {
      painel.classList.toggle('recolhido');
      GM_setValue('gerador_recolhido_v1', painel.classList.contains('recolhido'));
    });

    painel.querySelectorAll('button.fila').forEach(btn => btn.addEventListener('click', async () => {
      if (ocupado) return;
      const fila = lista[Number(btn.dataset.i)];
      ocupado = true;
      painel.querySelectorAll('button.fila').forEach(b => { b.disabled = true; });
      mostrar(`Gerando senha em ${fila.nome}…`);
      try {
        const senha = await gerarSenha(fila.id);
        ultima = { senha, fila: fila.nome };
        mostrar(`Senha ${senha} gerada. Imprimindo…`, 'ok');
        await imprimirCupom(ultima);
        mostrar(`Senha ${senha} — ${fila.nome}`, 'ok');
        reimp.hidden = false;
      } catch (e) {
        LOG('falha ao gerar', e.message);
        mostrar(`Não foi possível gerar: ${e.message}`, 'erro');
      } finally {
        ocupado = false;
        painel.querySelectorAll('button.fila').forEach(b => { b.disabled = false; });
      }
    }));

    reimp.addEventListener('click', () => { if (ultima) imprimirCupom(ultima); });
  }

  montar();
})();
