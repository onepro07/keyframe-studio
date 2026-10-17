/* ============================================================
   关键帧工坊 · 主逻辑
   浏览器内完成：场景检测抽帧 → 感知哈希去重 → 黑屏过滤 → 联系表
   ============================================================ */

(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  /* ---------------- 状态 ---------------- */

  const state = {
    file: null,
    videoUrl: null,
    duration: 0,
    frames: [],          // { canvas, blob, url, time, w, h }
    sheets: [],          // { blob, url }
    running: false,
    ready: false,
  };

  const VIDEO_EXTS = ['mp4', 'mov', 'mkv', 'webm', 'avi', 'flv', 'm4v', 'ts', 'mpg', 'mpeg'];

  /* ---------------- 工具 ---------------- */

  function fmtSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(0) + ' KB';
    if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
    return (bytes / 1073741824).toFixed(2) + ' GB';
  }

  function fmtTime(sec) {
    const s = Math.round(sec);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const r = s % 60;
    const p = (n) => String(n).padStart(2, '0');
    return h > 0 ? `${p(h)}:${p(m)}:${p(r)}` : `${p(m)}:${p(r)}`;
  }

  function fmtFileStamp(sec) {
    const s = Math.round(sec);
    const p = (n) => String(n).padStart(2, '0');
    return `${p(Math.floor(s / 3600))}-${p(Math.floor((s % 3600) / 60))}-${p(s % 60)}`;
  }

  function log(msg) {
    const pre = $('logPre');
    pre.textContent += msg + '\n';
    pre.scrollTop = pre.scrollHeight;
  }

  /* ---------------- 主题 ---------------- */

  const themeBtn = $('themeBtn');
  const savedTheme = localStorage.getItem('kf-theme');
  if (savedTheme) document.documentElement.dataset.theme = savedTheme;
  else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
    document.documentElement.dataset.theme = 'dark';
  }

  themeBtn.addEventListener('click', () => {
    const cur = document.documentElement.dataset.theme;
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('kf-theme', next);
  });

  // 进页面就检测解码能力，让顶栏状态立刻反映真实情况
  warmupEngine();

  /* ---------------- 引擎状态 ---------------- */

  function setEngine(stateName, text) {
    $('engineDot').dataset.state = stateName;
    $('engineText').textContent = text;
  }

  /* ---------------- 文件投放 ---------------- */

  const dropzone = $('dropzone');
  const fileInput = $('fileInput');

  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
  });

  ['dragenter', 'dragover'].forEach((ev) => {
    dropzone.addEventListener(ev, (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });
  });

  ['dragleave', 'drop'].forEach((ev) => {
    dropzone.addEventListener(ev, (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
    });
  });

  dropzone.addEventListener('drop', (e) => {
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) acceptFile(f);
  });

  // 拦截整页拖放，避免浏览器直接打开文件把页面顶掉
  ['dragover', 'drop'].forEach((ev) => {
    window.addEventListener(ev, (e) => {
      if (e.target.closest && e.target.closest('#dropzone')) return;
      e.preventDefault();
      if (ev === 'drop') {
        const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (f && !state.running) acceptFile(f);
      }
    });
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) acceptFile(fileInput.files[0]);
  });

  $('clearBtn').addEventListener('click', resetInput);
  $('againBtn').addEventListener('click', () => {
    resetInput();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  function resetInput() {
    if (state.videoUrl) URL.revokeObjectURL(state.videoUrl);
    state.file = null;
    state.videoUrl = null;
    state.duration = 0;
    state.frames.forEach((f) => f.url && URL.revokeObjectURL(f.url));
    state.frames = [];
    state.sheets.forEach((s) => s.url && URL.revokeObjectURL(s.url));
    state.sheets = [];
    fileInput.value = '';
    $('fileCard').hidden = true;
    $('dropzone').hidden = false;
    $('panelParams').hidden = true;
    $('panelProgress').hidden = true;
    $('panelResult').hidden = true;
    $('panelSummary').hidden = true;
  }

  async function acceptFile(file) {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    const isVideoMime = file.type.startsWith('video/');

    if (!isVideoMime && !VIDEO_EXTS.includes(ext)) {
      alert('这不是视频文件。支持：' + VIDEO_EXTS.join(' / '));
      return;
    }

    state.file = file;
    if (state.videoUrl) URL.revokeObjectURL(state.videoUrl);
    state.videoUrl = URL.createObjectURL(file);

    $('fileName').textContent = file.name;
    $('fileSub').textContent = fmtSize(file.size) + '　·　读取中…';

    // 探测时长与首帧
    try {
      const info = await probeVideo(state.videoUrl);
      state.duration = info.duration;
      $('fileSub').textContent =
        fmtSize(file.size) + '　·　' + (info.duration ? fmtTime(info.duration) : '时长未知') +
        '　·　' + info.width + '×' + info.height;
      $('fileThumb').style.backgroundImage = `url("${info.thumb}")`;
    } catch (err) {
      $('fileSub').textContent = fmtSize(file.size) + '　·　元信息读取失败';
      log('[警告] 元信息读取失败：' + err.message);
    }

    $('dropzone').hidden = true;
    $('fileCard').hidden = false;
    $('panelParams').hidden = false;
    $('panelResult').hidden = true;
    updateEstimate();

    // 预加载引擎（后台进行，不阻塞交互）
    warmupEngine();
  }

  /* ---------------- 视频探测 ---------------- */

  function probeVideo(url) {
    return new Promise((resolve, reject) => {
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.muted = true;
      v.playsInline = true;
      v.src = url;

      let done = false;
      const finish = () => {
        if (done) return;
        done = true;

        const duration = isFinite(v.duration) ? v.duration : 0;

        // 取首帧附近做缩略图（0 秒常是黑场，跳到 1s 或 5% 处）
        const seekTo = duration > 0 ? Math.min(duration * 0.05 + 0.2, duration - 0.1) : 0;
        const capture = () => {
          try {
            const c = document.createElement('canvas');
            const w = 152;
            const ratio = v.videoHeight / v.videoWidth || 0.5625;
            c.width = w;
            c.height = Math.round(w * ratio);
            c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
            resolve({
              duration,
              width: v.videoWidth,
              height: v.videoHeight,
              thumb: c.toDataURL('image/jpeg', 0.7),
            });
          } catch (e) {
            resolve({
              duration,
              width: v.videoWidth,
              height: v.videoHeight,
              thumb: '',
            });
          }
        };

        if (seekTo > 0) {
          v.currentTime = seekTo;
          v.addEventListener('seeked', capture, { once: true });
          setTimeout(() => { try { capture(); } catch (e) {} }, 1500);
        } else {
          capture();
        }
      };

      v.addEventListener('loadeddata', finish, { once: true });
      v.addEventListener('loadedmetadata', () => {
        // 有些容器 loadedmetadata 就能拿到时长
        if (v.videoWidth) finish();
      }, { once: true });
      v.addEventListener('error', () => reject(new Error('浏览器无法解码此格式')), { once: true });

      setTimeout(() => {
        if (!done) reject(new Error('加载超时'));
      }, 12000);
    });
  }

  /* ---------------- 参数控制 ---------------- */

  const sceneRange = $('sceneRange');
  const maxRange = $('maxRange');
  const dedupeToggle = $('dedupeToggle');
  const flatToggle = $('flatToggle');

  function sceneTip(v) {
    if (v <= 0.12) return '极敏感：字幕跳动、轻微晃动都会截，帧数偏多';
    if (v <= 0.22) return '适合口播、讲课：讲话人换姿势不会误触发';
    if (v <= 0.38) return '均衡：大多数视频的推荐值';
    if (v <= 0.5) return '只抓明显切换：换页、换场景才留帧';
    return '只抓剧烈变化：可能漏掉小幅但重要的改动';
  }

  function updateEstimate() {
    const s = parseFloat(sceneRange.value);
    const m = parseInt(maxRange.value, 10);
    $('sceneOut').textContent = s.toFixed(2);
    $('maxOut').textContent = m + ' 帧';
    $('sceneTip').textContent = sceneTip(s);

    const expectNum = $('expectNum');
    const expectNote = $('expectNote');
    const expectBar = $('expectBar');

    if (!state.file || !state.duration) {
      expectNum.textContent = '—';
      expectNote.textContent = '选好文件后开始估算';
      expectBar.style.width = '0%';
      return;
    }

    // 经验模型：时长 × 场景密度 × 阈值修正，再受上限约束
    const density = 1 / (s * 1.9 + 0.35);         // 阈值越高，检出越少
    let est = Math.round(state.duration * density * 0.55 + 3);
    est = Math.max(3, Math.min(est, m));

    // 去重再砍约三成
    if (dedupeToggle.checked) est = Math.max(3, Math.round(est * 0.72));

    expectNum.textContent = est;
    const pct = Math.min(100, Math.round((est / m) * 100));
    expectBar.style.width = pct + '%';

    if (est >= m) {
      expectNote.textContent = '已触到上限，会等间隔抽稀到 ' + m + ' 帧';
    } else if (state.duration > 1800) {
      expectNote.textContent = '长视频建议配合联系表浏览';
    } else {
      expectNote.textContent = '估算值，实际以画面变化为准';
    }
  }

  sceneRange.addEventListener('input', () => { clearPresetActive(); updateEstimate(); });
  maxRange.addEventListener('input', () => { clearPresetActive(); updateEstimate(); });
  dedupeToggle.addEventListener('change', updateEstimate);
  flatToggle.addEventListener('change', updateEstimate);

  function clearPresetActive() {
    document.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
  }

  const PRESETS = {
    talk: { scene: 0.18, max: 40 },
    demo: { scene: 0.3, max: 60 },
    fast: { scene: 0.45, max: 90 },
  };

  document.querySelectorAll('.chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const p = PRESETS[chip.dataset.preset];
      if (!p) return;
      sceneRange.value = p.scene;
      maxRange.value = p.max;
      clearPresetActive();
      chip.classList.add('active');
      updateEstimate();
    });
  });

  /* ---------------- 能力检测 ---------------- */

  // 全部解码走浏览器原生 video 元素，不依赖 ffmpeg wasm
  function warmupEngine() {
    if (state.running) return;

    const v = document.createElement('video');
    const canH264 = v.canPlayType('video/mp4; codecs="avc1.42E01E"');
    const canWebm = v.canPlayType('video/webm; codecs="vp9"');

    if (!canH264 && !canWebm) {
      setEngine('error', '当前浏览器不支持视频解码');
      $('actionNote').textContent = '请换用 Chrome 或 Edge 打开';
      return;
    }

    setEngine('ready', '就绪');
    state.ready = true;
    $('actionNote').textContent = '本地解码，文件不会上传';
  }

  /* ---------------- 抽帧核心 ---------------- */

  const SCENE_STEP = 0.35;   // 采样间隔（秒）
  const WORK_MAX_W = 480;    // 计算哈希用的工作尺寸

  function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  // 计算 dHash（64 位）—— 只用于「精确去重」，不用于场景判定
  function dhashOf(ctx, w, h) {
    const gw = 9, gh = 8;
    const tmp = makeCanvas(gw, gh);
    const tctx = tmp.getContext('2d', { willReadFrequently: true });
    tctx.imageSmoothingQuality = 'high';
    tctx.drawImage(ctx.canvas, 0, 0, gw, gh);
    const d = tctx.getImageData(0, 0, gw, gh).data;
    const gray = new Array(gw * gh);
    for (let i = 0; i < gw * gh; i++) {
      gray[i] = d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114;
    }
    const bits = [];
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw - 1; x++) {
        bits.push(gray[y * gw + x] > gray[y * gw + x + 1] ? 1 : 0);
      }
    }
    return bits;
  }

  // 缩略灰度向量 —— 用于场景变化判定
  // 与 dHash 不同，这里保留绝对亮度，渐变→棋盘、白→黑都能算出差值
  const SIG_W = 32, SIG_H = 18;

  function signatureOf(ctx) {
    const tmp = makeCanvas(SIG_W, SIG_H);
    const tctx = tmp.getContext('2d', { willReadFrequently: true });
    tctx.imageSmoothingQuality = 'high';
    tctx.drawImage(ctx.canvas, 0, 0, SIG_W, SIG_H);
    const d = tctx.getImageData(0, 0, SIG_W, SIG_H).data;
    const sig = new Float32Array(SIG_W * SIG_H);
    let sum = 0, sum2 = 0;
    for (let i = 0; i < sig.length; i++) {
      const g = d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114;
      sig[i] = g;
      sum += g;
      sum2 += g * g;
    }
    const mean = sum / sig.length;
    const std = Math.sqrt(Math.max(0, sum2 / sig.length - mean * mean));
    return { sig, std };
  }

  // 两帧之间的画面差异：0（相同）~ 1（完全不同）
  // 用平均绝对差，对整体亮度变化、结构变化都敏感
  function frameDiff(a, b) {
    let sum = 0;
    const n = a.sig.length;
    for (let i = 0; i < n; i++) {
      sum += Math.abs(a.sig[i] - b.sig[i]);
    }
    return sum / n / 255;
  }

  function hamming(a, b) {
    let n = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
    return n;
  }

  /* ---------------- 主流程 ---------------- */

  $('runBtn').addEventListener('click', () => {
    if (state.running || !state.file) return;
    runExtraction();
  });

  function setProgress(pct, title, detail) {
    $('progressFill').style.width = Math.min(100, pct) + '%';
    $('progressPct').textContent = Math.round(pct) + '%';
    if (title) $('progressTitle').textContent = title;
    if (detail !== undefined) $('progressDetail').textContent = detail;
  }

  async function runExtraction() {
    state.running = true;
    $('runBtn').disabled = true;
    $('runBtn').querySelector('.btn-label').textContent = '拆帧中…';
    $('panelProgress').hidden = false;
    $('panelResult').hidden = true;
    $('logPre').textContent = '';
    $('logBox').open = false;
    $('panelProgress').scrollIntoView({ behavior: 'smooth', block: 'center' });

    const sceneThreshold = parseFloat(sceneRange.value);
    const maxFrames = parseInt(maxRange.value, 10);
    const doDedupe = dedupeToggle.checked;
    const doFlat = flatToggle.checked;

    try {
      // 清理上一轮
      state.frames.forEach((f) => f.url && URL.revokeObjectURL(f.url));
      state.frames = [];
      state.sheets.forEach((s) => s.url && URL.revokeObjectURL(s.url));
      state.sheets = [];

      setProgress(6, '解码视频', '浏览器正在读取视频流…');

      const result = await extractViaVideo(state.videoUrl, {
        sceneThreshold,
        maxFrames,
        doDedupe,
        doFlat,
        onProgress: (pct, detail) => setProgress(6 + pct * 0.9, null, detail),
      });

      state.frames = result.frames;

      $('statCandidates').textContent = result.candidates;
      $('statDup').textContent = result.droppedDup;
      $('statFlat').textContent = result.droppedFlat;
      $('statKept').textContent = result.frames.length;

      setProgress(97, '生成联系表', '正在拼装预览图…');
      buildLightbox();
      await buildSheets();
      renderResults();

      setProgress(100, '完成', '共 ' + result.frames.length + ' 帧');
      $('panelResult').hidden = false;
      $('panelSummary').hidden = false;
      $('panelResult').scrollIntoView({ behavior: 'smooth', block: 'start' });

      setTimeout(() => { $('panelProgress').hidden = true; }, 900);
    } catch (err) {
      console.error(err);
      setProgress(100, '出错了', (err && err.message) || '未知错误');
      $('progressDetail').style.color = 'var(--err)';
      log('[错误] ' + ((err && err.stack) || String(err)));
      $('logBox').open = true;
    } finally {
      state.running = false;
      $('runBtn').disabled = false;
      $('runBtn').querySelector('.btn-label').textContent = '开始拆帧';
    }
  }

  /* ---------------- 浏览器原生解码抽帧 ---------------- */

  async function extractViaVideo(url, opts) {
    const { sceneThreshold, maxFrames, doDedupe, doFlat, onProgress } = opts;

    return new Promise((resolve, reject) => {
      const v = document.createElement('video');
      v.src = url;
      v.muted = true;
      v.playsInline = true;
      v.preload = 'auto';

      let settled = false;
      const fail = (msg) => {
        if (settled) return;
        settled = true;
        reject(new Error(msg));
      };

      v.addEventListener('error', () => fail('浏览器无法解码此视频，试试转成 mp4（H.264）'), { once: true });

      v.addEventListener('loadedmetadata', async () => {
        const dur = isFinite(v.duration) ? v.duration : 0;
        if (!dur) { fail('读不到视频时长，可能文件损坏或格式特殊'); return; }

        const vw = v.videoWidth;
        const vh = v.videoHeight;
        if (!vw || !vh) { fail('读不到画面尺寸'); return; }

        // 工作画布：用于哈希与比较
        const scale = Math.min(1, WORK_MAX_W / vw);
        const ww = Math.round(vw * scale);
        const wh = Math.round(vh * scale);

        const work = makeCanvas(ww, wh);
        const wctx = work.getContext('2d', { willReadFrequently: true });

        // 输出画布：用于保存帧
        const outScale = Math.min(1, 1280 / vw);
        const ow = Math.round(vw * outScale);
        const oh = Math.round(vh * outScale);

        const seek = (t) => new Promise((res, rej) => {
          const to = setTimeout(() => rej(new Error('seek 超时')), 8000);
          const onSeeked = () => {
            clearTimeout(to);
            v.removeEventListener('seeked', onSeeked);
            res();
          };
          v.addEventListener('seeked', onSeeked);
          v.currentTime = Math.min(t, dur - 0.05);
        });

        const grab = () => {
          wctx.drawImage(v, 0, 0, ww, wh);
          const { sig, std } = signatureOf(wctx);
          return { sig, std, hash: null };
        };

        const candidates = [];
        let prev = null;
        let lastKeptT = -999;

        const step = SCENE_STEP;
        const totalSteps = Math.max(1, Math.floor(dur / step));
        let i = 0;
        let droppedFlatStep = 0;

        // 阈值映射：界面 0.05~0.6 → 实际像素差 0.012~0.14
        const diffThreshold = 0.012 + (sceneThreshold - 0.05) * 0.233;

        try {
          // 先取第一帧
          await seek(Math.min(0.1, dur * 0.01));
          prev = grab();

          while (i < totalSteps) {
            const t = i * step;
            i++;
            await seek(t);

            const cur = grab();

            // 纯色帧自身不输出，但仍要作为「上一个画面」参与对比，
            // 否则白底→彩色、黑场→彩色的切换会被漏掉
            const curFlat = doFlat && cur.std < 5;

            if (curFlat) {
              droppedFlatStep++;
              prev = cur;
              if (i % 4 === 0) onProgress((i / totalSteps) * 100, `扫描中 ${fmtTime(t)}`);
              continue;
            }

            // 场景判定：像素级平均绝对差
            const score = prev.std < 5 ? 1 : frameDiff(prev, cur);

            if (score >= diffThreshold && (t - lastKeptT) > 0.4) {
              // 去重：与上一个保留帧比像素差，太像就跳过
              let keep = true;
              if (doDedupe && candidates.length > 0) {
                const lastSig = candidates[candidates.length - 1].sig;
                if (frameDiff({ sig: lastSig }, cur) < diffThreshold * 0.75) keep = false;
              }

              if (keep) {
                const blob = await captureFrame(v, ow, oh);
                candidates.push({
                  blob,
                  time: t,
                  sig: cur.sig.slice(),
                  std: cur.std,
                });
                lastKeptT = t;
              }
            }

            prev = cur;

            if (i % 3 === 0) {
              onProgress((i / totalSteps) * 100, `扫描中 ${fmtTime(t)} / ${fmtTime(dur)}`);
              await new Promise((r) => setTimeout(r, 0));
            }
          }

          // 二次采样到上限
          let kept = candidates;
          if (kept.length > maxFrames) {
            const stepRatio = kept.length / maxFrames;
            kept = Array.from({ length: maxFrames }, (_, k) => kept[Math.floor(k * stepRatio)]);
          }

          // 去重统计（相对候选总数）
          const droppedDup = Math.max(0, candidates.length - kept.length);

          const frames = kept.map((c) => ({
            blob: c.blob,
            url: URL.createObjectURL(c.blob),
            time: c.time,
          }));

          settled = true;
          resolve({
            frames,
            candidates: candidates.length,
            droppedDup,
            droppedFlat: Math.round(droppedFlatStep * step),
          });
        } catch (e) {
          fail(e.message || '抽帧失败');
        }
      }, { once: true });

      v.load();
    });
  }

  function captureFrame(video, w, h) {
    const c = makeCanvas(w, h);
    const ctx = c.getContext('2d');
    ctx.drawImage(video, 0, 0, w, h);
    return new Promise((res) => {
      c.toBlob((b) => res(b), 'image/jpeg', 0.86);
    });
  }

  /* ---------------- 联系表 ---------------- */

  const SHEET_COLS = 3;
  const SHEET_PER = 9;
  const SHEET_CELL_W = 560;

  async function buildSheets() {
    const frames = state.frames;
    if (!frames.length) return;

    const ratio = frames[0].blob ? await blobRatio(frames[0].blob) : 0.5625;
    const cellW = SHEET_CELL_W;
    const cellH = Math.round(cellW * ratio);
    const labelH = 30;
    const pad = 10;
    const rows = Math.ceil(SHEET_PER / SHEET_COLS);

    const sheetW = SHEET_COLS * cellW + (SHEET_COLS + 1) * pad;
    const sheetH = rows * (cellH + labelH) + (rows + 1) * pad;

    for (let start = 0; start < frames.length; start += SHEET_PER) {
      const batch = frames.slice(start, start + SHEET_PER);
      const canvas = makeCanvas(sheetW, sheetH);
      const ctx = canvas.getContext('2d');

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, sheetW, sheetH);

      for (let k = 0; k < batch.length; k++) {
        const r = Math.floor(k / SHEET_COLS);
        const c = k % SHEET_COLS;
        const x = pad + c * (cellW + pad);
        const y = pad + r * (cellH + labelH + pad);

        const img = await loadImage(batch[k].url);
        ctx.drawImage(img, x, y, cellW, cellH);

        // 边框
        ctx.strokeStyle = '#e2e2df';
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, cellW - 1, cellH - 1);

        // 标签
        const label = `${String(start + k + 1).padStart(3, '0')}   ${fmtTime(batch[k].time)}`;
        ctx.fillStyle = '#171712';
        ctx.font = '500 17px -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';
        ctx.textBaseline = 'top';
        ctx.fillText(label, x + 4, y + cellH + 6);
      }

      const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.88));
      state.sheets.push({ blob, url: URL.createObjectURL(blob) });
    }
  }

  function blobRatio(blob) {
    return new Promise((res) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        res(img.naturalHeight / img.naturalWidth || 0.5625);
        URL.revokeObjectURL(url);
      };
      img.onerror = () => { res(0.5625); URL.revokeObjectURL(url); };
      img.src = url;
    });
  }

  function loadImage(url) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = rej;
      img.src = url;
    });
  }

  /* ---------------- 渲染结果 ---------------- */

  function renderResults() {
    const grid = $('viewGrid');
    const sheetView = $('viewSheet');
    grid.innerHTML = '';
    sheetView.innerHTML = '';

    if (!state.frames.length) {
      grid.innerHTML = '<p class="empty">没有抽取到帧。试试把场景灵敏度调低（比如 0.10）。</p>';
      return;
    }

    state.frames.forEach((f, idx) => {
      const div = document.createElement('div');
      div.className = 'frame-item';
      div.innerHTML = `
        <img src="${f.url}" alt="第 ${idx + 1} 帧" loading="lazy">
        <span class="frame-tag">${String(idx + 1).padStart(3, '0')} · ${fmtTime(f.time)}</span>
      `;
      div.addEventListener('click', () => openLightbox(f.url));
      grid.appendChild(div);
    });

    state.sheets.forEach((s, i) => {
      const img = document.createElement('img');
      img.className = 'sheet-item';
      img.src = s.url;
      img.alt = `联系表 ${i + 1}`;
      img.addEventListener('click', () => openLightbox(s.url));
      sheetView.appendChild(img);
    });

    $('resultMeta').textContent =
      state.frames.length + ' 帧　·　' + state.sheets.length + ' 张联系表';
  }

  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
      document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
      tab.classList.add('active');
      $('view' + tab.dataset.view.charAt(0).toUpperCase() + tab.dataset.view.slice(1)).classList.add('active');
    });
  });

  /* ---------------- 大图 ---------------- */

  let lightboxEl = null;

  function buildLightbox() {
    if (lightboxEl) return;
    lightboxEl = document.createElement('div');
    lightboxEl.className = 'lightbox';
    lightboxEl.hidden = true;
    lightboxEl.addEventListener('click', closeLightbox);
    document.body.appendChild(lightboxEl);
  }

  function openLightbox(url) {
    if (!lightboxEl) buildLightbox();
    lightboxEl.innerHTML = '';
    const img = document.createElement('img');
    img.src = url;
    lightboxEl.appendChild(img);
    lightboxEl.hidden = false;
  }

  function closeLightbox() {
    if (lightboxEl) { lightboxEl.hidden = true; lightboxEl.innerHTML = ''; }
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeLightbox();
  });

  /* ---------------- 导出 ---------------- */

  function downloadBlob(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 1000);
  }

  $('dlSheetBtn').addEventListener('click', () => {
    state.sheets.forEach((s, i) => {
      setTimeout(() => {
        downloadBlob(s.blob, `联系表_${String(i + 1).padStart(2, '0')}.jpg`);
      }, i * 320);
    });
  });

  $('dlFrameBtn').addEventListener('click', () => {
    state.frames.forEach((f, i) => {
      setTimeout(() => {
        const name = `frame_${String(i + 1).padStart(4, '0')}_${fmtFileStamp(f.time)}.jpg`;
        downloadBlob(f.blob, name);
      }, i * 220);
    });
  });

  /* ================= 内容总结 ================= */

  const KEY_STORE = 'kf-api-key';
  const PROVIDER_STORE = 'kf-provider';
  const sum = { controller: null, running: false, text: '', meta: '' };

  // 平台预设：只列「能看图」的模型
  const PROVIDERS = {
    zhipu: {
      endpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
      model: 'glm-4.6v-flash',
      link: 'https://open.bigmodel.cn/usercenter/apikeys',
      tip: 'GLM-4.6V-Flash 免费（128K 上下文，输入输出缓存全免费）。手机号注册即可。',
    },
    deepseek: {
      endpoint: 'https://api.deepseek.com/chat/completions',
      model: 'deepseek-flash',
      link: 'https://platform.deepseek.com/api_keys',
      tip: 'DeepSeek 的 deepseek-flash（V4.1-Flash）支持图像理解。注意：V4 Pro 不支持看图，别选错。',
    },
    siliconflow: {
      endpoint: 'https://api.siliconflow.cn/v1/chat/completions',
      model: 'Qwen/Qwen2.5-VL-7B-Instruct',
      link: 'https://cloud.siliconflow.cn/me/account/ak',
      tip: '硅基流动注册送额度，模型名请在控制台确认当前可用的视觉模型。',
    },
    custom: {
      endpoint: '',
      model: '',
      link: '',
      tip: '填任意 OpenAI 兼容接口。注意：模型必须支持图像输入，否则读不了帧。',
    },
  };

  const providerSel = $('providerSel');
  const apiKeyEl = $('apiKey');
  const apiEndpointEl = $('apiEndpoint');
  const apiModelEl = $('apiModel');
  const apiFramesEl = $('apiFrames');
  const summarizeBtn = $('summarizeBtn');
  const stopBtn = $('stopBtn');
  const summaryStatus = $('summaryStatus');
  const summaryOutput = $('summaryOutput');
  const summaryText = $('summaryText');

  function applyProvider(name, keepFields) {
    const p = PROVIDERS[name];
    if (!p) return;
    if (!keepFields) {
      if (p.endpoint) apiEndpointEl.value = p.endpoint;
      if (p.model) apiModelEl.value = p.model;
    }
    $('keyTip').textContent = p.tip;
    const link = $('keyLink');
    if (p.link) {
      link.href = p.link;
      link.textContent = '去获取';
      link.style.display = '';
    } else {
      link.style.display = 'none';
    }
  }

  providerSel.addEventListener('change', () => {
    applyProvider(providerSel.value);
    try { localStorage.setItem(PROVIDER_STORE, providerSel.value); } catch (e) {}
  });

  // 恢复上次选的平台
  try {
    const savedProvider = localStorage.getItem(PROVIDER_STORE);
    if (savedProvider && PROVIDERS[savedProvider]) {
      providerSel.value = savedProvider;
      applyProvider(savedProvider);
    }
  } catch (e) {}

  // 回填本地保存的 Key，并给出「已保存」提示
  const keyState = $('keyState');
  const keyClear = $('keyClear');

  function reflectKeyState(saved) {
    keyState.hidden = !saved;
    keyClear.hidden = !saved;
  }

  function persistKey() {
    try {
      const v = apiKeyEl.value.trim();
      if (v) localStorage.setItem(KEY_STORE, v);
      else localStorage.removeItem(KEY_STORE);
      reflectKeyState(!!v);
    } catch (e) { /* 隐私模式或存储被禁用 */ }
  }

  try {
    const saved = localStorage.getItem(KEY_STORE);
    if (saved) {
      apiKeyEl.value = saved;
      reflectKeyState(true);
    }
  } catch (e) {}

  // 边输边存：不依赖失焦，粘完就算存好
  let keyTimer = null;
  apiKeyEl.addEventListener('input', () => {
    clearTimeout(keyTimer);
    keyTimer = setTimeout(persistKey, 350);
  });
  apiKeyEl.addEventListener('change', persistKey);

  keyClear.addEventListener('click', () => {
    apiKeyEl.value = '';
    apiKeyEl.type = 'password';
    $('keyToggle').textContent = '显示';
    try { localStorage.removeItem(KEY_STORE); } catch (e) {}
    reflectKeyState(false);
    setStatus('已清除本机保存的 Key，下次需要重新填写。');
    apiKeyEl.focus();
  });

  $('keyToggle').addEventListener('click', () => {
    const isPwd = apiKeyEl.type === 'password';
    apiKeyEl.type = isPwd ? 'text' : 'password';
    $('keyToggle').textContent = isPwd ? '隐藏' : '显示';
  });

  function setStatus(msg, tone) {
    summaryStatus.textContent = msg;
    if (tone) summaryStatus.dataset.tone = tone;
    else delete summaryStatus.dataset.tone;
  }

  /* ---------- 取帧并压缩 ---------- */

  async function pickFramesForApi(maxN) {
    const frames = state.frames;
    if (!frames.length) return [];

    let picked = frames;
    if (frames.length > maxN) {
      const step = frames.length / maxN;
      picked = Array.from({ length: maxN }, (_, k) => frames[Math.floor(k * step)]);
    }

    const out = [];
    for (const f of picked) {
      try {
        const img = await loadImage(f.url);
        const nw = img.naturalWidth || img.width;
        const nh = img.naturalHeight || img.height;
        const w = Math.min(800, nw);
        const h = Math.round(w * (nh / nw));
        const c = makeCanvas(w, h);
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        out.push({ time: f.time, dataUrl: c.toDataURL('image/jpeg', 0.72) });
      } catch (e) {
        log('[警告] 一帧压缩失败：' + e.message);
      }
    }
    return out;
  }

  /* ---------- 提示词 ---------- */

  function buildPrompt(frames) {
    const times = frames.map((f, i) => `第 ${i + 1} 帧 = ${fmtTime(f.time)}`).join('；');
    return [
      '你在分析一段视频的关键帧截图。这些帧是按时间顺序从视频里抽取的，代表了画面发生明显变化的时刻。',
      '',
      `共 ${frames.length} 帧，时间对应：${times}。`,
      '',
      '请按下面的结构输出：',
      '',
      '## 一句话总览',
      '用一句话说清这段视频在讲什么。',
      '',
      '## 时间线',
      '按时间顺序，每一帧写一小段，格式为「[时间点] 画面内容 — 这段在讲什么」。',
      '画面内容要写：出现了什么主体、有哪些可见的文字或数字、图表的大致结构。',
      '',
      '## 结构与逻辑',
      '整体是如何展开的：先讲什么、再怎么推进、有没有对比或递进。',
      '',
      '## 关键信息',
      '画面里出现的具体数据、结论、名词、步骤，逐条列出。没有就写「无可辨识的数据」。',
      '',
      '## 画面之外',
      '哪些内容很可能只存在于口播里、光看画面判断不了。这一节用来提醒我哪里需要回看。',
      '',
      '要求：',
      '1. 只描述你确实看到的，不要推测和编造。',
      '2. 文字看不清就直说「文字模糊无法辨认」，不要猜。',
      '3. 不要复述这些指令，直接给结论。',
    ].join('\n');
  }

  /* ---------- 调用模型（流式） ---------- */

  async function callVision(frames, opt) {
    const content = [{ type: 'text', text: buildPrompt(frames) }];
    frames.forEach((f, i) => {
      content.push({ type: 'text', text: `第 ${i + 1} 帧（${fmtTime(f.time)}）：` });
      content.push({ type: 'image_url', image_url: { url: f.dataUrl } });
    });

    const body = {
      model: opt.model,
      stream: true,
      temperature: 0.3,
      messages: [{ role: 'user', content }],
    };

    const resp = await fetch(opt.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + opt.key,
      },
      body: JSON.stringify(body),
      signal: sum.controller.signal,
    });

    if (!resp.ok) {
      let detail = '';
      try { detail = (await resp.text()).slice(0, 300); } catch (e) {}
      const hint = {
        400: '请求被拒，常见原因是模型不支持图片输入或参数不对',
        401: 'Key 无效或已过期',
        403: '没有权限，检查 Key 或该模型是否已开通',
        404: '模型名不存在。去控制台确认当前的免费视觉模型（智谱现为 glm-4.6v-flash）',
        429: '请求太频繁或额度用尽，稍后再试',
      }[resp.status] || '';
      throw new Error(`HTTP ${resp.status}${hint ? '　' + hint : ''}${detail ? '\n' + detail : ''}`);
    }

    // 没有流式响应体时退化为整体读取
    if (!resp.body || !resp.body.getReader) {
      const data = await resp.json();
      return (data.choices && data.choices[0] && data.choices[0].message &&
              data.choices[0].message.content) || '';
    }

    const reader = resp.body.getReader();
    const dec = new TextDecoder('utf-8');
    let buf = '';
    let full = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });

      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line || !line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        try {
          const j = JSON.parse(payload);
          const d = j.choices && j.choices[0] &&
                    (j.choices[0].delta || j.choices[0].message);
          const piece = d && d.content;
          if (piece) { full += piece; onChunk(piece); }
        } catch (e) { /* 不完整的分片，跳过 */ }
      }
    }
    return full;
  }

  /* ---------- 渲染 ---------- */

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // 极简排版：## 标题加粗，- 开头做项目符号，**文字**加粗
  function renderSummary(text) {
    const lines = escapeHtml(text).split('\n');
    let out = '';
    lines.forEach((line) => {
      const t = line.trimEnd();
      if (/^#{1,6}\s+/.test(t)) {
        // 块级元素自带换行，不再补 \n，避免行距被撑开
        out += '<span class="h">' + t.replace(/^#{1,6}\s+/, '') + '</span>';
      } else if (/^[-*]\s+/.test(t)) {
        out += '<span class="bullet">' + t.replace(/^[-*]\s+/, '') + '</span>';
      } else {
        out += t + '\n';
      }
    });
    return out.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  }

  let onChunk = () => {};

  function resetSummaryOutput() {
    sum.text = '';
    summaryText.innerHTML = '';
    summaryOutput.hidden = false;
  }

  /* ---------- 生成总结 ---------- */

  summarizeBtn.addEventListener('click', async () => {
    if (sum.running) return;

    const key = apiKeyEl.value.trim();
    const endpoint = apiEndpointEl.value.trim();
    const model = apiModelEl.value.trim();
    const maxN = Math.max(2, Math.min(16, parseInt(apiFramesEl.value, 10) || 8));

    if (!state.frames.length) { setStatus('还没有帧，先拆一遍视频。', 'error'); return; }
    if (!key) { setStatus('先填 API Key。没有的话可以点「复制提示词」，交给任意 AI。', 'error'); apiKeyEl.focus(); return; }
    if (!endpoint || !model) { setStatus('接口地址和模型名不能为空。', 'error'); return; }

    // DeepSeek V4 Pro 官方标注「图像理解：不支持」，选了也读不了帧
    if (/v4[\s._-]?pro/i.test(model)) {
      setStatus('DeepSeek V4 Pro 不支持图像输入（官方定价页明确标注），换 deepseek-flash 才能读帧。', 'error');
      return;
    }

    sum.running = true;
    sum.controller = new AbortController();
    summarizeBtn.disabled = true;
    stopBtn.hidden = false;
    resetSummaryOutput();
    summaryMeta.textContent = '准备中…';

    try {
      setStatus('正在压缩画面…');
      const frames = await pickFramesForApi(maxN);
      if (!frames.length) throw new Error('没有可用的帧');

      setStatus(`已选 ${frames.length} 帧，正在请求模型…`);
      summaryMeta.textContent = `${frames.length} 帧 · ${model}`;

      let count = 0;
      onChunk = (piece) => {
        count += piece.length;
        summaryText.innerHTML = renderSummary(sum.text);
        summaryText.scrollTop = summaryText.scrollHeight;
        if (count % 40 < piece.length) {
          summaryMeta.textContent = `${frames.length} 帧 · 已生成 ${count} 字`;
        }
      };

      const t0 = Date.now();
      sum.text = await callVision(frames, { key, endpoint, model });
      summaryText.innerHTML = renderSummary(sum.text);

      const secs = ((Date.now() - t0) / 1000).toFixed(1);
      summaryMeta.textContent = `${frames.length} 帧 · ${sum.text.length} 字 · ${secs}s`;
      setStatus('完成。可以复制或存成 .md。', 'ok');
    } catch (err) {
      const aborted = err && err.name === 'AbortError';
      if (aborted) {
        setStatus('已停止。已生成的部分保留在上面。', 'error');
      } else {
        const msg = (err && err.message) || String(err);
        let extra = '';
        if (/Failed to fetch|NetworkError|load failed/i.test(msg)) {
          extra = '　（可能是网络不通，或该接口不允许浏览器直接调用。可改用「复制提示词」）';
        }
        setStatus('出错了：' + msg + extra, 'error');
        log('[错误] 总结失败：' + msg);
      }
    } finally {
      sum.running = false;
      onChunk = () => {};
      summarizeBtn.disabled = false;
      stopBtn.hidden = true;
    }
  });

  stopBtn.addEventListener('click', () => {
    if (sum.controller) sum.controller.abort();
  });

  /* ---------- 复制 / 保存 ---------- */

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e2) {}
      ta.remove();
      return ok;
    }
  }

  $('copySummaryBtn').addEventListener('click', async () => {
    if (!sum.text) return;
    const ok = await copyText(sum.text);
    setStatus(ok ? '总结已复制。' : '复制失败，请手动选中。', ok ? 'ok' : 'error');
  });

  $('saveSummaryBtn').addEventListener('click', () => {
    if (!sum.text) return;
    const name = (state.file ? state.file.name.replace(/\.[^.]+$/, '') : '视频') + '_画面总结.md';
    const head = `# 画面总结\n\n源文件：${state.file ? state.file.name : '未知'}\n帧数：${state.frames.length}\n生成时间：${new Date().toLocaleString()}\n\n---\n\n`;
    downloadBlob(new Blob([head + sum.text], { type: 'text/markdown;charset=utf-8' }), name);
  });

  /* ---------- 无 Key 的兜底：导出提示词与图片 ---------- */

  $('promptBtn').addEventListener('click', async () => {
    if (!state.frames.length) { setStatus('还没有帧。', 'error'); return; }
    const maxN = Math.max(2, Math.min(16, parseInt(apiFramesEl.value, 10) || 8));
    setStatus('正在整理提示词…');

    const frames = await pickFramesForApi(maxN);
    const list = frames.map((f, i) => `第 ${i + 1} 帧（${fmtTime(f.time)}）`).join('\n');
    const text = buildPrompt(frames) +
      '\n\n---\n\n（请把上面列出的 ' + frames.length + ' 张截图按顺序一起发给我）\n\n截图清单：\n' + list;

    const ok = await copyText(text);
    setStatus(ok
      ? `提示词已复制。把「下载总结用图」得到的 ${frames.length} 张图一起发给任意 AI 即可。`
      : '复制失败，请手动选中。', ok ? 'ok' : 'error');
  });

  $('summaryImgsBtn').addEventListener('click', async () => {
    if (!state.frames.length) { setStatus('还没有帧。', 'error'); return; }
    const maxN = Math.max(2, Math.min(16, parseInt(apiFramesEl.value, 10) || 8));
    setStatus('正在导出图片…');
    const frames = await pickFramesForApi(maxN);
    frames.forEach((f, i) => {
      setTimeout(() => {
        const bin = atob(f.dataUrl.split(',')[1]);
        const arr = new Uint8Array(bin.length);
        for (let k = 0; k < bin.length; k++) arr[k] = bin.charCodeAt(k);
        const name = `总结图_${String(i + 1).padStart(2, '0')}_${fmtFileStamp(f.time)}.jpg`;
        downloadBlob(new Blob([arr], { type: 'image/jpeg' }), name);
      }, i * 260);
    });
    setStatus(`已导出 ${frames.length} 张（按时间编号）。`, 'ok');
  });

})();
