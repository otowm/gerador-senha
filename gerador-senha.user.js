// ==UserScript==
// @name         Gerador de Senha — Urgência e Emergência
// @namespace    om30.guaruja.gerador
// @version      1.0.0
// @description  Botão na tela de Atendimentos da Urgência/Emergência que gera uma senha (fila fixa configurada) e imprime o cupom na térmica, no mesmo modelo do totem.
// @author       Otowm
// @match        https://v3guaruja.saudesimples.net/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @connect      senhaguaruja.saudesimples.net
// @connect      *
// @run-at       document-idle
// ==/UserScript==

/*
 * Como funciona
 * -------------
 * Faz exatamente o que o totem (Senha Simples Totem 3.6.1) faz:
 *   POST {servidor}/api/v1/senhas
 *   Authorization: Basic base64(usuario:senha)
 *   { unidade_saude: <id>, tipo_atendimento: <id> }
 * e imprime o cupom com o layout de static/offline.html (73 x 100 mm).
 *
 * A fila (tipo_atendimento) é FIXA: configure uma vez no menu do
 * Tampermonkey e o botão sempre gera senha nela.
 * Usuário/senha ficam guardados só no Tampermonkey deste computador.
 *
 * Impressão sem diálogo: abra o Chrome com --kiosk-printing e deixe a
 * térmica como impressora padrão (margens: nenhuma).
 */

(function () {
  'use strict';

  const LOG = (...a) => console.log('[gerador-senha]', ...a);

  // ------------------------------------------------------------ CONFIG
  const CAMPOS = [
    // chave, rótulo, padrão
    ['url', 'URL do servidor Senha Simples (o mesmo "fila.url" do totem):', 'https://senhaguaruja.saudesimples.net'],
    ['usuario', 'Usuário da API (o mesmo "fila.user" do totem):', ''],
    ['senha', 'Senha da API (o mesmo "fila.password" do totem):', ''],
    ['unidade_id', 'ID da unidade de saúde no Senha Simples (unidade_saude):', ''],
    ['tipo_id', 'ID do tipo de atendimento (tipo_atendimento) — a fila fixa:', ''],
    ['fila_nome', 'Nome da fila impresso no cupom:', 'URGÊNCIA E EMERGÊNCIA'],
    ['botao', 'Texto do botão:', 'Gerar senha'],
    ['unidade_nome', 'Nome da unidade (topo do cupom):', 'PRONTO SOCORRO'],
    ['cabecalho', 'Texto abaixo do nome (opcional, use \\n para quebrar linha):', ''],
    ['rodape', 'Texto do rodapé (opcional, use \\n para quebrar linha):', ''],
    ['imagem', 'URL da imagem do rodapé (opcional):', ''],
    ['vias', 'Quantas vias imprimir (1 ou 2):', '1'],
  ];
  const PADRAO = Object.fromEntries(CAMPOS.map(([k, , p]) => [k, p]));
  const cfg = k => String(GM_getValue('gs_' + k, PADRAO[k]) ?? '');
  const salvar = (k, v) => GM_setValue('gs_' + k, v);

  function configurar(chaves) {
    for (const [k, rotulo] of CAMPOS) {
      if (chaves && !chaves.includes(k)) continue;
      const atual = k === 'senha' && cfg(k) ? '********' : cfg(k).replace(/\n/g, '\\n');
      const v = prompt(rotulo, atual);
      if (v === null) return false;
      if (k === 'senha' && v === '********') continue;
      salvar(k, v.trim().replace(/\\n/g, '\n'));
    }
    return true;
  }

  const faltando = () => ['url', 'usuario', 'senha', 'unidade_id', 'tipo_id'].filter(k => !cfg(k).trim());

  GM_registerMenuCommand('Configurar tudo', () => { if (configurar()) location.reload(); });
  GM_registerMenuCommand('Configurar conexão e fila', () => {
    if (configurar(['url', 'usuario', 'senha', 'unidade_id', 'tipo_id', 'fila_nome', 'botao'])) location.reload();
  });
  GM_registerMenuCommand('Configurar cupom', () => {
    configurar(['unidade_nome', 'cabecalho', 'rodape', 'imagem', 'vias']);
  });
  GM_registerMenuCommand('Imprimir cupom de teste', () => imprimirCupom({ senha: 'TESTE01' }));

  // ------------------------------------------------------------ API
  function base64Utf8(s) {
    return btoa(unescape(encodeURIComponent(s)));
  }

  function gerarSenha() {
    const falta = faltando();
    if (falta.length) return Promise.reject(new Error(`configure no Tampermonkey: ${falta.join(', ')}`));
    const url = cfg('url').trim().replace(/\/+$/, '') + '/api/v1/senhas';
    const corpo = {
      unidade_saude: Number(cfg('unidade_id')) || cfg('unidade_id'),
      tipo_atendimento: Number(cfg('tipo_id')) || cfg('tipo_id'),
    };
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'POST',
        url,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: 'Basic ' + base64Utf8(`${cfg('usuario')}:${cfg('senha')}`),
        },
        data: JSON.stringify(corpo),
        timeout: 15000,
        anonymous: true,
        onload: r => {
          let json = null;
          try { json = JSON.parse(r.responseText || 'null'); } catch (_) { /* não-JSON */ }
          LOG('resposta', r.status, json || r.responseText);
          if (r.status >= 200 && r.status < 300 && json && json.senha != null) {
            return resolve(String(json.senha).trim());
          }
          if (r.status === 401 || r.status === 403) return reject(new Error('usuário/senha da API recusados'));
          const msg = json && (json.message || json.error || json.errors || json.detail);
          reject(new Error(msg ? JSON.stringify(msg) : `servidor respondeu HTTP ${r.status}`));
        },
        onerror: () => reject(new Error('servidor Senha Simples inacessível')),
        ontimeout: () => reject(new Error('o servidor não respondeu a tempo')),
      });
    });
  }

  // ------------------------------------------------------------ CUPOM
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const trunc = (v, n) => { const s = String(v || ''); return s.length > n ? `${s.slice(0, n - 3)}...` : s; };
  const nl2br = v => esc(v).replace(/\n/g, '<br/>');

  function agora() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  // Mesmo layout de static/offline.html do totem.
  function htmlCupom({ senha }) {
    const imagem = cfg('imagem').trim();
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
          <div class="health-unit">${esc(trunc(cfg('unidade_nome').toUpperCase(), 22))}</div>
          <div class="health-unit-subtitle">${nl2br(cfg('cabecalho'))}</div>
          <div class="number">${esc(String(senha).toUpperCase())}</div>
          <div class="queue">${esc(trunc(cfg('fila_nome').toUpperCase(), 25))}</div>
          <div class="instructions">
            A PREVISÃO DE ATENDIMENTO PODE SER ALTERADA SEM AVISO PRÉVIO.
            <br/>EMISSÃO DESTA SENHA: ${esc(agora())}
          </div>
          <div class="instructions-footer">${nl2br(cfg('rodape'))}</div>
        </div>
        ${imagem ? `<div class="footer"><img class="logo" src="${esc(imagem)}"/></div>` : ''}
      </div>
    </body></html>`;
  }

  // Senha sempre numa linha: reduz a fonte até caber (como o totem).
  function ajustarSenha(doc) {
    doc.querySelectorAll('.number').forEach(el => {
      const r = doc.createRange();
      r.selectNodeContents(el);
      let t = 60;
      while (r.getBoundingClientRect().width > el.clientWidth && t > 24) {
        t -= 2;
        el.style.fontSize = `${t}px`;
      }
    });
  }

  function imprimirCupom(dados) {
    return new Promise(resolve => {
      const vias = Math.max(1, Math.min(2, Number(cfg('vias')) || 1));
      const iframe = document.createElement('iframe');
      iframe.setAttribute('aria-hidden', 'true');
      iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:73mm;height:100mm;border:0;opacity:0;pointer-events:none;';
      document.body.appendChild(iframe);
      const doc = iframe.contentDocument;
      doc.open();
      doc.write(htmlCupom(dados));
      doc.close();
      if (vias === 2) {
        const pg = doc.querySelector('.page');
        pg.style.pageBreakAfter = 'always';
        doc.body.appendChild(pg.cloneNode(true)).style.pageBreakAfter = 'auto';
      }
      let feito = false;
      const imprimir = () => {
        if (feito) return;
        feito = true;
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

  // ------------------------------------------------------------ BOTÃO
  GM_addStyle(`
    .gs-box { display: inline-flex; align-items: center; gap: 8px; margin-left: 12px; flex-wrap: wrap; }
    .gs-box .gs-btn { font-weight: bold; white-space: nowrap; }
    .gs-box .gs-btn:disabled { cursor: wait; }
    .gs-box .gs-status { font-size: 13px; }
    .gs-box .gs-status.erro { color: #c62828; font-weight: bold; }
    .gs-box .gs-status.ok { color: #2e7d32; font-weight: bold; }
    .gs-box .gs-reimp { padding: 2px 8px; font-size: 12px; }
    .gs-flutuante { position: fixed; right: 16px; bottom: 16px; z-index: 99999; background: #fff;
      padding: 8px; border-radius: 6px; box-shadow: 0 2px 10px rgba(0,0,0,.25); margin: 0; }
  `);

  let ultima = null;
  let ocupado = false;

  function criarBox() {
    const box = document.createElement('div');
    box.className = 'gs-box';
    box.id = 'gs-gerador';
    box.innerHTML = `
      <button type="button" class="btn btn-primary gs-btn">
        <i class="icon zmdi zmdi-ticket-star" aria-hidden="true"></i> ${esc(cfg('botao') || 'Gerar senha')}
      </button>
      <button type="button" class="btn btn-default btn-outline gs-reimp" hidden>Reimprimir</button>
      <span class="gs-status" role="status" aria-live="polite"></span>`;
    const btn = box.querySelector('.gs-btn');
    const reimp = box.querySelector('.gs-reimp');
    const status = box.querySelector('.gs-status');
    const mostrar = (m, t = '') => { status.textContent = m; status.className = `gs-status ${t}`; };

    if (faltando().length) mostrar('Configure no menu do Tampermonkey', 'erro');

    btn.addEventListener('click', async () => {
      if (ocupado) return;
      ocupado = true;
      btn.disabled = true;
      mostrar('Gerando…');
      try {
        const senha = await gerarSenha();
        ultima = { senha };
        mostrar(`Senha ${senha} — imprimindo…`, 'ok');
        await imprimirCupom(ultima);
        mostrar(`Senha ${senha}`, 'ok');
        reimp.hidden = false;
      } catch (e) {
        LOG('falha', e);
        mostrar(`Erro: ${e.message}`, 'erro');
      } finally {
        ocupado = false;
        btn.disabled = false;
      }
    });
    reimp.addEventListener('click', () => { if (ultima) imprimirCupom(ultima); });
    return box;
  }

  // A página é um SPA (Nuxt/Vue): o cabeçalho pode ser recriado, então
  // reinserimos o botão sempre que ele sumir.
  let box = null;
  function garantir() {
    if (!/\/urgencia_emergencia\/atendimentos/.test(location.pathname)) {
      if (box) box.remove();
      return;
    }
    if (box && document.body.contains(box) && !box.classList.contains('gs-flutuante')) return;
    box = box || criarBox();
    const alvo = document.querySelector('.page-header .row') || document.querySelector('.page-header');
    if (alvo) {
      box.classList.remove('gs-flutuante');
      alvo.appendChild(box);
    } else if (!document.body.contains(box)) {
      box.classList.add('gs-flutuante');
      document.body.appendChild(box);
    }
  }

  garantir();
  let pendente = false;
  new MutationObserver(() => {
    if (pendente) return;
    pendente = true;
    requestAnimationFrame(() => { pendente = false; garantir(); });
  }).observe(document.body, { childList: true, subtree: true });
})();
