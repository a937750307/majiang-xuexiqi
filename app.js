/* 麻将学习器 · 对局流程与界面 */
(function () {
  'use strict';
  const M = window.MJ;
  const NAMES = ['你', '下家', '对家', '上家'];
  const SEAT_CLASS = ['bottom', 'right', 'top', 'left'];

  const DOT = [
    [[50, 50]],
    [[34, 30], [66, 70]],
    [[28, 26], [50, 50], [72, 74]],
    [[32, 30], [68, 30], [32, 70], [68, 70]],
    [[32, 28], [68, 28], [50, 50], [32, 72], [68, 72]],
    [[32, 20], [68, 20], [32, 50], [68, 50], [32, 80], [68, 80]],
    [[50, 14], [30, 38], [70, 38], [30, 60], [70, 60], [30, 82], [70, 82]],
    [[32, 15], [68, 15], [32, 37], [68, 37], [32, 63], [68, 63], [32, 85], [68, 85]],
    [[26, 26], [50, 26], [74, 26], [26, 50], [50, 50], [74, 50], [26, 74], [50, 74], [74, 74]]
  ];

  const state = {
    wall: [], players: [], turn: 0, dealer: 0, round: 1,
    phase: 'idle', lastDiscard: null, lastDraw: null,
    busy: false, hintsOn: true, pending: null,
    logs: [], result: null, analysisKey: '', analysis: null
  };
  let generation = 0; // 局次隔离：新开一局后丢弃旧局的异步流程
  const $ = id => document.getElementById(id);
  const delay = ms => new Promise(r => setTimeout(r, ms));
  const fixedOf = p => state.players[p].melds.length;

  /* ---------- 牌面渲染 ---------- */
  function tileHTML(id, o) {
    o = o || {};
    const cls = ['tile'];
    if (o.small) cls.push('small');
    if (o.tiny) cls.push('tiny');
    if (o.back) cls.push('tile-back');
    if (o.clickable) cls.push('clickable');
    if (o.recommended) cls.push('recommended');
    if (o.drawn) cls.push('drawn');
    if (o.dim) cls.push('dim');
    const attr = o.uid != null ? ' data-uid="' + o.uid + '"' : '';
    let face = '';
    if (!o.back) {
      if (id <= 8) {
        face = '<span class="wan"><i>' + M.CN_NUM[id] + '</i><b>萬</b></span>';
      } else if (id <= 17) {
        const n = id - 8; // 9..17 → 1..9 条
        face = n === 1
          ? '<span class="honor green" style="font-size:22px">丨</span>'
          : DOT[n - 1].map(p => '<i class="stick" style="left:' + p[0] + '%;top:' + p[1] + '%"></i>').join('');
      } else if (id <= 26) {
        face = DOT[id - 18].map(p => '<i class="dot" style="left:' + p[0] + '%;top:' + p[1] + '%"></i>').join('');
      } else if (id <= 30) {
        face = '<span class="honor">' + M.WINDS[id - 27] + '</span>';
      } else {
        face = '<span class="honor ' + ['red', 'green', ''][id - 31] + '">' + M.DRAGONS[id - 31] + '</span>';
      }
    }
    return '<div class="' + cls.join(' ') + '"' + attr + '>' +
      (face ? '<span class="tile-face">' + face + '</span>' : '') + '</div>';
  }

  /* ---------- 工具 ---------- */
  function removeById(hand, id, n) {
    for (let k = 0; k < n; k++) {
      const i = hand.findIndex(t => t.id === id);
      if (i >= 0) hand.splice(i, 1);
    }
  }
  function visibleFor(p) {
    const v = new Array(34).fill(0);
    state.players[p].hand.forEach(t => v[t.id]++);
    state.players.forEach(pl => {
      pl.river.forEach(t => v[t.id]++);
      pl.melds.forEach(m => m.tiles.forEach(id => v[id]++));
    });
    return v;
  }
  function visibleKey() {
    return state.wall.length + '|' + state.players.map(p =>
      p.river.map(t => t.id).join('') + '/' + p.melds.map(m => m.tiles.join('')).join('-')
    ).join('|');
  }
  function log(html) {
    state.logs.unshift(html);
    if (state.logs.length > 60) state.logs.pop();
    renderLog();
  }
  function renderLog() {
    $('log-body').innerHTML = state.logs.length
      ? state.logs.slice(0, 18).map(x => '<div class="log-item">' + x + '</div>').join('')
      : '<div class="empty-tip">对局开始后会记录在这里。</div>';
  }

  /* ---------- 开局 ---------- */
  function newGame() {
    generation++;
    if (state.pending && state.pending.resolve) state.pending.resolve(null);
    state.wall = M.shuffle(M.buildWall());
    state.players = [0, 1, 2, 3].map(i => ({
      name: NAMES[i], hand: [], melds: [], river: [], concealed: true, isAI: i !== 0
    }));
    for (let k = 0; k < 13; k++) {
      for (let p = 0; p < 4; p++) state.players[p].hand.push(state.wall.pop());
    }
    for (let p = 0; p < 4; p++) state.players[p].hand.sort((a, b) => a.id - b.id);
    state.turn = state.dealer;
    state.phase = 'discard';
    state.lastDiscard = null;
    state.lastDraw = null;
    state.pending = null;
    state.busy = false;
    state.result = null;
    state.logs = [];
    state.analysisKey = '';
    closeDialog();
    log('新的一局开始，庄家：<b>' + NAMES[state.dealer] + '</b>');
    render();
    startTurn(state.dealer);
  }

  /* ---------- 回合 ---------- */
  async function startTurn(p) {
    if (state.phase === 'over') return;
    const gen = generation;
    state.turn = p;
    state.lastDiscard = null;
    if (state.wall.length === 0) { drawGame(); return; }
    const tile = state.wall.pop();
    state.players[p].hand.push(tile);
    state.lastDraw = tile;
    state.phase = 'discard';
    state.analysisKey = '';
    render();

    if (p === 0) {
      if (M.isWinTiles(state.players[0].hand, fixedOf(0))) {
        log('<span class="hl">你摸到和牌张，可以自摸！</span>');
      }
      renderCoach();
    } else {
      state.busy = true;
      renderActionBar();
      await delay(220);
      if (gen !== generation) return;
      if (M.isWinTiles(state.players[p].hand, fixedOf(p))) {
        winGame(p, null, true);
        return;
      }
      state.busy = false;
      aiDiscard(p);
    }
  }

  function playerTurn() {
    state.phase = 'discard';
    state.analysisKey = '';
    render();
  }

  async function discard(p, tile) {
    if (!tile) return;
    const gen = generation;
    const pl = state.players[p];
    const i = pl.hand.findIndex(t => t.uid === tile.uid);
    if (i < 0) return;
    pl.hand.splice(i, 1);
    pl.river.push(tile);
    state.lastDiscard = { from: p, tile: tile };
    state.lastDraw = null;
    state.analysisKey = '';
    log('<b>' + pl.name + '</b> 打出 ' + M.tileName(tile.id));
    state.phase = 'claim';
    state.busy = true;
    render();
    await delay(90);
    if (gen !== generation) return;
    await resolveClaims(p, tile);
  }

  function aiDiscard(p) {
    const pl = state.players[p];
    const analysis = M.analyzeDiscards(pl.hand, visibleFor(p), fixedOf(p));
    const chosen = analysis.length > 1 && Math.random() < 0.25 ? analysis[1] : analysis[0];
    const tile = pl.hand.find(t => t.id === chosen.id);
    discard(p, tile);
  }

  /* ---------- 鸣牌判定 ---------- */
  function collectClaims(from, tile) {
    const out = [];
    for (let p = 0; p < 4; p++) {
      if (p === from) continue;
      const hand = state.players[p].hand;
      if (M.canWinWith(hand, tile.id, fixedOf(p))) out.push({ p, type: 'win', from });
      // 牌墙摸空后开杠无牌可补，会导致手牌少一张，直接禁止
      if (state.wall.length && M.canKong(hand, tile.id)) out.push({ p, type: 'kong', from });
      else if (M.canPung(hand, tile.id)) out.push({ p, type: 'pung', from });
      if (p === (from + 1) % 4) {
        M.chowOptions(hand, tile.id).forEach(combo => out.push({ p, type: 'chow', combo, from }));
      }
    }
    return out;
  }

  async function resolveClaims(from, tile) {
    const gen = generation;
    const claims = collectClaims(from, tile);
    const groups = [['win'], ['kong', 'pung'], ['chow']];
    for (const group of groups) {
      const pool = claims.filter(c => group.includes(c.type));
      if (!pool.length) continue;
      const human = pool.filter(c => c.p === 0);
      if (human.length) {
        const chosen = await waitHuman(human);
        if (gen !== generation) return;
        if (chosen) { await executeClaim(chosen.p, chosen, tile, from); return; }
      }
      for (const c of pool.filter(x => x.p !== 0)) {
        if (await aiAccept(c, tile)) {
          if (gen !== generation) return;
          await executeClaim(c.p, c, tile, from);
          return;
        }
      }
    }
    if (gen !== generation) return;
    state.busy = false;
    startTurn((from + 1) % 4);
  }

  function waitHuman(options) {
    return new Promise(resolve => {
      state.pending = { type: 'claim', options, resolve };
      state.busy = false;
      render();
    });
  }
  function answerClaim(idx) {
    const pending = state.pending;
    if (!pending) return;
    state.pending = null;
    state.busy = true;
    render();
    pending.resolve(idx < 0 ? null : pending.options[idx]);
  }

  async function aiAccept(c, tile) {
    if (c.type === 'win') return true;
    if (c.type === 'kong') return Math.random() < 0.75;
    const pl = state.players[c.p];
    const before = M.calcShanten(M.countsOf(pl.hand.map(t => t.id)), fixedOf(c.p));
    const cnt = M.countsOf(pl.hand.map(t => t.id));
    if (c.type === 'pung') cnt[tile.id] -= 2;
    else c.combo.forEach(x => { if (x !== tile.id) cnt[x]--; });
    const after = M.calcShanten(cnt, fixedOf(c.p));
    return after < before || (c.type === 'pung' && Math.random() < 0.2);
  }

  async function executeClaim(p, c, tile, from) {
    const gen = generation;
    const pl = state.players[p];
    if (c.type === 'win') { winGame(p, tile, false); return; }
    // 被鸣的牌已从打出者手中打出，鸣牌后归入副露，必须从河里移除，避免同一张牌计两次
    const river = state.players[from].river;
    const ri = river.findIndex(t => t.uid === tile.uid);
    if (ri >= 0) river.splice(ri, 1);
    if (c.type === 'pung' || c.type === 'kong') {
      removeById(pl.hand, tile.id, c.type === 'pung' ? 2 : 3);
      pl.melds.push({
        type: c.type,
        tiles: c.type === 'pung' ? [tile.id, tile.id, tile.id] : [tile.id, tile.id, tile.id, tile.id],
        from: c.from
      });
      log('<b>' + pl.name + '</b> ' + (c.type === 'pung' ? '碰' : '明杠') + ' ' + M.tileName(tile.id));
    } else if (c.type === 'chow') {
      c.combo.forEach(x => { if (x !== tile.id) removeById(pl.hand, x, 1); });
      pl.melds.push({ type: 'chow', tiles: c.combo.slice().sort((a, b) => a - b), from: c.from });
      log('<b>' + pl.name + '</b> 吃 ' + c.combo.map(M.tileShort).join(''));
    }
    pl.concealed = false;
    if (c.type === 'kong' && state.wall.length) pl.hand.push(state.wall.pop());
    state.lastDiscard = null;
    state.turn = p; // 鸣牌后由鸣牌者直接出牌，无需摸牌
    state.phase = 'discard';
    state.analysisKey = '';
    state.busy = false;
    render();
    if (p === 0) {
      renderCoach();
    } else {
      state.busy = true;
      renderActionBar();
      await delay(240);
      if (gen !== generation) return;
      state.busy = false;
      aiDiscard(p);
    }
  }

  /* ---------- 和牌 / 流局 ---------- */
  function winGame(p, tile, selfDraw) {
    const pl = state.players[p];
    const fixed = fixedOf(p);
    const all = (selfDraw ? pl.hand.map(t => t.id) : pl.hand.map(t => t.id).concat(tile.id));
    const info = M.decomposeWin(all, fixed);
    // 防御：牌型无法分解时不进入结算，避免复盘渲染崩溃
    if (!info) { state.busy = false; state.pending = null; render(); return; }
    const allTiles = all.concat(pl.melds.reduce((a, m) => a.concat(m.tiles), []));
    const fan = M.evaluateFan(all, info, { selfDraw, concealed: pl.concealed, allTiles });
    state.phase = 'over';
    state.result = { p, all, info, fan, selfDraw, fixed, allTiles };
    state.busy = false;
    state.pending = null;
    log('<span class="hl">' + pl.name + (selfDraw ? ' 自摸和牌！' : ' 和牌！') + '</span>');
    render();
    showWinDialog();
  }

  function drawGame() {
    state.phase = 'over';
    state.result = null;
    state.busy = false;
    log('牌墙摸完，本局流局。');
    render();
    showDialog('<h2>流局</h2><div class="lead">牌墙已摸完，无人和牌</div>' +
      '<p>牌墙共 136 张，四人各 13 张起手，剩余牌全部摸完后仍未有人和牌，本局结束。</p>' +
      '<div class="close-row"><button class="solid-btn" data-act="new">再来一局</button></div>');
  }

  function showWinDialog() {
    const r = state.result;
    const d = M.decomposeWin(r.all, r.fixed);
    const parts = d.type === 'sevenPairs'
      ? d.pairs.map(i => '对 ' + M.tileName(i)).join('、')
      : '将 ' + M.tileName(d.pair) + '　·　' + d.melds.map(m =>
          (m.kind === 'chow' ? '顺 ' : '刻 ') + m.tiles.map(M.tileName).join('')).join('　·　');
    const tileRow = r.allTiles.slice().sort((a, b) => a - b)
      .map(id => tileHTML(id, { small: true })).join('');
    const html =
      '<h2>' + (r.p === 0 ? '你和牌了' : state.players[r.p].name + '和牌') + '</h2>' +
      '<div class="lead">' + (r.selfDraw ? '自摸' : '点和') + ' · 第 ' + state.round + ' 局</div>' +
      '<div class="win-tiles">' + tileRow + '</div>' +
      '<h3>牌型拆解</h3><p>' + parts + '</p>' +
      '<h3>番型</h3><div class="fan-list">' + r.fan.map(f =>
        '<div class="fan"><b>' + f.name + '</b><span>' + f.desc + '</span></div>').join('') + '</div>' +
      '<h3>点评</h3><p>' + reviewText(r, d) + '</p>' +
      '<div class="close-row"><button class="action-btn" data-act="close">查看牌桌</button>' +
      '<button class="solid-btn" data-act="new">再来一局</button></div>';
    showDialog(html);
  }

  function reviewText(r, d) {
    if (d.type === 'sevenPairs') {
      return '这手牌由七个对子组成，走的是「七对」路线。七对的关键在于尽早保留对子、避免过多吃碰，' +
        '因为一旦副露就无法成立。你在本局中保持了门清，思路是对的。';
    }
    const kinds = new Set(d.melds.map(m => m.kind));
    if (kinds.has('chow')) {
      return '这手牌以顺子为骨架，属于最常见的「四面子一将」结构。顺子讲究连张搭配，' +
        '出牌时优先留下能两面进张的搭子（如 4、5 万可等 3 或 6 万），进张面更宽。';
    }
    return '这手牌由刻子构成，走的是「碰碰和」路线。刻子路线依赖对子与碰牌，' +
      '进张较窄但一旦成型和牌很快；若初期对子较少，及时转向顺子路线通常更稳。';
  }

  function showDialog(html) { $('dialog').innerHTML = html; $('overlay').classList.remove('hidden'); }
  function closeDialog() { $('overlay').classList.add('hidden'); }

  /* ---------- 名词解释（面向新手） ---------- */
  const GLOSSARY = [
    { g: '牌与牌型', items: [
      { t: '万 / 条 / 筒', d: '三种数牌，各 1–9 共 27 种，每种 4 张。' },
      { t: '风牌 / 箭牌', d: '风牌是东南西北，箭牌是中发白；它们不能组顺子，只能三张相同成刻子。' },
      { t: '面子', d: '3 张一组，可以是顺子或刻子。标准和牌需要 4 组面子。' },
      { t: '顺子', d: '同一花色连续的三张，如三万四万五万。' },
      { t: '刻子', d: '三张完全相同的牌，如三张东风。' },
      { t: '将（雀头）', d: '一对相同的牌，是和牌的「眼睛」，每手和牌必须有且只有一对。' },
      { t: '七对子', d: '七个对子组成的特殊和牌型，不走「四面子一将」。' }
    ]},
    { g: '牌怎么组合', items: [
      { t: '标准和牌', d: '14 张＝4 组面子（每组 3 张）＋1 对将。面子是顺子或刻子，将是任意一对相同的牌。' },
      { t: '七对和牌', d: '14 张＝7 个对子。最常见的特殊组合，要求全程门清，不能吃碰杠。' },
      { t: '搭子', d: '还没凑成面子的两三张牌，如四万五万可等三万或六万，是组合的中间步骤。' },
      { t: '副露后怎么算', d: '吃、碰、杠各算 1 组固定面子（杠虽有 4 张仍算 1 组），手里只需凑齐其余面子与将。' },
      { t: '组合示例', d: '三万四万五万（顺）＋六筒七筒八筒（顺）＋三张东风（刻）＋二条三条四条（顺）＋一对五万（将）＝和牌。' }
    ]},
    { g: '离胡牌多远', items: [
      { t: '听牌', d: '只差一张就成和牌，摸到或别人打出那张就能胡。' },
      { t: '向听', d: '离听牌还差几步。0 向听＝已经听牌，1 向听＝再进一张就听，数字越小越好。' },
      { t: '进张', d: '摸到后能让向听变小的牌。进张越多，这手牌越好、越容易胡。' },
      { t: '剩余张数', d: '「某牌 剩 N 张」指这种牌全场还剩几张没露面，剩 0 张就等不到了。' }
    ]},
    { g: '别人打牌时', items: [
      { t: '吃', d: '只能吃上家打的牌，用手里两张凑成顺子。' },
      { t: '碰', d: '任意一家打的牌，只要手里有两张相同的，就能凑成刻子。' },
      { t: '杠', d: '四张相同的牌为一组杠，分明杠、暗杠、加杠；杠后从牌墙补摸一张。' },
      { t: '过', d: '放弃这次吃／碰／杠／胡的机会，让牌继续传给下一家。' },
      { t: '副露', d: '吃过、碰过或杠过，手牌会摊开一部分，就不再算门清。' },
      { t: '门清', d: '全程没有吃、碰、明杠，和牌时额外算一番。' }
    ]},
    { g: '和牌与结局', items: [
      { t: '和牌 / 胡', d: '凑齐 4 组面子＋1 对将，或七对子，就赢了这一局。' },
      { t: '自摸', d: '自己摸到关键牌而和牌。' },
      { t: '点炮', d: '和别人打出的牌而和牌，对方就是「点炮」的人。' },
      { t: '流局', d: '牌墙全部摸完仍没人和牌，本局结束。' }
    ]},
    { g: '界面用语', items: [
      { t: '推荐打出', d: '系统帮你挑的、当前最该打出去的那张牌，手牌里用红框标出。' },
      { t: '候选出牌', d: '其他能打的牌按好坏从上往下排，越靠前越好，第一行红字就是推荐。' }
    ]}
  ];

  function renderGlossary() {
    $('glossary-body').innerHTML = GLOSSARY.map(group =>
      '<div class="glossary-group"><h4>' + group.g + '</h4><dl>' +
      group.items.map(it => '<div class="glossary-item"><dt>' + it.t + '</dt><dd>' + it.d + '</dd></div>').join('') +
      '</dl></div>'
    ).join('');
  }

  /* ---------- 渲染 ---------- */
  function render() {
    for (let p = 0; p < 4; p++) renderSeat(p);
    renderCenter();
    renderActionBar();
    renderCoach();
  }

  function renderSeat(p) {
    const pl = state.players[p];
    const seat = $('seat-' + p);
    if (!pl || !seat) return;
    const isMe = p === 0;
    const active = state.turn === p && state.phase !== 'over';
    const canClick = isMe && state.phase === 'discard' && !state.busy && !state.pending;
    const analysis = canClick ? getAnalysis() : null;
    const recId = analysis && analysis[0] ? analysis[0].id : null;

    const hand = pl.hand.map((t, i) => {
      const o = isMe
        ? { uid: t.uid, clickable: canClick, recommended: canClick && t.id === recId,
            drawn: state.lastDraw && state.lastDraw.uid === t.uid && canClick }
        : { small: true, back: true };
      return tileHTML(t.id, o);
    }).join('');

    const river = pl.river.map(t => {
      const hot = state.lastDiscard && state.lastDiscard.tile.uid === t.uid;
      return tileHTML(t.id, { small: true, dim: hot && state.phase === 'over' });
    }).join('');

    const melds = pl.melds.map(m =>
      '<div class="meld">' + m.tiles.map(id => tileHTML(id, { tiny: true })).join('') + '</div>'
    ).join('');

    seat.className = 'seat seat-' + SEAT_CLASS[p] + (active ? ' active' : '');
    seat.innerHTML =
      '<div class="seat-head"><span class="seat-name">' + pl.name + '</span>' +
      (p === state.dealer ? '<span class="seat-tag">庄</span>' : '') +
      (pl.concealed ? '' : '<span class="seat-tag">已副露</span>') +
      '<span class="seat-tag">' + (pl.hand.length + pl.melds.reduce((s, m) => s + m.tiles.length, 0)) + ' 张</span></div>' +
      (isMe ? '<div class="hand mine">' + hand + '</div>' : '<div class="hand">' + hand + '</div>') +
      '<div class="melds">' + melds + '</div>' +
      '<div class="river">' + river + '</div>';
  }

  function renderCenter() {
    const status = state.phase === 'over'
      ? (state.result ? state.players[state.result.p].name + '和牌' : '流局')
      : (state.pending ? '轮到你鸣牌' : state.busy ? state.players[state.turn].name + '行动中' : '轮到你出牌');
    $('center').innerHTML =
      '<div class="round">第 ' + state.round + ' 局 · 东风场</div>' +
      '<div class="wall-count">' + state.wall.length + '</div>' +
      '<div class="wall-label">牌墙剩余</div>' +
      '<div class="status">' + status + '</div>';
  }

  function renderActionBar() {
    const bar = $('action-bar');
    if (state.phase === 'over') {
      bar.innerHTML = '<span class="action-hint">本局已结束。</span>' +
        '<button class="action-btn" data-act="new">新开一局</button>';
      return;
    }
    if (state.pending && state.pending.type === 'claim') {
      const btns = state.pending.options.map((o, i) => {
        const label = { win: '胡', kong: '杠', pung: '碰', chow: '吃' }[o.type] +
          (o.type === 'chow' ? ' ' + o.combo.map(M.tileShort).join('') : '');
        return '<button class="action-btn ' + (o.type === 'win' ? 'win' : '') +
          '" data-act="claim" data-opt="' + i + '">' + label + '</button>';
      }).join('');
      bar.innerHTML = '<span class="action-hint">可以鸣牌：</span>' + btns +
        '<button class="action-btn" data-act="claim" data-opt="-1">过</button>';
      return;
    }
    if (state.turn === 0 && state.phase === 'discard' && !state.busy) {
      const hand = state.players[0].hand;
      let btns = '';
      if (M.isWinTiles(hand, fixedOf(0))) btns += '<button class="action-btn win" data-act="selfwin">自摸</button>';
      const uniq = Array.from(new Set(hand.map(t => t.id)));
      // 牌墙摸空后开杠无牌可补，不提供杠按钮
      if (state.wall.length) {
        uniq.forEach(id => {
          if (M.canConcealedKong(hand, id))
            btns += '<button class="action-btn" data-act="ckong" data-id="' + id + '">暗杠 ' + M.tileShort(id) + '</button>';
        });
        state.players[0].melds.forEach((m, i) => {
          if (m.type === 'pung' && hand.some(t => t.id === m.tiles[0]))
            btns += '<button class="action-btn" data-act="akong" data-id="' + m.tiles[0] + '" data-i="' + i + '">加杠 ' + M.tileShort(m.tiles[0]) + '</button>';
        });
      }
      bar.innerHTML = '<span class="action-hint">点击一张手牌打出</span>' + btns;
      return;
    }
    bar.innerHTML = '<span class="action-hint">' +
      (state.busy ? state.players[state.turn].name + '思考中…' : '等待下一回合…') + '</span>';
  }

  function getAnalysis() {
    const key = state.players[0].hand.map(t => t.uid).join(',') + '|' + visibleKey();
    if (state.analysisKey !== key) {
      state.analysis = M.analyzeDiscards(state.players[0].hand, visibleFor(0), fixedOf(0));
      state.analysisKey = key;
    }
    return state.analysis;
  }

  function renderCoach() {
    const body = $('coach-body');
    if (!state.hintsOn) {
      body.innerHTML = '<div class="empty-tip">提示已关闭。<br>点击上方「提示 · 关」可重新开启。</div>';
      return;
    }
    if (state.phase === 'over') {
      body.innerHTML = '<div class="empty-tip">本局结束。<br>可在对局记录中回顾过程，或新开一局练习。</div>';
      return;
    }
    if (state.turn === 0 && state.phase === 'discard' && !state.busy) {
      const a = getAnalysis();
      if (!a || !a.length) { body.innerHTML = '<div class="empty-tip">正在分析手牌…</div>'; return; }
      const best = a[0];
      const rows = a.slice(0, 5).map((x, i) =>
        '<div class="rank-row ' + (i === 0 ? 'first' : '') + '">' +
        '<span class="r-name">' + (i + 1) + '. 打 ' + M.tileName(x.id) + '</span>' +
        '<span class="r-val">' + (x.shanten <= 0 ? '听牌' : x.shanten + ' 向听') + ' · 进张 ' + x.usefulCount + '</span></div>'
      ).join('');
      let waitPart = '';
      if (best.shanten === 0 && best.waits.length) {
        waitPart = '<div class="coach-section"><div class="coach-label">打出后听牌</div><div class="coach-tiles">' +
          best.waits.map(w => tileHTML(w.id, { tiny: true })).join('') +
          '</div><div class="coach-reason" style="margin-top:6px">' +
          best.waits.map(w => M.tileName(w.id) + ' 剩 ' + w.left + ' 张').join('、') + '</div></div>';
      }
      body.innerHTML =
        '<div class="coach-head">推荐打出 <em>' + M.tileName(best.id) + '</em></div>' +
        '<div class="coach-reason">' + M.explainDiscard(best, state.players[0].hand) + '</div>' +
        '<div class="coach-section"><div class="coach-label">候选出牌（按优劣排序）</div>' + rows + '</div>' +
        waitPart;
      return;
    }
    const hand = state.players[0].hand.map(t => t.id);
    const sh = M.calcShanten(M.countsOf(hand), fixedOf(0));
    if (sh === 0) {
      const waits = M.getWaits(hand, visibleFor(0), fixedOf(0));
      body.innerHTML = '<div class="coach-head">你已经<em>听牌</em></div>' +
        '<div class="coach-reason">等待以下牌即可和牌：</div>' +
        '<div class="coach-section"><div class="coach-tiles">' +
        (waits.length ? waits.map(w => tileHTML(w.id, { tiny: true })).join('') : '—') + '</div>' +
        '<div class="coach-reason" style="margin-top:6px">' +
        (waits.length ? waits.map(w => M.tileName(w.id) + ' 剩 ' + w.left + ' 张').join('、') : '剩余牌已被全部打出') +
        '</div></div>';
    } else {
      body.innerHTML = '<div class="coach-head">当前 <em>' + sh + ' 向听</em></div>' +
        '<div class="coach-reason">距离听牌还差 ' + sh + ' 步。轮到你出牌时，这里会给出逐张的推荐与理由。</div>';
    }
  }

  /* ---------- 玩家操作 ---------- */
  function doConcealedKong(id) {
    const pl = state.players[0];
    removeById(pl.hand, id, 4);
    pl.melds.push({ type: 'concealedKong', tiles: [id, id, id, id], from: 0 });
    if (state.wall.length) pl.hand.push(state.wall.pop());
    state.analysisKey = '';
    log('你 暗杠 ' + M.tileName(id));
    render();
  }
  function doAddedKong(id, idx) {
    const pl = state.players[0];
    removeById(pl.hand, id, 1);
    pl.melds[idx] = { type: 'kong', tiles: [id, id, id, id], from: pl.melds[idx].from };
    if (state.wall.length) pl.hand.push(state.wall.pop());
    state.analysisKey = '';
    log('你 加杠 ' + M.tileName(id));
    render();
  }

  /* ---------- 事件 ---------- */
  document.addEventListener('click', e => {
    const tile = e.target.closest('.tile.clickable');
    if (tile && state.turn === 0 && state.phase === 'discard' && !state.busy && !state.pending) {
      const t = state.players[0].hand.find(x => x.uid === Number(tile.dataset.uid));
      if (t) { state.busy = true; discard(0, t); }
      return;
    }
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === 'new') { newGame(); return; }
    if (act === 'close') { closeDialog(); return; }
    if (act === 'claim') { answerClaim(Number(btn.dataset.opt)); return; }
    if (act === 'selfwin') { winGame(0, null, true); return; }
    if (act === 'ckong') { doConcealedKong(Number(btn.dataset.id)); return; }
    if (act === 'akong') { doAddedKong(Number(btn.dataset.id), Number(btn.dataset.i)); return; }
  });

  $('new-btn').addEventListener('click', newGame);
  $('hint-btn').addEventListener('click', () => {
    state.hintsOn = !state.hintsOn;
    $('hint-btn').textContent = '提示 · ' + (state.hintsOn ? '开' : '关');
    renderCoach();
  });
  $('overlay').addEventListener('click', e => {
    if (e.target === $('overlay') && state.phase === 'over') closeDialog();
  });

  renderGlossary();
  newGame();
})();
