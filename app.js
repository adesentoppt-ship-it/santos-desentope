/* Santos Desentope — app */
(function () {
  'use strict';
  var IVA = 0.23, COMISSAO = 0.10;
  var ESTADOS = ['Agendado', 'Orçamento dado', 'Concluído', 'Concluído – cliente falta pagar', 'Orçamento recusado'];
  var CONCLUIDOS = ['Concluído', 'Concluído – cliente falta pagar'];
  var PAGAMENTOS = ['Dinheiro', 'MB Way', 'Transferência', 'Multibanco (TPA)', 'Outro'];
  var S = { pin: null, user: null, tecnicos: [], vapid: '', jobs: [], tab: 'agenda', filtro: 'proximos', meus: false, q: '', mes: null };

  var $ = function (s, el) { return (el || document).querySelector(s); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var eur = function (n) { return (Math.round((n || 0) * 100) / 100).toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'; };
  var num = function (v) { var n = parseFloat(String(v || '').replace(',', '.')); return isNaN(n) ? 0 : n; };
  function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { return null; } }

  /* ---------- API ---------- */
  function api(action, data) {
    var body = Object.assign({ action: action, pin: S.pin }, data || {});
    return fetch(self.API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); })
      .then(function (d) { if (!d.ok) throw new Error(d.erro || 'Erro'); return d; });
  }
  function toast(msg, ms) {
    var t = $('#toast'); t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.classList.add('hidden'); }, ms || 2600);
  }

  /* ---------- Datas, feriados, comissões ---------- */
  function hojeISO(d) { d = d || new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function parseISO(s) { var p = String(s).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function pascoa(y) {
    var a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3),
      h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451),
      mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(y, mes - 1, dia);
  }
  var feriadoCache = {};
  function feriados(y) {
    if (feriadoCache[y]) return feriadoCache[y];
    var f = ['01-01', '04-25', '05-01', '06-10', '08-15', '10-05', '11-01', '12-01', '12-08', '12-25'].map(function (md) { return y + '-' + md; });
    var p = pascoa(y);
    [-2, 0, 60].forEach(function (off) { var d = new Date(p); d.setDate(d.getDate() + off); f.push(hojeISO(d)); });
    return (feriadoCache[y] = f);
  }
  function foraDeHoras(job) {
    if (!job.data) return false;
    var d = parseISO(job.data), h = parseInt(String(job.hora || '12').split(':')[0], 10);
    if (d.getDay() === 0 || d.getDay() === 6) return true;
    if (feriados(d.getFullYear()).indexOf(job.data) >= 0) return true;
    return h >= 17 || h < 8;
  }
  function baseJob(j) {
    if (CONCLUIDOS.indexOf(j.estado) >= 0) return num(j.valor) + num(j.taxaDeslocacao);
    if (j.estado === 'Orçamento recusado') return num(j.taxaDeslocacao);
    return 0;
  }
  function ivaJob(j) { return j.querFatura ? baseJob(j) * IVA : 0; }
  function comissaoTec() { var o = {}; S.tecnicos.forEach(function (t) { o[t.nome] = t.comissao; }); return o; }
  // devolve {nome: valor} da comissão deste trabalho
  function comissoes(j) {
    var out = {}, elig = j.tecnicos.filter(function (t) { return comissaoTec()[t]; });
    if (!elig.length || !foraDeHoras(j)) return out;
    if (CONCLUIDOS.indexOf(j.estado) >= 0) {
      var c = Math.max(0, num(j.valor) + num(j.taxaDeslocacao) - num(j.custoMaterial)) * COMISSAO;
      elig.forEach(function (t) { out[t] = c; });
    } else if (j.estado === 'Orçamento recusado' && num(j.taxaDeslocacao) > 0) {
      var parte = num(j.taxaDeslocacao) / 2 / elig.length;
      elig.forEach(function (t) { out[t] = parte; });
    }
    return out;
  }
  function inicioSemana(d) { var x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); var w = (x.getDay() + 6) % 7; x.setDate(x.getDate() - w); return x; }
  function fmtCurta(d) { return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0'); }
  function nomeDia(iso) {
    var d = parseISO(iso), hoje = hojeISO(), am = new Date(); am.setDate(am.getDate() + 1);
    if (iso === hoje) return 'Hoje · ' + fmtCurta(d);
    if (iso === hojeISO(am)) return 'Amanhã · ' + fmtCurta(d);
    return d.toLocaleDateString('pt-PT', { weekday: 'long', day: '2-digit', month: 'long' });
  }
  function stClass(e) { return { 'Agendado': 'Agendado', 'Orçamento dado': 'Orc', 'Concluído': 'Conc', 'Concluído – cliente falta pagar': 'Falta', 'Orçamento recusado': 'Rec' }[e] || 'Agendado'; }

  /* ---------- Arranque / login ---------- */
  var pinBuf = '';
  function arrancar() {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function () {});
    setTimeout(function () {
      $('#splash').style.opacity = 0;
      setTimeout(function () { $('#splash').classList.add('hidden'); }, 400);
      var p = ls('sd_pin');
      if (p) entrar(p, true); else mostrarLogin();
    }, 1300);
    document.querySelectorAll('.keypad button').forEach(function (b) {
      b.addEventListener('click', function () {
        if (b.dataset.k === 'del') pinBuf = pinBuf.slice(0, -1);
        else if (pinBuf.length < 4) pinBuf += b.textContent;
        pintarPin();
        if (pinBuf.length === 4) entrar(pinBuf);
      });
    });
    $('#btnSair').onclick = function () { if (confirm('Sair do app?')) { ls('sd_pin', null); location.reload(); } };
    $('#btnBell').onclick = ativarNotificacoes;
    $('#fab').onclick = function () { abrirForm(null); };
    $('#modal').addEventListener('click', function (e) { if (e.target.id === 'modal') fecharModal(); });
    window.addEventListener('hashchange', abrirHash);
  }
  function mostrarLogin() { pinBuf = ''; pintarPin(); $('#login').classList.remove('hidden'); }
  function pintarPin() { document.querySelectorAll('.pin-dots span').forEach(function (s, i) { s.classList.toggle('on', i < pinBuf.length); }); }
  function entrar(pin, auto) {
    S.pin = pin; $('#pinErr').textContent = auto ? '' : 'A entrar…';
    api('login').then(function (d) {
      S.user = d.user; S.tecnicos = d.tecnicos; S.vapid = d.vapid;
      ls('sd_pin', pin);
      $('#login').classList.add('hidden'); $('#app').classList.remove('hidden');
      $('#who').textContent = S.user.nome + (S.user.admin ? ' · dono' : ' · técnico');
      $('#fab').classList.toggle('hidden', !S.user.admin);
      S.tab = 'agenda';
      montarTabs(); carregar().then(abrirHash);
      verificarSubscricao();
    }).catch(function (e) {
      ls('sd_pin', null); pinBuf = ''; pintarPin(); mostrarLogin();
      $('#pinErr').textContent = /PIN/.test(e.message) ? 'PIN errado' : 'Sem ligação. Tenta outra vez.';
    });
  }
  function carregar() {
    return api('list').then(function (d) {
      S.jobs = d.jobs; render();
    }).catch(function (e) { toast('Erro a carregar: ' + e.message); });
  }
  setInterval(function () { if (S.user && document.visibilityState === 'visible' && $('#modal').classList.contains('hidden')) carregar(); }, 60000);
  document.addEventListener('visibilitychange', function () { if (S.user && document.visibilityState === 'visible') carregar(); });

  function abrirHash() {
    var m = location.hash.match(/job=([\w-]+)/);
    if (m) { var j = S.jobs.filter(function (x) { return x.id === m[1]; })[0]; if (j) abrirDetalhe(j); history.replaceState(null, '', location.pathname); }
  }

  /* ---------- Tabs ---------- */
  function montarTabs() {
    var t = [['agenda', '📅', 'Agenda']];
    if (S.user.admin) { t.push(['receber', '💶', 'A receber']); t.push(['faturas', '🧾', 'Faturas']); t.push(['resumo', '📊', 'Resumo']); }
    else if (S.user.comissao) t.push(['comissoes', '💰', 'Comissões']);
    $('#tabs').innerHTML = t.map(function (x) {
      return '<button data-t="' + x[0] + '" class="' + (S.tab === x[0] ? 'on' : '') + '"><i>' + x[1] + '</i><span>' + x[2] + '<b class="badge hidden" id="bd-' + x[0] + '"></b></span></button>';
    }).join('');
    $('#tabs').querySelectorAll('button').forEach(function (b) { b.onclick = function () { S.tab = b.dataset.t; montarTabs(); render(); window.scrollTo(0, 0); }; });
  }
  function badges() {
    if (!S.user.admin) return;
    var f = pendentesFatura().length, r = porReceber().length;
    var bf = $('#bd-faturas'), br = $('#bd-receber');
    if (bf) { bf.textContent = f; bf.classList.toggle('hidden', !f); }
    if (br) { br.textContent = r; br.classList.toggle('hidden', !r); }
  }
  function render() {
    badges();
    $('#fab').classList.toggle('hidden', !S.user.admin || S.tab !== 'agenda');
    ({ agenda: vAgenda, faturas: vFaturas, resumo: vResumo, comissoes: vComissoes, receber: vReceber }[S.tab] || vAgenda)();
  }

  /* ---------- Agenda ---------- */
  function cardHTML(j) {
    var sc = stClass(j.estado), extra = '';
    if (S.user.admin && baseJob(j) > 0) extra = '<b>' + eur(baseJob(j) + ivaJob(j)) + '</b>';
    return '<div class="card click b-' + sc + '" data-id="' + j.id + '">' +
      '<div class="row1"><span class="hora">' + esc(j.hora) + '</span><span class="st st-' + sc + '">' + esc(j.estado) + '</span></div>' +
      '<div class="cli">' + esc(j.cliente || 'Sem nome') + (j.querFatura ? ' · 🧾' : '') + '</div>' +
      '<div class="sub">' + esc(j.servico || '') + (j.morada ? ' · ' + esc(j.morada) : '') + '</div>' +
      '<div class="row1"><span class="tec">👷 ' + esc(j.tecnicos.join(' + ')) + '</span>' + extra + '</div></div>';
  }
  function ligarCards(root) {
    root.querySelectorAll('.card[data-id]').forEach(function (c) {
      c.onclick = function () { abrirDetalhe(S.jobs.filter(function (j) { return j.id === c.dataset.id; })[0]); };
    });
  }
  function vAgenda() {
    var hoje = hojeISO();
    var chips = [['hoje', 'Hoje'], ['proximos', 'Próximos'], ['abertos', 'Por fechar'], ['passados', 'Anteriores']];
    var html = '<div class="chips">' + chips.map(function (c) { return '<button class="chip ' + (S.filtro === c[0] ? 'on' : '') + '" data-f="' + c[0] + '">' + c[1] + '</button>'; }).join('');
    if (S.user.admin && S.user.tecnico) html += '<button class="chip ' + (S.meus ? 'on' : '') + '" data-meus="1">Só os meus</button>';
    html += '</div><input class="search" id="q" placeholder="Procurar cliente, morada, telefone…" value="' + esc(S.q) + '">';
    var js = S.jobs.slice();
    if (S.meus) js = js.filter(function (j) { return j.tecnicos.indexOf(S.user.nome) >= 0; });
    if (S.q) { var q = S.q.toLowerCase(); js = js.filter(function (j) { return [j.cliente, j.morada, j.telefone, j.servico, j.nif].join(' ').toLowerCase().indexOf(q) >= 0; }); }
    else if (S.filtro === 'hoje') js = js.filter(function (j) { return j.data === hoje; });
    else if (S.filtro === 'proximos') js = js.filter(function (j) { return j.data >= hoje; });
    else if (S.filtro === 'abertos') js = js.filter(function (j) { return j.estado === 'Agendado' || j.estado === 'Orçamento dado'; });
    else if (S.filtro === 'passados') js = js.filter(function (j) { return j.data < hoje; });
    var desc = S.filtro === 'passados' && !S.q;
    js.sort(function (a, b) { var k = (a.data + a.hora).localeCompare(b.data + b.hora); return desc ? -k : k; });
    if (!js.length) html += '<div class="empty">Sem trabalhos aqui.' + (S.user.admin ? '<br>Carrega no <b>＋</b> para marcar.' : '') + '</div>';
    var dia = null;
    js.forEach(function (j) { if (j.data !== dia) { dia = j.data; html += '<div class="day">' + nomeDia(dia) + '</div>'; } html += cardHTML(j); });
    $('#view').innerHTML = html;
    $('#view').querySelectorAll('[data-f]').forEach(function (b) { b.onclick = function () { S.filtro = b.dataset.f; S.q = ''; render(); }; });
    var bm = $('[data-meus]'); if (bm) bm.onclick = function () { S.meus = !S.meus; render(); };
    var qi = $('#q'); qi.oninput = function () { S.q = qi.value; clearTimeout(vAgenda._t); vAgenda._t = setTimeout(function () { render(); var n = $('#q'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 350); };
    ligarCards($('#view'));
  }

  /* ---------- Detalhe ---------- */
  function abrirModal(html) { $('#sheet').innerHTML = html; $('#modal').classList.remove('hidden'); $('#sheet').scrollTop = 0; document.body.style.overflow = 'hidden'; }
  function fecharModal() { $('#modal').classList.add('hidden'); document.body.style.overflow = ''; }
  function linha(l, v) { return v ? '<div><span>' + l + '</span><b>' + v + '</b></div>' : ''; }
  function fotoURL(id, sz) { return 'https://drive.google.com/thumbnail?id=' + encodeURIComponent(id) + '&sz=w' + (sz || 400); }

  function abrirDetalhe(j) {
    if (!j) return;
    var tel = String(j.telefone || '').replace(/[^\d+]/g, ''), wa = tel.replace(/^\+/, ''); if (wa.length === 9) wa = '351' + wa;
    var meu = j.tecnicos.indexOf(S.user.nome) >= 0, pode = S.user.admin || meu;
    var h = '<h2>' + esc(j.cliente || 'Trabalho') + '<button class="x" data-close>✕</button></h2>';
    h += '<div class="actions">' +
      (tel ? '<a href="tel:' + esc(tel) + '"><i>📞</i>Ligar</a><a href="https://wa.me/' + esc(wa) + '" target="_blank"><i>💬</i>WhatsApp</a>' : '<a></a><a></a>') +
      (j.morada ? '<a href="https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(j.morada) + '" target="_blank"><i>📍</i>Mapa</a>' : '<a></a>') + '</div>';
    h += '<div class="info">' + linha('Estado', '<span class="st st-' + stClass(j.estado) + '">' + esc(j.estado) + '</span>') +
      linha('Data', esc(nomeDia(j.data)) + ' · ' + esc(j.hora)) + linha('Serviço', esc(j.servico)) + linha('Morada', esc(j.morada)) +
      linha('Telefone', esc(j.telefone)) + linha('Técnico(s)', esc(j.tecnicos.join(' + '))) + linha('Notas', esc(j.notas)) + '</div>';
    if (j.querFatura) h += '<div class="info">' + linha('Fatura', 'Sim' + (j.faturaFeita ? ' ✅ feita' : ' — por fazer')) + linha('Nome', esc(j.nomeFatura)) + linha('NIF', esc(j.nif)) + linha('Morada fatura', esc(j.moradaFatura)) + '</div>';
    if (baseJob(j) > 0 || num(j.valor) > 0) {
      h += '<div class="money">' + (j.estado === 'Orçamento dado' ? '<div><span>Orçamento (sem IVA)</span><b>' + eur(j.valor) + '</b></div>' : '') +
        (baseJob(j) > 0 ? '<div><span>Serviço</span><b>' + eur(baseJob(j)) + '</b></div>' : '') +
        (j.querFatura && baseJob(j) > 0 ? '<div><span>IVA 23% (não é lucro)</span><b>' + eur(ivaJob(j)) + '</b></div>' : '') +
        (baseJob(j) > 0 ? '<div class="tot"><span>Cliente paga</span><b>' + eur(baseJob(j) + ivaJob(j)) + '</b></div>' : '') +
        (num(j.custoMaterial) ? '<div><span>Material</span><b>' + eur(j.custoMaterial) + '</b></div>' : '') +
        (j.formaPagamento ? '<div><span>Pagamento</span><b>' + esc(j.formaPagamento) + (j.pago ? ' ✅' : ' ⏳') + '</b></div>' : '') + '</div>';
    }
    if (j.material) h += '<div class="note"><b>Material:</b> ' + esc(j.material) + '</div>';
    if (j.notasTecnico) h += '<div class="note"><b>Notas do técnico:</b> ' + esc(j.notasTecnico) + '</div>';
    if (j.fotos.length) h += '<label>Fotos</label><div class="fotos">' + j.fotos.map(function (f) { return '<a href="https://drive.google.com/file/d/' + esc(f) + '/view" target="_blank"><img loading="lazy" src="' + fotoURL(f) + '"></a>'; }).join('') + '</div>';
    if (pode) h += '<button class="btn" data-fechar>' + (j.estado === 'Agendado' || j.estado === 'Orçamento dado' ? '✅ Fechar trabalho' : '✏️ Valores, fotos e estado') + '</button>';
    if (S.user.admin) {
      if (j.estado === 'Concluído – cliente falta pagar' || (CONCLUIDOS.indexOf(j.estado) >= 0 && !j.pago)) h += '<button class="btn ok" data-pago>💶 Marcar como pago</button>';
      if (j.querFatura && baseJob(j) > 0 && !j.faturaFeita) h += '<button class="btn yel" data-fatura>🧾 Fatura feita</button>';
      h += '<button class="btn ghost" data-editar>Editar marcação</button><button class="btn ghost" data-apagar style="border-color:#999;color:#777">Apagar trabalho</button>';
    }
    abrirModal(h);
    var sh = $('#sheet');
    sh.querySelector('[data-close]').onclick = fecharModal;
    var b;
    if ((b = sh.querySelector('[data-fechar]'))) b.onclick = function () { abrirFecho(j); };
    if ((b = sh.querySelector('[data-editar]'))) b.onclick = function () { abrirForm(j); };
    if ((b = sh.querySelector('[data-pago]'))) b.onclick = function () { marcarPago(j); };
    if ((b = sh.querySelector('[data-fatura]'))) b.onclick = function () { acaoSimples('fatura', j, 'Fatura marcada como feita'); };
    if ((b = sh.querySelector('[data-apagar]'))) b.onclick = function () {
      if (!confirm('Apagar este trabalho? Não dá para desfazer.')) return;
      api('apagar', { id: j.id }).then(function () { S.jobs = S.jobs.filter(function (x) { return x.id !== j.id; }); fecharModal(); render(); toast('Trabalho apagado'); }).catch(function (e) { toast(e.message); });
    };
  }
  function atualizaJob(nj) {
    var i = S.jobs.findIndex(function (x) { return x.id === nj.id; });
    if (i >= 0) S.jobs[i] = nj; else S.jobs.push(nj);
    render(); return nj;
  }
  function acaoSimples(acao, j, msg) {
    api(acao, { id: j.id }).then(function (d) { abrirDetalhe(atualizaJob(d.job)); toast(msg); }).catch(function (e) { toast(e.message); });
  }
  function marcarPago(j) {
    var h = '<h2>Marcar como pago<button class="x" data-close>✕</button></h2><div class="money"><div class="tot"><span>' + esc(j.cliente) + '</span><b>' + eur(baseJob(j) + ivaJob(j)) + '</b></div></div>' +
      '<label>Forma de pagamento</label><select id="fp">' + PAGAMENTOS.map(function (p) { return '<option ' + (p === j.formaPagamento ? 'selected' : '') + '>' + p + '</option>'; }).join('') + '</select>' +
      '<button class="btn ok" id="ok">Confirmar pagamento</button>';
    abrirModal(h);
    $('#sheet [data-close]').onclick = function () { abrirDetalhe(j); };
    $('#ok').onclick = function () {
      this.disabled = true;
      api('pago', { id: j.id, forma: $('#fp').value }).then(function (d) { abrirDetalhe(atualizaJob(d.job)); toast('Marcado como pago'); }).catch(function (e) { toast(e.message); });
    };
  }

  /* ---------- Formulário de marcação (donos) ---------- */
  function tecSel(sel) {
    return '<div class="tsel">' + S.tecnicos.map(function (t) {
      return '<button type="button" class="chip ' + (sel.indexOf(t.nome) >= 0 ? 'on' : '') + '" data-tec="' + esc(t.nome) + '">' + esc(t.nome) + '</button>';
    }).join('') + '</div>';
  }
  function abrirForm(j) {
    var n = !j; j = j || { data: hojeISO(), hora: '', tecnicos: [], querFatura: false };
    var h = '<h2>' + (n ? 'Novo trabalho' : 'Editar marcação') + '<button class="x" data-close>✕</button></h2>' +
      '<div class="grid2"><div><label>Data</label><input type="date" id="f_data" value="' + esc(j.data) + '"></div><div><label>Hora</label><input type="time" id="f_hora" value="' + esc(j.hora) + '"></div></div>' +
      '<label>Técnico(s) — podes escolher dois</label>' + tecSel(j.tecnicos) +
      '<label>Cliente (nome completo)</label><input id="f_cliente" value="' + esc(j.cliente) + '" autocomplete="off">' +
      '<label>Telefone</label><input id="f_telefone" type="tel" value="' + esc(j.telefone) + '">' +
      '<label>Morada</label><input id="f_morada" value="' + esc(j.morada) + '">' +
      '<label>Serviço</label><input id="f_servico" value="' + esc(j.servico) + '" placeholder="Ex.: desentupir sanita, esgoto, fossa…" list="servs">' +
      '<datalist id="servs"><option>Desentupimento de sanita<option>Desentupimento de esgoto<option>Desentupimento de lava-loiça<option>Desentupimento de banheira/duche<option>Limpeza de fossa<option>Inspeção com câmara<option>Reparação de canalização</datalist>' +
      '<label>Notas para o técnico</label><textarea id="f_notas">' + esc(j.notas) + '</textarea>' +
      '<label class="check"><input type="checkbox" id="f_fat" ' + (j.querFatura ? 'checked' : '') + '> Cliente quer fatura (IVA 23%)</label>' +
      '<div id="fatbox" class="' + (j.querFatura ? '' : 'hidden') + '"><label>Nome para a fatura</label><input id="f_nomeFatura" value="' + esc(j.nomeFatura || '') + '">' +
      '<label>NIF (contribuinte)</label><input id="f_nif" inputmode="numeric" maxlength="9" value="' + esc(j.nif || '') + '">' +
      '<label>Morada da fatura (se for diferente)</label><input id="f_moradaFatura" value="' + esc(j.moradaFatura || '') + '"></div>' +
      '<button class="btn" id="f_ok">' + (n ? 'Marcar trabalho' : 'Guardar alterações') + '</button>';
    abrirModal(h);
    var sh = $('#sheet'), tecs = j.tecnicos.slice();
    sh.querySelector('[data-close]').onclick = function () { n ? fecharModal() : abrirDetalhe(j); };
    sh.querySelectorAll('[data-tec]').forEach(function (b) {
      b.onclick = function () { var t = b.dataset.tec, i = tecs.indexOf(t); if (i >= 0) tecs.splice(i, 1); else tecs.push(t); b.classList.toggle('on', i < 0); };
    });
    $('#f_fat').onchange = function () { $('#fatbox').classList.toggle('hidden', !this.checked); };
    $('#f_ok').onclick = function () {
      var btn = this, d = { id: j.id, tecnicos: tecs, querFatura: $('#f_fat').checked };
      ['data', 'hora', 'cliente', 'telefone', 'morada', 'servico', 'notas', 'nomeFatura', 'nif', 'moradaFatura'].forEach(function (k) { d[k] = $('#f_' + k).value.trim(); });
      if (!d.data || !d.hora) return toast('Falta a data ou a hora');
      if (!tecs.length) return toast('Escolhe o técnico');
      if (d.nif && !/^\d{9}$/.test(d.nif)) return toast('O NIF tem de ter 9 números');
      btn.disabled = true; btn.textContent = 'A guardar…';
      api('save', { job: d }).then(function (r) { atualizaJob(r.job); fecharModal(); toast(n ? 'Trabalho marcado ✅ técnico avisado' : 'Alterações guardadas'); })
        .catch(function (e) { btn.disabled = false; btn.textContent = 'Tentar outra vez'; toast(e.message); });
    };
  }

  /* ---------- Fechar trabalho (técnico ou dono) ---------- */
  function abrirFecho(j) {
    var est = j.estado === 'Agendado' ? 'Concluído' : j.estado;
    var h = '<h2>Fechar trabalho<button class="x" data-close>✕</button></h2>' +
      '<div class="note">' + esc(j.cliente) + ' · ' + esc(j.servico || '') + '</div>' +
      '<label>Estado</label><select id="c_estado">' + ESTADOS.slice(1).map(function (e) { return '<option ' + (e === est ? 'selected' : '') + '>' + e + '</option>'; }).join('') + '</select>' +
      '<div id="box_valor"><label id="lb_valor">Valor do serviço (sem IVA) €</label><input id="c_valor" inputmode="decimal" value="' + (num(j.valor) || '') + '" placeholder="0,00"></div>' +
      '<div id="box_taxa"><label>Taxa de deslocação €</label><input id="c_taxa" inputmode="decimal" value="' + (num(j.taxaDeslocacao) || '') + '" placeholder="0,00"></div>' +
      '<div id="box_mat"><label>Material gasto</label><input id="c_material" value="' + esc(j.material) + '" placeholder="Ex.: 2 m tubo, 1 curva…">' +
      '<label>Custo do material €</label><input id="c_custo" inputmode="decimal" value="' + (num(j.custoMaterial) || '') + '" placeholder="0,00"></div>' +
      '<label class="check"><input type="checkbox" id="c_fat" ' + (j.querFatura ? 'checked' : '') + '> Cliente quer fatura</label>' +
      '<div id="c_fatbox" class="' + (j.querFatura ? '' : 'hidden') + '"><label>Nome completo para a fatura</label><input id="c_nomeFatura" value="' + esc(j.nomeFatura || j.cliente || '') + '">' +
      '<label>NIF (contribuinte)</label><input id="c_nif" inputmode="numeric" maxlength="9" value="' + esc(j.nif || '') + '">' +
      '<label>Morada da fatura</label><input id="c_moradaFatura" value="' + esc(j.moradaFatura || j.morada || '') + '"></div>' +
      '<div class="money" id="c_money"></div>' +
      '<div id="box_pag"><label>Forma de pagamento</label><select id="c_pag"><option value="">—</option>' + PAGAMENTOS.map(function (p) { return '<option ' + (p === j.formaPagamento ? 'selected' : '') + '>' + p + '</option>'; }).join('') + '</select></div>' +
      '<label>Fotos</label><div class="fotos" id="c_fotos"></div><input type="file" id="c_file" accept="image/*" multiple class="hidden">' +
      '<label>Notas</label><textarea id="c_notas">' + esc(j.notasTecnico) + '</textarea>' +
      '<button class="btn" id="c_ok">Guardar</button>';
    abrirModal(h);
    var sh = $('#sheet');
    sh.querySelector('[data-close]').onclick = function () { abrirDetalhe(j); };
    function upd() {
      var e = $('#c_estado').value, rec = e === 'Orçamento recusado', orc = e === 'Orçamento dado', fat = $('#c_fat').checked;
      $('#box_valor').classList.toggle('hidden', rec);
      $('#lb_valor').textContent = orc ? 'Valor do orçamento (sem IVA) €' : 'Valor do serviço (sem IVA) €';
      $('#box_taxa').classList.toggle('hidden', !rec);
      $('#box_mat').classList.toggle('hidden', rec || orc);
      $('#box_pag').classList.toggle('hidden', orc);
      $('#c_fatbox').classList.toggle('hidden', !fat);
      var base = rec ? num($('#c_taxa').value) : num($('#c_valor').value), iva = fat ? base * IVA : 0;
      $('#c_money').innerHTML = '<div><span>' + (orc ? 'Orçamento' : 'Serviço') + '</span><b>' + eur(base) + '</b></div>' +
        (fat ? '<div><span>IVA 23%</span><b>' + eur(iva) + '</b></div>' : '') +
        '<div class="tot"><span>' + (orc ? 'Total do orçamento' : 'Cliente paga') + '</span><b>' + eur(base + iva) + '</b></div>';
    }
    ['c_estado', 'c_fat', 'c_valor', 'c_taxa'].forEach(function (id) { $('#' + id).addEventListener('input', upd); $('#' + id).addEventListener('change', upd); });
    upd();
    function pintarFotos() {
      $('#c_fotos').innerHTML = j.fotos.map(function (f) { return '<div class="f"><img src="' + fotoURL(f, 200) + '"><button class="del" data-f="' + esc(f) + '">✕</button></div>'; }).join('') + '<button class="addfoto" id="c_add">📷</button>';
      $('#c_add').onclick = function () { $('#c_file').click(); };
      $('#c_fotos').querySelectorAll('[data-f]').forEach(function (b) {
        b.onclick = function () {
          if (!confirm('Tirar esta foto?')) return;
          api('removerFoto', { id: j.id, fotoId: b.dataset.f }).then(function (d) { j.fotos = d.job.fotos; atualizaJob(d.job); pintarFotos(); }).catch(function (e) { toast(e.message); });
        };
      });
    }
    pintarFotos();
    $('#c_file').onchange = function () {
      var files = Array.prototype.slice.call(this.files); this.value = '';
      var seq = Promise.resolve();
      files.forEach(function (file, i) {
        seq = seq.then(function () {
          toast('A enviar foto ' + (i + 1) + ' de ' + files.length + '…', 60000);
          return reduzir(file).then(function (data) { return api('foto', { id: j.id, data: data }); })
            .then(function (d) { j.fotos = d.job.fotos; atualizaJob(d.job); pintarFotos(); });
        });
      });
      seq.then(function () { toast('Fotos guardadas ✅'); }).catch(function (e) { toast('Erro na foto: ' + e.message); });
    };
    $('#c_ok').onclick = function () {
      var btn = this, e = $('#c_estado').value, fat = $('#c_fat').checked;
      var d = { id: j.id, estado: e, querFatura: fat, notasTecnico: $('#c_notas').value, formaPagamento: $('#c_pag').value,
        nomeFatura: $('#c_nomeFatura').value, nif: $('#c_nif').value.replace(/\s/g, ''), moradaFatura: $('#c_moradaFatura').value };
      if (e === 'Orçamento recusado') { d.taxaDeslocacao = num($('#c_taxa').value); d.valor = 0; }
      else { d.valor = num($('#c_valor').value); d.taxaDeslocacao = num(j.taxaDeslocacao); d.material = $('#c_material').value; d.custoMaterial = num($('#c_custo').value); }
      if (CONCLUIDOS.indexOf(e) >= 0 && !d.valor) return toast('Põe o valor do serviço');
      if (fat && CONCLUIDOS.indexOf(e) >= 0 && !/^\d{9}$/.test(d.nif)) return toast('Para fatura, põe o NIF (9 números)');
      if (e === 'Concluído' && !d.formaPagamento) return toast('Escolhe a forma de pagamento');
      btn.disabled = true; btn.textContent = 'A guardar…';
      api('close', { job: d }).then(function (r) { abrirDetalhe(atualizaJob(r.job)); toast('Trabalho guardado ✅'); })
        .catch(function (er) { btn.disabled = false; btn.textContent = 'Guardar'; toast(er.message); });
    };
  }
  function reduzir(file) {
    return new Promise(function (ok, ko) {
      var img = new Image(), url = URL.createObjectURL(file);
      img.onload = function () {
        var m = 1400, w = img.width, h = img.height, r = Math.min(1, m / Math.max(w, h));
        var c = document.createElement('canvas'); c.width = Math.round(w * r); c.height = Math.round(h * r);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
        ok(c.toDataURL('image/jpeg', 0.78));
      };
      img.onerror = function () { ko(new Error('não consegui ler a imagem')); };
      img.src = url;
    });
  }

  /* ---------- A receber (donos) ---------- */
  function porReceber() { return S.jobs.filter(function (j) { return j.estado === 'Concluído – cliente falta pagar' || (CONCLUIDOS.indexOf(j.estado) >= 0 && !j.pago); }); }
  function vReceber() {
    var js = porReceber().sort(function (a, b) { return (a.data + a.hora).localeCompare(b.data + b.hora); });
    var tot = js.reduce(function (s, j) { return s + baseJob(j) + ivaJob(j); }, 0);
    var h = '<div class="kpis"><div class="kpi red big"><span>Clientes que faltam pagar</span><b>' + eur(tot) + '</b> <small>' + js.length + ' trabalho(s)</small></div></div>';
    if (!js.length) h += '<div class="empty">Ninguém deve nada 🎉</div>';
    js.forEach(function (j) { h += '<div class="day">' + nomeDia(j.data) + '</div>' + cardHTML(j); });
    $('#view').innerHTML = h; ligarCards($('#view'));
  }

  /* ---------- Faturas (donos) ---------- */
  function pendentesFatura() { return S.jobs.filter(function (j) { return j.querFatura && baseJob(j) > 0 && !j.faturaFeita; }); }
  function mesDe(iso) { return String(iso || '').slice(0, 7); }
  function nomeMes(ym) { var p = ym.split('-'); var t = new Date(+p[0], +p[1] - 1, 1).toLocaleDateString('pt-PT', { month: 'long', year: 'numeric' }); return t.charAt(0).toUpperCase() + t.slice(1); }
  function vFaturas() {
    var pend = pendentesFatura().sort(function (a, b) { return a.data.localeCompare(b.data); });
    var h = '<h3>Faturas por fazer (' + pend.length + ')</h3>';
    if (!pend.length) h += '<div class="empty">Tudo faturado ✅</div>';
    pend.forEach(function (j) {
      var atras = j.concluidoEm && (Date.now() - new Date(j.concluidoEm).getTime()) > 864e5;
      h += '<div class="card ' + (atras ? 'b-Falta' : '') + '"><div class="row1"><span class="cli">' + esc(j.nomeFatura || j.cliente) + '</span><b>' + eur(baseJob(j) + ivaJob(j)) + '</b></div>' +
        '<div class="sub">NIF ' + esc(j.nif || '—') + ' · ' + esc(j.moradaFatura || j.morada || '') + '</div>' +
        '<div class="sub">' + esc(j.servico || '') + ' · ' + fmtCurta(parseISO(j.data)) + ' · sem IVA ' + eur(baseJob(j)) + ' + IVA ' + eur(ivaJob(j)) + (atras ? ' · <b style="color:var(--red)">há mais de 24 h</b>' : '') + '</div>' +
        '<div class="grid2"><button class="btn ghost" data-ver="' + j.id + '">Ver</button><button class="btn yel" data-fat="' + j.id + '">🧾 Fatura feita</button></div></div>';
    });
    var meses = {};
    S.jobs.filter(function (j) { return j.querFatura && baseJob(j) > 0; }).forEach(function (j) {
      var m = mesDe(j.data); meses[m] = meses[m] || { n: 0, base: 0, iva: 0, feitas: 0 };
      meses[m].n++; meses[m].base += baseJob(j); meses[m].iva += ivaJob(j); if (j.faturaFeita) meses[m].feitas++;
    });
    var ks = Object.keys(meses).sort().reverse();
    h += '<h3>Total de faturas por mês</h3>';
    if (!ks.length) h += '<div class="empty">Ainda sem faturas.</div>';
    else h += '<table><tr><th>Mês</th><th class="n">Nº</th><th class="n">Sem IVA</th><th class="n">IVA</th><th class="n">Total</th></tr>' +
      ks.map(function (k) { var m = meses[k]; return '<tr><td>' + nomeMes(k) + '</td><td class="n">' + m.feitas + '/' + m.n + '</td><td class="n">' + eur(m.base) + '</td><td class="n">' + eur(m.iva) + '</td><td class="n"><b>' + eur(m.base + m.iva) + '</b></td></tr>'; }).join('') + '</table>' +
      '<p class="sub" style="color:var(--mut);font-size:13px">Nº = faturas feitas / trabalhos com fatura. O IVA é para entregar ao Estado.</p>';
    $('#view').innerHTML = h;
    $('#view').querySelectorAll('[data-ver]').forEach(function (b) { b.onclick = function () { abrirDetalhe(S.jobs.filter(function (j) { return j.id === b.dataset.ver; })[0]); }; });
    $('#view').querySelectorAll('[data-fat]').forEach(function (b) {
      b.onclick = function () { b.disabled = true; api('fatura', { id: b.dataset.fat }).then(function (d) { atualizaJob(d.job); toast('Fatura marcada como feita ✅'); }).catch(function (e) { b.disabled = false; toast(e.message); }); };
    });
  }

  /* ---------- Resumo (donos) ---------- */
  function vResumo() {
    if (!S.mes) S.mes = hojeISO().slice(0, 7);
    var js = S.jobs.filter(function (j) { return mesDe(j.data) === S.mes; });
    var fech = js.filter(function (j) { return baseJob(j) > 0; });
    var t = { base: 0, iva: 0, mat: 0, com: 0, receber: 0, pago: 0 }, porTec = {}, porPag = {};
    S.tecnicos.forEach(function (x) { porTec[x.nome] = { n: 0, valor: 0, com: 0 }; });
    fech.forEach(function (j) {
      var b = baseJob(j), iv = ivaJob(j);
      t.base += b; t.iva += iv; t.mat += num(j.custoMaterial);
      if (j.pago) t.pago += b + iv; else t.receber += b + iv;
      var c = comissoes(j);
      Object.keys(c).forEach(function (k) { t.com += c[k]; });
      j.tecnicos.forEach(function (n) { porTec[n] = porTec[n] || { n: 0, valor: 0, com: 0 }; porTec[n].n++; porTec[n].valor += b; porTec[n].com += c[n] || 0; });
      var fp = j.formaPagamento || (j.pago ? 'Sem indicação' : 'Por receber'); porPag[fp] = (porPag[fp] || 0) + b + iv;
    });
    var lucro = t.base - t.mat - t.com;
    var cont = function (e) { return js.filter(function (j) { return j.estado === e; }).length; };
    var h = '<div class="monthbar"><button id="mPrev">‹</button><b>' + nomeMes(S.mes) + '</b><button id="mNext">›</button></div>' +
      '<div class="kpis">' +
      '<div class="kpi big green"><span>Lucro estimado (sem IVA − material − comissões)</span><b>' + eur(lucro) + '</b></div>' +
      '<div class="kpi"><span>Serviços (sem IVA)</span><b>' + eur(t.base) + '</b></div>' +
      '<div class="kpi red"><span>IVA a entregar</span><b>' + eur(t.iva) + '</b><small>não é lucro</small></div>' +
      '<div class="kpi"><span>Total cobrado c/ IVA</span><b>' + eur(t.base + t.iva) + '</b></div>' +
      '<div class="kpi red"><span>Falta receber</span><b>' + eur(t.receber) + '</b></div>' +
      '<div class="kpi"><span>Material</span><b>' + eur(t.mat) + '</b></div>' +
      '<div class="kpi"><span>Comissões</span><b>' + eur(t.com) + '</b></div>' +
      '</div>' +
      '<table><tr><th>Estado</th><th class="n">Nº</th></tr>' + ESTADOS.map(function (e) { return '<tr><td>' + e + '</td><td class="n">' + cont(e) + '</td></tr>'; }).join('') + '</table>' +
      '<h3>Por técnico</h3><table><tr><th>Técnico</th><th class="n">Trab.</th><th class="n">Valor</th><th class="n">Comissão</th></tr>' +
      Object.keys(porTec).map(function (n) { var p = porTec[n]; return '<tr><td>' + esc(n) + '</td><td class="n">' + p.n + '</td><td class="n">' + eur(p.valor) + '</td><td class="n">' + (comissaoTec()[n] ? eur(p.com) : '—') + '</td></tr>'; }).join('') + '</table>' +
      '<h3>Formas de pagamento</h3><table>' + (Object.keys(porPag).length ? Object.keys(porPag).map(function (k) { return '<tr><td>' + esc(k) + '</td><td class="n">' + eur(porPag[k]) + '</td></tr>'; }).join('') : '<tr><td>Sem dados</td></tr>') + '</table>' +
      '<h3>Comissões por semana (seg–dom, paga ao domingo)</h3>' + tabelaSemanas(null);
    $('#view').innerHTML = h;
    $('#mPrev').onclick = function () { mudaMes(-1); }; $('#mNext').onclick = function () { mudaMes(1); };
  }
  function mudaMes(d) { var p = S.mes.split('-'); var x = new Date(+p[0], +p[1] - 1 + d, 1); S.mes = x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0'); render(); }

  function tabelaSemanas(soNome) {
    var nomes = S.tecnicos.filter(function (t) { return t.comissao && (!soNome || t.nome === soNome); }).map(function (t) { return t.nome; });
    var sem = {};
    S.jobs.forEach(function (j) {
      var c = comissoes(j); if (!Object.keys(c).length) return;
      var k = hojeISO(inicioSemana(parseISO(j.data)));
      sem[k] = sem[k] || {}; Object.keys(c).forEach(function (n) { sem[k][n] = (sem[k][n] || 0) + c[n]; });
    });
    var ks = Object.keys(sem).sort().reverse().slice(0, 10);
    if (!ks.length) return '<div class="empty">Ainda sem comissões (só contam trabalhos fora de horas: 17h–8h, sábados, domingos e feriados).</div>';
    return '<table><tr><th>Semana</th>' + nomes.map(function (n) { return '<th class="n">' + esc(n) + '</th>'; }).join('') + '</tr>' +
      ks.map(function (k) { var a = parseISO(k), b = new Date(a); b.setDate(b.getDate() + 6); return '<tr><td>' + fmtCurta(a) + '–' + fmtCurta(b) + '</td>' + nomes.map(function (n) { return '<td class="n">' + eur(sem[k][n] || 0) + '</td>'; }).join('') + '</tr>'; }).join('') + '</table>';
  }

  /* ---------- Comissões (técnico) ---------- */
  function vComissoes() {
    var ini = inicioSemana(new Date()), fim = new Date(ini); fim.setDate(fim.getDate() + 6);
    var tot = 0, lista = [];
    S.jobs.forEach(function (j) {
      var d = parseISO(j.data), c = comissoes(j)[S.user.nome];
      if (c && d >= ini && d <= fim) { tot += c; lista.push([j, c]); }
    });
    var h = '<div class="kpis"><div class="kpi big green"><span>Comissão desta semana (' + fmtCurta(ini) + '–' + fmtCurta(fim) + ')</span><b>' + eur(tot) + '</b><small>Paga no domingo</small></div></div>' +
      '<div class="note">Comissão de 10% do valor sem IVA, menos o material, nos trabalhos fora de horas (17h–8h), sábados, domingos e feriados. Orçamento recusado: metade da taxa de deslocação.</div>';
    lista.forEach(function (x) { h += '<div class="card"><div class="row1"><span class="cli">' + fmtCurta(parseISO(x[0].data)) + ' ' + esc(x[0].hora) + ' · ' + esc(x[0].cliente) + '</span><b>' + eur(x[1]) + '</b></div><div class="sub">' + esc(x[0].servico || '') + '</div></div>'; });
    h += '<h3>Semanas anteriores</h3>' + tabelaSemanas(S.user.nome);
    $('#view').innerHTML = h;
  }

  /* ---------- Notificações ---------- */
  function b64ToU8(s) { var p = '='.repeat((4 - s.length % 4) % 4), b = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); var a = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a; }
  function pushSuportado() { return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window; }
  function verificarSubscricao() {
    if (!pushSuportado()) { $('#btnBell').textContent = '🔕'; return; }
    navigator.serviceWorker.ready.then(function (reg) { return reg.pushManager.getSubscription(); }).then(function (sub) {
      if (sub && Notification.permission === 'granted') { $('#btnBell').textContent = '🔔'; api('subscribe', { sub: sub.toJSON() }).catch(function () {}); }
      else { $('#btnBell').textContent = '🔕'; setTimeout(function () { if (!ls('sd_pedido')) { ls('sd_pedido', '1'); ativarNotificacoes(); } }, 800); }
    });
  }
  function ativarNotificacoes() {
    var ios = /iphone|ipad|ipod/i.test(navigator.userAgent), standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    if (!pushSuportado() || (ios && !standalone)) {
      return abrirModal('<h2>Notificações<button class="x" data-close>✕</button></h2><div class="note">' + (ios ? 'No iPhone, as notificações só funcionam depois de instalares o app: no Safari carrega em <b>Partilhar</b> ⬆️ → <b>Adicionar ao ecrã principal</b>, abre o app pelo ícone e carrega outra vez no 🔔.' : 'Este navegador não suporta notificações. Usa o Chrome.') + '</div>'), $('#sheet [data-close]').onclick = fecharModal;
    }
    abrirModal('<h2>Notificações<button class="x" data-close>✕</button></h2><p>Ativa para receberes aviso quando te marcam ou mudam um trabalho, e 1 hora antes de cada trabalho.</p>' +
      '<button class="btn" id="nOn">🔔 Ativar notificações</button><button class="btn ghost" id="nTest">Enviar notificação de teste</button>');
    $('#sheet [data-close]').onclick = fecharModal;
    $('#nOn').onclick = function () {
      var btn = this; btn.disabled = true;
      Notification.requestPermission().then(function (p) {
        if (p !== 'granted') throw new Error('Permissão negada. Ativa nas definições do telemóvel.');
        return navigator.serviceWorker.ready;
      }).then(function (reg) {
        return reg.pushManager.getSubscription().then(function (s) { return s || reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(S.vapid) }); });
      }).then(function (sub) { return api('subscribe', { sub: sub.toJSON() }); })
        .then(function () { $('#btnBell').textContent = '🔔'; btn.textContent = '✅ Notificações ativas'; toast('Notificações ativas ✅'); })
        .catch(function (e) { btn.disabled = false; toast(e.message, 5000); });
    };
    $('#nTest').onclick = function () { api('testPush').then(function () { toast('Enviada. Deve chegar em segundos.'); }).catch(function (e) { toast(e.message); }); };
  }

  arrancar();
})();
