(function() {
  'use strict';

  let isInspectorActive = false;
  let inspectorStyle = null;
  let hoveredElement = null;
  let selectedElements = [];
  let hoverBox = null;
  let selectionBoxes = []; // each: {box, label, el, queued}

  // Tooltip & queue state
  let activeTooltip = null;
  let activeTooltipMeta = null; // {elementInfo, targetEl}
  let pendingAttachment = null; // {name, type, size, dataUrl?, textContent?}
  let editQueue = []; // [{selector, path, tagName, instruction, attachment}]
  let fileInputEl = null;

  // ── Helpers (identical to existing) ────────────────────────────────────────

  function getElementClassName(el) {
    if (!el.className) return '';
    if (typeof el.className === 'string') return el.className;
    if (el.className.baseVal !== undefined) return el.className.baseVal;
    return el.className.toString();
  }

  function getRelevantStyles(el) {
    const cs = window.getComputedStyle(el);
    const props = [
      'display','position','width','height',
      'margin','margin-top','margin-right','margin-bottom','margin-left',
      'padding','padding-top','padding-right','padding-bottom','padding-left',
      'border','border-radius','background','background-color','color',
      'font-size','font-weight','font-family','line-height','letter-spacing',
      'text-align','flex-direction','justify-content','align-items','gap',
      'opacity','box-shadow','z-index','overflow',
    ];
    const out = {};
    props.forEach(p => {
      const v = cs.getPropertyValue(p);
      if (v && v !== 'normal' && v !== 'none' && v !== 'auto' && v !== '0px') out[p] = v;
    });
    return out;
  }

  function getElementPath(el) {
    const path = [];
    let cur = el;
    while (cur && cur !== document.body && cur !== document.documentElement && path.length < 5) {
      let seg = cur.tagName.toLowerCase();
      if (cur.id) seg += '#' + cur.id;
      else {
        const cn = getElementClassName(cur);
        if (cn.trim()) seg += '.' + cn.trim().split(/\s+/)[0];
      }
      path.unshift(seg);
      cur = cur.parentElement;
    }
    return path.join(' > ');
  }

  function createSelector(el) {
    let sel = el.tagName.toLowerCase();
    if (el.id) sel += '#' + el.id;
    const cn = getElementClassName(el);
    if (cn.trim()) {
      const classes = cn.trim().split(/\s+/).slice(0, 3);
      sel += '.' + classes.join('.');
    }
    return sel;
  }

  function createElementInfo(el) {
    const rect = el.getBoundingClientRect();
    const cn = getElementClassName(el);
    const tag = el.tagName.toLowerCase();

    let display = '<' + tag;
    if (el.id) display += ' id="' + el.id + '"';
    if (cn.trim()) {
      const classes = cn.trim().split(/\s+/);
      display += ' class="' + classes.slice(0,3).join(' ') + (classes.length > 3 ? '...' : '') + '"';
    }
    display += '>';
    const textTags = ['span','p','h1','h2','h3','h4','h5','h6','button','a','label','li','td','th'];
    if (textTags.includes(tag) && el.textContent) {
      const t = el.textContent.trim().slice(0, 60);
      if (t) display += t + (t.length === 60 ? '…' : '');
    }
    display += '</' + tag + '>';

    return {
      tagName: el.tagName,
      className: cn,
      id: el.id || '',
      textContent: (el.textContent || '').trim().slice(0, 200),
      innerText: el.innerText ? el.innerText.trim().slice(0, 200) : '',
      styles: getRelevantStyles(el),
      rect: {
        x: rect.x + window.scrollX,
        y: rect.y + window.scrollY,
        width: rect.width,
        height: rect.height,
        top: rect.top + window.scrollY,
        left: rect.left + window.scrollX,
        viewportTop: rect.top,
        viewportLeft: rect.left,
      },
      selector: createSelector(el),
      displayText: display,
      elementPath: getElementPath(el),
    };
  }

  // ── Overlay boxes ──────────────────────────────────────────────────────────

  function createBox(color, alpha) {
    const box = document.createElement('div');
    box.style.cssText =
      'position:fixed;pointer-events:none;z-index:2147483645;' +
      'border:2px solid ' + color + ';' +
      'background:' + color.replace('rgb', 'rgba').replace(')', ',' + alpha + ')') + ';' +
      'box-sizing:border-box;transition:none;';
    document.body.appendChild(box);
    return box;
  }

  function positionBox(box, el) {
    if (!el) { box.style.display = 'none'; return; }
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) { box.style.display = 'none'; return; }
    box.style.display = 'block';
    box.style.left = rect.left + 'px';
    box.style.top = rect.top + 'px';
    box.style.width = rect.width + 'px';
    box.style.height = rect.height + 'px';
  }

  function ensureHoverBox() {
    if (!hoverBox) hoverBox = createBox('rgb(59,130,246)', '0.08');
  }

  function addSelectionBox(el) {
    const box = createBox('rgb(34,197,94)', '0.10');
    const label = document.createElement('div');
    label.style.cssText =
      'position:absolute;top:-22px;left:0;' +
      'background:rgb(34,197,94);color:#fff;' +
      'font-size:11px;font-family:monospace;' +
      'padding:1px 6px;border-radius:3px 3px 0 0;' +
      'white-space:nowrap;pointer-events:none;';
    label.textContent = createSelector(el);
    box.appendChild(label);
    const entry = { box, label, el, queued: false };
    selectionBoxes.push(entry);
    return selectionBoxes.length - 1;
  }

  function syncSelectionBoxes() {
    while (selectionBoxes.length > selectedElements.length) {
      selectionBoxes.pop().box.remove();
    }
    while (selectionBoxes.length < selectedElements.length) {
      addSelectionBox(selectedElements[selectionBoxes.length]);
    }
    selectedElements.forEach((el, i) => {
      const entry = selectionBoxes[i];
      entry.el = el;
      positionBox(entry.box, el);
      if (!entry.queued) entry.label.textContent = createSelector(el);
    });
  }

  function markSelectionQueued(targetEl) {
    const idx = selectedElements.indexOf(targetEl);
    if (idx === -1 || idx >= selectionBoxes.length) return;
    const entry = selectionBoxes[idx];
    entry.queued = true;
    entry.label.textContent = '✓ queued';
    entry.label.style.background = '#16a34a';
    entry.box.style.border = '2px solid #22c55e';
  }

  // ── File attachment ────────────────────────────────────────────────────────

  function ensureFileInput() {
    if (!fileInputEl) {
      fileInputEl = document.createElement('input');
      fileInputEl.type = 'file';
      fileInputEl.style.display = 'none';
      fileInputEl.accept = 'image/*,video/*,.svg,.ttf,.woff,.woff2,.otf,.gif,.webp';
      fileInputEl.addEventListener('change', onFileSelected);
      document.body.appendChild(fileInputEl);
    }
    return fileInputEl;
  }

  function onFileSelected(e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    e.target.value = '';
    var name = file.name, type = file.type, size = file.size;
    var isImage = type.startsWith('image/') || name.toLowerCase().endsWith('.svg');
    var isSvg = type === 'image/svg+xml' || name.toLowerCase().endsWith('.svg');
    var MAX_B64 = 1.5 * 1024 * 1024;

    if (isSvg) {
      var r1 = new FileReader();
      r1.onload = function(ev) {
        pendingAttachment = { name: name, type: type, size: size, textContent: ev.target.result };
        renderAttachPreview();
      };
      r1.readAsText(file);
    } else if (isImage && size <= MAX_B64) {
      var r2 = new FileReader();
      r2.onload = function(ev) {
        pendingAttachment = { name: name, type: type, size: size, dataUrl: ev.target.result };
        renderAttachPreview();
      };
      r2.readAsDataURL(file);
    } else {
      pendingAttachment = { name: name, type: type, size: size };
      renderAttachPreview();
    }
  }

  function renderAttachPreview() {
    if (!activeTooltip || !pendingAttachment) return;
    var previewDiv = document.getElementById('__pk_tt_ap__');
    if (!previewDiv) return;
    var a = pendingAttachment;
    var kb = Math.round(a.size / 1024);
    var icon = a.type.startsWith('video/') ? '🎬' : a.type.startsWith('image/') ? '🖼️' :
               (a.name.match(/\.(ttf|woff|woff2|otf)$/i) ? '🔤' : '📄');
    var imgHtml = '';
    if (a.dataUrl && a.type.startsWith('image/') && !a.type.includes('svg')) {
      imgHtml = '<img src="' + a.dataUrl + '" style="max-height:44px;max-width:64px;border-radius:4px;object-fit:cover;flex-shrink:0;">';
    }
    previewDiv.innerHTML = imgHtml +
      '<div style="flex:1;min-width:0;">' +
        '<div style="font-size:11px;color:#e2e8f0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + icon + ' ' + a.name + '</div>' +
        '<div style="font-size:10px;color:#64748b;">' + kb + 'KB</div>' +
      '</div>' +
      '<button id="__pk_tt_rm__" style="background:none;border:none;cursor:pointer;color:#ef4444;font-size:15px;padding:0;line-height:1;flex-shrink:0;">\xd7</button>';
    previewDiv.style.display = 'flex';
    document.getElementById('__pk_tt_rm__').onclick = function() {
      pendingAttachment = null;
      previewDiv.innerHTML = '';
      previewDiv.style.display = 'none';
    };
  }

  // ── Tooltip ────────────────────────────────────────────────────────────────

  function injectTooltipStyles() {
    if (document.getElementById('__pk_tt_css__')) return;
    var s = document.createElement('style');
    s.id = '__pk_tt_css__';
    s.textContent =
      '@keyframes __pk_tt_in{from{opacity:0;transform:scale(0.94) translateY(-6px)}to{opacity:1;transform:scale(1) translateY(0)}}' +
      '#__palmkit_tooltip__ textarea{transition:border-color 0.15s}' +
      '#__palmkit_tooltip__ textarea:focus{border-color:#3b82f6!important;outline:none}' +
      '#__pk_tt_attach_btn__:hover{border-color:#3b82f6!important;color:#93c5fd!important}' +
      '#__pk_tt_confirm__:hover{background:#1d4ed8!important}' +
      '#__pk_tt_panel_btn__:hover{border-color:#3b82f6!important;color:#93c5fd!important}';
    document.head.appendChild(s);
  }

  function showTooltip(elementInfo, clientX, clientY, targetEl) {
    hideTooltip();
    injectTooltipStyles();
    activeTooltipMeta = { elementInfo: elementInfo, targetEl: targetEl };
    pendingAttachment = null;

    var tag = elementInfo.tagName.toLowerCase();
    var id = elementInfo.id ? '#' + elementInfo.id : '';
    var cn = elementInfo.className ? '.' + elementInfo.className.trim().split(/\s+/)[0] : '';
    var shortSel = tag + (id || cn);

    var VW = window.innerWidth, VH = window.innerHeight;
    var W = 292;
    var left = clientX + 14;
    var top = clientY + 14;
    if (left + W > VW - 8) left = Math.max(8, clientX - W - 14);
    if (top + 290 > VH - 8) top = Math.max(8, VH - 300);
    if (left < 8) left = 8;

    var pathHtml = elementInfo.elementPath
      ? '<div style="font-size:10px;color:#475569;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + elementInfo.elementPath + '">' + elementInfo.elementPath + '</div>'
      : '';

    var tt = document.createElement('div');
    tt.id = '__palmkit_tooltip__';
    tt.style.cssText =
      'position:fixed;z-index:2147483647;width:' + W + 'px;left:' + left + 'px;top:' + top + 'px;' +
      'background:#0f172a;border:1px solid rgba(59,130,246,0.65);border-radius:12px;' +
      'box-shadow:0 12px 48px rgba(0,0,0,0.8),0 0 0 1px rgba(59,130,246,0.12);' +
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:13px;' +
      'color:#e2e8f0;overflow:hidden;animation:__pk_tt_in 0.13s cubic-bezier(0.16,1,0.3,1);';

    tt.innerHTML =
      // Header
      '<div style="background:#1e293b;padding:8px 12px;display:flex;align-items:flex-start;justify-content:space-between;border-bottom:1px solid rgba(255,255,255,0.06);">' +
        '<div style="min-width:0;flex:1;padding-right:8px;">' +
          '<span style="display:inline-block;background:#1e3a5f;color:#93c5fd;padding:2px 7px;border-radius:5px;font-size:11px;font-family:monospace;white-space:nowrap;">' + shortSel + '</span>' +
          pathHtml +
        '</div>' +
        '<button id="__pk_tt_close__" style="background:none;border:none;color:#475569;cursor:pointer;font-size:18px;line-height:1;padding:0;flex-shrink:0;margin-top:-1px;">\xd7</button>' +
      '</div>' +
      // Textarea
      '<div style="padding:10px 12px 6px;">' +
        '<textarea id="__pk_tt_input__" rows="3" placeholder="What to change? (Enter to queue, Shift+Enter for newline)" ' +
          'style="width:100%;box-sizing:border-box;background:#1e293b;border:1px solid #334155;border-radius:8px;' +
          'color:#e2e8f0;font-size:12px;line-height:1.5;padding:8px 10px;resize:none;font-family:inherit;"></textarea>' +
      '</div>' +
      // Attach
      '<div style="padding:0 12px 8px;">' +
        '<button id="__pk_tt_attach_btn__" style="width:100%;text-align:left;background:#1e293b;border:1px dashed #334155;' +
          'border-radius:8px;color:#64748b;font-size:11px;padding:6px 10px;cursor:pointer;transition:border-color 0.15s,color 0.15s;">📎 Attach image \xb7 video \xb7 font \xb7 icon</button>' +
        '<div id="__pk_tt_ap__" style="display:none;align-items:center;gap:8px;margin-top:6px;padding:6px 8px;background:#1e293b;border-radius:6px;"></div>' +
      '</div>' +
      // Footer
      '<div style="padding:7px 12px;border-top:1px solid rgba(255,255,255,0.05);background:#090e1a;display:flex;align-items:center;justify-content:space-between;gap:8px;">' +
        '<span style="font-size:10px;color:#2d3748;white-space:nowrap;">↵ queue \xb7 Esc cancel</span>' +
        '<div style="display:flex;gap:6px;flex-shrink:0;">' +
          '<button id="__pk_tt_panel_btn__" style="background:none;border:1px solid #1e3a5f;border-radius:6px;color:#475569;font-size:11px;padding:3px 10px;cursor:pointer;transition:all 0.15s;white-space:nowrap;">panel →</button>' +
          '<button id="__pk_tt_confirm__" style="background:#2563eb;border:none;border-radius:6px;color:#fff;font-size:12px;font-weight:600;padding:4px 14px;cursor:pointer;white-space:nowrap;">Queue ↵</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(tt);
    activeTooltip = tt;

    var ta = document.getElementById('__pk_tt_input__');
    requestAnimationFrame(function() { if (ta) ta.focus(); });

    document.getElementById('__pk_tt_close__').onclick = hideTooltip;

    document.getElementById('__pk_tt_attach_btn__').onclick = function() {
      ensureFileInput().click();
    };

    document.getElementById('__pk_tt_confirm__').onclick = function() {
      var val = ta ? ta.value.trim() : '';
      if (val) confirmTooltipEdit(val);
      else if (ta) ta.focus();
    };

    document.getElementById('__pk_tt_panel_btn__').onclick = function() {
      hideTooltip();
      window.parent.postMessage({ type: 'INSPECTOR_OPEN_PANEL', elementInfo: elementInfo }, '*');
    };

    if (ta) {
      ta.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); hideTooltip(); return; }
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault(); e.stopPropagation();
          var val = ta.value.trim();
          if (val) confirmTooltipEdit(val);
        }
      });
    }

    // Block inspector events from firing inside tooltip
    tt.addEventListener('mousemove', function(e) { e.stopPropagation(); }, true);
    tt.addEventListener('mousedown', function(e) { e.stopPropagation(); }, true);
    tt.addEventListener('click',     function(e) { e.stopPropagation(); }, true);
  }

  function hideTooltip() {
    if (activeTooltip) { activeTooltip.remove(); activeTooltip = null; }
    activeTooltipMeta = null;
    pendingAttachment = null;
  }

  function confirmTooltipEdit(instruction) {
    if (!activeTooltipMeta) return;
    var info = activeTooltipMeta.elementInfo;
    var targetEl = activeTooltipMeta.targetEl;

    var edit = {
      selector: info.selector,
      path: info.elementPath || '',
      tagName: info.tagName.toLowerCase(),
      instruction: instruction,
      attachment: pendingAttachment || null,
    };

    editQueue.push(edit);
    markSelectionQueued(targetEl);
    hideTooltip();

    window.parent.postMessage({
      type: 'INSPECTOR_EDIT_QUEUED',
      edit: edit,
      count: editQueue.length,
    }, '*');
  }

  // ── Event handlers ─────────────────────────────────────────────────────────

  function handleMouseMove(e) {
    if (!isInspectorActive) return;
    if (activeTooltip && activeTooltip.contains(e.target)) return;
    var target = e.target;
    if (!target || target === document.body || target === document.documentElement) return;
    if (target === hoveredElement) return;
    hoveredElement = target;
    ensureHoverBox();
    positionBox(hoverBox, target);
    window.parent.postMessage({ type: 'INSPECTOR_HOVER', elementInfo: createElementInfo(target) }, '*');
  }

  function handleClick(e) {
    if (!isInspectorActive) return;
    if (activeTooltip && activeTooltip.contains(e.target)) return;
    e.preventDefault();
    e.stopPropagation();

    var target = e.target;
    if (!target || target === document.body || target === document.documentElement) return;

    // Close any existing tooltip first
    if (activeTooltip) hideTooltip();

    if (e.shiftKey) {
      var idx = selectedElements.indexOf(target);
      if (idx === -1) selectedElements.push(target);
      else selectedElements.splice(idx, 1);
    } else {
      selectedElements = [target];
    }

    syncSelectionBoxes();
    showTooltip(createElementInfo(target), e.clientX, e.clientY, target);
  }

  function handleMouseLeave() {
    if (!isInspectorActive) return;
    hoveredElement = null;
    if (hoverBox) hoverBox.style.display = 'none';
    window.parent.postMessage({ type: 'INSPECTOR_LEAVE' }, '*');
  }

  function handleScroll() {
    if (!isInspectorActive) return;
    if (hoverBox && hoveredElement) positionBox(hoverBox, hoveredElement);
    syncSelectionBoxes();
  }

  // ── Activate / Deactivate ─────────────────────────────────────────────────

  function activate() {
    isInspectorActive = true;
    if (!inspectorStyle) {
      inspectorStyle = document.createElement('style');
      inspectorStyle.textContent = '.palmkit-inspector-active * { cursor: crosshair !important; }';
      document.head.appendChild(inspectorStyle);
    }
    document.documentElement.classList.add('palmkit-inspector-active');
    document.addEventListener('mousemove', handleMouseMove, true);
    document.addEventListener('click', handleClick, true);
    document.addEventListener('mouseleave', handleMouseLeave, true);
    window.addEventListener('scroll', handleScroll, true);
  }

  function deactivate() {
    isInspectorActive = false;
    hoveredElement = null;
    hideTooltip();
    document.documentElement.classList.remove('palmkit-inspector-active');
    if (hoverBox) hoverBox.style.display = 'none';
    selectionBoxes.forEach(function(e) { e.box.remove(); });
    selectionBoxes = [];
    selectedElements = [];
    if (inspectorStyle) { inspectorStyle.remove(); inspectorStyle = null; }
    document.removeEventListener('mousemove', handleMouseMove, true);
    document.removeEventListener('click', handleClick, true);
    document.removeEventListener('mouseleave', handleMouseLeave, true);
    window.removeEventListener('scroll', handleScroll, true);
  }

  // ── Message listener ───────────────────────────────────────────────────────

  window.addEventListener('message', function(e) {
    if (!e.data || !e.data.type) return;
    if (e.data.type === 'INSPECTOR_ACTIVATE') {
      if (e.data.active) activate(); else deactivate();
    }
    if (e.data.type === 'INSPECTOR_CLEAR_SELECTION') {
      hideTooltip();
      selectedElements = [];
      syncSelectionBoxes();
    }
    if (e.data.type === 'INSPECTOR_QUEUE_RESET') {
      editQueue = [];
      hideTooltip();
      // Reset queued labels back to selector text
      selectionBoxes.forEach(function(entry, i) {
        if (entry.queued) {
          entry.queued = false;
          entry.label.style.background = 'rgb(34,197,94)';
          entry.box.style.border = '2px solid rgb(34,197,94)';
          if (selectedElements[i]) entry.label.textContent = createSelector(selectedElements[i]);
        }
      });
    }
  });

  window.parent.postMessage({ type: 'INSPECTOR_READY' }, '*');
})();
