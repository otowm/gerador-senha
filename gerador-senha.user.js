// ==UserScript==
// @name         Gerador de Senha — Urgência e Emergência
// @namespace    om30.guaruja.gerador
// @version      1.1.0
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
 * Configure só: URL + usuário/senha da gestão de filas + token do totem.
 * Unidade, filas e textos do cupom vêm de GET /api/v1/totens/{token}.
 * Escolha a fila uma vez (menu ou botão ▾) e sempre ela que sai.
 * Usuário/senha ficam guardados só no Tampermonkey deste computador.
 *
 * Impressão sem diálogo: abra o Chrome com --kiosk-printing e deixe a
 * térmica como impressora padrão (margens: nenhuma).
 */

(function () {
  'use strict';

  const LOG = (...a) => console.log('[gerador-senha]', ...a);

  // ------------------------------------------------------------ CONFIG
  // Só isto é configurado à mão. Unidade, filas, textos e imagem do cupom
  // vêm do servidor pelo token do totem (GET /api/v1/totens/{token}).
  const CAMPOS = [
    ['url', 'URL da gestão de filas (o "fila.url" do totem):', 'https://senhaguaruja.saudesimples.net'],
    ['usuario', 'Usuário da gestão de filas (o "fila.user" do totem):', ''],
    ['senha', 'Senha da gestão de filas (o "fila.password" do totem):', ''],
    ['token', 'Token / ID do totem (o "totem.token"):', ''],
    ['botao', 'Texto do botão:', 'Gerar senha'],
    ['vias', 'Quantas vias imprimir (1 ou 2):', '1'],
  ];
  const PADRAO = Object.fromEntries(CAMPOS.map(([k, , p]) => [k, p]));
  const cfg = k => String(GM_getValue('gs_' + k, PADRAO[k]) ?? '');
  const salvar = (k, v) => GM_setValue('gs_' + k, v);

  function configurar(chaves) {
    for (const [k, rotulo] of CAMPOS) {
      if (chaves && !chaves.includes(k)) continue;
      const atual = k === 'senha' && cfg(k) ? '********' : cfg(k);
      const v = prompt(rotulo, atual);
      if (v === null) return false;
      if (k === 'senha' && v === '********') continue;
      salvar(k, v.trim());
    }
    return true;
  }

  const faltando = () => ['url', 'usuario', 'senha', 'token'].filter(k => !cfg(k).trim());
  // Fila escolhida: { tipo_id, categoria } — sempre essa que sai.
  const escolha = () => GM_getValue('gs_escolha', null);

  GM_registerMenuCommand('Configurar conexão e token do totem', () => {
    if (configurar(['url', 'usuario', 'senha', 'token'])) { GM_setValue('gs_escolha', null); location.reload(); }
  });
  GM_registerMenuCommand('Escolher fila da senha', () => abrirSeletor());
  GM_registerMenuCommand('Texto do botão / vias', () => { if (configurar(['botao', 'vias'])) location.reload(); });
  GM_registerMenuCommand('Imprimir cupom de teste', async () => {
    try {
      const f = await filaAtual();
      imprimirCupom({ senha: 'TESTE01', ...f });
    } catch (e) { alert('Gerador de senha: ' + e.message); }
  });

  // ------------------------------------------------------------ API
  const base = () => cfg('url').trim().replace(/\/+$/, '');
  const auth = () => 'Basic ' + btoa(unescape(encodeURIComponent(`${cfg('usuario')}:${cfg('senha')}`)));

  function req(method, caminho, corpo) {
    const falta = faltando();
    if (falta.length) return Promise.reject(new Error(`configure no Tampermonkey: ${falta.join(', ')}`));
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method,
        url: base() + caminho,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: auth() },
        data: corpo ? JSON.stringify(corpo) : undefined,
        timeout: 15000,
        anonymous: true,
        onload: r => {
          let json = null;
          try { json = JSON.parse(r.responseText || 'null'); } catch (_) { /* não-JSON */ }
          LOG(method, caminho, r.status, json || r.responseText);
          if (r.status >= 200 && r.status < 300) return resolve(json);
          if (r.status === 401 || r.status === 403) return reject(new Error('usuário/senha da gestão de filas recusados'));
          if (r.status === 404) return reject(new Error('não encontrado (confira o token do totem)'));
          const msg = json && (json.message || json.error || json.errors || json.detail);
          reject(new Error(msg ? JSON.stringify(msg) : `servidor respondeu HTTP ${r.status}`));
        },
        onerror: () => reject(new Error('gestão de filas inacessível')),
        ontimeout: () => reject(new Error('o servidor não respondeu a tempo')),
      });
    });
  }

  // Configuração do totem (unidade + categorias). Guardada para funcionar
  // mesmo se a consulta falhar num momento.
  let totemCache = null;
  async function carregarTotem() {
    try {
      const dados = await req('GET', '/api/v1/totens/' + encodeURIComponent(cfg('token').trim()));
      if (!dados || !dados.unidade_saude) throw new Error('resposta do totem sem unidade_saude');
      totemCache = dados;
      GM_setValue('gs_totem_cache', dados);
      return dados;
    } catch (e) {
      const salvo = totemCache || GM_getValue('gs_totem_cache', null);
      if (salvo) { LOG('usando configuração do totem em cache:', e.message); return salvo; }
      throw e;
    }
  }

  // Lista "categoria → tipo de atendimento" (o que o totem mostra na tela).
  function opcoes(totem) {
    const lista = [];
    const visitar = cats => (Array.isArray(cats) ? cats : []).forEach(c => {
      if (!c) return;
      (c.tipos_atendimento || []).forEach(t => lista.push({ categoria: c, tipo: t }));
      if (Array.isArray(c.categorias)) visitar(c.categorias);
    });
    visitar(totem.categorias);
    return lista;
  }

  // Dados da fila escolhida, sempre atualizados pelo servidor.
  async function filaAtual() {
    const esc = escolha();
    if (!esc) throw new Error('escolha a fila no menu do Tampermonkey');
    const totem = await carregarTotem();
    const achou = opcoes(totem).find(o => String(o.tipo.id) === String(esc.tipo_id));
    const cat = achou ? achou.categoria : esc.categoria || {};
    if (!achou) LOG('tipo', esc.tipo_id, 'não está mais no totem; usando dados salvos');
    return {
      unidadeId: totem.unidade_saude.id,
      unidadeNome: totem.unidade_saude.nome,
      tipoId: esc.tipo_id,
      fila: cat.nome || '',
      cabecalho: cat.texto_cabecalho || '',
      rodape: cat.texto_rodape || '',
      imagem: cat.imagem_rodape || '',
    };
  }

  async function gerarSenha() {
    const f = await filaAtual();
    const r = await req('POST', '/api/v1/senhas', { unidade_saude: f.unidadeId, tipo_atendimento: f.tipoId });
    if (!r || r.senha == null) throw new Error('o servidor não devolveu a senha');
    return { ...f, senha: String(r.senha).trim() };
  }

  // ------------------------------------------------------------ SELETOR
  async function abrirSeletor() {
    let totem;
    try { totem = await carregarTotem(); } catch (e) { alert('Gerador de senha: ' + e.message); return; }
    const lista = opcoes(totem);
    const atual = escolha();
    document.getElementById('gs-seletor')?.remove();
    const fundo = document.createElement('div');
    fundo.id = 'gs-seletor';
    fundo.innerHTML = `
      <div class="gs-modal" role="dialog" aria-modal="true" aria-labelledby="gs-titulo">
        <h4 id="gs-titulo">Fila da senha</h4>
        <p>${esc(totem.unidade_saude.nome)}</p>
        ${lista.length ? `<select class="form-control" size="${Math.min(12, lista.length)}">
          ${lista.map((o, i) => `<option value="${i}" ${atual && String(atual.tipo_id) === String(o.tipo.id) ? 'selected' : ''}>
            ${esc(o.categoria.nome)} — ${esc(o.tipo.nome || o.tipo.descricao || o.tipo.id)} (tipo ${esc(o.tipo.id)})</option>`).join('')}
        </select>` : '<p class="gs-erro">Este totem não tem filas cadastradas.</p>'}
        <div class="gs-acoes">
          <button type="button" class="btn btn-default gs-cancelar">Cancelar</button>
          <button type="button" class="btn btn-primary gs-salvar" ${lista.length ? '' : 'disabled'}>Salvar</button>
        </div>
      </div>`;
    document.body.appendChild(fundo);
    const sel = fundo.querySelector('select');
    if (sel && sel.selectedIndex < 0) sel.selectedIndex = 0;
    sel?.focus();
    const fechar = () => fundo.remove();
    fundo.querySelector('.gs-cancelar').onclick = fechar;
    fundo.addEventListener('keydown', e => { if (e.key === 'Escape') fechar(); });
    fundo.querySelector('.gs-salvar').onclick = () => {
      const o = lista[Number(sel.value)];
      const { tipos_atendimento, categorias, ...cat } = o.categoria;
      GM_setValue('gs_escolha', { tipo_id: o.tipo.id, categoria: cat });
      fechar();
      atualizarRotulo();
    };
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
  function htmlCupom(d) {
    const { senha } = d;
    const imagem = String(d.imagem || '').trim();
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
          <div class="health-unit">${esc(trunc(String(d.unidadeNome || '').toUpperCase(), 22))}</div>
          <div class="health-unit-subtitle">${nl2br(d.cabecalho)}</div>
          <div class="number">${esc(String(senha).toUpperCase())}</div>
          <div class="queue">${esc(trunc(String(d.fila || '').toUpperCase(), 25))}</div>
          <div class="instructions">
            A PREVISÃO DE ATENDIMENTO PODE SER ALTERADA SEM AVISO PRÉVIO.
            <br/>EMISSÃO DESTA SENHA: ${esc(agora())}
          </div>
          <div class="instructions-footer">${nl2br(d.rodape)}</div>
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
    .gs-box .gs-trocar { padding: 2px 8px; font-size: 12px; max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    #gs-seletor { position: fixed; inset: 0; z-index: 100000; background: rgba(0,0,0,.45);
      display: flex; align-items: center; justify-content: center; padding: 16px; }
    #gs-seletor .gs-modal { background: #fff; border-radius: 6px; padding: 16px; width: 520px; max-width: 100%; }
    #gs-seletor select { height: auto; margin: 8px 0; }
    #gs-seletor .gs-acoes { display: flex; justify-content: flex-end; gap: 8px; }
    #gs-seletor .gs-erro { color: #c62828; }
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
      <button type="button" class="btn btn-default btn-outline gs-trocar" title="Trocar fila"><span class="gs-fila"></span> ▾</button>
      <span class="gs-status" role="status" aria-live="polite"></span>`;
    const btn = box.querySelector('.gs-btn');
    const reimp = box.querySelector('.gs-reimp');
    const status = box.querySelector('.gs-status');
    const mostrar = (m, t = '') => { status.textContent = m; status.className = `gs-status ${t}`; };

    if (faltando().length) mostrar('Configure no menu do Tampermonkey', 'erro');
    else if (!escolha()) mostrar('Escolha a fila no botão ▾', 'erro');

    btn.addEventListener('click', async () => {
      if (ocupado) return;
      ocupado = true;
      btn.disabled = true;
      mostrar('Gerando…');
      try {
        ultima = await gerarSenha();
        const { senha } = ultima;
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
    box.querySelector('.gs-trocar').addEventListener('click', abrirSeletor);
    reimp.addEventListener('click', () => { if (ultima) imprimirCupom(ultima); });
    setTimeout(atualizarRotulo);
    return box;
  }

  function atualizarRotulo() {
    const el = document.querySelector('#gs-gerador .gs-fila');
    if (!el) return;
    const e = escolha();
    el.textContent = e ? (e.categoria && e.categoria.nome) || `tipo ${e.tipo_id}` : 'escolher fila';
    const st = document.querySelector('#gs-gerador .gs-status');
    if (e && st && /Escolha a fila/.test(st.textContent)) { st.textContent = ''; st.className = 'gs-status'; }
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
