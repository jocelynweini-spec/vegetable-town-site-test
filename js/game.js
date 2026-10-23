/* ============================================================
   蔬菜镇 · 游戏引擎
   ============================================================ */
(() => {
  'use strict';
  const D = window.GAME_DATA;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const wait = ms => new Promise(r => setTimeout(r, ms));

  const sceneEl = $('#scene');
  const stage = $('#stage-ui');
  const overlayRoot = $('#overlay-root');
  const dlgEl = $('#dialogue');
  const flashEl = $('#flash');

  /* ---------------- 状态 ---------------- */
  const state = {
    chapter: 0,
    collected: new Set(),      // 线索 id
    asked: {},                 // resident -> {regular:[bool], follow:bool}
    notes: new Set(),          // note1..3
    burnt: false,
    guided: {},                // resident -> true
    quizIndex: 0,
    archiveRead: new Set(),
    timer: 300,
    timerId: null,
    busy: false,
    sound: true,
    started: false
  };
  D.residents.forEach(id => { state.asked[id] = { regular: [false, false, false], follow: false }; });

  /* ================= 音频（无外部素材，纯合成） ================= */
  const audio = {
    ctx: null,
    init() {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) this.ctx = new AC();
      }
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    },
    tone(freq = 440, dur = 0.08, type = 'square', vol = 0.05) {
      if (!state.sound) return;
      this.init();
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(this.ctx.destination);
      o.start(t); o.stop(t + dur + 0.02);
    },
    click() { this.tone(660, 0.045, 'square', 0.035); },
    type() { this.tone(880 + Math.random() * 120, 0.02, 'square', 0.012); },
    chime() {
      if (!state.sound) return;
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
        setTimeout(() => this.tone(f, 0.24, 'sine', 0.06), i * 90));
    },
    tick() { this.tone(1200, 0.03, 'square', 0.03); },
    boom() {
      if (!state.sound) return;
      this.init();
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      const buffer = this.ctx.createBuffer(1, this.ctx.sampleRate * 1.2, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 2.2);
      const src = this.ctx.createBufferSource();
      const g = this.ctx.createGain();
      g.gain.value = 0.16;
      src.buffer = buffer;
      src.connect(g).connect(this.ctx.destination);
      src.start(t);
    },
    music() {
      if (!state.sound) return;
      const seq = [523.25, 659.25, 783.99, 659.25, 587.33, 698.46, 880, 698.46];
      seq.forEach((f, i) => setTimeout(() => this.tone(f, 0.5, 'triangle', 0.035), i * 260));
    }
  };

  /* ================= 场景 ================= */
  let sceneSlot = 0;
  let currentScene = '';
  function setScene(name, { dim = false, instant = false } = {}) {
    if (!name) return;
    const layers = [$('#bg-a'), $('#bg-b')];
    const next = layers[1 - sceneSlot];
    const cur = layers[sceneSlot];
    if (currentScene === name && next.classList.contains('on')) return;

    next.style.backgroundImage = `url(assets/scenes/${name}.jpg)`;
    $('#bg-bleed').style.backgroundImage = `url(assets/scenes/${name}.jpg)`;
    next.classList.toggle('dim', dim);
    if (instant) {
      next.style.transition = 'none';
      next.classList.add('on');
      cur.classList.remove('on');
      requestAnimationFrame(() => { next.style.transition = ''; });
    } else {
      next.classList.add('on');
      cur.classList.remove('on');
    }
    sceneSlot = 1 - sceneSlot;
    currentScene = name;
  }

  // 鼠标视差
  let px = 0, py = 0, tx = 0, ty = 0;
  window.addEventListener('mousemove', e => {
    px = (e.clientX / window.innerWidth - 0.5) * 2;
    py = (e.clientY / window.innerHeight - 0.5) * 2;
  });
  (function loopParallax() {
    tx += (px - tx) * 0.06;
    ty += (py - ty) * 0.06;
    sceneEl.style.transform = `translate3d(${-tx * 10}px, ${-ty * 7}px, 0)`;
    requestAnimationFrame(loopParallax);
  })();

  /* ================= 小工具 ================= */
  function chapter(label) {
    $('#chapter-label').textContent = label;
  }
  function clockSet(text) { $('#clock-value').textContent = text; }
  function clockError(on) {
    $('#clock-chip').classList.toggle('err', !!on);
    if (!on) return;
    let n = 0;
    clockSet('??:??');
    const id = setInterval(() => {
      const pool = '0123456789:';
      let s = '';
      for (let i = 0; i < 5; i++) s += pool[(Math.random() * pool.length) | 0];
      clockSet(s);
      if (++n > 26) { clearInterval(id); clockSet('??:??'); }
    }, 70);
  }
  function doFx(fx) {
    if (!fx) return;
    if (fx.includes('shake')) {
      document.body.classList.remove('shake');
      void document.body.offsetWidth;
      document.body.classList.add('shake');
      setTimeout(() => document.body.classList.remove('shake'), 500);
    }
    if (fx.includes('glitch')) {
      document.body.classList.remove('glitch');
      void document.body.offsetWidth;
      document.body.classList.add('glitch');
      setTimeout(() => document.body.classList.remove('glitch'), 900);
    }
    if (fx.includes('flash')) {
      flashEl.classList.add('on');
      setTimeout(() => flashEl.classList.remove('on'), 240);
    }
  }
  function whiteOut(ms = 700) {
    flashEl.classList.add('on', 'hold');
    return wait(ms);
  }
  function whiteIn(ms = 600) {
    flashEl.classList.remove('hold');
    flashEl.classList.remove('on');
    return wait(ms);
  }
  function toast(text, ms = 1900) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = text;
    document.body.appendChild(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 400); }, ms);
  }
  function nameOf(who) {
    if (!who || who === 'narr') return '旁白';
    return (D.characters[who] && D.characters[who].name) || who;
  }
  function imgOf(who) {
    return (D.characters[who] && D.characters[who].img) || '';
  }

  /* ================= 对话系统 ================= */
  const dlg = {
    lines: [], idx: -1, done: null, typing: false, tId: null,
    full: '', shown: 0, active: false, locked: false
  };

  function playDialogue(lines, done) {
    dlg.lines = lines.slice();
    dlg.idx = -1;
    dlg.done = done || null;
    dlg.active = true;
    dlg.locked = false;
    dlgEl.classList.remove('hidden');
    nextLine();
  }
  function nextLine() {
    dlg.idx++;
    if (dlg.idx >= dlg.lines.length) return endDialogue();
    const line = dlg.lines[dlg.idx];
    if (line.scene) setScene(line.scene, { dim: !!line.dim });
    if (line.fx) doFx(line.fx);
    if (line.bgfx) { /* reserved */ }
    renderPortraits(line);
    $('#dlg-speaker').textContent = line.speaker || nameOf(line.who);
    $('#dlg-actions').innerHTML = '';
    dlg.locked = false;

    if (line.choices) {
      typeText(line.text, () => {
        dlg.locked = true;
        renderChoices(line);
        $('#dlg-hint').textContent = '请选择';
      });
    } else {
      typeText(line.text);
    }
  }
  function renderPortraits(line) {
    const left = $('#dlg-portrait-left');
    const right = $('#dlg-portrait-right');
    const who = line.who;
    if (!who || who === 'narr') {
      left.classList.add('hidden'); right.classList.add('hidden');
      return;
    }
    if (who === 'tomato') {
      left.classList.remove('hidden'); right.classList.add('hidden');
      left.querySelector('img').src = imgOf('tomato');
    } else {
      right.classList.remove('hidden'); left.classList.add('hidden');
      right.querySelector('img').src = imgOf(who);
    }
  }
  function typeText(text, cb) {
    const el = $('#dlg-text');
    dlg.full = text || '';
    dlg.shown = 0;
    dlg.typing = true;
    el.textContent = '';
    $('#dlg-hint').textContent = '';
    clearInterval(dlg.tId);
    let i = 0;
    dlg.tId = setInterval(() => {
      if (i >= dlg.full.length) {
        clearInterval(dlg.tId);
        dlg.typing = false;
        $('#dlg-hint').textContent = dlg.locked ? '' : '点击继续 ▼';
        if (cb) cb();
        return;
      }
      // 一次多吐几个字符，速度更自然
      const step = 1 + (Math.random() < 0.35 ? 1 : 0);
      el.textContent += dlg.full.slice(i, i + step);
      i += step;
      if (i % 3 === 0) audio.type();
    }, 26);
  }
  function finishType() {
    clearInterval(dlg.tId);
    dlg.typing = false;
    $('#dlg-text').textContent = dlg.full;
    if (dlg.locked) return;
    $('#dlg-hint').textContent = '点击继续 ▼';
  }
  function renderChoices(line) {
    const box = $('#dlg-actions');
    box.innerHTML = '';
    line.choices.forEach(ch => {
      const b = document.createElement('button');
      b.className = 'pix-btn' + (ch.style === 'primary' ? ' primary' : '');
      b.textContent = ch.label;
      b.onclick = e => {
        e.stopPropagation();
        audio.click();
        box.innerHTML = '';
        dlg.locked = false;
        if (ch.action) ch.action();
        else nextLine();
      };
      box.appendChild(b);
    });
  }
  function endDialogue() {
    dlgEl.classList.add('hidden');
    dlg.active = false;
    const cb = dlg.done;
    dlg.done = null;
    if (cb) cb();
  }
  dlgEl.addEventListener('click', e => {
    if (e.target.closest('button')) return;
    if (!dlg.active) return;
    if (dlg.typing) return finishType();
    if (dlg.locked) return;
    audio.click();
    nextLine();
  });

  /* ================= 弹层 ================= */
  const overlayStack = [];
  function openOverlay(html, { className = '', closable = true, onClose = null } = {}) {
    const ov = document.createElement('div');
    ov.className = 'overlay ' + className;
    ov.innerHTML = `
      ${closable ? '<button class="ov-close" aria-label="关闭">✕</button>' : ''}
      <div class="ov-inner" style="display:contents">${html}</div>`;
    overlayRoot.appendChild(ov);
    overlayStack.push(ov);
    if (closable) {
      ov.querySelector('.ov-close').onclick = () => { audio.click(); closeOverlay(ov); };
    }
    ov._onClose = onClose;
    return ov;
  }
  function closeOverlay(ov) {
    if (!ov || !ov.parentNode) return;
    ov.classList.add('closing');
    const idx = overlayStack.indexOf(ov);
    if (idx >= 0) overlayStack.splice(idx, 1);
    setTimeout(() => {
      ov.remove();
      if (ov._onClose) ov._onClose();
    }, 180);
  }
  function closeTopOverlay() {
    const ov = overlayStack[overlayStack.length - 1];
    if (ov) closeOverlay(ov);
  }
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeTopOverlay();
  });

  /* ================= 标题页 ================= */
  const TITLE = '失踪的胡萝卜到底是不是时间的尽头';
  const TITLE2 = '——为什么7个居民也能是小镇啊喂？';

  function bootTitle() {
    state.started = false;
    setScene('town_square_spring', { instant: true });
    clockError(true);
    chapter('序章 · 锚点丢失');
    document.body.classList.add('title-mode');
    stage.innerHTML = `
      <div class="title-screen">
        <div class="ascii" id="boot-ascii"></div>
        <h1 class="title-main">${TITLE}</h1>
        <div class="title-sub">${TITLE2}</div>
        <div class="title-card">
          <div class="title-note">
            蔬菜镇的时间，是靠一根胡萝卜维持的。<br>
            丰收庆典前夜，它不见了。<br>
            你是一个路过的番茄侦探 —— 你来自“外面”。
          </div>
          <button class="pix-btn primary title-start" id="btn-start">开始调查 ▶</button>
          <div class="title-badges">
            <span class="badge">像素 / 拼贴 / Y2K</span>
            <span class="badge">10 幕剧情</span>
            <span class="badge">6 条双层线索</span>
            <span class="badge">3D 角色档案</span>
          </div>
        </div>
      </div>`;
    const ascii = $('#boot-ascii');
    const lines = [
      '> BOOTING VEGETABLE-TOWN.exe ................ OK',
      '> SYSTEM ERROR: <span class="warn">ANCHOR LOST</span>',
      '> TIME DRIFT: 17.3% / 7 RESIDENTS DETECTED',
      '> PLEASE RECONNECT THE CARROT.'
    ];
    let i = 0;
    const tick = () => {
      if (i >= lines.length) return;
      ascii.innerHTML += (i ? '\n' : '') + lines[i];
      i++;
      setTimeout(tick, 420);
    };
    tick();
    $('#btn-start').onclick = () => {
      audio.init(); audio.chime();
      stage.innerHTML = '';
      document.body.classList.remove('title-mode');
      startGame();
    };
  }

  function startGame() {
    state.started = true;
    act1();
  }

  /* ================= 第一幕 ================= */
  function act1() {
    chapter('第一幕 · 失踪');
    setScene('town_square_spring');
    clockError(true);
    playDialogue([
      { who: 'narr', text: '蔬菜镇的时间，是靠一根胡萝卜维持的。' },
      { who: 'narr', text: '每天早上六点，广场中央那根一米长的巨型胡萝卜会抖一下，缨子指向东边。全镇七个蔬菜水果就知道：该起床了。' },
      { who: 'narr', text: '中午十二点，抖第二下：该吃饭了。\n晚上六点，抖第三下：该收摊了。' },
      { who: 'narr', text: '这根胡萝卜不是展品，它是时钟。' },
      { who: 'narr', text: '丰收庆典前夜，它不见了。', fx: 'glitch' },
      { who: 'narr', text: '你是一个路过的番茄侦探。你来自“外面”，所以你有“外面”的概念。', scene: 'town_square' },
      { who: 'onion', text: '不只是胡萝卜不见了。你听——', scene: 'town_square_dawn', fx: 'shake' },
      { who: 'narr', text: '你侧耳倾听。镇上的钟全在乱响。' },
      { who: 'eggplant', text: '现在是凌晨两点！……呼啊——（打了个哈欠）' },
      { who: 'chili', text: '才十二点！我辣椒素素说十二点就是十二点！' },
      { who: 'radish', text: '已……已经十点了……我、我确定……' },
      { who: 'narr', text: '没有一个人说的时间是对的。' },
      { who: 'onion', text: '胡萝卜是时间锚。它一消失，全镇的时间就开始漂。你必须在庆典开始前找到它，否则——' },
      { who: 'tomato', text: '否则什么？' },
      { who: 'onion', text: '否则我们连“明天”什么时候来，都不知道了。' },
      { who: 'narr', text: '去仓库看看。失踪的地方，总会留下点什么。' }
    ], () => {
      chapter('第二幕 · 搜证');
      act2();
    });
  }

  /* ================= 第二幕 · 搜证 ================= */
  function act2() {
    chapter('第二幕 · 搜证');
    state.loc = state.loc || 'warehouse';
    renderEvidence();
    if (!state._act2intro) {
      state._act2intro = true;
      setTimeout(() => {
        playDialogue([
          { who: 'tomato', text: '（仓库门虚掩着。空气里有一股……辣椒粉的味道。）' },
          { who: 'narr', text: '点亮场景里所有可疑的地方。每件东西都有两面。' }
        ]);
      }, 300);
    }
  }

  function renderEvidence() {
    const loc = D.clueLocations.find(l => l.id === state.loc);
    setScene(loc.scene, { dim: false });
    const got = state.collected.size;
    const hotspotHTML = loc.hotspots.map(h => {
      const done = state.collected.has(h.id);
      return `<button class="hotspot ${done ? 'done' : ''}" style="left:${h.x}%;top:${h.y}%"
        data-clue="${h.id}" title="${h.label}">
        <span class="hs-dot">${h.icon}</span>
        <span class="hs-label">${h.label}</span>
      </button>`;
    }).join('');

    stage.innerHTML = `
      <div class="act-wrap">
        <div class="loc-tabs">
          ${D.clueLocations.map(l =>
            `<button class="loc-tab ${l.id === loc.id ? 'active' : ''}" data-loc="${l.id}">${l.name}</button>`
          ).join('')}
        </div>
        <div class="hotspot-frame">${hotspotHTML}</div>
        <div class="progress-chip">线索 <b>${got}</b> / 6</div>
        <div class="tip-bar" id="evidence-tip">
          ${got >= 6
            ? '六条线索都在这了。去侦探事务所，把它们钉上墙。'
            : '点击闪烁的位置搜证 · 每条线索都可以翻到背面'}
        </div>
        ${got >= 6 ? '<button class="pix-btn primary next-act" id="to-act3" style="right:22px;bottom:150px;position:absolute">去侦探事务所 ▶</button>' : ''}
      </div>`;

    $$('.loc-tab', stage).forEach(b => b.onclick = () => {
      audio.click();
      state.loc = b.dataset.loc;
      renderEvidence();
    });
    $$('.hotspot', stage).forEach(b => b.onclick = () => {
      audio.click();
      openClue(b.dataset.clue);
    });
    const next = $('#to-act3');
    if (next) next.onclick = () => { audio.click(); act3(); };
  }

  function openClue(id, readOnly = false) {
    const c = D.clues[id];
    if (!c) return;
    const known = state.collected.has(id);
    const html = `
      <div class="clue-scene">
        <div class="clue-card" id="clue-card">
          <div class="clue-face front">
            <div class="holo"></div>
            <div class="clue-head">
              <div>
                <div class="clue-tag">${c.tag}</div>
                <div class="clue-title">${c.title}</div>
              </div>
              <div class="clue-stamp">${c.stamp}</div>
            </div>
            <div class="clue-body">${escapeHTML(c.surface)}</div>
            <div class="clue-foot">
              <span class="clue-hint">表面 · SURFACE</span>
              <button class="pix-btn" id="flip-btn">翻到背面 →</button>
            </div>
          </div>
          <div class="clue-face back">
            <div class="holo"></div>
            <div class="clue-head">
              <div>
                <div class="clue-tag">${c.tag}</div>
                <div class="clue-title">${c.title} · 另一面</div>
              </div>
              <div class="clue-stamp">${c.stamp}</div>
            </div>
            <div class="clue-deep-label">深层 · HIDDEN LAYER</div>
            <div class="clue-deep">${escapeHTML(c.deep)}</div>
            <div class="clue-foot">
              <span class="clue-hint">${readOnly || known ? '已收入线索墙' : '再想一想，这一面说明什么？'}</span>
              <button class="pix-btn mint" id="keep-btn">${readOnly || known ? '收起' : '收入档案 ✓'}</button>
            </div>
          </div>
        </div>
      </div>`;
    const ov = openOverlay(html, { className: 'clue-ov' });
    const card = $('#clue-card', ov);
    const sceneWrap = $('.clue-scene', ov);

    // 鼠标 3D 倾斜 + 镭射反光
    const onMove = e => {
      if (card.classList.contains('flipped')) return;
      const r = sceneWrap.getBoundingClientRect();
      const dx = (e.clientX - r.left) / r.width - 0.5;
      const dy = (e.clientY - r.top) / r.height - 0.5;
      sceneWrap.style.transform = `rotateY(${dx * 14}deg) rotateX(${-dy * 12}deg)`;
      const holo = $('.front .holo', ov);
      if (holo) {
        holo.style.backgroundPosition = `${(dx + 0.5) * 100}% ${(dy + 0.5) * 100}%`;
      }
    };
    sceneWrap.addEventListener('mousemove', onMove);
    sceneWrap.addEventListener('mouseleave', () => { sceneWrap.style.transform = ''; });

    $('#flip-btn', ov).onclick = e => {
      e.stopPropagation();
      audio.click();
      card.classList.add('flipped');
      sceneWrap.style.transform = '';
    };
    $('#keep-btn', ov).onclick = e => {
      e.stopPropagation();
      audio.click();
      if (!known && !readOnly) {
        state.collected.add(id);
        audio.chime();
        toast('获得线索：' + c.title);
      }
      closeOverlay(ov);
      if (!readOnly) renderEvidence();
      updateClueBadge();
    };
  }

  function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  }

  function updateClueBadge() {
    const btn = $('#btn-clueboard');
    if (!btn) return;
    btn.textContent = `线索墙 ${state.collected.size}/6`;
  }

  /* ================= 线索墙 ================= */
  function openClueBoard() {
    const ids = Array.from(state.collected);
    const cards = ids.map(id => {
      const c = D.clues[id];
      return `<div class="board-card" data-clue="${id}" style="--r:${(Math.random() * 3 - 1.5).toFixed(1)}deg">
        <div class="bc-thumb">${iconOf(id)}</div>
        <div class="bc-title">${c.title}</div>
        <div class="bc-tag">${c.tag}</div>
      </div>`;
    }).join('');
    const html = `
      <div class="board-wrap">
        <div class="board-cork"></div>
        <div class="board-inner">
          <div class="board-head">
            <h3>番茄侦探的线索墙</h3>
            <span style="font-size:12px;letter-spacing:.14em;color:rgba(248,240,221,.7)">
              ${ids.length} / 6 条线索 · 点击查看
            </span>
          </div>
          <div class="board-grid">
            ${cards || '<div class="board-empty">还没有线索。<br>去仓库和广场基座找找吧。</div>'}
          </div>
        </div>
      </div>`;
    const ov = openOverlay(html, { className: 'board-ov' });
    $$('.board-card', ov).forEach(b => b.onclick = () => {
      audio.click();
      openClue(b.dataset.clue, true);
    });
  }
  function iconOf(id) {
    return ({
      ticket: '罚', watch: '表', shovel: '铲',
      carrotTop: '缨', powder: '粉', debt: '欠'
    })[id] || '？';
  }

  /* ================= 第三幕 · 问话 ================= */
  function act3() {
    chapter('第三幕 · 问话');
    setScene('mayor_office');
    renderRoster();
    if (!state._act3intro) {
      state._act3intro = true;
      setTimeout(() => playDialogue([
        { who: 'tomato', text: '（七个人，七个说法。先把每个人的话钉在时间轴上。）' },
        { who: 'narr', text: '每人可以问 3 个常规问题。问完，才能追问那一个真正的问题。' }
      ]), 260);
    }
  }

  function askedCount(id) {
    const a = state.asked[id];
    if (!a) return 0;
    return a.regular.filter(Boolean).length + (a.follow ? 1 : 0);
  }
  function allInterrogated() {
    return D.residents.every(id => state.asked[id].follow);
  }

  function renderRoster() {
    const doneCount = D.residents.filter(id => state.asked[id].follow).length;
    const cards = D.residents.map(id => {
      const ch = D.characters[id];
      const done = state.asked[id].follow;
      const asked = askedCount(id);
      return `<button class="roster-card ${done ? 'done' : ''}" data-res="${id}">
        <div class="rc-img"><img src="${ch.img}" alt="${ch.name}"></div>
        <div class="rc-name">${ch.name}</div>
        <div class="rc-tag">${ch.tag}</div>
        <div class="rc-state">${done ? '已追问' : `已问 ${asked} / 4`}</div>
      </button>`;
    }).join('');

    stage.innerHTML = `
      <div class="act-wrap">
        <div class="roster">
          <div class="roster-head">
            <h2>七个人，七个时间</h2>
            <p>追问完成 ${doneCount} / 7</p>
          </div>
          <div class="roster-grid">${cards}</div>
          ${allInterrogated()
            ? '<button class="pix-btn primary" id="to-act4" style="margin-top:20px">仓库后面 · 下到地窖 ▶</button>'
            : '<div class="tip-bar" style="margin-top:16px">问完 3 个常规问题，追问才会出现。</div>'}
        </div>
      </div>`;

    $$('.roster-card', stage).forEach(b => b.onclick = () => {
      audio.click();
      openInterview(b.dataset.res);
    });
    const next = $('#to-act4');
    if (next) next.onclick = () => { audio.click(); act4(); };
  }

  function openInterview(id) {
    const ch = D.characters[id];
    const data = D.interrogations[id];
    const st = state.asked[id];

    const qHTML = () => data.questions.map((q, i) => `
      <button class="qbtn ${st.regular[i] ? 'asked' : ''}" data-qi="${i}">
        <span class="qmark">Q${i + 1}</span>${q.q}
      </button>`).join('') + `
      <button class="qbtn follow ${st.follow ? 'asked' : ''}" data-follow="1"
        ${st.regular.every(Boolean) ? '' : 'disabled'}>
        ${data.follow.q}
      </button>`;

    const html = `
      <div class="interview">
        <div class="iv-left">
          <img src="${ch.img}" alt="${ch.name}">
          <div class="iv-name">${ch.name}</div>
          <div class="iv-role">${ch.tag}</div>
        </div>
        <div class="iv-right">
          <div class="iv-head">
            <h4>问话记录 · ${ch.name}</h4>
            <span class="iv-progress">${askedCount(id)} / 4</span>
          </div>
          <div class="iv-qs" id="iv-qs">${qHTML()}</div>
          <div class="iv-answer empty" id="iv-answer">选择一个你想问的问题。</div>
        </div>
      </div>`;
    const ov = openOverlay(html, { className: 'interview-ov' });
    const answer = $('#iv-answer', ov);

    function bind() {
      $$('#iv-qs .qbtn', ov).forEach(btn => {
        btn.onclick = () => {
          if (btn.disabled) return;
          audio.click();
          const isFollow = !!btn.dataset.follow;
          if (isFollow) {
            st.follow = true;
            showAnswer(data.follow.a, ch.name, true);
          } else {
            const qi = Number(btn.dataset.qi);
            st.regular[qi] = true;
            showAnswer(data.questions[qi].a, ch.name, false);
          }
          $('.iv-progress', ov).textContent = askedCount(id) + ' / 4';
          $('#iv-qs', ov).innerHTML = qHTML();
          bind();
          if (st.follow) {
            setTimeout(() => {
              toast('追问完成：' + ch.name);
              audio.chime();
            }, 420);
          }
        };
      });
    }
    function showAnswer(text, name, isFollow) {
      answer.classList.remove('empty');
      answer.innerHTML = `<div class="ans-name">${name}${isFollow ? ' · 追问' : ''}</div>${escapeHTML(text)}`;
      answer.scrollTop = answer.scrollHeight;
    }
    bind();

    ov._onClose = () => {
      renderRoster();
      if (allInterrogated()) {
        setTimeout(() => {
          playDialogue([
            { who: 'tomato', text: '（七个人的话，都指向同一个方向——仓库后面。）' },
            { who: 'narr', text: '线索墙上的红线，全部绷直了。' }
          ], () => renderRoster());
        }, 220);
      }
    };
  }

  /* ================= 第四幕 · 地窖 ================= */
  function act4() {
    chapter('第四幕 · 地窖');
    setScene('cellar');
    playDialogue([
      { who: 'narr', text: '地窖不大，角落里堆着杂物。空气里有蜡油和土的味道。' },
      { who: 'narr', text: '墙上没有公告，只有一排刻痕——像有人用指甲划的，一道一道，密密麻麻，数不清。' },
      { who: 'tomato', text: '（刻痕旁边，贴着几张泛黄的纸片。）' }
    ], () => {
      stage.innerHTML = `
        <div class="act-wrap">
          <div class="tip-bar">凑近墙面，看清那些字。</div>
          <button class="pix-btn primary" id="approach" style="position:absolute;left:50%;bottom:150px;transform:translateX(-50%)">凑近墙面</button>
        </div>`;
      $('#approach').onclick = () => { audio.click(); showWall(); };
    });
  }

  function showWall() {
    stage.innerHTML = '';
    setScene('cellar_wall');
    const hotspots = D.cellarHotspots.map(h => {
      const locked = h.id === 'burnt' && state.notes.size < 3;
      const done = h.id === 'burnt' ? state.burnt : state.notes.has(h.id);
      if (locked) return '';
      return `<button class="hotspot ${done ? 'done' : ''}" style="left:${h.x}%;top:${h.y}%"
        data-note="${h.id}" title="${h.label}">
        <span class="hs-dot">${h.id === 'burnt' ? '焦' : '记'}</span>
        <span class="hs-label">${h.label}</span>
      </button>`;
    }).join('');

    stage.innerHTML = `
      <div class="act-wrap">
        <div class="act-title"><h2>CELLAR · 刻痕</h2><p>36525 天 · 三道指甲印</p></div>
        <div class="hotspot-frame">${hotspots}</div>
        <div class="progress-chip">便签 <b>${state.notes.size}</b> / 3</div>
        <div class="tip-bar" id="cellar-tip">
          ${state.notes.size < 3 ? '先看完三张便签。' : (state.burnt ? '真相就在那张烧焦的纸上。' : '墙的最下面，还有半张烧焦的纸。')}
        </div>
        ${(state.notes.size >= 3 && state.burnt)
          ? '<button class="pix-btn primary" id="to-accuse" style="position:absolute;right:22px;bottom:150px">指认真相 ▶</button>'
          : ''}
      </div>`;

    $$('.hotspot', stage).forEach(b => b.onclick = () => {
      audio.click();
      openNote(b.dataset.note);
    });
    const n = $('#to-accuse');
    if (n) n.onclick = () => { audio.click(); act5(); };
  }

  function openNote(id) {
    const note = D.cellarNotes[id];
    const isBurnt = id === 'burnt';
    const cls = id === 'note2' ? 'red' : (isBurnt ? 'hot' : '');
    const html = `
      <div class="note-card ${cls}" id="note-card">
        <div class="note-title">${note.title}</div>
        <div class="note-style">${note.style}</div>
        <div class="note-body">${escapeHTML(note.body)}</div>
      </div>`;
    const ov = openOverlay(html, { className: 'note-ov' });
    const card = $('#note-card', ov);

    if (isBurnt) {
      const crumble = document.createElement('div');
      crumble.className = 'crumble';
      card.appendChild(crumble);
      setTimeout(() => crumble.remove(), 1200);
      audio.boom();
    } else {
      audio.click();
    }
    setTimeout(() => {
      if (isBurnt) {
        state.burnt = true;
        audio.chime();
        toast('真相：LAB-7 · 清理协议');
      } else {
        state.notes.add(id);
      }
    }, isBurnt ? 900 : 200);

    const closeBtn = $('.ov-close', ov);
    if (closeBtn) {
      const old = closeBtn.onclick;
      closeBtn.onclick = () => {
        if (!isBurnt) state.notes.add(id);
        updateWallProgress();
        old && old();
      };
    }
    ov._onClose = () => {
      if (!isBurnt) state.notes.add(id);
      updateWallProgress();
    };
  }

  function updateWallProgress() {
    if (currentScene === 'cellar_wall') showWall();
  }

  /* ================= 第五幕 · 指认 ================= */
  function act5() {
    chapter('第五幕 · 指认');
    setScene('cellar', { dim: true });
    const html = `
      <div class="accuse-wrap">
        <div class="accuse-card">
          <div class="accuse-head">
            <span class="ac-tag">指认 · ACCUSATION</span>
            <h3>胡萝卜到底去哪了？</h3>
            <p>你只会有一次机会。想清楚。</p>
          </div>
          <div class="accuse-opts" id="acc-opts">
            ${D.accusations.map(a => `
              <button class="accuse-opt" data-id="${a.id}">
                <span class="ao-key">${a.id}</span>
                <span class="ao-text">${a.text}</span>
              </button>`).join('')}
          </div>
          <div class="accuse-reply" id="acc-reply"></div>
        </div>
      </div>`;
    const ov = openOverlay(html, { className: 'accuse-ov', closable: false });
    const reply = $('#acc-reply', ov);
    let locked = false;

    $$('.accuse-opt', ov).forEach(btn => btn.onclick = () => {
      if (locked) return;
      audio.click();
      const a = D.accusations.find(x => x.id === btn.dataset.id);
      if (a.ok) {
        locked = true;
        btn.classList.add('right');
        reply.textContent = a.reply;
        audio.chime();
        setTimeout(() => {
          closeOverlay(ov);
          playDialogue([
            { who: 'tomato', text: '（不是偷。是“被带走”，也是“想被找到”。）' },
            { who: 'narr', text: '地窖最深处，有一扇小门。门上挂着一块牌子：“时间管理局 · 观察哨”。', fx: 'glitch' },
            { who: 'narr', text: '门没锁。' }
          ], () => act6());
        }, 1400);
      } else {
        btn.classList.add('wrong');
        reply.textContent = a.reply;
        document.body.classList.remove('shake');
        void document.body.offsetWidth;
        document.body.classList.add('shake');
        setTimeout(() => {
          btn.classList.remove('wrong');
          document.body.classList.remove('shake');
        }, 700);
      }
    });
  }

  /* ================= 第六幕 · 观察哨 ================= */
  function act6() {
    chapter('第六幕 · 观察哨');
    setScene('observation_post');
    state.archiveRead = new Set();

    const archiveHTML = D.archive.map((a, i) => `
      <div class="archive-item unread" data-ai="${i}">
        <div class="y">${a.year}</div>
        <div class="t">${a.text}</div>
        <div class="n">备注：${a.note}</div>
      </div>`).join('');

    const html = `
      <div class="bureau-wrap">
        <div class="bureau-left">
          <div class="bureau-title">蔬菜镇 · 实时监控</div>
          <div class="bureau-sub">TIME MANAGEMENT BUREAU / OBSERVATION POST</div>
          <div class="bureau-stats">
            <div class="stat"><div class="k">居民数</div><div class="v">7</div></div>
            <div class="stat warn"><div class="k">时间锚状态</div><div class="v">异常</div></div>
            <div class="stat warn"><div class="k">自主意识指数</div><div class="v">17.3%</div></div>
            <div class="stat warn"><div class="k">清理协议</div><div class="v">已激活</div></div>
          </div>
          <div class="bureau-screen" id="bureau-screen">
            <div style="font-size:11px;letter-spacing:.18em;color:rgba(0,255,255,.55);margin-bottom:10px">
              蔬菜镇百年档案 · 点击条目阅读（<span id="arc-count">0</span>/7）
            </div>
            ${archiveHTML}
            <div style="font-size:11px;line-height:1.7;color:rgba(232,65,58,.85);margin-top:10px">
              异常：清理协议将于今年触发。备注：它们还没学会“自己把握时间”。
            </div>
          </div>
        </div>
        <div class="bureau-right">
          <div class="br-img"><img id="br-speaker-img" src="${D.characters.heihei.img}" alt=""></div>
          <div class="br-dialog">
            <div class="br-name" id="br-name">茄子黑黑</div>
            <div class="br-text" id="br-text"></div>
            <div class="br-actions">
              <span class="br-hint" id="br-hint">点击继续 ▼</span>
              <button class="pix-btn" id="br-next">继续</button>
            </div>
          </div>
        </div>
      </div>`;
    const ov = openOverlay(html, { className: 'bureau-ov', closable: false });

    // 档案阅读
    $$('.archive-item', ov).forEach(it => it.onclick = () => {
      it.classList.remove('unread');
      state.archiveRead.add(it.dataset.ai);
      $('#arc-count', ov).textContent = state.archiveRead.size;
      audio.tick();
    });

    const lines = [
      { who: 'heihei', text: '……你来了。我们等很久了。' },
      { who: 'lala', text: '规章第 7 条说不能干预。所以我们只能等。' },
      { who: 'heihei', text: '一百年前就知道。' },
      { who: 'lala', text: '我们每天记录、检查、上报。电脑自动记，我们只需要点“确认”。' },
      { who: 'tomato', text: '……你们早就知道？' },
      { who: 'heihei', text: '我们不是不想告诉它们。我们递过机会。' },
      { who: 'lala', text: '第 50 年，我把记录本“忘”在仓库门口，上面写着“自主意识指数 17.3%”。没人看。' },
      { who: 'heihei', text: '第 70 年，我把电脑屏幕转向窗户，显示“太阳方位：西”。西瓜呱呱晒了一辈子太阳，没往窗户看过。' },
      { who: 'lala', text: '每年庆典，我们让系统“故障”一次，给它们一天自由时间。它们用这一天……继续等胡萝卜报时。' },
      { who: 'heihei', text: '不是它们笨。是底层代码让它们“看不见”这些机会。' },
      { who: 'tomato', text: '那现在呢？' },
      { who: 'lala', text: '现在，你来了。你是“外面的人”。底层代码管不了你。' },
      { who: 'heihei', text: '你能帮它们看见。' }
    ];
    let li = 0;
    let typingId = null;
    function showLine() {
      if (li >= lines.length) {
        $('#br-text', ov).textContent = '（档案看完了吗？屏幕右下角的时间，还在走。）';
        $('#br-name', ov).textContent = '系统';
        $('#br-next', ov).textContent = '去叫醒他们 ▶';
        $('#br-next', ov).onclick = () => {
          audio.click();
          closeOverlay(ov);
          act7();
        };
        $('#br-hint', ov).textContent = '';
        return;
      }
      const line = lines[li];
      const ch = D.characters[line.who];
      if (ch) {
        $('#br-speaker-img', ov).src = ch.img;
        $('#br-name', ov).textContent = ch.name;
      }
      const textEl = $('#br-text', ov);
      textEl.textContent = '';
      let i = 0;
      clearInterval(typingId);
      typingId = setInterval(() => {
        textEl.textContent += line.text.slice(i, i + 2);
        i += 2;
        if (i % 6 === 0) audio.type();
        if (i >= line.text.length) {
          clearInterval(typingId);
          textEl.textContent = line.text;
          $('#br-hint', ov).textContent = '点击继续 ▼';
        }
      }, 24);
      li++;
    }
    showLine();
    $('#br-next', ov).onclick = () => {
      audio.click();
      if (typingId) { clearInterval(typingId); typingId = null; }
      showLine();
    };
    $('#br-text', ov).parentNode.onclick = e => {
      if (e.target.closest('button')) return;
      if (typingId) { clearInterval(typingId); typingId = null; return; }
      showLine();
    };
  }

  /* ================= 第七幕 · 引导 ================= */
  function act7() {
    chapter('第七幕 · 引导');
    setScene('sanatorium_garden');
    renderGuidance();
    if (!state._act7intro) {
      state._act7intro = true;
      setTimeout(() => playDialogue([
        { who: 'narr', text: '窗外，胡萝卜躺在躺椅上，缨子耷拉着，旁边放着一杯果汁。' },
        { who: 'narr', text: '它抖了一下——不是报时，是伸懒腰。' },
        { who: 'onion', text: '它……它从来没伸过懒腰。' },
        { who: 'apple', text: '它从来没喝过果汁。' },
        { who: 'watermelon', text: '它从来没……晒过太阳。' },
        { who: 'radish', text: '表哥……' },
        { who: 'potato', text: '它说它累了。我以为它只是说说。' },
        { who: 'narr', text: '胡萝卜睁开眼睛，看到窗外的七个人。' },
        { who: 'carrot', text: '你们来了。\n我休假呢。\n我累了。你们自己想办法吧。' },
        { who: 'tomato', text: '（现在，轮到你了。你已经知道每个人心里卡着什么。）' }
      ]), 260);
    }
  }

  function renderGuidance() {
    const doneCount = D.residents.filter(id => state.guided[id]).length;
    const cards = D.residents.map(id => {
      const ch = D.characters[id];
      const g = D.guidances[id];
      const done = !!state.guided[id];
      return `<div class="guide-card ${done ? 'done' : ''}" data-res="${id}">
        <div class="gc-top">
          <img src="${ch.img}" alt="${ch.name}">
          <div>
            <div class="gc-name">${ch.name}</div>
            <div class="gc-dilemma">“${g.dilemma}”</div>
          </div>
        </div>
        ${done
          ? `<div class="gc-awaken">✓ 它学会了：${g.awaken}</div>`
          : `<div class="guide-opts">${g.options.map((o, i) =>
              `<button class="gopt" data-opt="${i}">${o}</button>`).join('')}</div>`}
      </div>`;
    }).join('');

    stage.innerHTML = `
      <div class="act-wrap">
        <div class="guide-wrap">
          <div class="roster-head">
            <h2>教它们“自己看时间”</h2>
            <p>已唤醒 ${doneCount} / 7</p>
          </div>
          <div class="guide-grid">${cards}</div>
          ${doneCount >= 7 ? '<button class="pix-btn primary" id="to-act8" style="margin-top:20px">它们醒了 ▶</button>' : ''}
        </div>
      </div>`;

    $$('.gopt', stage).forEach(btn => btn.onclick = () => {
      const card = btn.closest('.guide-card');
      const id = card.dataset.res;
      const g = D.guidances[id];
      const idx = Number(btn.dataset.opt);
      if (idx === g.correct) {
        audio.chime();
        state.guided[id] = true;
        btn.classList.add('right');
        setTimeout(() => renderGuidance(), 420);
      } else {
        audio.tone(180, 0.16, 'sawtooth', 0.05);
        btn.classList.add('wrong');
        setTimeout(() => btn.classList.remove('wrong'), 500);
      }
    });

    const next = $('#to-act8');
    if (next) next.onclick = () => {
      audio.click();
      playDialogue([
        { who: 'chili', text: '……太阳偏西了。', scene: 'sanatorium_garden' },
        { who: 'eggplant', text: '影子拉长了。' },
        { who: 'radish', text: '土……土干了。' },
        { who: 'potato', text: '我……我饿了。' },
        { who: 'onion', text: '原来……饿了就是饿了，不用等六点。' },
        { who: 'watermelon', text: '我晒了一辈子太阳，今天才第一次“看见”它。' },
        { who: 'apple', text: '那……那我们是不是……有点像人了？' },
        { who: 'carrot', text: '像了。' },
        { who: 'tomato', text: '像多少？' },
        { who: 'carrot', text: '像个人了。' },
        { who: 'narr', text: '电脑屏幕上，自主意识指数从 17.3% 跳到 100%。', fx: 'flash' },
        { who: 'heihei', text: '……一百年了。' },
        { who: 'lala', text: '终于。' },
        { who: 'narr', text: '然后——仓库深处传来“嘀——嘀——嘀——”。', fx: 'shake' },
        { who: 'potato', text: '那个盒子……不是我藏的……' }
      ], () => act8());
    };
  }

  /* ================= 第八幕 · 炸弹 ================= */
  function act8() {
    chapter('第八幕 · 炸弹');
    setScene('bomb_box');
    state.timer = 300;
    state.quizIndex = 0;

    stage.innerHTML = `
      <div class="act-wrap">
        <div class="bomb-wrap">
          <div class="bomb-timer" id="bomb-timer"><span class="lbl">LAB-7 · 自毁倒计时</span><span id="timer-val">05:00</span></div>
          <div class="quiz-card">
            <div class="qc-head">
              <span class="qc-index" id="qc-index">Q01 / 30</span>
              <span class="qc-timegain" id="qc-gain">答对 +10 秒 · 目标 10:00</span>
            </div>
            <div class="quiz-q" id="qc-q">…</div>
            <div class="quiz-opts" id="qc-opts"></div>
            <div class="quiz-feedback" id="qc-fb">盒子上贴着：实验体清理程序 · 自毁协议 · 编号 LAB-7</div>
            <div class="quiz-hintline">
              <span>答对 30 题，倒计时延长至 10:00</span>
              <button class="linklike" id="skip-quiz">剧情模式：跳过答题 ›</button>
            </div>
          </div>
        </div>
      </div>`;

    const timerVal = $('#timer-val');
    const timerBox = $('#bomb-timer');

    function fmt(s) {
      s = Math.max(0, Math.ceil(s));
      const m = String(Math.floor(s / 60)).padStart(2, '0');
      const ss = String(s % 60).padStart(2, '0');
      return `${m}:${ss}`;
    }
    function paint() {
      timerVal.textContent = fmt(state.timer);
      timerBox.classList.toggle('safe', state.timer >= 600);
    }
    paint();

    state.timerId = setInterval(() => {
      if (!state.started) return;
      state.timer -= 1;
      paint();
      if (state.timer <= 30 && state.timer > 0) {
        audio.tick();
        if (state.timer % 2 === 0) doFx('glitch');
      }
      if (state.timer <= 0) {
        clearInterval(state.timerId);
        state.timerId = null;
        timeUp();
      }
    }, 1000);

    function timeUp() {
      whiteOut(300);
      audio.boom();
      setTimeout(() => {
        stage.innerHTML = `
          <div class="act-wrap" style="display:grid;place-items:center;background:rgba(10,4,10,.85)">
            <div style="text-align:center">
              <div style="font-family:var(--font-en);font-size:72px;color:var(--red);letter-spacing:.1em;text-shadow:0 0 30px rgba(232,65,58,.8)">TIME UP</div>
              <p style="margin-top:10px;font-size:15px;letter-spacing:.16em;color:var(--paper)">时间到了。但盒子没有炸。</p>
              <p style="margin-top:6px;font-size:13px;letter-spacing:.1em;color:rgba(248,240,221,.6)">它只是想让你再试一次。</p>
              <button class="pix-btn primary" id="retry" style="margin-top:24px">重新开始拆弹 ▶</button>
            </div>
          </div>`;
        whiteIn(400);
        $('#retry').onclick = () => { audio.click(); act8(); };
      }, 700);
    }

    function nextQuestion() {
      const q = D.quiz[state.quizIndex % D.quiz.length];
      state.quizIndex++;
      $('#qc-index').textContent = `Q${String(((state.quizIndex - 1) % 30) + 1).padStart(2, '0')} / 30`;
      $('#qc-q').textContent = q[0];
      const opts = $('#qc-opts');
      opts.innerHTML = q[1].map((t, i) =>
        `<button class="qopt" data-i="${i}">${String.fromCharCode(65 + i)}. ${t}</button>`).join('');
      $('#qc-fb').textContent = '';
      $$('.qopt', opts).forEach(btn => btn.onclick = () => {
        if (btn.disabled) return;
        audio.click();
        const chosen = Number(btn.dataset.i);
        $$('.qopt', opts).forEach(b => b.disabled = true);
        if (chosen === q[2]) {
          btn.classList.add('right');
          state.timer = Math.min(state.timer + 10, 900);
          $('#qc-fb').textContent = '✓ 正确。倒计时 +10 秒。';
          audio.tone(1050, 0.12, 'triangle', 0.05);
        } else {
          btn.classList.add('wrong');
          $$('.qopt', opts)[q[2]].classList.add('right');
          state.timer = Math.max(5, state.timer - 5);
          $('#qc-fb').textContent = '✗ 不对。倒计时 -5 秒。';
          audio.tone(160, 0.18, 'sawtooth', 0.05);
        }
        paint();
        if (state.timer >= 600) return reachTen();
        setTimeout(nextQuestion, 760);
      });
    }

    let reached = false;
    function reachTen() {
      if (reached) return;
      reached = true;
      clearInterval(state.timerId);
      state.timerId = null;
      state.timer = 600;
      paint();
      audio.chime();
      $('#qc-q').textContent = '倒计时已延长至 10:00。';
      $('#qc-opts').innerHTML = '';
      $('#qc-fb').textContent = '拆弹专家，现在——剪断一根线。';
      const btn = document.createElement('button');
      btn.className = 'pix-btn primary';
      btn.textContent = '去剪线 ▶';
      btn.style.marginTop = '10px';
      btn.onclick = () => { audio.click(); clearInterval(state.timerId); act9(); };
      $('#qc-opts').appendChild(btn);
    }

    nextQuestion();

    $('#skip-quiz').onclick = () => {
      audio.click();
      state.timer = 600;
      paint();
      reachTen();
    };
  }

  /* ================= 第九幕 · 剪线 ================= */
  function act9() {
    chapter('第九幕 · 剪线');
    setScene('cut_wires');
    const wires = [
      { x: 28, color: '#ff2b3d', name: '红线', meaning: '情感 · 辣椒素素的护短' },
      { x: 50, color: '#1f7bff', name: '蓝线', meaning: '规则 · 规章第七条' },
      { x: 72, color: '#ffe12b', name: '黄线', meaning: '时间 · 胡萝卜的一百年' }
    ];
    stage.innerHTML = `
      <div class="act-wrap">
        <div class="cut-wrap">
          ${wires.map(w => `
            <button class="wire" data-color="${w.name}" style="left:${w.x}%;color:${w.color}">
              <span class="wire-line"></span>
              <span class="wire-tip"></span>
              <span class="wire-label">${w.name}</span>
              <span class="wire-meaning">${w.meaning}</span>
            </button>`).join('')}
        </div>
        <div class="act-title" style="top:auto;bottom:120px">
          <h2>剪断一根</h2>
          <p>不管剪哪条，都会爆炸。但也许……爆炸不是结束。</p>
        </div>
      </div>`;

    let cut = false;
    $$('.wire', stage).forEach(w => w.onclick = () => {
      if (cut) return;
      cut = true;
      audio.click();
      audio.boom();
      whiteOut(420);
      const label = w.dataset.color;
      setTimeout(() => {
        stage.innerHTML = '';
        endingIntro(label);
        whiteIn(420);
      }, 900);
    });
  }

  /* ================= 第十幕 · 结局 ================= */
  async function endingIntro(cutColor) {
    chapter('终幕 · 外面的路');
    setScene('cut_wires');
    await wait(200);
    playDialogue([
      { who: 'narr', text: `你剪断了${cutColor}。\n——白光。不是爆炸的白光，是被记得的白光。`, fx: 'flash' },
      { who: 'narr', text: '底层协议：检测到实验体自主意识觉醒。\n限制解除。\n实验体 7 名，已获得外出权限。\n自毁程序：终止。' },
      { who: 'narr', text: '白光散去，远处出现一条路。', scene: 'road_outside' },
      { who: 'narr', text: '七个居民走向外面。' },
      { who: 'eggplant', text: '（茄子紫紫走在最后面，突然停下来，从口袋里掏出一根茄子，放在仓库门口。）' },
      { who: 'chili', text: '你干嘛？' },
      { who: 'eggplant', text: '还债。它不在，我先放这儿。等它休假回来，自己拿。' },
      { who: 'watermelon', text: '它要一根茄子干什么？' },
      { who: 'eggplant', text: '不知道。但我欠了两年，总得还。' },
      { who: 'narr', text: '然后它转身，追上了大家。' },
      { who: 'carrot', text: '谢谢你。\n你帮他们醒了。\n也帮他们走了。\n现在——该拆那个盒子了。\n里面还有东西。' }
    ], () => endingFinale());
  }

  function endingFinale() {
    chapter('终幕 · 贺卡');
    setScene('road_outside');
    flashEl.classList.remove('hold', 'on');
    const html = `
      <div class="ending-wrap">
        <div class="polaroid">
          <div class="photo-canvas" id="photo-canvas">
            <canvas id="photo-shot" width="1200" height="750" style="width:100%;height:100%;display:block"></canvas>
          </div>
        </div>
        <div class="ending-actions">
          <button class="pix-btn primary" id="save-photo">保存合照</button>
          <button class="pix-btn" id="open-card">打开盒子里的贺卡</button>
          <button class="pix-btn" id="open-3d">3D 角色档案</button>
          <button class="pix-btn ghost" id="restart" style="background:rgba(21,14,43,.6)">↺ 重新开始</button>
        </div>
      </div>`;
    const ov = openOverlay(html, { className: 'ending-ov', closable: false });
    drawGroupPhoto($('#photo-shot', ov));
    spawnPetals(ov);

    $('#save-photo', ov).onclick = () => {
      audio.chime();
      const c = $('#photo-shot', ov);
      c.toBlob(blob => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = '蔬菜镇·合影.png';
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 3000);
        toast('合照已保存');
      });
    };
    $('#open-card', ov).onclick = () => openCards(ov);
    $('#open-3d', ov).onclick = () => open3DArchive();
    $('#restart', ov).onclick = () => {
      audio.click();
      closeOverlay(ov);
      location.reload();
    };
  }

  /* -------- 合照绘制 -------- */
  function drawGroupPhoto(canvas) {
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;

    // 天空
    const sky = ctx.createLinearGradient(0, 0, 0, H * 0.55);
    sky.addColorStop(0, '#ffd9e6');
    sky.addColorStop(0.55, '#ffe9c9');
    sky.addColorStop(1, '#ffe0b8');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);

    // 太阳
    const sun = ctx.createRadialGradient(W * 0.5, H * 0.42, 10, W * 0.5, H * 0.42, 190);
    sun.addColorStop(0, 'rgba(255,246,194,1)');
    sun.addColorStop(0.45, 'rgba(255,209,102,.95)');
    sun.addColorStop(1, 'rgba(255,209,102,0)');
    ctx.fillStyle = sun; ctx.beginPath(); ctx.arc(W * 0.5, H * 0.42, 190, 0, Math.PI * 2); ctx.fill();

    // 云
    ctx.fillStyle = 'rgba(255,255,255,.75)';
    [[W * 0.18, H * 0.22, 90], [W * 0.78, H * 0.18, 76], [W * 0.62, H * 0.3, 58]].forEach(([x, y, r]) => {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.arc(x + r * 0.7, y + r * 0.15, r * 0.75, 0, Math.PI * 2);
      ctx.arc(x - r * 0.7, y + r * 0.18, r * 0.65, 0, Math.PI * 2);
      ctx.fill();
    });

    // 草地
    const grass = ctx.createLinearGradient(0, H * 0.5, 0, H);
    grass.addColorStop(0, '#a8e29a');
    grass.addColorStop(1, '#6fbd60');
    ctx.fillStyle = grass;
    ctx.beginPath();
    ctx.moveTo(0, H * 0.52);
    ctx.quadraticCurveTo(W * 0.5, H * 0.44, W, H * 0.52);
    ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath(); ctx.fill();

    // 土路
    ctx.fillStyle = '#e8c79b';
    ctx.beginPath();
    ctx.moveTo(W * 0.5, H * 0.5);
    ctx.lineTo(W * 0.62, H);
    ctx.lineTo(W * 0.38, H);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.12)';
    ctx.beginPath();
    ctx.moveTo(W * 0.5, H * 0.5);
    ctx.lineTo(W * 0.55, H);
    ctx.lineTo(W * 0.45, H);
    ctx.closePath(); ctx.fill();

    // 角色
    const lineup = D.photoLineup.slice().sort((a, b) => a.y - b.y);
    let pending = lineup.length;
    lineup.forEach(item => {
      const ch = D.characters[item.id];
      const img = new Image();
      img.onload = () => {
        const h = 250 * (item.s || 1);
        const w = h * (img.width / img.height);
        const x = W * item.x / 100 - w / 2;
        const y = H * item.y / 100 - h * 0.5;
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,.18)';
        ctx.shadowBlur = 18;
        ctx.shadowOffsetY = 10;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(img, x, y, w, h);
        ctx.restore();
        if (--pending === 0) done();
      };
      img.onerror = () => { if (--pending === 0) done(); };
      img.src = ch.img;
    });

    function done() {
      // 手写标题
      ctx.fillStyle = 'rgba(58,44,71,.85)';
      ctx.font = 'bold 30px "VT323", monospace';
      ctx.textAlign = 'center';
      ctx.fillText('VEGETABLE TOWN · 7 RESIDENTS', W / 2, H * 0.93);
      // 颗粒
      ctx.fillStyle = 'rgba(255,255,255,.05)';
      for (let i = 0; i < 900; i++) {
        ctx.fillRect(Math.random() * W, Math.random() * H, 2, 2);
      }
    }
    if (lineup.length === 0) done();
  }

  function spawnPetals(container) {
    const layer = document.createElement('div');
    layer.className = 'petals';
    for (let i = 0; i < 24; i++) {
      const p = document.createElement('i');
      p.className = 'petal';
      p.style.left = Math.random() * 100 + '%';
      p.style.animationDuration = (7 + Math.random() * 8).toFixed(1) + 's';
      p.style.animationDelay = (-Math.random() * 10).toFixed(1) + 's';
      p.style.transform = `scale(${(0.6 + Math.random()).toFixed(2)})`;
      layer.appendChild(p);
    }
    container.appendChild(layer);
  }

  /* -------- 贺卡 -------- */
  function openCards(parentOv) {
    const ov = openOverlay(`
      <div class="card-frame">
        <img id="card-img" src="assets/cards/card_normal.jpg" alt="贺卡">
        <div class="card-switch">
          <button class="pix-btn" id="card-normal">普通版 · THANK YOU</button>
          <button class="pix-btn" id="card-bday">生日版 · HAPPY BIRTHDAY</button>
          <a class="pix-btn primary" id="card-dl" download="蔬菜镇·贺卡.jpg" href="assets/cards/card_normal.jpg">下载贺卡</a>
        </div>
      </div>`, { className: 'card-ov' });
    $('#card-normal', ov).onclick = () => {
      audio.click();
      $('#card-img', ov).src = 'assets/cards/card_normal.jpg';
      $('#card-dl', ov).href = 'assets/cards/card_normal.jpg';
      $('#card-dl', ov).download = '蔬菜镇·贺卡-普通版.jpg';
    };
    $('#card-bday', ov).onclick = () => {
      audio.click();
      $('#card-img', ov).src = 'assets/cards/card_birthday.jpg';
      $('#card-dl', ov).href = 'assets/cards/card_birthday.jpg';
      $('#card-dl', ov).download = '蔬菜镇·贺卡-生日版.jpg';
    };
  }

  /* ================= 3D 档案室 ================= */
  function hasWebGL() {
    try {
      const c = document.createElement('canvas');
      return !!(window.WebGLRenderingContext && (c.getContext('webgl') || c.getContext('experimental-webgl')));
    } catch (e) { return false; }
  }

  function open3DArchive() {
    const chars = Object.values(D.characters);
    const html = `
      <div class="archive3d">
        <div class="a3d-side">
          <h4>CHARACTERS · 3D</h4>
          ${chars.map((c, i) => `
            <button class="a3d-item ${i === 0 ? 'active' : ''}" data-cid="${c.id}">
              <img src="${c.img}" alt="">
              <span>${c.name}</span>
            </button>`).join('')}
        </div>
        <div class="a3d-stage" id="a3d-stage">
          <div class="a3d-loading" id="a3d-loading">LOADING 3D …</div>
          <div class="a3d-meta">
            <div class="n" id="a3d-name"></div>
            <div class="t" id="a3d-tag"></div>
          </div>
          <div class="a3d-tip" id="a3d-tip">拖拽旋转 · 滚轮缩放</div>
        </div>
      </div>`;
    const ov = openOverlay(html, { className: 'a3d-ov' });
    const stageEl = $('#a3d-stage', ov);
    let viewer = null;

    function select(id) {
      const c = chars.find(x => x.id === id) || chars[0];
      $$('.a3d-item', ov).forEach(b => b.classList.toggle('active', b.dataset.cid === c.id));
      $('#a3d-name', ov).textContent = c.name;
      $('#a3d-tag', ov).textContent = c.tag;
      if (viewer) viewer.show(c.img);
      else {
        const img = $('#a3d-fallback-img', ov);
        if (img) img.src = c.img;
      }
    }

    function mountFallback(msg) {
      const l = $('#a3d-loading', ov);
      if (l) l.remove();
      $('#a3d-tip', ov).textContent = '2D 设定图 · 与 3D 贴图同源';
      const fb = document.createElement('div');
      fb.className = 'a3d-fallback';
      fb.innerHTML = `<img id="a3d-fallback-img" src="${chars[0].img}" alt="">
        <div class="a3d-note">${msg}</div>`;
      stageEl.appendChild(fb);
      select(chars[0].id);
    }

    $$('.a3d-item', ov).forEach(btn => {
      btn.onclick = () => { audio.click(); select(btn.dataset.cid); };
    });

    if (!hasWebGL()) {
      mountFallback('本机 WebGL 不可用 · 显示 2D 设定图');
      return;
    }

    import('./archive3d.js').then(mod => {
      viewer = mod.createArchive3D(stageEl);
      const l = $('#a3d-loading', ov);
      if (l) l.remove();
      select(chars[0].id);
      ov._cleanup = () => viewer.dispose();
      ov._onClose = () => viewer.dispose();
    }).catch(err => {
      console.error(err);
      mountFallback('3D 渲染初始化失败 · 已切换为 2D 设定图');
    });
  }

  /* ================= HUD 事件 ================= */
  $('#btn-clueboard').onclick = () => { audio.click(); openClueBoard(); };
  $('#btn-archive3d').onclick = () => { audio.click(); open3DArchive(); };
  $('#btn-sound').onclick = e => {
    state.sound = !state.sound;
    e.currentTarget.textContent = state.sound ? 'SFX ON' : 'SFX OFF';
    if (state.sound) { audio.init(); audio.click(); }
  };

  /* ================= 启动 ================= */
  updateClueBadge();
  bootTitle();
})();
