/**
 * 易经核心计算引擎 — yijing_core.js
 * 错卦、综卦、互卦、变卦、卦象查找
 * 纯计算，不依赖DOM，可在任何环境使用
 */
var Yijing = (function() {

  // ─── 基础工具 ───
  function linesEqual(a, b) {
    for (var i = 0; i < 6; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }

  function linesKey(lines) {
    return lines.join('');
  }

  /** 在 HEXAGRAMS 中按爻线查找卦 */
  function findHexByLines(lines) {
    for (var i = 0; i < HEXAGRAMS.length; i++) {
      if (linesEqual(HEXAGRAMS[i].lines, lines)) {
        return HEXAGRAMS[i];
      }
    }
    return null;
  }

  // ─── 错卦 (旁通卦) — 六爻全变 ───
  // 阴阳完全相反：阳变阴，阴变阳
  function cuoGua(lines) {
    var result = [];
    for (var i = 0; i < 6; i++) {
      result.push(lines[i] === 1 ? 0 : 1);
    }
    return result;
  }

  // ─── 综卦 (覆卦/倒卦) — 上下颠倒 ───
  // 把整个卦颠倒过来看
  function zongGua(lines) {
    var result = [];
    for (var i = 5; i >= 0; i--) {
      result.push(lines[i]);
    }
    return result;
  }

  // ─── 互卦 — 二三四爻为下卦，三四五爻为上卦 ───
  function huGua(lines) {
    // 初爻(0)到四爻(3) 取 二爻(1)三爻(2)四爻(3) 为下卦
    // 二爻(1)到五爻(4) 取 三爻(2)四爻(3)五爻(4) 为上卦
    return [
      lines[1], lines[2], lines[3],  // 下卦 (二三四)
      lines[2], lines[3], lines[4]   // 上卦 (三四五)
    ];
  }

  // ─── 变卦 (之卦) — 只变动爻 ───
  function bianGua(lines, changingIndices) {
    var result = lines.slice();
    for (var i = 0; i < changingIndices.length; i++) {
      var idx = changingIndices[i];
      result[idx] = result[idx] === 1 ? 0 : 1;
    }
    return result;
  }

  // ─── 八卦（三爻）→ 卦名映射 ───
  var TRIGRAM_NAMES = {
    '111': { name: '乾', symbol: '☰', nature: '天', xiang: '健' },
    '000': { name: '坤', symbol: '☷', nature: '地', xiang: '顺' },
    '100': { name: '震', symbol: '☳', nature: '雷', xiang: '动' },
    '010': { name: '坎', symbol: '☵', nature: '水', xiang: '陷' },
    '001': { name: '艮', symbol: '☶', nature: '山', xiang: '止' },
    '110': { name: '巽', symbol: '☴', nature: '风', xiang: '入' },
    '101': { name: '离', symbol: '☲', nature: '火', xiang: '丽' },
    '011': { name: '兑', symbol: '☱', nature: '泽', xiang: '说' }
  };

  function getTrigram(lines, start) {
    var key = '' + lines[start] + lines[start+1] + lines[start+2];
    return TRIGRAM_NAMES[key] || { name: '?', symbol: '?', nature: '?', xiang: '?' };
  }

  /** 获取卦的上卦(外卦)和下卦(内卦)信息 */
  function getGuaComposition(lines) {
    return {
      lower: getTrigram(lines, 0),  // 下卦 (初爻到三爻)
      upper: getTrigram(lines, 3)   // 上卦 (四爻到上爻)
    };
  }

  // ─── 关系网络 (为一个卦计算所有关联卦) ───
  function getRelationNetwork(hexagram) {
    var lines = hexagram.lines;
    var net = {};

    // 错卦
    var cuoLines = cuoGua(lines);
    var cuoHex = findHexByLines(cuoLines);
    net.cuo = cuoHex ? { id: cuoHex.id, name: cuoHex.name, symbol: cuoHex.upper + cuoHex.lower, upper: cuoHex.upper, lower: cuoHex.lower, lines: cuoHex.lines } : null;

    // 综卦
    var zongLines = zongGua(lines);
    var zongHex = findHexByLines(zongLines);
    net.zong = zongHex ? { id: zongHex.id, name: zongHex.name, symbol: zongHex.upper + zongHex.lower, upper: zongHex.upper, lower: zongHex.lower, lines: zongHex.lines } : null;

    // 互卦
    var huLines = huGua(lines);
    var huHex = findHexByLines(huLines);
    net.hu = huHex ? { id: huHex.id, name: huHex.name, symbol: huHex.upper + huHex.lower, upper: huHex.upper, lower: huHex.lower, lines: huHex.lines } : null;

    // 体卦(内卦) 和 用卦(外卦) 
    var comp = getGuaComposition(lines);
    net.ti = comp.lower;   // 体卦 = 下卦(内卦)
    net.yong = comp.upper; // 用卦 = 上卦(外卦)

    return net;
  }

  // ─── 铜钱筮法: 6/7/8/9 → 爻 ───
  // 6=老阴(变爻), 7=少阳(不变), 8=少阴(不变), 9=老阳(变爻)
  var YAO_NAMES = {
    6: { name: '老阴', yinYang: '阴', changing: true,  line: 0, symbol: '⚋' },
    7: { name: '少阳', yinYang: '阳', changing: false, line: 1, symbol: '⚊' },
    8: { name: '少阴', yinYang: '阴', changing: false, line: 0, symbol: '⚋' },
    9: { name: '老阳', yinYang: '阳', changing: true,  line: 1, symbol: '⚊' }
  };

  // ─── 爻位信息 ───
  var YAO_POSITIONS = ['初', '二', '三', '四', '五', '上'];

  function getYaoName(lineValue, positionIndex) {
    // positionIndex: 0=初爻, 5=上爻
    var posName = YAO_POSITIONS[positionIndex];
    var isYang = (lineValue === 7 || lineValue === 9);
    var num = isYang ? '九' : '六';
    // 初和上用特殊格式: 初九/初六, 上九/上六
    if (positionIndex === 0) return '初' + num;
    if (positionIndex === 5) return '上' + num;
    return num + posName;
  }

  // ─── 解卦摘要 (用于卜卦结果展示) ───
  function buildDivinationSummary(tosses) {
    // tosses: [6/7/8/9, ...] 从初爻到上爻
    var benLines = [];
    var changingLines = [];
    for (var i = 0; i < 6; i++) {
      var v = tosses[i];
      benLines.push((v === 9 || v === 7) ? 1 : 0);
      if (v === 9 || v === 6) changingLines.push(i);
    }

    var benHex = findHexByLines(benLines);
    if (!benHex) return null;

    var hasChange = changingLines.length > 0;
    var zhiHex = null;
    var zhiLines = null;
    if (hasChange) {
      zhiLines = bianGua(benLines, changingLines);
      zhiHex = findHexByLines(zhiLines);
    }

    // 找出变动爻的爻辞
    var changingYaoDetails = [];
    for (var ci = 0; ci < changingLines.length; ci++) {
      var posIdx = changingLines[ci];
      var yaoData = benHex.yao ? benHex.yao[posIdx] : null;
      changingYaoDetails.push({
        index: posIdx,
        posName: getYaoName(tosses[posIdx], posIdx),
        yaoData: yaoData,
        tossValue: tosses[posIdx],
        yaoInfo: YAO_NAMES[tosses[posIdx]]
      });
    }

    // 变卦被变的爻（从变卦视角看）
    var zhiYaoDetails = [];
    if (zhiHex && zhiHex.yao) {
      for (var di = 0; di < changingLines.length; di++) {
        var posIdx = changingLines[di];
        zhiYaoDetails.push({
          index: posIdx,
          posName: YAO_POSITIONS[posIdx], // 在变卦中此爻的位置名
          yaoData: zhiHex.yao[posIdx]
        });
      }
    }

    var relationNet = getRelationNetwork(benHex);

    return {
      benHex: benHex,
      zhiHex: zhiHex,
      changingLines: changingLines,
      tosses: tosses,
      benLines: benLines,
      zhiLines: zhiLines,
      changingYaoDetails: changingYaoDetails,
      zhiYaoDetails: zhiYaoDetails,
      relationNet: relationNet,
      hasChange: hasChange
    };
  }

  // ─── 公开 API ───
  return {
    cuoGua: cuoGua,
    zongGua: zongGua,
    huGua: huGua,
    bianGua: bianGua,
    findHexByLines: findHexByLines,
    getRelationNetwork: getRelationNetwork,
    getGuaComposition: getGuaComposition,
    getYaoName: getYaoName,
    buildDivinationSummary: buildDivinationSummary,
    YAO_NAMES: YAO_NAMES,
    YAO_POSITIONS: YAO_POSITIONS,
    TRIGRAM_NAMES: TRIGRAM_NAMES
  };

})();
