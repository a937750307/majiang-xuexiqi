/* 麻将规则引擎 —— 大众简化规则
 * 牌型索引 0-33：万 0-8 / 条 9-17 / 筒 18-26 / 风 27-30(东南西北) / 箭 31-33(中发白)
 */
(function (root, factory) {
  const MJ = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = MJ;
  else root.MJ = MJ;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CN_NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
  const WINDS = ['东', '南', '西', '北'];
  const DRAGONS = ['中', '发', '白'];
  const SUIT_NAME = ['万', '条', '筒'];

  function isSuited(t) { return t >= 0 && t <= 26; }
  function suitOf(t) { return t <= 8 ? 0 : t <= 17 ? 1 : t <= 26 ? 2 : 3; }
  function rankOf(t) { return t <= 26 ? (t % 9) + 1 : 0; }
  function sameSuit(a, b) { return suitOf(a) === suitOf(b); }

  function tileName(t) {
    if (t <= 8) return CN_NUM[t] + '万';
    if (t <= 17) return CN_NUM[t - 9] + '条';
    if (t <= 26) return CN_NUM[t - 18] + '筒';
    if (t <= 30) return WINDS[t - 27] + '风';
    return DRAGONS[t - 31];
  }
  function tileShort(t) {
    if (t <= 8) return CN_NUM[t] + '萬';
    if (t <= 17) return CN_NUM[t - 9] + '條';
    if (t <= 26) return CN_NUM[t - 18] + '筒';
    if (t <= 30) return WINDS[t - 27];
    return DRAGONS[t - 31];
  }

  let uidSeq = 0;
  function buildWall() {
    const wall = [];
    for (let t = 0; t < 34; t++) {
      for (let k = 0; k < 4; k++) wall.push({ id: t, uid: ++uidSeq });
    }
    return wall;
  }
  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function countsOf(tiles) {
    const c = new Array(34).fill(0);
    for (const t of tiles) c[typeof t === 'number' ? t : t.id]++;
    return c;
  }
  function countTotal(c) { return c.reduce((a, b) => a + b, 0); }

  /* ---------- 胡牌判定与分解 ---------- */

  // 在计数数组上尝试把 n 张牌全部分解为面子（刻子/顺子），返回是否可行
  function formMelds(c, need) {
    if (need === 0) return c.every(v => v === 0);
    let i = 0;
    while (i < 34 && c[i] === 0) i++;
    if (i >= 34) return false;

    if (c[i] >= 3) {
      c[i] -= 3;
      if (formMelds(c, need - 1)) { c[i] += 3; return true; }
      c[i] += 3;
    }
    if (isSuited(i) && (i % 9) <= 6 && c[i + 1] > 0 && c[i + 2] > 0) {
      c[i]--; c[i + 1]--; c[i + 2]--;
      if (formMelds(c, need - 1)) { c[i]++; c[i + 1]++; c[i + 2]++; return true; }
      c[i]++; c[i + 1]++; c[i + 2]++;
    }
    return false;
  }

  // 标准胡：4 面子 + 1 将
  // fixed = 已副露的面子数（吃/碰/杠各算 1 组）
  function isStandardWin(c, fixed) {
    fixed = fixed || 0;
    if (countTotal(c) !== 14 - 3 * fixed) return false;
    for (let i = 0; i < 34; i++) {
      if (c[i] >= 2) {
        c[i] -= 2;
        const ok = formMelds(c, 4 - fixed);
        c[i] += 2;
        if (ok) return true;
      }
    }
    return false;
  }

  // 七对子（副露后不成立）
  function isSevenPairs(c, fixed) {
    if (fixed) return false;
    if (countTotal(c) !== 14) return false;
    let pairs = 0;
    for (let i = 0; i < 34; i++) {
      if (c[i] % 2 !== 0) return false;
      pairs += c[i] / 2;
    }
    return pairs === 7;
  }

  function isWinTiles(tiles, fixed) {
    const c = countsOf(tiles);
    return isStandardWin(c, fixed) || isSevenPairs(c, fixed);
  }

  // 返回胡牌分解（用于复盘讲解），仅分解手牌部分
  function decomposeWin(tiles, fixed) {
    const c = countsOf(tiles);
    if (isSevenPairs(c, fixed)) {
      const pairs = [];
      for (let i = 0; i < 34; i++) for (let k = 0; k < c[i] / 2; k++) pairs.push(i);
      return { type: 'sevenPairs', pair: null, pairs, melds: [] };
    }
    for (let i = 0; i < 34; i++) {
      if (c[i] >= 2) {
        c[i] -= 2;
        const melds = extractMelds(c, 4 - (fixed || 0));
        c[i] += 2;
        if (melds) return { type: 'standard', pair: i, pairs: [], melds };
      }
    }
    return null;
  }

  function extractMelds(c, need) {
    if (need === 0) return c.every(v => v === 0) ? [] : null;
    let i = 0;
    while (i < 34 && c[i] === 0) i++;
    if (i >= 34) return null;
    if (c[i] >= 3) {
      c[i] -= 3;
      const rest = extractMelds(c, need - 1);
      c[i] += 3;
      if (rest) return [{ kind: 'pung', tiles: [i, i, i] }].concat(rest);
    }
    if (isSuited(i) && (i % 9) <= 6 && c[i + 1] > 0 && c[i + 2] > 0) {
      c[i]--; c[i + 1]--; c[i + 2]--;
      const rest = extractMelds(c, need - 1);
      c[i]++; c[i + 1]++; c[i + 2]++;
      if (rest) return [{ kind: 'chow', tiles: [i, i + 1, i + 2] }].concat(rest);
    }
    return null;
  }

  /* ---------- 向听数 / 听牌 / 有效牌 ---------- */

  // 最小向听数：-1=和牌, 0=听牌, 1=一向听 ...
  // 分花色求解：每个花色独立枚举 (面子数, 搭子数, 是否出将)，再做小规模 DP 合并
  const comboCache = new Map();
  function calcShanten(counts, fixed) {
    fixed = fixed || 0;
    function combos(base, size) {
      const key = base + ':' + counts.slice(base, base + size).join('');
      const cached = comboCache.get(key);
      if (cached) return cached;
      const set = new Set();
      function dfs(i, m, t, p) {
        while (i < base + size && counts[i] === 0) i++;
        if (i >= base + size) {
          set.add(Math.min(m, 4) + ',' + Math.min(t, 4) + ',' + p);
          return;
        }
        const v = counts[i];
        if (v >= 3) { counts[i] -= 3; dfs(i, m + 1, t, p); counts[i] += 3; }
        if (size === 9 && i - base <= 6 && counts[i + 1] > 0 && counts[i + 2] > 0) {
          counts[i]--; counts[i + 1]--; counts[i + 2]--;
          dfs(i, m + 1, t, p);
          counts[i]++; counts[i + 1]++; counts[i + 2]++;
        }
        if (v >= 2) {
          counts[i] -= 2;
          dfs(i, m, t + 1, p);
          if (!p) dfs(i, m, t, 1);
          counts[i] += 2;
        }
        if (size === 9 && i - base <= 7 && counts[i + 1] > 0) {
          counts[i]--; counts[i + 1]--;
          dfs(i, m, t + 1, p);
          counts[i]++; counts[i + 1]++;
        }
        if (size === 9 && i - base <= 6 && counts[i + 2] > 0) {
          counts[i]--; counts[i + 2]--;
          dfs(i, m, t + 1, p);
          counts[i]++; counts[i + 2]++;
        }
        dfs(i + 1, m, t, p);
      }
      dfs(base, 0, 0, 0);
      const result = Array.from(set).map(s => s.split(',').map(Number));
      if (comboCache.size < 20000) comboCache.set(key, result);
      return result;
    }

    const groups = [combos(0, 9), combos(9, 9), combos(18, 9), combos(27, 7)];
    let states = [[0, 0, 0]];
    for (const grp of groups) {
      const next = [];
      const seen = new Set();
      for (const st of states) {
        for (const g of grp) {
          const M = st[0] + g[0], T = st[1] + g[1], P = st[2] + g[2];
          if (M + T + fixed > 4 || P > 1) continue;
          const key = M + ',' + T + ',' + P;
          if (seen.has(key)) continue;
          seen.add(key);
          next.push([M, T, P]);
        }
      }
      states = next;
    }
    let best = 0;
    for (const st of states) best = Math.max(best, 2 * st[0] + st[1] + st[2]);
    let shanten = 8 - 2 * fixed - best;

    if (!fixed) {
      let pairs = 0, kinds = 0;
      for (let i = 0; i < 34; i++) {
        if (counts[i] > 0) kinds++;
        pairs += Math.floor(counts[i] / 2);
      }
      const seven = 6 - pairs + Math.max(0, 7 - kinds);
      shanten = Math.min(shanten, seven);
    }
    return shanten;
  }

  // 13 张手牌的听牌（visible 为已见牌计数，含自己手牌）
  function getWaits(tiles13, visible, fixed) {
    const c = countsOf(tiles13);
    const waits = [];
    for (let t = 0; t < 34; t++) {
      if (visible && visible[t] >= 4) continue;
      c[t]++;
      const win = isStandardWin(c, fixed) || isSevenPairs(c, fixed);
      c[t]--;
      if (win) waits.push({ id: t, left: visible ? Math.max(0, 4 - visible[t]) : 4 - c[t] });
    }
    return waits;
  }

  // 有效进张：使向听数下降的牌
  function getUsefulTiles(tiles13, visible, fixed) {
    const c = countsOf(tiles13);
    const base = calcShanten(c, fixed);
    const res = [];
    for (let t = 0; t < 34; t++) {
      if (visible && visible[t] >= 4) continue;
      c[t]++;
      const s = calcShanten(c, fixed);
      c[t]--;
      if (s < base) {
        res.push({ id: t, left: visible ? Math.max(0, 4 - visible[t]) : 4 - c[t] });
      }
    }
    return res;
  }

  /* ---------- 出牌分析与推荐 ---------- */

  // 对 14 张手牌分析每张可打出的牌；visible 为已见计数（含当前 14 张手牌）
  function analyzeDiscards(tiles14, visible, fixed) {
    const results = [];
    const ids = tiles14.map(t => typeof t === 'number' ? t : t.id);
    const uniq = Array.from(new Set(ids)).sort((a, b) => a - b);
    for (const id of uniq) {
      const rest = ids.filter(x => x !== id);
      const c13 = countsOf(rest);
      const shanten = calcShanten(c13, fixed);
      const useful = getUsefulTiles(rest, visible, fixed);
      const waits = shanten === 0 ? getWaits(rest, visible, fixed) : [];
      const usefulCount = useful.reduce((s, x) => s + x.left, 0);
      const waitCount = waits.reduce((s, x) => s + x.left, 0);
      results.push({
        id, shanten, useful, waits, usefulCount, waitCount,
        score: shanten * 10000 - usefulCount * 10 - waitCount
      });
    }
    results.sort((a, b) => a.score - b.score);
    return results;
  }

  function bestDiscard(tiles14, visible) {
    return analyzeDiscards(tiles14, visible)[0];
  }

  // 推荐理由（中文）
  function explainDiscard(analysis, hand14) {
    const a = analysis;
    if (!a) return '';
    const name = tileName(a.id);
    if (a.shanten === 0) {
      const w = a.waits.map(x => tileName(x.id) + '(' + x.left + '张)').join('、');
      return `打出「${name}」后进入听牌，可胡 ${w}。`;
    }
    const top = a.useful.slice().sort((x, y) => y.left - x.left).slice(0, 4)
      .map(x => tileName(x.id)).join('、');
    const shantenText = a.shanten === 1 ? '一向听' : a.shanten === 2 ? '两向听' : a.shanten + '向听';
    return `打出「${name}」保持${shantenText}，进张 ${a.usefulCount} 张（${top}${a.useful.length > 4 ? '等' : ''}）。`;
  }

  /* ---------- 副露与和牌可能性 ---------- */

  function canPung(hand13, id) {
    return countsOf(hand13)[id] >= 2;
  }
  function canKong(hand13, id) {
    return countsOf(hand13)[id] >= 3;
  }
  function canConcealedKong(hand14, id) {
    return countsOf(hand14)[id] === 4;
  }
  function canWinWith(hand13, id, fixed) {
    const c = countsOf(hand13);
    c[id]++;
    return isStandardWin(c, fixed) || isSevenPairs(c, fixed);
  }
  // 吃：返回所有可吃组合（上家打出的牌 id）
  function chowOptions(hand13, id) {
    const c = countsOf(hand13);
    const opts = [];
    if (!isSuited(id)) return opts;
    const r = rankOf(id), s = suitOf(id) * 9;
    for (const start of [r - 2, r - 1, r]) {
      if (start < 1 || start > 7) continue;
      const need = [start, start + 1, start + 2].map(x => s + x - 1);
      if (need.includes(id)) {
        const ok = need.every(x => x === id ? true : c[x] > 0);
        if (ok) opts.push(need); // need 为绝对索引，含 id
      }
    }
    return opts;
  }

  /* ---------- 基础番型识别 ---------- */

  function evaluateFan(tiles14, winInfo, opts) {
    opts = opts || {};
    const fan = [];
    const check = opts.allTiles || tiles14;
    const c = countsOf(check);
    const suits = new Set();
    let allSimple = true;
    for (const t of check) {
      if (isSuited(t)) suits.add(suitOf(t));
      if (!isSuited(t) || rankOf(t) === 1 || rankOf(t) === 9) allSimple = false;
    }
    const sum = (arr) => arr.reduce((a, b) => a + b, 0);
    fan.push({ name: opts.selfDraw ? '自摸' : '点炮和', desc: opts.selfDraw ? '自己摸到和牌张' : '和他人打出的牌' });

    if (winInfo.type === 'sevenPairs') {
      fan.push({ name: '七对', desc: '七个对子组成的和牌' });
    } else {
      const allPungs = winInfo.melds.every(m => m.kind === 'pung');
      if (allPungs) fan.push({ name: '碰碰和', desc: '四组刻子加一对将' });
      // 一杯口
      const chows = winInfo.melds.filter(m => m.kind === 'chow').map(m => m.tiles.join(','));
      if (new Set(chows).size < chows.length) fan.push({ name: '一杯口', desc: '两组完全相同的顺子' });
    }
    const hasHonor = c.some((v, i) => i >= 27 && v > 0);
    if (suits.size === 1 && !hasHonor) {
      fan.push({ name: '清一色', desc: '全部由同一种数牌组成' });
    } else if (suits.size === 1 && hasHonor) {
      fan.push({ name: '混一色', desc: '同一种数牌加字牌' });
    }
    if (allSimple) fan.push({ name: '断幺', desc: '不含幺九牌与字牌' });
    if (opts.concealed) fan.push({ name: '门前清', desc: '没有吃、碰、明杠' });
    return fan;
  }

  return {
    CN_NUM, WINDS, DRAGONS, SUIT_NAME,
    isSuited, suitOf, rankOf, sameSuit, tileName, tileShort,
    buildWall, shuffle, countsOf, countTotal,
    isStandardWin, isSevenPairs, isWinTiles, decomposeWin,
    calcShanten, getWaits, getUsefulTiles,
    analyzeDiscards, bestDiscard, explainDiscard,
    canPung, canKong, canConcealedKong, canWinWith, chowOptions, evaluateFan
  };
});
