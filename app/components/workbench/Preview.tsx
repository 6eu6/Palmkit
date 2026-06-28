import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '@nanostores/react';
import { IconButton } from '~/components/ui/IconButton';
import { classNames } from '~/utils/classNames';
import { workbenchStore } from '~/lib/stores/workbench';
import { PortDropdown } from './PortDropdown';
import { ScreenshotSelector } from './ScreenshotSelector';
import { expoUrlAtom } from '~/lib/stores/qrCodeStore';
import { ExpoQrModal } from '~/components/workbench/ExpoQrModal';
import { canShowPreview, buildStatusMessage, buildStatusStore, previewFilesStore } from '~/lib/stores/build-status';
import { useWorkerSandbox } from '~/lib/hooks/use-worker-sandbox';
import type { ElementInfo } from './Inspector';
import { InspectorPanel } from './InspectorPanel';
import { pendingEditPromptStore, type QueuedEdit } from '~/lib/stores/inspector';
import inspectorScript from '/public/inspector-script.js?raw';

type ResizeSide = 'left' | 'right' | null;

interface PreviewProps {
  setSelectedElement?: (element: ElementInfo | null) => void;
}

interface WindowSize {
  name: string;
  width: number;
  height: number;
  icon: string;
  hasFrame?: boolean;
  frameType?: 'mobile' | 'tablet' | 'laptop' | 'desktop';
}

const WINDOW_SIZES: WindowSize[] = [
  { name: 'iPhone SE', width: 375, height: 667, icon: 'i-ph:device-mobile', hasFrame: true, frameType: 'mobile' },
  { name: 'iPhone 12/13', width: 390, height: 844, icon: 'i-ph:device-mobile', hasFrame: true, frameType: 'mobile' },
  {
    name: 'iPhone 12/13 Pro Max',
    width: 428,
    height: 926,
    icon: 'i-ph:device-mobile',
    hasFrame: true,
    frameType: 'mobile',
  },
  { name: 'iPad Mini', width: 768, height: 1024, icon: 'i-ph:device-tablet', hasFrame: true, frameType: 'tablet' },
  { name: 'iPad Air', width: 820, height: 1180, icon: 'i-ph:device-tablet', hasFrame: true, frameType: 'tablet' },
  { name: 'iPad Pro 11"', width: 834, height: 1194, icon: 'i-ph:device-tablet', hasFrame: true, frameType: 'tablet' },
  {
    name: 'iPad Pro 12.9"',
    width: 1024,
    height: 1366,
    icon: 'i-ph:device-tablet',
    hasFrame: true,
    frameType: 'tablet',
  },
  { name: 'Small Laptop', width: 1280, height: 800, icon: 'i-ph:laptop', hasFrame: true, frameType: 'laptop' },
  { name: 'Laptop', width: 1366, height: 768, icon: 'i-ph:laptop', hasFrame: true, frameType: 'laptop' },
  { name: 'Large Laptop', width: 1440, height: 900, icon: 'i-ph:laptop', hasFrame: true, frameType: 'laptop' },
  { name: 'Desktop', width: 1920, height: 1080, icon: 'i-ph:monitor', hasFrame: true, frameType: 'desktop' },
  { name: '4K Display', width: 3840, height: 2160, icon: 'i-ph:monitor', hasFrame: true, frameType: 'desktop' },
];

export const Preview = memo(({ setSelectedElement }: PreviewProps) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [activePreviewIndex, setActivePreviewIndex] = useState(0);
  const [isPortDropdownOpen, setIsPortDropdownOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const hasSelectedPreview = useRef(false);
  const previews = useStore(workbenchStore.previews);
  const activePreview = previews[activePreviewIndex];

  /*
   * Phase 1 Safety Gate — Ready-for-Preview Gate.
   *
   * `canShowPreview` is a computed store that returns false while a build is
   * in progress, incomplete, or failed. When false, we block the iframe from
   * rendering (src=undefined) and show a status-aware "No preview available"
   * state instead. This prevents partial/broken previews from reaching the
   * user — the #1 complaint before Phase 1.
   *
   * See ROADMAP.md → Phase 1 → "Fix partial preview".
   */
  const canShowPreviewValue = useStore(canShowPreview);
  const buildStatusMessageValue = useStore(buildStatusMessage);
  const buildStatusValue = useStore(buildStatusStore);

  // Effective preview: only render if (a) a preview exists AND (b) the gate is open.
  const effectiveActivePreview = canShowPreviewValue ? activePreview : undefined;

  /*
   * Phase 3: Sandbox bridge — runs Oracle worker files in WebContainer (desktop)
   * or E2B (mobile/Python). Auto-launches on desktop; requires a button on mobile.
   */
  const { sandboxState, sandboxUrl, sandboxError, launchSandbox, usesMobileE2B, canUseSandbox } = useWorkerSandbox();

  /*
   * Phase 2: External Worker preview from R2.
   * When the worker completes a job, previewFilesStore has {path: content}.
   * We build a blob URL (rewriting relative links) and use it as the iframe src.
   */
  const previewFiles = useStore(previewFilesStore);
  const [extWorkerBlobUrl, setExtWorkerBlobUrl] = useState<string | undefined>();

  useEffect(() => {
    const html = previewFiles['index.html'];

    if (!html) {
      setExtWorkerBlobUrl(undefined);
      return undefined;
    }

    // Create blob URLs for CSS and JS.
    const blobUrls: string[] = [];
    const urlMap: Record<string, string> = {};

    for (const [path, content] of Object.entries(previewFiles)) {
      if (path === 'index.html') {
        continue;
      }

      const mime = path.endsWith('.css') ? 'text/css' : path.endsWith('.js') ? 'text/javascript' : 'text/plain';
      const blob = new Blob([content], { type: mime });
      const url = URL.createObjectURL(blob);
      blobUrls.push(url);
      urlMap[path.split('/').pop() ?? path] = url;
    }

    // Rewrite href/src in HTML.
    let rewritten = html;

    for (const [fileName, url] of Object.entries(urlMap)) {
      rewritten = rewritten.replace(new RegExp(`(href|src)=["']${fileName}["']`, 'g'), `$1="${url}"`);
    }

    // Inject inspector script so the visual editor works in blob URL previews.
    const scriptTag = `<script>${inspectorScript}</script>`;
    rewritten = rewritten.includes('</body>')
      ? rewritten.replace('</body>', `${scriptTag}</body>`)
      : rewritten + scriptTag;

    const htmlBlob = new Blob([rewritten], { type: 'text/html' });
    const blobUrl = URL.createObjectURL(htmlBlob);
    setExtWorkerBlobUrl(blobUrl);

    return () => {
      URL.revokeObjectURL(blobUrl);
      blobUrls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [previewFiles]);

  const [displayPath, setDisplayPath] = useState('/');
  const [iframeUrl, setIframeUrl] = useState<string | undefined>();
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [isInspectorMode, setIsInspectorMode] = useState(false);
  const [selectedPanelElement, setSelectedPanelElement] = useState<ElementInfo | null>(null);
  const [queuedEdits, setQueuedEdits] = useState<QueuedEdit[]>([]);
  const [isDeviceModeOn, setIsDeviceModeOn] = useState(false);
  const [widthPercent, setWidthPercent] = useState<number>(37.5);
  const [currentWidth, setCurrentWidth] = useState<number>(0);

  /*
   * Effective iframe URL precedence:
   *   1. Phase 3 sandbox URL (WebContainer or E2B preview)
   *   2. Phase 2 blob URL (static R2 preview)
   *   3. Phase 1 WebContainer URL (bolt editor flow)
   */
  const finalIframeUrl = sandboxUrl ?? extWorkerBlobUrl ?? iframeUrl;
  const hasExtWorkerPreview = Boolean(extWorkerBlobUrl);
  const hasSandboxPreview = sandboxState === 'ready' && Boolean(sandboxUrl);

  const resizingState = useRef({
    isResizing: false,
    side: null as ResizeSide,
    startX: 0,
    startWidthPercent: 37.5,
    windowWidth: window.innerWidth,
    pointerId: null as number | null,
  });

  // Reduce scaling factor to make resizing less sensitive
  const SCALING_FACTOR = 1;

  const [isWindowSizeDropdownOpen, setIsWindowSizeDropdownOpen] = useState(false);
  const [selectedWindowSize, setSelectedWindowSize] = useState<WindowSize>(WINDOW_SIZES[0]);
  const [isLandscape, setIsLandscape] = useState(false);
  const [showDeviceFrame, setShowDeviceFrame] = useState(true);
  const [showDeviceFrameInPreview, setShowDeviceFrameInPreview] = useState(false);
  const expoUrl = useStore(expoUrlAtom);
  const [isExpoQrModalOpen, setIsExpoQrModalOpen] = useState(false);

  useEffect(() => {
    if (!activePreview) {
      setIframeUrl(undefined);
      setDisplayPath('/');

      return;
    }

    const { baseUrl } = activePreview;
    setIframeUrl(baseUrl);
    setDisplayPath('/');
  }, [activePreview]);

  const findMinPortIndex = useCallback(
    (minIndex: number, preview: { port: number }, index: number, array: { port: number }[]) => {
      return preview.port < array[minIndex].port ? index : minIndex;
    },
    [],
  );

  useEffect(() => {
    if (previews.length > 1 && !hasSelectedPreview.current) {
      const minPortIndex = previews.reduce(findMinPortIndex, 0);
      setActivePreviewIndex(minPortIndex);
    }
  }, [previews, findMinPortIndex]);

  const reloadPreview = () => {
    if (iframeRef.current) {
      iframeRef.current.src = iframeRef.current.src;
    }
  };

  const toggleFullscreen = async () => {
    if (!isFullscreen && containerRef.current) {
      await containerRef.current.requestFullscreen();
    } else if (document.fullscreenElement) {
      await document.exitFullscreen();
    }
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  const toggleDeviceMode = () => {
    setIsDeviceModeOn((prev) => !prev);
  };

  const startResizing = (e: React.PointerEvent, side: ResizeSide) => {
    if (!isDeviceModeOn) {
      return;
    }

    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);

    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'ew-resize';

    resizingState.current = {
      isResizing: true,
      side,
      startX: e.clientX,
      startWidthPercent: widthPercent,
      windowWidth: window.innerWidth,
      pointerId: e.pointerId,
    };
  };

  const ResizeHandle = ({ side }: { side: ResizeSide }) => {
    if (!side) {
      return null;
    }

    return (
      <div
        className={`resize-handle-${side}`}
        onPointerDown={(e) => startResizing(e, side)}
        style={{
          position: 'absolute',
          top: 0,
          ...(side === 'left' ? { left: 0, marginLeft: '-7px' } : { right: 0, marginRight: '-7px' }),
          width: '15px',
          height: '100%',
          cursor: 'ew-resize',
          background: 'var(--palmkit-elements-background-depth-4, rgba(0,0,0,.3))',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'background 0.2s',
          userSelect: 'none',
          touchAction: 'none',
          zIndex: 10,
        }}
        onMouseOver={(e) =>
          (e.currentTarget.style.background = 'var(--palmkit-elements-background-depth-4, rgba(0,0,0,.3))')
        }
        onMouseOut={(e) =>
          (e.currentTarget.style.background = 'var(--palmkit-elements-background-depth-3, rgba(0,0,0,.15))')
        }
        title="Drag to resize width"
      >
        <GripIcon />
      </div>
    );
  };

  useEffect(() => {
    // Skip if not in device mode
    if (!isDeviceModeOn) {
      return;
    }

    const handlePointerMove = (e: PointerEvent) => {
      const state = resizingState.current;

      if (!state.isResizing || e.pointerId !== state.pointerId) {
        return;
      }

      const dx = e.clientX - state.startX;
      const dxPercent = (dx / state.windowWidth) * 100 * SCALING_FACTOR;

      let newWidthPercent = state.startWidthPercent;

      if (state.side === 'right') {
        newWidthPercent = state.startWidthPercent + dxPercent;
      } else if (state.side === 'left') {
        newWidthPercent = state.startWidthPercent - dxPercent;
      }

      // Limit width percentage between 10% and 90%
      newWidthPercent = Math.max(10, Math.min(newWidthPercent, 90));

      // Force a synchronous update to ensure the UI reflects the change immediately
      setWidthPercent(newWidthPercent);

      // Calculate and update the actual pixel width
      if (containerRef.current) {
        const containerWidth = containerRef.current.clientWidth;
        const newWidth = Math.round((containerWidth * newWidthPercent) / 100);
        setCurrentWidth(newWidth);

        // Apply the width directly to the container for immediate feedback
        const previewContainer = containerRef.current.querySelector('div[style*="width"]');

        if (previewContainer) {
          (previewContainer as HTMLElement).style.width = `${newWidthPercent}%`;
        }
      }
    };

    const handlePointerUp = (e: PointerEvent) => {
      const state = resizingState.current;

      if (!state.isResizing || e.pointerId !== state.pointerId) {
        return;
      }

      // Find all resize handles
      const handles = document.querySelectorAll('.resize-handle-left, .resize-handle-right');

      // Release pointer capture from any handle that has it
      handles.forEach((handle) => {
        if ((handle as HTMLElement).hasPointerCapture?.(e.pointerId)) {
          (handle as HTMLElement).releasePointerCapture(e.pointerId);
        }
      });

      // Reset state
      resizingState.current = {
        ...resizingState.current,
        isResizing: false,
        side: null,
        pointerId: null,
      };

      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };

    // Add event listeners
    document.addEventListener('pointermove', handlePointerMove, { passive: false });
    document.addEventListener('pointerup', handlePointerUp);
    document.addEventListener('pointercancel', handlePointerUp);

    // Define cleanup function
    function cleanupResizeListeners() {
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', handlePointerUp);
      document.removeEventListener('pointercancel', handlePointerUp);

      // Release any lingering pointer captures
      if (resizingState.current.pointerId !== null) {
        const handles = document.querySelectorAll('.resize-handle-left, .resize-handle-right');
        handles.forEach((handle) => {
          if ((handle as HTMLElement).hasPointerCapture?.(resizingState.current.pointerId!)) {
            (handle as HTMLElement).releasePointerCapture(resizingState.current.pointerId!);
          }
        });

        // Reset state
        resizingState.current = {
          ...resizingState.current,
          isResizing: false,
          side: null,
          pointerId: null,
        };

        document.body.style.userSelect = '';
        document.body.style.cursor = '';
      }
    }

    // Return the cleanup function
    // eslint-disable-next-line consistent-return
    return cleanupResizeListeners;
  }, [isDeviceModeOn, SCALING_FACTOR]);

  useEffect(() => {
    const handleWindowResize = () => {
      // Update the window width in the resizing state
      resizingState.current.windowWidth = window.innerWidth;

      // Update the current width in pixels
      if (containerRef.current && isDeviceModeOn) {
        const containerWidth = containerRef.current.clientWidth;
        setCurrentWidth(Math.round((containerWidth * widthPercent) / 100));
      }
    };

    window.addEventListener('resize', handleWindowResize);

    // Initial calculation of current width
    if (containerRef.current && isDeviceModeOn) {
      const containerWidth = containerRef.current.clientWidth;
      setCurrentWidth(Math.round((containerWidth * widthPercent) / 100));
    }

    return () => {
      window.removeEventListener('resize', handleWindowResize);
    };
  }, [isDeviceModeOn, widthPercent]);

  // Update current width when device mode is toggled
  useEffect(() => {
    if (containerRef.current && isDeviceModeOn) {
      const containerWidth = containerRef.current.clientWidth;
      setCurrentWidth(Math.round((containerWidth * widthPercent) / 100));
    }
  }, [isDeviceModeOn]);

  const GripIcon = () => (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100%',
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          color: 'var(--palmkit-elements-textSecondary, rgba(0,0,0,0.5))',
          fontSize: '10px',
          lineHeight: '5px',
          userSelect: 'none',
          marginLeft: '1px',
        }}
      >
        ••• •••
      </div>
    </div>
  );

  const openInNewTab = () => {
    const url = finalIframeUrl ?? activePreview?.baseUrl;

    if (url) {
      window.open(url, '_blank');
    }
  };

  // Function to get the correct frame padding based on orientation
  const getFramePadding = useCallback(() => {
    if (!selectedWindowSize) {
      return '40px 20px';
    }

    const isMobile = selectedWindowSize.frameType === 'mobile';

    if (isLandscape) {
      // Increase horizontal padding in landscape mode to ensure full device frame is visible
      return isMobile ? '40px 60px' : '30px 50px';
    }

    return isMobile ? '40px 20px' : '50px 30px';
  }, [isLandscape, selectedWindowSize]);

  // Function to get the scale factor for the device frame
  const getDeviceScale = useCallback(() => {
    // Always return 1 to ensure the device frame is shown at its exact size
    return 1;
  }, [isLandscape, selectedWindowSize, widthPercent]);

  // Update the device scale when needed
  useEffect(() => {
    /*
     * Intentionally disabled - we want to maintain scale of 1
     * No dynamic scaling to ensure device frame matches external window exactly
     */
    // Intentionally empty cleanup function - no cleanup needed
    return () => {
      // No cleanup needed
    };
  }, [isDeviceModeOn, showDeviceFrameInPreview, getDeviceScale, isLandscape, selectedWindowSize]);

  // Function to get the frame color based on dark mode
  const getFrameColor = useCallback(() => {
    // Check if the document has a dark class or data-theme="dark"
    const isDarkMode =
      document.documentElement.classList.contains('dark') ||
      document.documentElement.getAttribute('data-theme') === 'dark' ||
      window.matchMedia('(prefers-color-scheme: dark)').matches;

    // Return a darker color for light mode, lighter color for dark mode
    return isDarkMode ? '#555' : '#111';
  }, []);

  // Effect to handle color scheme changes
  useEffect(() => {
    const darkModeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const handleColorSchemeChange = () => {
      // Force a re-render when color scheme changes
      if (showDeviceFrameInPreview) {
        setShowDeviceFrameInPreview(true);
      }
    };

    darkModeMediaQuery.addEventListener('change', handleColorSchemeChange);

    return () => {
      darkModeMediaQuery.removeEventListener('change', handleColorSchemeChange);
    };
  }, [showDeviceFrameInPreview]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data.type === 'INSPECTOR_READY') {
        if (iframeRef.current?.contentWindow) {
          iframeRef.current.contentWindow.postMessage({ type: 'INSPECTOR_ACTIVATE', active: isInspectorMode }, '*');
        }
      } else if (event.data.type === 'INSPECTOR_CLICK') {
        /*
         * "panel →" button inside tooltip sends INSPECTOR_OPEN_PANEL;
         * legacy INSPECTOR_CLICK still opens the InspectorPanel
         */
        const element = event.data.elementInfo as ElementInfo;
        setSelectedPanelElement(element);
        setSelectedElement?.(element);
      } else if (event.data.type === 'INSPECTOR_OPEN_PANEL') {
        const element = event.data.elementInfo as ElementInfo;
        setSelectedPanelElement(element);
        setSelectedElement?.(element);
      } else if (event.data.type === 'INSPECTOR_EDIT_QUEUED') {
        const edit = event.data.edit as QueuedEdit;
        setQueuedEdits((prev) => [...prev, edit]);
      }
    };

    window.addEventListener('message', handleMessage);

    return () => window.removeEventListener('message', handleMessage);
  }, [isInspectorMode]);

  const toggleInspectorMode = () => {
    const newInspectorMode = !isInspectorMode;
    setIsInspectorMode(newInspectorMode);

    if (!newInspectorMode) {
      setSelectedPanelElement(null);
      setSelectedElement?.(null);
      setQueuedEdits([]);
      iframeRef.current?.contentWindow?.postMessage({ type: 'INSPECTOR_CLEAR_SELECTION' }, '*');
      iframeRef.current?.contentWindow?.postMessage({ type: 'INSPECTOR_QUEUE_RESET' }, '*');
    }

    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage({ type: 'INSPECTOR_ACTIVATE', active: newInspectorMode }, '*');
    }
  };

  const buildQueuePrompt = (edits: QueuedEdit[]): string => {
    const items = edits.map((e, i) => {
      const path = e.path ? ` (${e.path})` : '';
      let attachNote = '';

      if (e.attachment) {
        const kb = Math.round(e.attachment.size / 1024);
        const { name, type, dataUrl, textContent } = e.attachment;

        if (type?.startsWith('video/')) {
          attachNote = `\n   📎 VIDEO "${name}" (${kb}KB) → embed as <video autoplay muted loop playsinline style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0"> and wrap parent in position:relative`;
        } else if (textContent && (type?.includes('svg') || name?.endsWith('.svg'))) {
          attachNote = `\n   📎 SVG "${name}" → inline this SVG:\n   ${textContent.trim().substring(0, 500)}`;
        } else if (dataUrl && type?.startsWith('image/')) {
          attachNote = `\n   📎 IMAGE "${name}" (${kb}KB) → use as img src: ${dataUrl.substring(0, 120)}...`;
        } else if (name?.match(/\.(ttf|woff|woff2|otf)$/i)) {
          const fontName = name.replace(/\.(ttf|woff|woff2|otf)$/i, '');
          attachNote = `\n   📎 FONT "${fontName}" → declare @font-face and apply to this element`;
        } else if (type?.startsWith('image/')) {
          attachNote = `\n   📎 IMAGE "${name}" (${kb}KB) → use descriptive placeholder or ask user to provide URL`;
        }
      }

      return `${i + 1}. \`${e.selector}\`${path}\n   ${e.instruction}${attachNote}`;
    });

    return [
      'Apply these visual edits exactly. Modify ONLY the listed elements, keep all other code unchanged.\n',
      ...items,
    ].join('\n');
  };

  return (
    <div ref={containerRef} className={`w-full h-full flex flex-col relative`}>
      {isPortDropdownOpen && (
        <div className="z-iframe-overlay w-full h-full absolute" onClick={() => setIsPortDropdownOpen(false)} />
      )}
      <div className="bg-palmkit-elements-background-depth-2 p-2 flex items-center gap-2">
        <div className="flex items-center gap-2">
          <IconButton icon="i-ph:arrow-clockwise" onClick={reloadPreview} />
          <IconButton
            icon="i-ph:selection"
            onClick={() => setIsSelectionMode(!isSelectionMode)}
            className={isSelectionMode ? 'bg-palmkit-elements-background-depth-3' : ''}
          />
        </div>

        <div className="flex-grow flex items-center gap-1 bg-palmkit-elements-preview-addressBar-background border border-palmkit-elements-borderColor text-palmkit-elements-preview-addressBar-text rounded-full px-1 py-1 text-sm hover:bg-palmkit-elements-preview-addressBar-backgroundHover hover:focus-within:bg-palmkit-elements-preview-addressBar-backgroundActive focus-within:bg-palmkit-elements-preview-addressBar-backgroundActive focus-within-border-palmkit-elements-borderColorActive focus-within:text-palmkit-elements-preview-addressBar-textActive">
          <PortDropdown
            activePreviewIndex={activePreviewIndex}
            setActivePreviewIndex={setActivePreviewIndex}
            isDropdownOpen={isPortDropdownOpen}
            setHasSelectedPreview={(value) => (hasSelectedPreview.current = value)}
            setIsDropdownOpen={setIsPortDropdownOpen}
            previews={previews}
          />
          <input
            title="URL Path"
            ref={inputRef}
            className="w-full bg-transparent outline-none"
            type="text"
            value={displayPath}
            onChange={(event) => {
              setDisplayPath(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && activePreview) {
                let targetPath = displayPath.trim();

                if (!targetPath.startsWith('/')) {
                  targetPath = '/' + targetPath;
                }

                /*
                 * Avoid a double slash when baseUrl ends with "/" (e.g. the
                 * same-origin cloud proxy base "/preview/").
                 */
                const fullUrl = activePreview.baseUrl.replace(/\/$/, '') + targetPath;
                setIframeUrl(fullUrl);
                setDisplayPath(targetPath);

                if (inputRef.current) {
                  inputRef.current.blur();
                }
              }
            }}
            disabled={!activePreview}
          />
        </div>

        <div className="flex items-center gap-2">
          <IconButton
            icon="i-ph:devices"
            onClick={toggleDeviceMode}
            title={isDeviceModeOn ? 'Switch to Responsive Mode' : 'Switch to Device Mode'}
          />

          {expoUrl && <IconButton icon="i-ph:qr-code" onClick={() => setIsExpoQrModalOpen(true)} title="Show QR" />}

          <ExpoQrModal open={isExpoQrModalOpen} onClose={() => setIsExpoQrModalOpen(false)} />

          {isDeviceModeOn && (
            <>
              <IconButton
                icon="i-ph:device-rotate"
                onClick={() => setIsLandscape(!isLandscape)}
                title={isLandscape ? 'Switch to Portrait' : 'Switch to Landscape'}
              />
              <IconButton
                icon={showDeviceFrameInPreview ? 'i-ph:device-mobile' : 'i-ph:device-mobile-slash'}
                onClick={() => setShowDeviceFrameInPreview(!showDeviceFrameInPreview)}
                title={showDeviceFrameInPreview ? 'Hide Device Frame' : 'Show Device Frame'}
              />
            </>
          )}
          <IconButton
            icon="i-ph:cursor-click"
            onClick={toggleInspectorMode}
            className={
              isInspectorMode ? 'bg-palmkit-elements-background-depth-3 !text-palmkit-elements-item-contentAccent' : ''
            }
            title={isInspectorMode ? 'Disable Element Inspector' : 'Enable Element Inspector'}
          />
          <IconButton
            icon={isFullscreen ? 'i-ph:arrows-in' : 'i-ph:arrows-out'}
            onClick={toggleFullscreen}
            title={isFullscreen ? 'Exit Full Screen' : 'Full Screen'}
          />

          <div className="flex items-center relative">
            <IconButton
              icon="i-ph:list"
              onClick={() => setIsWindowSizeDropdownOpen(!isWindowSizeDropdownOpen)}
              title="New Window Options"
            />

            {isWindowSizeDropdownOpen && (
              <>
                <div className="fixed inset-0 z-50" onClick={() => setIsWindowSizeDropdownOpen(false)} />
                <div className="absolute right-0 top-full mt-2 z-50 min-w-[240px] max-h-[400px] overflow-y-auto bg-white dark:bg-black rounded-xl shadow-2xl border border-[#E5E7EB] dark:border-[rgba(255,255,255,0.1)] overflow-hidden">
                  <div className="p-3 border-b border-[#E5E7EB] dark:border-[rgba(255,255,255,0.1)]">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-[#111827] dark:text-gray-300">Window Options</span>
                    </div>
                    <div className="flex flex-col gap-2">
                      <button
                        className={`flex w-full justify-between items-center text-start bg-transparent text-xs text-palmkit-elements-textTertiary hover:text-palmkit-elements-textPrimary`}
                        onClick={() => {
                          openInNewTab();
                          setIsWindowSizeDropdownOpen(false);
                        }}
                      >
                        <span>Open in new tab</span>
                        <div className="i-ph:arrow-square-out h-5 w-4" />
                      </button>
                      <button
                        className={`flex w-full justify-between items-center text-start bg-transparent text-xs text-palmkit-elements-textTertiary hover:text-palmkit-elements-textPrimary`}
                        onClick={() => {
                          const url = finalIframeUrl ?? activePreview?.baseUrl;

                          if (!url) {
                            console.warn('[Preview] No preview URL available');
                            return;
                          }

                          const match = url.match(/^https?:\/\/([^.]+)\.local-credentialless\.webcontainer-api\.io/);

                          if (match) {
                            const previewId = match[1];
                            const previewUrl = `/webcontainer/preview/${previewId}`;
                            window.open(
                              previewUrl,
                              `preview-${previewId}`,
                              'width=1280,height=720,menubar=no,toolbar=no,location=no,status=no,resizable=yes',
                            );
                          } else {
                            // blob URL or direct URL (static preview)
                            window.open(
                              url,
                              '_blank',
                              'width=1280,height=720,menubar=no,toolbar=no,location=no,status=no,resizable=yes',
                            );
                          }

                          setIsWindowSizeDropdownOpen(false);
                        }}
                      >
                        <span>Open in new window</span>
                        <div className="i-ph:browser h-5 w-4" />
                      </button>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-palmkit-elements-textTertiary">Show Device Frame</span>
                        <button
                          className={`w-10 h-5 rounded-full transition-colors duration-200 ${
                            showDeviceFrame ? 'bg-gray-800 dark:bg-gray-200' : 'bg-gray-300 dark:bg-gray-700'
                          } relative`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setShowDeviceFrame(!showDeviceFrame);
                          }}
                        >
                          <span
                            className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform duration-200 ${
                              showDeviceFrame ? 'transform translate-x-5' : ''
                            }`}
                          />
                        </button>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-palmkit-elements-textTertiary">Landscape Mode</span>
                        <button
                          className={`w-10 h-5 rounded-full transition-colors duration-200 ${
                            isLandscape ? 'bg-gray-800 dark:bg-gray-200' : 'bg-gray-300 dark:bg-gray-700'
                          } relative`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setIsLandscape(!isLandscape);
                          }}
                        >
                          <span
                            className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform duration-200 ${
                              isLandscape ? 'transform translate-x-5' : ''
                            }`}
                          />
                        </button>
                      </div>
                    </div>
                  </div>
                  {WINDOW_SIZES.map((size) => (
                    <button
                      key={size.name}
                      className="w-full px-4 py-3.5 text-left text-[#111827] dark:text-gray-300 text-sm whitespace-nowrap flex items-center gap-3 group hover:bg-gray-100 dark:hover:bg-gray-900 bg-white dark:bg-black"
                      onClick={() => {
                        setSelectedWindowSize(size);
                        setIsDeviceModeOn(true);
                        setIsWindowSizeDropdownOpen(false);
                      }}
                    >
                      <div
                        className={`${size.icon} w-5 h-5 text-[#6B7280] dark:text-gray-400 group-hover:text-gray-900 dark:group-hover:text-gray-100 transition-colors duration-200`}
                      />
                      <div className="flex-grow flex flex-col">
                        <span className="font-medium group-hover:text-gray-900 dark:group-hover:text-gray-100 transition-colors duration-200">
                          {size.name}
                        </span>
                        <span className="text-xs text-[#6B7280] dark:text-gray-400 group-hover:text-gray-900 dark:group-hover:text-gray-100 transition-colors duration-200">
                          {isLandscape && (size.frameType === 'mobile' || size.frameType === 'tablet')
                            ? `${size.height} × ${size.width}`
                            : `${size.width} × ${size.height}`}
                          {size.hasFrame && showDeviceFrame ? ' (with frame)' : ''}
                        </span>
                      </div>
                      {selectedWindowSize.name === size.name && (
                        <div className="text-gray-800 dark:text-gray-200">
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <polyline points="20 6 9 17 4 12"></polyline>
                          </svg>
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 border-t border-palmkit-elements-borderColor flex justify-center items-center overflow-auto">
        <div
          style={{
            width: isDeviceModeOn ? (showDeviceFrameInPreview ? '100%' : `${widthPercent}%`) : '100%',
            height: '100%',
            overflow: 'auto',
            background: 'var(--palmkit-elements-background-depth-1)',
            position: 'relative',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          {canShowPreviewValue && (effectiveActivePreview || hasExtWorkerPreview || hasSandboxPreview) ? (
            <>
              {isDeviceModeOn && showDeviceFrameInPreview ? (
                <div
                  className="device-wrapper"
                  style={{
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    width: '100%',
                    height: '100%',
                    padding: '0',
                    overflow: 'auto',
                    transition: 'all 0.3s ease',
                    position: 'relative',
                  }}
                >
                  <div
                    className="device-frame-container"
                    style={{
                      position: 'relative',
                      borderRadius: selectedWindowSize.frameType === 'mobile' ? '36px' : '20px',
                      background: getFrameColor(),
                      padding: getFramePadding(),
                      boxShadow: '0 10px 30px rgba(0,0,0,0.2)',
                      overflow: 'hidden',
                      transform: 'scale(1)',
                      transformOrigin: 'center center',
                      transition: 'all 0.3s ease',
                      margin: '40px',
                      width: isLandscape
                        ? `${selectedWindowSize.height + (selectedWindowSize.frameType === 'mobile' ? 120 : 60)}px`
                        : `${selectedWindowSize.width + (selectedWindowSize.frameType === 'mobile' ? 40 : 60)}px`,
                      height: isLandscape
                        ? `${selectedWindowSize.width + (selectedWindowSize.frameType === 'mobile' ? 80 : 60)}px`
                        : `${selectedWindowSize.height + (selectedWindowSize.frameType === 'mobile' ? 80 : 100)}px`,
                    }}
                  >
                    {/* Notch - positioned based on orientation */}
                    <div
                      style={{
                        position: 'absolute',
                        top: isLandscape ? '50%' : '20px',
                        left: isLandscape ? '30px' : '50%',
                        transform: isLandscape ? 'translateY(-50%)' : 'translateX(-50%)',
                        width: isLandscape ? '8px' : selectedWindowSize.frameType === 'mobile' ? '60px' : '80px',
                        height: isLandscape ? (selectedWindowSize.frameType === 'mobile' ? '60px' : '80px') : '8px',
                        background: '#333',
                        borderRadius: '4px',
                        zIndex: 2,
                      }}
                    />

                    {/* Home button - positioned based on orientation */}
                    <div
                      style={{
                        position: 'absolute',
                        bottom: isLandscape ? '50%' : '15px',
                        right: isLandscape ? '30px' : '50%',
                        transform: isLandscape ? 'translateY(50%)' : 'translateX(50%)',
                        width: isLandscape ? '4px' : '40px',
                        height: isLandscape ? '40px' : '4px',
                        background: '#333',
                        borderRadius: '50%',
                        zIndex: 2,
                      }}
                    />

                    <iframe
                      ref={iframeRef}
                      title="preview"
                      style={{
                        border: 'none',
                        width: isLandscape ? `${selectedWindowSize.height}px` : `${selectedWindowSize.width}px`,
                        height: isLandscape ? `${selectedWindowSize.width}px` : `${selectedWindowSize.height}px`,
                        background: 'white',
                        display: 'block',
                      }}
                      src={finalIframeUrl}
                      sandbox="allow-scripts allow-forms allow-popups allow-modals allow-storage-access-by-user-activation allow-same-origin"
                      allow="cross-origin-isolated"
                    />
                  </div>
                </div>
              ) : (
                <iframe
                  ref={iframeRef}
                  title="preview"
                  className="border-none w-full h-full bg-palmkit-elements-background-depth-1"
                  src={finalIframeUrl}
                  sandbox="allow-scripts allow-forms allow-popups allow-modals allow-storage-access-by-user-activation allow-same-origin"
                  allow="geolocation; ch-ua-full-version-list; cross-origin-isolated; screen-wake-lock; publickey-credentials-get; shared-storage-select-url; ch-ua-arch; bluetooth; compute-pressure; ch-prefers-reduced-transparency; deferred-fetch; usb; ch-save-data; publickey-credentials-create; shared-storage; deferred-fetch-minimal; run-ad-auction; ch-ua-form-factors; ch-downlink; otp-credentials; payment; ch-ua; ch-ua-model; ch-ect; autoplay; camera; private-state-token-issuance; accelerometer; ch-ua-platform-version; idle-detection; private-aggregation; interest-cohort; ch-viewport-height; local-fonts; ch-ua-platform; midi; ch-ua-full-version; xr-spatial-tracking; clipboard-read; gamepad; display-capture; keyboard-map; join-ad-interest-group; ch-width; ch-prefers-reduced-motion; browsing-topics; encrypted-media; gyroscope; serial; ch-rtt; ch-ua-mobile; window-management; unload; ch-dpr; ch-prefers-color-scheme; ch-ua-wow64; attribution-reporting; fullscreen; identity-credentials-get; private-state-token-redemption; hid; ch-ua-bitness; storage-access; sync-xhr; ch-device-memory; ch-viewport-width; picture-in-picture; magnetometer; clipboard-write; microphone"
                />
              )}
              <ScreenshotSelector
                isSelectionMode={isSelectionMode}
                setIsSelectionMode={setIsSelectionMode}
                containerRef={iframeRef}
              />
              {isInspectorMode && selectedPanelElement && (
                <InspectorPanel
                  selectedElement={selectedPanelElement}
                  isVisible={true}
                  onClose={() => {
                    setSelectedPanelElement(null);
                    setSelectedElement?.(null);
                    iframeRef.current?.contentWindow?.postMessage({ type: 'INSPECTOR_CLEAR_SELECTION' }, '*');
                  }}
                  onApplyEdit={(prompt) => {
                    pendingEditPromptStore.set(prompt);
                    setIsInspectorMode(false);
                    setSelectedPanelElement(null);
                    setSelectedElement?.(null);
                    iframeRef.current?.contentWindow?.postMessage({ type: 'INSPECTOR_ACTIVATE', active: false }, '*');
                  }}
                />
              )}
              {isInspectorMode && queuedEdits.length > 0 && (
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 z-50">
                  <button
                    onClick={() => {
                      const prompt = buildQueuePrompt(queuedEdits);
                      pendingEditPromptStore.set(prompt);
                      setQueuedEdits([]);
                      iframeRef.current?.contentWindow?.postMessage({ type: 'INSPECTOR_QUEUE_RESET' }, '*');
                    }}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold shadow-xl
                      bg-blue-600 hover:bg-blue-500 text-white border border-blue-400/30
                      active:scale-95 transition-all duration-150"
                    style={{ boxShadow: '0 4px 24px rgba(37,99,235,0.5)' }}
                  >
                    <div className="i-ph:check-circle text-base" />
                    Apply Edit ({queuedEdits.length})
                  </button>
                  <button
                    onClick={() => {
                      setQueuedEdits([]);
                      iframeRef.current?.contentWindow?.postMessage({ type: 'INSPECTOR_QUEUE_RESET' }, '*');
                    }}
                    className="flex items-center justify-center w-9 h-9 rounded-xl text-sm
                      bg-palmkit-elements-background-depth-3 hover:bg-palmkit-elements-background-depth-4
                      text-palmkit-elements-textTertiary border border-palmkit-elements-borderColor
                      active:scale-95 transition-all duration-150"
                    title="Clear queue"
                  >
                    <div className="i-ph:x text-sm" />
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-col w-full h-full justify-center items-center bg-palmkit-elements-bg-depth-1 px-6">
              <div
                className="flex flex-col items-center gap-5 max-w-xs text-center"
                style={{ animation: 'fade-in-up 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards' }}
              >
                <div className="w-16 h-16 rounded-2xl flex items-center justify-center bg-palmkit-elements-item-backgroundAccent border border-palmkit-elements-borderColor">
                  {sandboxState === 'writing' || sandboxState === 'installing' || sandboxState === 'starting' ? (
                    <div className="i-svg-spinners:ring-resize text-2xl text-palmkit-elements-textTertiary animate-spin" />
                  ) : sandboxState === 'error' ? (
                    <div className="i-ph:warning text-2xl text-red-400" />
                  ) : (
                    <div className="i-ph:browser text-2xl text-palmkit-elements-textTertiary" />
                  )}
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-palmkit-elements-textPrimary mb-1.5">
                    {sandboxState === 'writing'
                      ? 'Writing project files…'
                      : sandboxState === 'installing'
                        ? 'Installing dependencies…'
                        : sandboxState === 'starting'
                          ? usesMobileE2B
                            ? 'Starting cloud preview…'
                            : 'Starting dev server…'
                          : sandboxState === 'error'
                            ? 'Preview failed'
                            : buildStatusValue.jobStatus === 'failed_clean'
                              ? 'Build failed'
                              : buildStatusValue.jobStatus === 'incomplete_retrying'
                                ? 'Still building…'
                                : buildStatusValue.jobStatus === 'generating'
                                  ? 'Building your app…'
                                  : buildStatusValue.jobStatus === 'ready_for_preview' &&
                                      buildStatusValue.appType &&
                                      buildStatusValue.appType !== 'static'
                                    ? `${buildStatusValue.appType.charAt(0).toUpperCase() + buildStatusValue.appType.slice(1)} project ready`
                                    : 'No preview available'}
                  </h3>
                  <p className="text-xs text-palmkit-elements-textTertiary leading-relaxed">
                    {sandboxError ||
                      (sandboxState === 'writing'
                        ? 'Copying source files into the preview runtime…'
                        : sandboxState === 'installing'
                          ? 'Running npm install — this may take a moment…'
                          : sandboxState === 'starting'
                            ? 'Waiting for the dev server to respond…'
                            : buildStatusMessageValue ||
                              'Start a conversation or wait for the runtime to initialize. Preview will appear here once the app is running.')}
                  </p>
                </div>
                <div className="flex items-center gap-2 mt-1">
                  {/* Mobile cloud preview launch button — shown only for sandboxable apps on phones */}
                  {canUseSandbox && usesMobileE2B && sandboxState === 'idle' && (
                    <button
                      onClick={launchSandbox}
                      className={classNames(
                        'flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium',
                        'bg-palmkit-elements-item-backgroundAccent text-palmkit-elements-textSecondary border border-palmkit-elements-borderColor',
                        'hover:bg-palmkit-elements-item-backgroundActive hover:border-palmkit-elements-borderColorActive',
                        'active:scale-[0.97] transition-all duration-200',
                      )}
                    >
                      <div className="i-ph:cloud-arrow-up text-sm" />
                      Launch Cloud Preview
                    </button>
                  )}
                  {/* Retry button shown after sandbox error */}
                  {sandboxState === 'error' && canUseSandbox && (
                    <button
                      onClick={launchSandbox}
                      className={classNames(
                        'flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium',
                        'bg-palmkit-elements-item-backgroundAccent text-palmkit-elements-textSecondary border border-palmkit-elements-borderColor',
                        'hover:bg-palmkit-elements-item-backgroundActive hover:border-palmkit-elements-borderColorActive',
                        'active:scale-[0.97] transition-all duration-200',
                      )}
                    >
                      <div className="i-ph:arrow-clockwise text-sm" />
                      Try Again
                    </button>
                  )}
                  <button
                    onClick={() => workbenchStore.currentView.set('code')}
                    className={classNames(
                      'flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium',
                      'bg-palmkit-elements-item-backgroundAccent text-palmkit-elements-textSecondary border border-palmkit-elements-borderColor',
                      'hover:bg-palmkit-elements-item-backgroundActive hover:border-palmkit-elements-borderColorActive',
                      'active:scale-[0.97] transition-all duration-200',
                    )}
                  >
                    <div className="i-ph:folder-open text-sm" />
                    View Files
                  </button>
                  <button
                    onClick={() => workbenchStore.downloadZip()}
                    className={classNames(
                      'flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium',
                      'bg-[rgba(255,255,255,0.03)] text-gray-400 border border-[rgba(255,255,255,0.06)]',
                      'hover:bg-[rgba(255,255,255,0.06)] hover:text-gray-300',
                      'active:scale-[0.97] transition-all duration-200',
                    )}
                  >
                    <div className="i-ph:download-simple text-sm" />
                    Export ZIP
                  </button>
                </div>
              </div>
            </div>
          )}

          {isDeviceModeOn && !showDeviceFrameInPreview && (
            <>
              {/* Width indicator */}
              <div
                style={{
                  position: 'absolute',
                  top: '-25px',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  background: 'var(--palmkit-elements-background-depth-3, rgba(0,0,0,0.7))',
                  color: 'var(--palmkit-elements-textPrimary, white)',
                  padding: '2px 8px',
                  borderRadius: '4px',
                  fontSize: '12px',
                  pointerEvents: 'none',
                  opacity: resizingState.current.isResizing ? 1 : 0,
                  transition: 'opacity 0.3s',
                }}
              >
                {currentWidth}px
              </div>

              <ResizeHandle side="left" />
              <ResizeHandle side="right" />
            </>
          )}
        </div>
      </div>
    </div>
  );
});
