import type { SubtitleTrack, VocabAnalysis } from '../core/types.js';

/** 面板对外接口：由 content script 注入 */
export interface PanelHandlers {
  /** 分析指定轨道并返回结果 */
  analyze(track: SubtitleTrack, dictId: string): Promise<VocabAnalysis>;
}

const STYLE = `
:host { all: initial; display: block; }
* { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif; }
#panel { background: #fff; color: #26262b; margin-bottom: 16px; border: 1px solid #e8e8ec; font-size: 12.5px; }
table { width: 100%; border-collapse: collapse; }
td { padding: 6px 12px; border-bottom: 1px solid #f0f0f2; }
td:last-child { text-align: right; font-variant-numeric: tabular-nums; }
.lbl { color: #9a9aa3; }
.vnum { font-size: 30px; font-weight: 800; letter-spacing: -1px; }
.vnum small { font-size: 12px; color: #9a9aa3; font-weight: 500; }
.curve { padding: 10px 12px 4px; }
.curve svg { display: block; width: 100%; height: auto; }
.wsec { border-top: 1px solid #f0f0f2; padding: 6px 12px 8px; }
.wtitle { font-size: 11px; color: #9a9aa3; padding: 2px 0 5px; }
.wrow { display: flex; justify-content: space-between; align-items: baseline; padding: 1.5px 0; }
.wrow .m { color: #9a9aa3; font-size: 11px; font-variant-numeric: tabular-nums; }
.note { padding: 8px 12px; font-size: 12px; color: #9a9aa3; border-top: 1px solid #f0f0f2; }
#status { padding: 8px 12px; font-size: 12px; color: #9a9aa3; }
#status:empty { padding: 0; }
.error { padding: 8px 12px; font-size: 12px; color: #b3261e; }
@media (prefers-color-scheme: dark) {
  #panel { background: #1f1f1f; color: #f1f1f1; border-color: #383838; }
  td { border-bottom-color: #2e2e2e; }
  .lbl, .vnum small, .note, #status, .wtitle, .wrow .m { color: #9a9aa3; }
  .note, .wsec { border-top-color: #2e2e2e; }
  .error { color: #f2a0a0; }
}
`;

/** 词汇量 K 格式：3518 -> 3.5K */
function fmtK(v: number): string {
  return `${Math.round(v / 100) / 10}K`;
}

/** 百分比：0.716 -> 71.6% */
function pct(v: number): string {
  return `${Math.round(v * 1000) / 10}%`;
}

/**
 * PCHIP(Fritsch–Carlson)单调三次样条的每点斜率。
 *
 * 数据点单调(累计覆盖率非降)时，插值保持单调且中间值不超出相邻两点，
 * 保证平滑不改变真实取值。
 */
function pchipSlopes(x: number[], y: number[]): number[] {
  const n = x.length;
  const m = new Array<number>(n);
  const h: number[] = [];
  const d: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    h[i] = x[i + 1] - x[i];
    d[i] = (y[i + 1] - y[i]) / h[i];
  }
  m[0] = d[0];
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) {
      m[i] = 0;
    } else {
      const w1 = 2 * h[i] + h[i - 1];
      const w2 = h[i] + 2 * h[i - 1];
      m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);
    }
  }
  m[n - 1] = d[n - 2];
  return m;
}

/** 三次 Hermite 基函数在 t∈[0,1] 处的取值（y0,y1 端点值，m0,m1 端点斜率，h 区间宽） */
function hermite(t: number, h: number, y0: number, y1: number, m0: number, m1: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * y0 + (t3 - 2 * t2 + t) * h * m0 + (-2 * t3 + 3 * t2) * y1 + (t3 - t2) * h * m1;
}

/**
 * 理解度曲线 SVG：横轴词汇量(对数 1K..maxK)，纵轴"不认识的词占比"。
 *
 * 与"认识多少%"互补：曲线从上往下，越高说明该词汇量下不懂的词越多。
 * 纵轴上界取第一个数据点(1K 处的不懂率)，曲线首点即顶到图顶；网格线画在
 * 5/10/20/30/40/50% 中落在范围内者。
 * 横轴线性刻度：从 1K 学到 maxK 需要付出的努力是线性的，
 * 曲线前端陡、后端平，直观体现"越往后越难有收益"。
 * 右界取第一个（从高到低）至少有 5 个 token 的 level，截掉稀疏的尾部噪声。
 */
function unknownCurveSvg(
  coverageByRank: VocabAnalysis['coverageByRank'],
  recommended: number,
  userVocab?: number | null,
): string {
  const pts = coverageByRank;
  if (pts.length === 0) return '';
  const W = 300;
  const H = 66;
  const L = 6;
  const R = 298;
  const T = 6;
  const B = 46;
  const vmin = 0;
  // 右界固定 10K，超出部分的数据点截断不绘
  const vmax = 10000;
  const drawPts = pts.filter((p) => p.rank <= vmax);
  const curvePts = drawPts.length > 1 ? drawPts : pts;
  // 首段补锚点(0 词, 100% 不懂)，使曲线从横轴左端起头
  const pts2 = [{ rank: 0, cumulative: 0 }, ...curvePts];
  const lx = (v: number): number => L + ((v - vmin) / (vmax - vmin)) * (R - L);
  // y 轴上界自动取全部绘图点(含锚点)中的最大不懂率，曲线不被截顶
  const yMax = Math.max(1e-9, ...pts2.map((c) => 1 - c.cumulative));
  const ly = (u: number): number => B - Math.min(1, Math.max(0, u / yMax)) * (B - T);
  const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

  // 平滑曲线：PCHIP 单调三次样条——严格经过每个真实数据点，
  // 且相邻点之间不超出两点取值（累计覆盖率单调，保证不歪曲真实值）。
  const xs = pts2.map((c) => lx(c.rank));
  const ys = pts2.map((c) => ly(1 - c.cumulative));
  const slopes = pchipSlopes(xs, ys);
  let curve = `M ${xs[0].toFixed(2)} ${ys[0].toFixed(2)}`;
  for (let i = 0; i < xs.length - 1; i++) {
    const h = xs[i + 1] - xs[i];
    const c1x = xs[i] + h / 3;
    const c1y = ys[i] + (slopes[i] * h) / 3;
    const c2x = xs[i + 1] - h / 3;
    const c2y = ys[i + 1] - (slopes[i + 1] * h) / 3;
    curve += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)} ${c2x.toFixed(2)} ${c2y.toFixed(2)} ${xs[i + 1].toFixed(2)} ${ys[i + 1].toFixed(2)}`;
  }
  const area = `${curve} L ${xs[xs.length - 1].toFixed(2)} ${B} L ${xs[0].toFixed(2)} ${B} Z`;

  // 曲线上的精确 y（用同一 Hermite 插值，保证点在曲线上）
  const last = pts2.length - 1;
  const curveYAt = (v: number): number => {
    const vc = clamp(v, vmin, vmax);
    if (vc <= pts2[0].rank) return ys[0];
    if (vc >= pts2[last].rank) return ys[last];
    let i = 0;
    while (i < last && pts2[i + 1].rank < vc) i++;
    const t = (vc - pts2[i].rank) / (pts2[i + 1].rank - pts2[i].rank);
    return hermite(t, xs[i + 1] - xs[i], ys[i], ys[i + 1], slopes[i], slopes[i + 1]);
  };

  // 建议词汇量位置
  const vRec = clamp(recommended, vmin, vmax);
  const xRec = lx(vRec);
  const yRec = curveYAt(vRec);

  // 用户词汇量位置（可选）：与"建议"同款，颜色稍浅；相距太近时省略文字
  let userMark = '';
  if (userVocab && userVocab > 0) {
    const vU = clamp(userVocab, vmin, vmax);
    const xU = lx(vU);
    const yU = curveYAt(vU);
    const hideLabel = Math.abs(xU - xRec) < 26 && Math.abs(yU - yRec) < 12;
    userMark = `
  <line x1="${xU}" y1="${B}" x2="${xU}" y2="${yU}" stroke="#9a9aa3" stroke-width="1" stroke-dasharray="2 2" vector-effect="non-scaling-stroke"/>
  <circle cx="${xU}" cy="${yU}" r="2.6" fill="#9a9aa3"/>
  ${
    hideLabel
      ? ''
      : `<text x="${xU + 4}" y="${clamp(yU - 4, 12, B - 2)}" font-size="9" fill="#9a9aa3">你</text>`
  }`;
  }

  const grid = [5, 10, 20, 30, 40, 50]
    .map((p) => p / 100)
    .filter((u) => u > 0.001 && u < yMax)
    .map((u) => `<line x1="${L}" y1="${ly(u).toFixed(1)}" x2="${R}" y2="${ly(u).toFixed(1)}" stroke="currentColor" stroke-width="0.7" opacity="0.12" vector-effect="non-scaling-stroke"/>`)
    .join('\n  ');

  // 线性横轴：每 5K 一个内部刻度（落在 [1K, maxK] 区间内的才画）
  const xLabels = [5000, 10000, 15000, 20000, 25000]
    .filter((v) => v > vmin && v < vmax)
    .map((v) => `<text x="${lx(v).toFixed(1)}" y="${B + 12}" font-size="9" text-anchor="middle" fill="#9a9aa3">${Math.round(v / 1000)}K</text>`)
    .join('\n  ');

  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  ${grid}
  <line x1="${L}" y1="${B}" x2="${R}" y2="${B}" stroke="#d5d5da" vector-effect="non-scaling-stroke"/>
  <line x1="${L}" y1="${T}" x2="${L}" y2="${B}" stroke="#d5d5da" vector-effect="non-scaling-stroke"/>
  <path d="${area}" fill="currentColor" opacity="0.1"/>
  <path d="${curve}" fill="none" stroke="currentColor" stroke-width="1.6" vector-effect="non-scaling-stroke"/>
  ${userMark}
  <line x1="${xRec}" y1="${B}" x2="${xRec}" y2="${yRec}" stroke="currentColor" stroke-width="1" stroke-dasharray="2 2" vector-effect="non-scaling-stroke"/>
  <circle cx="${xRec}" cy="${yRec}" r="2.6" fill="currentColor"/>
  <text x="${xRec + 4}" y="${clamp(yRec - 4, 12, B - 2)}" font-size="9" fill="currentColor">建议</text>
  <text x="${L}" y="${B + 12}" font-size="9" fill="#9a9aa3">0K</text>
  ${xLabels}
  <text x="${R - 12}" y="${B + 12}" font-size="9" fill="#9a9aa3">${Math.round(vmax / 1000)}K</text>
</svg>`;
}

/**
 * 词汇量分析面板（紧凑表格外观，支持亮/暗色）。
 *
 * 内嵌于观看页推荐栏（#secondary）顶部，仅展示分析结果；
 * 由 content script 在有英文字幕时自动触发分析。
 */
export class VocabPanel {
  private readonly host = document.createElement('div');
  private readonly shadow: ShadowRoot;
  private readonly ui: {
    status: HTMLElement;
    result: HTMLElement;
  };
  private tracks: SubtitleTrack[] = [];
  private activeDictId = '';
  /** 用户词汇量设置（词），用于曲线图上标记位置 */
  private userVocab: number | null = null;
  /** 最近一次分析结果，词汇量设置变化时重绘 */
  private lastAnalysis: VocabAnalysis | null = null;
  /** 分析请求序号：用于丢弃过期视频的异步结果 */
  private runId = 0;

  constructor(private readonly handlers: PanelHandlers) {
    this.host.id = 'vve-host';
    this.shadow = this.host.attachShadow({ mode: 'closed' });
    this.shadow.innerHTML = `
      <style>${STYLE}</style>
      <div id="panel">
        <div id="result"></div>
        <div id="status"></div>
      </div>
    `;
    this.ui = {
      status: this.shadow.getElementById('status') as HTMLElement,
      result: this.shadow.getElementById('result') as HTMLElement,
    };
  }

  /** 挂载到容器顶部（推荐栏位置）；已挂载则不重复插入 */
  mount(container: HTMLElement): void {
    if (this.host.isConnected) return;
    container.insertBefore(this.host, container.firstChild);
  }

  /** 从 DOM 中移除 */
  unmount(): void {
    this.host.remove();
  }

  isMounted(): boolean {
    return this.host.isConnected;
  }

  /** 清空状态与结果（换视频时调用） */
  reset(): void {
    this.runId++; // 使进行中的分析失效
    this.ui.status.textContent = '';
    this.ui.result.innerHTML = '';
  }

  /** 记录可用轨道（自动分析取英语轨道，其次第一条） */
  setTracks(tracks: SubtitleTrack[]): void {
    this.tracks = tracks;
  }

  /** 记录当前词典 id（供分析使用） */
  setDictionaries(_metas: Array<{ id: string; name: string }>, activeId: string): void {
    this.activeDictId = activeId;
  }

  /** 设置用户词汇量（词），更新曲线图上的"你"标记 */
  setUserVocab(vocab: number | null): void {
    this.userVocab = vocab;
    if (this.lastAnalysis) this.render(this.lastAnalysis);
  }

  setStatus(msg: string): void {
    this.ui.status.textContent = msg;
  }

  /** 保留空实现以兼容 content script 调用（无按钮可禁用） */
  setBusy(_busy: boolean): void {}

  private selectedTrack(): SubtitleTrack | undefined {
    const enIdx = this.tracks.findIndex((t) => t.lang.startsWith('en'));
    return this.tracks[enIdx >= 0 ? enIdx : 0];
  }

  /** 自动分析（由 content script 在有英文字幕时调用） */
  async run(): Promise<void> {
    const myId = ++this.runId;
    const track = this.selectedTrack();
    if (!track) {
      this.showError('没有可用的字幕轨道');
      return;
    }
    this.setStatus('分析中…');
    this.ui.result.innerHTML = '';
    try {
      const analysis = await this.handlers.analyze(track, this.activeDictId);
      if (myId !== this.runId) return; // 已有更新的分析请求，丢弃过期结果
      this.render(analysis);
      this.setStatus('');
    } catch (err) {
      if (myId !== this.runId) return;
      this.showError(err instanceof Error ? err.message : String(err));
    }
  }

  /** 渲染分析结果（紧凑表格排版） */
  private render(a: VocabAnalysis): void {
    this.lastAnalysis = a;
    const r = a.requiredVocab;
    const cov = a.coverageOfAll;
    // 分级覆盖率分母为分级词总量；basewrd 单开一类，表外词不计入比例但计入词汇量
    const gradedTokens = a.totalTokens - a.basewrdTokens - a.unknownTokens;
    const curve = unknownCurveSvg(a.coverageByRank, r.recommended, this.userVocab);
    const wlist = a.surprisingWords.length
      ? `<div class="wsec">
        <div class="wtitle">高频率生词</div>
        ${a.surprisingWords
          .map((w) => `<div class="wrow"><span>${w.word}</span><span class="m">${w.count} 次 · ${w.level}K</span></div>`)
          .join('')}
      </div>`
      : '';

    this.ui.result.innerHTML = `
      <table>
        <tr><td class="lbl">建议词汇量</td><td class="vnum">${fmtK(r.recommended)}<small> 词</small></td></tr>
        <tr><td class="lbl">字幕总词数</td><td>${a.totalTokens}</td></tr>
        <tr><td class="lbl">分级词数</td><td>${gradedTokens}</td></tr>
        <tr><td class="lbl">专有名词/边缘词</td><td>${a.basewrdTokens}</td></tr>
        <tr><td class="lbl">词表覆盖率</td><td>${pct(cov)}</td></tr>
      </table>
      <div class="curve">${curve}</div>
      ${wlist}
      <div class="note">${
        a.unknownLemmas.length > 0
          ? `${r.note}另有 ${a.unknownLemmas.length} 个表外词，已计入建议词汇量。`
          : r.note
      }</div>
    `;
  }

  showError(msg: string): void {
    this.ui.result.innerHTML = `<div class="error">${msg.replace(/</g, '&lt;')}</div>`;
  }
}
