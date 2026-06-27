(function() {
  let isInspectorActive = false;
  let inspectorStyle = null;
  let hoveredElement = null;
  let selectedElements = [];
  let hoverBox = null;
  let selectionBoxes = [];
  let scrollX = 0;
  let scrollY = 0;

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
      if (cur.id) seg += `#${cur.id}`;
      else {
        const cn = getElementClassName(cur);
        if (cn.trim()) seg += `.${cn.trim().split(/\s+/)[0]}`;
      }
      path.unshift(seg);
      cur = cur.parentElement;
    }
    return path.join(' > ');
  }

  function createElementInfo(el) {
    const rect = el.getBoundingClientRect();
    const cn = getElementClassName(el);
    const tag = el.tagName.toLowerCase();

    // Build display text like <button class="btn">Click me</button>
    let display = `<${tag}`;
    if (el.id) display += ` id="${el.id}"`;
    if (cn.trim()) {
      const classes = cn.trim().split(/\s+/);
      display += ` class="${classes.slice(0,3).join(' ')}${classes.length > 3 ? '...' : ''}"`;
    }
    display += '>';
    const textTags = ['span','p','h1','h2','h3','h4','h5','h6','button','a','label','li','td','th'];
    if (textTags.includes(tag) && el.textContent) {
      const t = el.textContent.trim().slice(0, 60);
      if (t) display += t + (t.length === 60 ? '…' : '');
    }
    display += `</${tag}>`;

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

  function createSelector(el) {
    let sel = el.tagName.toLowerCase();
    if (el.id) sel += `#${el.id}`;
    const cn = getElementClassName(el);
    if (cn.trim()) {
      const classes = cn.trim().split(/\s+/).slice(0, 3);
      sel += `.${classes.join('.')}`;
    }
    return sel;
  }

  // ── Overlay boxes ─────────────────────────────────────────────────────────

  function createBox(color, alpha) {
    const box = document.createElement('div');
    box.style.cssText = `
      position: fixed;
      pointer-events: none;
      z-index: 2147483646;
      border: 2px solid ${color};
      background: ${color.replace('rgb', 'rgba').replace(')', `,${alpha})`)};
      box-sizing: border-box;
      transition: none;
    `;
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

  function addSelectionBox() {
    const box = createBox('rgb(34,197,94)', '0.12');
    // Add label
    const label = document.createElement('div');
    label.style.cssText = `
      position: absolute; top: -22px; left: 0;
      background: rgb(34,197,94); color: #fff;
      font-size: 11px; font-family: monospace;
      padding: 1px 6px; border-radius: 3px 3px 0 0;
      white-space: nowrap; pointer-events: none;
    `;
    box.appendChild(label);
    selectionBoxes.push({ box, label });
    return selectionBoxes.length - 1;
  }

  function syncSelectionBoxes() {
    // Remove extra boxes
    while (selectionBoxes.length > selectedElements.length) {
      const { box } = selectionBoxes.pop();
      box.remove();
    }
    // Add missing boxes
    while (selectionBoxes.length < selectedElements.length) {
      addSelectionBox();
    }
    // Position all
    selectedElements.forEach((el, i) => {
      const { box, label } = selectionBoxes[i];
      positionBox(box, el);
      label.textContent = createSelector(el);
    });
  }

  // ── Event handlers ─────────────────────────────────────────────────────────

  function handleMouseMove(e) {
    if (!isInspectorActive) return;
    const target = e.target;
    if (!target || target === document.body || target === document.documentElement) return;
    if (target === hoveredElement) return;
    hoveredElement = target;

    ensureHoverBox();
    positionBox(hoverBox, target);

    window.parent.postMessage({
      type: 'INSPECTOR_HOVER',
      elementInfo: createElementInfo(target),
    }, '*');
  }

  function handleClick(e) {
    if (!isInspectorActive) return;
    e.preventDefault();
    e.stopPropagation();

    const target = e.target;
    if (!target || target === document.body || target === document.documentElement) return;

    if (e.shiftKey) {
      // Multi-select: toggle
      const idx = selectedElements.indexOf(target);
      if (idx === -1) {
        selectedElements.push(target);
      } else {
        selectedElements.splice(idx, 1);
      }
    } else {
      selectedElements = [target];
    }

    syncSelectionBoxes();

    window.parent.postMessage({
      type: 'INSPECTOR_CLICK',
      elementInfo: createElementInfo(target),
      selectedCount: selectedElements.length,
      isShift: e.shiftKey,
    }, '*');
  }

  function handleMouseLeave() {
    if (!isInspectorActive) return;
    hoveredElement = null;
    if (hoverBox) hoverBox.style.display = 'none';
    window.parent.postMessage({ type: 'INSPECTOR_LEAVE' }, '*');
  }

  function handleScroll() {
    if (!isInspectorActive) return;
    // Reposition overlay boxes on scroll
    if (hoverBox && hoveredElement) positionBox(hoverBox, hoveredElement);
    syncSelectionBoxes();
  }

  // ── Activate / deactivate ─────────────────────────────────────────────────

  function activate() {
    isInspectorActive = true;

    if (!inspectorStyle) {
      inspectorStyle = document.createElement('style');
      inspectorStyle.textContent = `
        .palmkit-inspector-active * { cursor: crosshair !important; }
      `;
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

    document.documentElement.classList.remove('palmkit-inspector-active');

    if (hoverBox) { hoverBox.style.display = 'none'; }
    selectionBoxes.forEach(({ box }) => box.remove());
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
    if (e.data.type === 'INSPECTOR_ACTIVATE') {
      if (e.data.active) activate(); else deactivate();
    }
    if (e.data.type === 'INSPECTOR_CLEAR_SELECTION') {
      selectedElements = [];
      syncSelectionBoxes();
    }
  });

  // Signal readiness to parent
  window.parent.postMessage({ type: 'INSPECTOR_READY' }, '*');
})();
