/**
 * SANTOS DESENTOPE — backend (Google Apps Script + Google Sheets)
 * Projeto independente. Não partilha nada com outros apps.
 *
 * Primeira vez: correr a função configurar no editor (cria separadores,
 * utilizadores, chaves VAPID e os acionadores automáticos).
 */

var TZ = 'Europe/Lisbon';
var IVA = 0.23;
var COMISSAO = 0.10;
var SUB_EMAIL = 'mailto:a.desentoppt@gmail.com';
var PASTA_FOTOS = 'Santos Desentope - Fotos';

var ESTADOS = ['Agendado', 'Orçamento dado', 'Concluído', 'Concluído – cliente falta pagar', 'Orçamento recusado'];
var CONCLUIDOS = ['Concluído', 'Concluído – cliente falta pagar'];

var JOB_COLS = ['id', 'data', 'hora', 'cliente', 'telefone', 'morada', 'servico', 'tecnicos', 'estado',
  'querFatura', 'nomeFatura', 'nif', 'moradaFatura', 'valor', 'material', 'custoMaterial', 'taxaDeslocacao',
  'formaPagamento', 'pago', 'dataPago', 'fotos', 'notas', 'notasTecnico', 'concluidoEm', 'faturaFeita',
  'dataFatura', 'lembrete1h', 'ultimoLembreteFatura', 'criadoPor', 'criadoEm', 'atualizadoEm'];
var USER_COLS = ['nome', 'pin', 'admin', 'tecnico', 'comissao'];
var SUB_COLS = ['nome', 'endpoint', 'p256dh', 'auth', 'criadoEm'];
var NOTIF_COLS = ['endpoint', 'titulo', 'corpo', 'jobId', 'criadoEm', 'entregue'];

/* ======================= CONFIGURAÇÃO INICIAL ======================= */

function configurar() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.setSpreadsheetTimeZone(TZ);
  ss.rename('Santos Desentope - Dados');
  folha_('Trabalhos', JOB_COLS);
  var u = folha_('Utilizadores', USER_COLS);
  folha_('Subscricoes', SUB_COLS);
  folha_('Notificacoes', NOTIF_COLS);
  // Os PINs verdadeiros estão só na folha Google (separador Utilizadores), não aqui.
  if (u.getLastRow() < 2) {
    u.getRange(2, 1, 5, 5).setValues([
      ['Thiago', '0000', 'sim', 'sim', 'nao'],
      ['Keila', '0000', 'sim', 'nao', 'nao'],
      ['Lucas', '0000', 'nao', 'sim', 'sim'],
      ['Higor', '0000', 'nao', 'sim', 'sim'],
      ['Ozeias', '0000', 'nao', 'sim', 'sim']
    ]);
  }
  var s1 = ss.getSheetByName('Sheet1') || ss.getSheetByName('Página1') || ss.getSheetByName('Folha1');
  if (s1 && ss.getSheets().length > 1 && s1.getLastRow() === 0) ss.deleteSheet(s1);
  vapidKeys_();
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('verificarLembretes').timeBased().everyMinutes(5).create();
  pastaFotos_();
  return 'OK';
}

function folha_(nome, cols) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(nome);
  if (!sh) sh = ss.insertSheet(nome);
  sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold');
  sh.getRange(1, 1, sh.getMaxRows(), cols.length).setNumberFormat('@');
  sh.setFrozenRows(1);
  return sh;
}

/* ============================ API ============================ */

function doGet() {
  return json_({ ok: true, app: 'Santos Desentope' });
}

function doPost(e) {
  var req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, erro: 'Pedido inválido' }); }
  try {
    if (req.action === 'pull') return json_({ ok: true, notifs: puxarNotificacoes_(req.endpoint) });
    var user = utilizadorPorPin_(req.pin);
    if (!user) return json_({ ok: false, erro: 'PIN errado' });
    var r = acao_(req, user);
    r.ok = true;
    return json_(r);
  } catch (err) {
    return json_({ ok: false, erro: String(err && err.message || err) });
  }
}

function acao_(req, user) {
  switch (req.action) {
    case 'login':
      return { user: publico_(user), tecnicos: listaTecnicos_(), vapid: vapidKeys_().pub };
    case 'list':
      return { jobs: listarTrabalhos_(user) };
    case 'save':
      exigeAdmin_(user);
      return { job: guardarTrabalho_(req.job, user) };
    case 'close':
      return { job: fecharTrabalho_(req.job, user) };
    case 'foto':
      return { job: adicionarFoto_(req.id, req.data, user) };
    case 'removerFoto':
      return { job: removerFoto_(req.id, req.fotoId, user) };
    case 'pago':
      exigeAdmin_(user);
      return { job: marcarPago_(req.id, req.forma) };
    case 'fatura':
      exigeAdmin_(user);
      return { job: marcarFatura_(req.id) };
    case 'apagar':
      exigeAdmin_(user);
      apagarTrabalho_(req.id);
      return {};
    case 'subscribe':
      guardarSubscricao_(user, req.sub);
      return {};
    case 'testPush':
      notificarPessoa_(user.nome, 'Santos Desentope', 'As notificações estão a funcionar ✅', '');
      return {};
    default:
      throw new Error('Ação desconhecida');
  }
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

/* ========================= UTILIZADORES ========================= */

function utilizadores_() {
  return linhas_('Utilizadores', USER_COLS).map(function (r) {
    return {
      nome: String(r.nome).trim(), pin: String(r.pin).trim(),
      admin: /^s/i.test(r.admin), tecnico: /^s/i.test(r.tecnico), comissao: /^s/i.test(r.comissao)
    };
  }).filter(function (u) { return u.nome; });
}

function utilizadorPorPin_(pin) {
  pin = String(pin || '').trim();
  if (!/^\d{4}$/.test(pin)) return null;
  var us = utilizadores_();
  for (var i = 0; i < us.length; i++) if (us[i].pin === pin) return us[i];
  return null;
}

function publico_(u) { return { nome: u.nome, admin: u.admin, tecnico: u.tecnico, comissao: u.comissao }; }

function listaTecnicos_() {
  return utilizadores_().filter(function (u) { return u.tecnico; })
    .map(function (u) { return { nome: u.nome, comissao: u.comissao }; });
}

function exigeAdmin_(u) { if (!u.admin) throw new Error('Só os donos podem fazer isto'); }

/* =========================== TRABALHOS =========================== */

function linhas_(nome, cols) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(nome);
  var n = sh.getLastRow() - 1;
  if (n < 1) return [];
  var vals = sh.getRange(2, 1, n, cols.length).getDisplayValues();
  return vals.map(function (row, i) {
    var o = { _row: i + 2 };
    cols.forEach(function (c, j) { o[c] = row[j]; });
    return o;
  });
}

function escreve_(nome, cols, obj) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(nome);
  var row = cols.map(function (c) { return obj[c] == null ? '' : String(obj[c]); });
  if (obj._row) sh.getRange(obj._row, 1, 1, cols.length).setValues([row]);
  else { sh.appendRow(row); obj._row = sh.getLastRow(); }
  return obj;
}

function tecnicosDe_(job) {
  return String(job.tecnicos || '').split(',').map(function (s) { return s.trim(); }).filter(String);
}

function paraCliente_(j) {
  var o = {};
  JOB_COLS.forEach(function (c) { o[c] = j[c]; });
  o.fotos = j.fotos ? JSON.parse(j.fotos) : [];
  o.tecnicos = tecnicosDe_(j);
  o.querFatura = j.querFatura === 'sim';
  o.pago = j.pago === 'sim';
  o.faturaFeita = j.faturaFeita === 'sim';
  ['valor', 'custoMaterial', 'taxaDeslocacao'].forEach(function (k) { o[k] = num_(j[k]); });
  delete o.lembrete1h; delete o.ultimoLembreteFatura;
  return o;
}

function num_(v) {
  var n = parseFloat(String(v || '').replace(',', '.'));
  return isNaN(n) ? 0 : Math.round(n * 100) / 100;
}

function listarTrabalhos_(user) {
  var jobs = linhas_('Trabalhos', JOB_COLS);
  if (!user.admin) jobs = jobs.filter(function (j) { return tecnicosDe_(j).indexOf(user.nome) >= 0; });
  return jobs.map(paraCliente_);
}

function trabalhoPorId_(id) {
  var jobs = linhas_('Trabalhos', JOB_COLS);
  for (var i = 0; i < jobs.length; i++) if (jobs[i].id === id) return jobs[i];
  throw new Error('Trabalho não encontrado');
}

function agora_() { return Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd'T'HH:mm:ss"); }

function comLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function guardarTrabalho_(d, user) {
  return comLock_(function () {
    var antigo = null, job;
    if (d.id) { job = trabalhoPorId_(d.id); antigo = JSON.parse(JSON.stringify(job)); }
    else job = { id: Utilities.getUuid().slice(0, 8), criadoPor: user.nome, criadoEm: agora_(), estado: 'Agendado', fotos: '[]', pago: 'nao', faturaFeita: 'nao' };
    if (!d.data || !d.hora) throw new Error('Falta a data ou a hora');
    var tecs = (d.tecnicos || []).filter(String);
    if (!tecs.length) throw new Error('Escolhe pelo menos um técnico');
    ['data', 'hora', 'cliente', 'telefone', 'morada', 'servico', 'notas', 'nomeFatura', 'nif', 'moradaFatura', 'formaPagamento', 'material'].forEach(function (k) {
      if (d[k] !== undefined) job[k] = String(d[k] || '').trim();
    });
    job.tecnicos = tecs.join(', ');
    if (d.estado && ESTADOS.indexOf(d.estado) >= 0) aplicaEstado_(job, d.estado);
    if (d.querFatura !== undefined) job.querFatura = d.querFatura ? 'sim' : 'nao';
    ['valor', 'custoMaterial', 'taxaDeslocacao'].forEach(function (k) { if (d[k] !== undefined) job[k] = num_(d[k]); });
    if (d.pago !== undefined) { job.pago = d.pago ? 'sim' : 'nao'; if (d.pago && !job.dataPago) job.dataPago = agora_(); }
    if (antigo && (antigo.data !== job.data || antigo.hora !== job.hora)) job.lembrete1h = '';
    job.atualizadoEm = agora_();
    escreve_('Trabalhos', JOB_COLS, job);
    avisarTecnicos_(antigo, job, user);
    return paraCliente_(job);
  });
}

function aplicaEstado_(job, estado) {
  job.estado = estado;
  if (CONCLUIDOS.indexOf(estado) >= 0 || estado === 'Orçamento recusado') {
    if (!job.concluidoEm) job.concluidoEm = agora_();
  } else job.concluidoEm = '';
  if (estado === 'Concluído') { if (job.pago !== 'sim') { job.pago = 'sim'; job.dataPago = agora_(); } }
  if (estado === 'Concluído – cliente falta pagar') { job.pago = 'nao'; job.dataPago = ''; }
}

function fecharTrabalho_(d, user) {
  return comLock_(function () {
    var job = trabalhoPorId_(d.id);
    if (!user.admin && tecnicosDe_(job).indexOf(user.nome) < 0) throw new Error('Este trabalho não é teu');
    if (ESTADOS.indexOf(d.estado) < 0) throw new Error('Estado inválido');
    var estadoAntes = job.estado;
    ['material', 'notasTecnico', 'formaPagamento', 'nomeFatura', 'nif', 'moradaFatura'].forEach(function (k) {
      if (d[k] !== undefined) job[k] = String(d[k] || '').trim();
    });
    ['valor', 'custoMaterial', 'taxaDeslocacao'].forEach(function (k) { if (d[k] !== undefined) job[k] = num_(d[k]); });
    if (d.querFatura !== undefined) job.querFatura = d.querFatura ? 'sim' : 'nao';
    if (job.querFatura === 'sim' && CONCLUIDOS.indexOf(d.estado) >= 0 && !/^\d{9}$/.test(String(job.nif || '').replace(/\s/g, '')))
      throw new Error('Para fatura é preciso o NIF (9 números)');
    aplicaEstado_(job, d.estado);
    job.atualizadoEm = agora_();
    escreve_('Trabalhos', JOB_COLS, job);
    if (estadoAntes !== job.estado) {
      var txt = user.nome + ': ' + job.estado + ' — ' + (job.cliente || 'cliente') + (job.morada ? ', ' + job.morada : '');
      utilizadores_().forEach(function (u) { if (u.admin && u.nome !== user.nome) notificarPessoa_(u.nome, 'Trabalho atualizado', txt, job.id); });
    }
    return paraCliente_(job);
  });
}

function pastaFotos_() {
  var it = DriveApp.getFoldersByName(PASTA_FOTOS);
  return it.hasNext() ? it.next() : DriveApp.createFolder(PASTA_FOTOS);
}

function adicionarFoto_(id, dataUrl, user) {
  var job = trabalhoPorId_(id);
  if (!user.admin && tecnicosDe_(job).indexOf(user.nome) < 0) throw new Error('Este trabalho não é teu');
  var m = String(dataUrl).match(/^data:(image\/[a-z]+);base64,(.+)$/);
  if (!m) throw new Error('Foto inválida');
  var blob = Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], id + '_' + Date.now() + '.jpg');
  var f = pastaFotos_().createFile(blob);
  f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return comLock_(function () {
    job = trabalhoPorId_(id);
    var fotos = job.fotos ? JSON.parse(job.fotos) : [];
    fotos.push(f.getId());
    job.fotos = JSON.stringify(fotos);
    job.atualizadoEm = agora_();
    escreve_('Trabalhos', JOB_COLS, job);
    return paraCliente_(job);
  });
}

function removerFoto_(id, fotoId, user) {
  return comLock_(function () {
    var job = trabalhoPorId_(id);
    if (!user.admin && tecnicosDe_(job).indexOf(user.nome) < 0) throw new Error('Este trabalho não é teu');
    var fotos = (job.fotos ? JSON.parse(job.fotos) : []).filter(function (f) { return f !== fotoId; });
    job.fotos = JSON.stringify(fotos);
    escreve_('Trabalhos', JOB_COLS, job);
    try { DriveApp.getFileById(fotoId).setTrashed(true); } catch (e) {}
    return paraCliente_(job);
  });
}

function marcarPago_(id, forma) {
  return comLock_(function () {
    var job = trabalhoPorId_(id);
    job.pago = 'sim'; job.dataPago = agora_();
    if (forma) job.formaPagamento = forma;
    if (job.estado === 'Concluído – cliente falta pagar') job.estado = 'Concluído';
    job.atualizadoEm = agora_();
    escreve_('Trabalhos', JOB_COLS, job);
    return paraCliente_(job);
  });
}

function marcarFatura_(id) {
  return comLock_(function () {
    var job = trabalhoPorId_(id);
    job.faturaFeita = 'sim'; job.dataFatura = agora_();
    escreve_('Trabalhos', JOB_COLS, job);
    return paraCliente_(job);
  });
}

function apagarTrabalho_(id) {
  comLock_(function () {
    var job = trabalhoPorId_(id);
    SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Trabalhos').deleteRow(job._row);
    tecnicosDe_(job).forEach(function (t) {
      notificarPessoa_(t, 'Trabalho cancelado', dataBonita_(job) + ' — ' + (job.cliente || '') + ' ' + (job.morada || ''), '');
    });
  });
}

function dataBonita_(job) {
  var p = String(job.data).split('-');
  return (p.length === 3 ? p[2] + '/' + p[1] : job.data) + ' às ' + job.hora;
}

function avisarTecnicos_(antigo, job, autor) {
  var novos = tecnicosDe_(job), velhos = antigo ? tecnicosDe_(antigo) : [];
  var resumo = dataBonita_(job) + ' — ' + (job.servico || 'Trabalho') + (job.morada ? ' · ' + job.morada : '');
  novos.forEach(function (t) {
    if (t === autor.nome) return;
    if (velhos.indexOf(t) < 0) notificarPessoa_(t, 'Novo trabalho marcado', resumo, job.id);
    else if (mudou_(antigo, job)) notificarPessoa_(t, 'Trabalho alterado', resumo, job.id);
  });
  velhos.forEach(function (t) {
    if (novos.indexOf(t) < 0 && t !== autor.nome) notificarPessoa_(t, 'Saíste de um trabalho', resumo, '');
  });
}

function mudou_(a, b) {
  return ['data', 'hora', 'cliente', 'telefone', 'morada', 'servico', 'notas', 'tecnicos'].some(function (k) {
    return String(a[k] || '') !== String(b[k] || '');
  });
}

/* ======================= LEMBRETES AUTOMÁTICOS ======================= */

function verificarLembretes() {
  var agora = new Date();
  var hora = Number(Utilities.formatDate(agora, TZ, 'H'));
  var jobs = linhas_('Trabalhos', JOB_COLS);
  var admins = utilizadores_().filter(function (u) { return u.admin; });
  jobs.forEach(function (job) {
    // 1 hora antes
    if ((job.estado === 'Agendado' || job.estado === 'Orçamento dado') && !job.lembrete1h && job.data && job.hora) {
      var ini = Utilities.parseDate(job.data + ' ' + job.hora, TZ, 'yyyy-MM-dd HH:mm');
      var mins = (ini.getTime() - agora.getTime()) / 60000;
      if (mins > 0 && mins <= 62) {
        tecnicosDe_(job).forEach(function (t) {
          notificarPessoa_(t, 'Daqui a ' + Math.round(mins) + ' min', (job.servico || 'Trabalho') + ' — ' + (job.cliente || '') + (job.morada ? ' · ' + job.morada : ''), job.id);
        });
        job.lembrete1h = agora_();
        escreve_('Trabalhos', JOB_COLS, job);
      }
    }
    // Faturas: 24 h depois de concluído, repete a cada 24 h (só entre as 9h e as 21h)
    if (precisaFatura_(job) && job.faturaFeita !== 'sim' && job.concluidoEm && hora >= 9 && hora < 21) {
      var conc = Utilities.parseDate(job.concluidoEm, TZ, "yyyy-MM-dd'T'HH:mm:ss");
      var ultimo = job.ultimoLembreteFatura ? Utilities.parseDate(job.ultimoLembreteFatura, TZ, "yyyy-MM-dd'T'HH:mm:ss") : null;
      var DIA = 24 * 3600 * 1000;
      if (agora - conc >= DIA && (!ultimo || agora - ultimo >= DIA)) {
        admins.forEach(function (u) {
          notificarPessoa_(u.nome, '🧾 Fatura por fazer', (job.nomeFatura || job.cliente || 'Cliente') + ' — NIF ' + job.nif + ' · ' + eur_(baseJob_(job) * (1 + IVA)), job.id);
        });
        job.ultimoLembreteFatura = agora_();
        escreve_('Trabalhos', JOB_COLS, job);
      }
    }
  });
  limparNotificacoes_();
}

function baseJob_(job) {
  if (CONCLUIDOS.indexOf(job.estado) >= 0) return num_(job.valor) + num_(job.taxaDeslocacao);
  if (job.estado === 'Orçamento recusado') return num_(job.taxaDeslocacao);
  return 0;
}
function precisaFatura_(job) { return job.querFatura === 'sim' && baseJob_(job) > 0; }

function eur_(n) { return n.toFixed(2).replace('.', ',') + ' €'; }

/* ========================= WEB PUSH (VAPID) ========================= */

function guardarSubscricao_(user, sub) {
  if (!sub || !sub.endpoint) throw new Error('Subscrição inválida');
  comLock_(function () {
    var subs = linhas_('Subscricoes', SUB_COLS);
    var ex = subs.filter(function (s) { return s.endpoint === sub.endpoint; })[0];
    var o = ex || {};
    o.nome = user.nome; o.endpoint = sub.endpoint;
    o.p256dh = sub.keys ? sub.keys.p256dh : ''; o.auth = sub.keys ? sub.keys.auth : '';
    o.criadoEm = agora_();
    escreve_('Subscricoes', SUB_COLS, o);
  });
}

function notificarPessoa_(nome, titulo, corpo, jobId) {
  var subs = linhas_('Subscricoes', SUB_COLS).filter(function (s) { return s.nome === nome; });
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Notificacoes');
  var mortos = [];
  subs.forEach(function (s) {
    sh.appendRow([s.endpoint, titulo, corpo, jobId || '', agora_(), 'nao']);
    var code = enviarPush_(s.endpoint);
    if (code === 404 || code === 410) mortos.push(s._row);
  });
  if (mortos.length) {
    var ssh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Subscricoes');
    mortos.sort(function (a, b) { return b - a; }).forEach(function (r) { ssh.deleteRow(r); });
  }
}

function puxarNotificacoes_(endpoint) {
  if (!endpoint) return [];
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Notificacoes');
  var out = [];
  linhas_('Notificacoes', NOTIF_COLS).forEach(function (n) {
    if (n.endpoint === endpoint && n.entregue !== 'sim') {
      out.push({ titulo: n.titulo, corpo: n.corpo, jobId: n.jobId });
      sh.getRange(n._row, 6).setValue('sim');
    }
  });
  return out;
}

function limparNotificacoes_() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Notificacoes');
  var lim = Utilities.formatDate(new Date(Date.now() - 3 * 24 * 3600 * 1000), TZ, "yyyy-MM-dd'T'HH:mm:ss");
  var rows = linhas_('Notificacoes', NOTIF_COLS).filter(function (n) { return n.criadoEm < lim; }).map(function (n) { return n._row; });
  rows.sort(function (a, b) { return b - a; }).forEach(function (r) { sh.deleteRow(r); });
}

function enviarPush_(endpoint) {
  var keys = vapidKeys_();
  var aud = endpoint.match(/^https:\/\/[^\/]+/)[0];
  var jwt = vapidJwt_(aud, keys);
  try {
    var r = UrlFetchApp.fetch(endpoint, {
      method: 'post',
      headers: { 'TTL': '86400', 'Urgency': 'high', 'Authorization': 'vapid t=' + jwt + ', k=' + keys.pub },
      payload: '',
      muteHttpExceptions: true
    });
    return r.getResponseCode();
  } catch (e) { return 0; }
}

function vapidKeys_() {
  var p = PropertiesService.getScriptProperties();
  var pub = p.getProperty('VAPID_PUB'), priv = p.getProperty('VAPID_PRIV');
  if (!pub || !priv) {
    var d;
    do { d = bytesToBig_(randomBytes_(32)); } while (d === N0_ || d >= EC_N);
    var Q = ecMul_(d, EC_G);
    pub = b64u_([4].concat(bigToBytes_(Q[0]), bigToBytes_(Q[1])));
    priv = b64u_(bigToBytes_(d));
    p.setProperty('VAPID_PUB', pub); p.setProperty('VAPID_PRIV', priv);
  }
  return { pub: pub, priv: priv };
}

function vapidJwt_(aud, keys) {
  var head = b64u_(utf8_(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  var body = b64u_(utf8_(JSON.stringify({ aud: aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: SUB_EMAIL })));
  var msg = head + '.' + body;
  var sig = ecdsaSign_(utf8_(msg), bytesToBig_(b64uDec_(keys.priv)));
  return msg + '.' + b64u_(sig);
}

/* ---- P-256 em JavaScript puro (BigInt) ---- */
var N0_ = BigInt(0), N1_ = BigInt(1), N2_ = BigInt(2), N3_ = BigInt(3), N4_ = BigInt(4), N8_ = BigInt(8);
var EC_P = BigInt('0xffffffff00000001000000000000000000000000ffffffffffffffffffffffff');
var EC_N = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551');
var EC_A = EC_P - N3_;
var EC_G = [BigInt('0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296'),
  BigInt('0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5')];

function mod_(a, m) { var r = a % m; return r < N0_ ? r + m : r; }
function inv_(a, m) {
  var lm = N1_, hm = N0_, low = mod_(a, m), high = m;
  while (low > N1_) { var r = high / low; var nm = hm - lm * r, nw = high - low * r; hm = lm; lm = nm; high = low; low = nw; }
  return mod_(lm, m);
}
// Pontos em coordenadas Jacobianas [X, Y, Z]
function jDouble_(P) {
  if (P[1] === N0_ || P[2] === N0_) return [N0_, N0_, N0_];
  var X = P[0], Y = P[1], Z = P[2], p = EC_P;
  var YY = Y * Y % p, S = N4_ * X * YY % p, ZZ = Z * Z % p;
  var M = (N3_ * X * X + EC_A * ZZ * ZZ) % p;
  var nx = mod_(M * M - N2_ * S, p);
  var ny = mod_(M * (S - nx) - N8_ * YY * YY, p);
  var nz = N2_ * Y * Z % p;
  return [nx, ny, nz];
}
function jAdd_(P, Q) {
  if (P[2] === N0_) return Q; if (Q[2] === N0_) return P;
  var p = EC_P;
  var Z1Z1 = P[2] * P[2] % p, Z2Z2 = Q[2] * Q[2] % p;
  var U1 = P[0] * Z2Z2 % p, U2 = Q[0] * Z1Z1 % p;
  var S1 = P[1] * Q[2] % p * Z2Z2 % p, S2 = Q[1] * P[2] % p * Z1Z1 % p;
  if (U1 === U2) return S1 === S2 ? jDouble_(P) : [N0_, N0_, N0_];
  var H = mod_(U2 - U1, p), R = mod_(S2 - S1, p);
  var HH = H * H % p, HHH = H * HH % p, V = U1 * HH % p;
  var nx = mod_(R * R - HHH - N2_ * V, p);
  var ny = mod_(R * (V - nx) - S1 * HHH, p);
  var nz = H * P[2] % p * Q[2] % p;
  return [nx, ny, nz];
}
function ecMul_(k, G) {
  var R = [N0_, N0_, N0_], A = [G[0], G[1], N1_];
  while (k > N0_) { if (k & N1_) R = jAdd_(R, A); A = jDouble_(A); k >>= N1_; }
  var zi = inv_(R[2], EC_P), zi2 = zi * zi % EC_P;
  return [R[0] * zi2 % EC_P, R[1] * zi2 % EC_P * zi % EC_P];
}
function ecdsaSign_(msgBytes, d) {
  var z = bytesToBig_(sha256_(msgBytes));
  while (true) {
    var k = mod_(bytesToBig_(sha256_(randomBytes_(32).concat(bigToBytes_(d), bigToBytes_(z)))), EC_N);
    if (k === N0_) continue;
    var r = mod_(ecMul_(k, EC_G)[0], EC_N);
    if (r === N0_) continue;
    var s = mod_(inv_(k, EC_N) * (z + r * d), EC_N);
    if (s === N0_) continue;
    return bigToBytes_(r).concat(bigToBytes_(s));
  }
}

function bytesToBig_(b) { var h = '0x'; for (var i = 0; i < b.length; i++) h += ('0' + (b[i] & 255).toString(16)).slice(-2); return BigInt(h === '0x' ? '0' : h); }
function bigToBytes_(n) { var h = n.toString(16); while (h.length < 64) h = '0' + h; var o = []; for (var i = 0; i < 64; i += 2) o.push(parseInt(h.substr(i, 2), 16)); return o; }
function sha256_(bytes) {
  var signed = bytes.map(function (x) { return x > 127 ? x - 256 : x; });
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, signed).map(function (x) { return x & 255; });
}
function randomBytes_(n) {
  var out = [];
  while (out.length < n) {
    var hex = Utilities.getUuid().replace(/-/g, '');
    for (var i = 0; i < hex.length && out.length < n; i += 2) out.push(parseInt(hex.substr(i, 2), 16));
  }
  // mistura com SHA-256 para remover os bits fixos do UUID
  return sha256_(out.concat(utf8_(String(Date.now() + Math.random())))).slice(0, n);
}
function utf8_(s) { return Utilities.newBlob(s).getBytes().map(function (x) { return x & 255; }); }
var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
function b64u_(bytes) {
  var s = '', i;
  for (i = 0; i + 2 < bytes.length; i += 3) { var n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2]; s += B64[n >> 18 & 63] + B64[n >> 12 & 63] + B64[n >> 6 & 63] + B64[n & 63]; }
  var rest = bytes.length - i;
  if (rest === 1) { var a = bytes[i] << 16; s += B64[a >> 18 & 63] + B64[a >> 12 & 63]; }
  if (rest === 2) { var b = (bytes[i] << 16) | (bytes[i + 1] << 8); s += B64[b >> 18 & 63] + B64[b >> 12 & 63] + B64[b >> 6 & 63]; }
  return s;
}
function b64uDec_(s) {
  var out = [], buf = 0, bits = 0;
  for (var i = 0; i < s.length; i++) { var v = B64.indexOf(s[i]); if (v < 0) continue; buf = (buf << 6) | v; bits += 6; if (bits >= 8) { bits -= 8; out.push((buf >> bits) & 255); } }
  return out;
}
