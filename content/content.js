(() => {
  "use strict";

  const INSTANCE_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const GLOBAL_CLEANUP_KEY = "__autotocCleanup";
  const ROOT_SELECTOR = ".autotoc-root";

  if (typeof window[GLOBAL_CLEANUP_KEY] === "function") {
    try {
      window[GLOBAL_CLEANUP_KEY]();
    } catch (error) {
      console.error("[AutoToC] Failed to cleanup previous instance", error);
    }
  }

  const SELECTORS = {
    userMessage: '[data-message-author-role="user"]',
    assistantMessage: '[data-message-author-role="assistant"]',
    conversationTurn: '[data-testid^="conversation-turn-"]',
    markdownBody: ".markdown, .prose",
    streamingIndicator: 'button[aria-label="Stop generating"], [data-testid="stop-button"], .result-streaming',
    streamingResult: ".result-streaming",
    codeBlock: "pre, code"
  };

  const COLLAPSED_ITEM_HEIGHT = 20;
  const COLLAPSED_HEIGHT_LIMIT_RATIO = 0.8;
  const QA_ACTIVATION_OFFSET_PX = 88;
  const QUESTION_SCROLL_MARGIN_PX = 88;
  const COLLAPSED_HEADING_MIN_SCROLL_GAP = 48;
  const NATIVE_MINIMAP_MIN_BARS = 5;
  const NATIVE_MINIMAP_HIDDEN_ATTR = "data-autotoc-hidden-native-minimap";
  const NATIVE_MINIMAP_SCAN_DELAY_MS = 120;

  function createDefaultState() {
    return {
      conversationId: null,
      qaBlocks: [],
      qaCache: new Map(),
      activeQAIndex: -1,
      activeQAKey: null,
      activeHeadingIndex: -1,
      scrollContainer: null,
      conversationContainer: null,
      root: null,
      collapsed: null,
      panel: null,
      observers: [],
      mutationObserver: null,
      mutationObserverTarget: null,
      intervals: [],
      timeouts: [],
      scrollHandler: null,
      resizeHandler: null,
      currentUrl: window.location.href,
      initialized: false,
      rebuilding: false,
      renderTimeout: null,
      nativeMinimapObserver: null,
      nativeMinimapScanTimeout: null,
      hiddenNativeMinimapElements: new Set(),
      nextFallbackOrder: 0
    };
  }

  const state = createDefaultState();
  let navigationPatched = false;
  let bootTimeout = null;
  let navigationPollId = null;
  let navigationHandler = null;
  let initializationRunId = 0;

  function removeForeignRoots() {
    for (const root of document.querySelectorAll(ROOT_SELECTOR)) {
      if (root === state.root) continue;
      root.remove();
    }
  }

  function resetState() {
    Object.assign(state, createDefaultState());
  }

  function extractConversationId() {
    const match = window.location.pathname.match(/\/c\/([^/?#]+)/);
    return match ? match[1] : null;
  }

  function rememberTimeout(timeoutId) {
    state.timeouts.push(timeoutId);
    return timeoutId;
  }

  function rememberInterval(intervalId) {
    state.intervals.push(intervalId);
    return intervalId;
  }

  function debounce(fn, delay) {
    let timeoutId = null;
    return (...args) => {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
      timeoutId = rememberTimeout(window.setTimeout(() => {
        timeoutId = null;
        fn(...args);
      }, delay));
    };
  }

  function getScrollTop(scrollContainer = state.scrollContainer) {
    if (!scrollContainer) return 0;
    if (scrollContainer === document.documentElement || scrollContainer === document.body) {
      return window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
    }
    return scrollContainer.scrollTop;
  }

  function scrollToY(y) {
    if (!Number.isFinite(y)) return;

    if (
      state.scrollContainer === document.documentElement ||
      state.scrollContainer === document.body ||
      state.scrollContainer === document.scrollingElement
    ) {
      window.scrollTo({ top: y, behavior: "smooth" });
      return;
    }

    state.scrollContainer?.scrollTo?.({ top: y, behavior: "smooth" });
  }

  function getElementTopRelativeToScrollContainer(element, scrollContainer) {
    if (!element || !scrollContainer) return 0;
    const elementRect = element.getBoundingClientRect();
    if (
      scrollContainer === document.documentElement ||
      scrollContainer === document.body ||
      scrollContainer === document.scrollingElement
    ) {
      return elementRect.top + getScrollTop(scrollContainer);
    }

    const containerRect = scrollContainer.getBoundingClientRect();
    return elementRect.top - containerRect.top + getScrollTop(scrollContainer);
  }

  function discoverScrollContainer() {
    const firstMessage = document.querySelector(SELECTORS.userMessage);
    let candidate = firstMessage;

    while (candidate && candidate !== document.body) {
      const style = window.getComputedStyle(candidate);
      const canScroll = candidate.scrollHeight > candidate.clientHeight;
      const overflowScrolls = style.overflowY === "auto" || style.overflowY === "scroll";
      if (canScroll && overflowScrolls) {
        return candidate;
      }
      candidate = candidate.parentElement;
    }

    return document.scrollingElement || document.documentElement;
  }

  function findCommonAncestor(elements) {
    if (!elements.length) return null;

    let candidate = elements[0];
    while (candidate && candidate !== document.documentElement) {
      if (elements.every((element) => candidate.contains(element))) {
        return candidate;
      }
      candidate = candidate.parentElement;
    }

    return null;
  }

  function findConversationContainer(userMessages) {
    const main = document.querySelector("main");
    if (main && (!userMessages.length || userMessages.every((element) => main.contains(element)))) {
      return main;
    }

    if (userMessages.length <= 1) {
      return document.body || document.documentElement;
    }

    const commonAncestor = findCommonAncestor(userMessages);
    return commonAncestor || document.body || document.documentElement;
  }

  function getMessageSearchRoot() {
    const main = document.querySelector("main");
    return main || document.body || document.documentElement;
  }

  function isInsideCodeBlock(headingElement) {
    return Boolean(headingElement.closest(SELECTORS.codeBlock));
  }

  function normalizeText(text, maxLength) {
    const normalized = (text || "").replace(/\s+/g, " ").trim();
    return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized;
  }

  function getQuestionText(userMessageElement) {
    return normalizeText(userMessageElement?.textContent, 240) || "Question";
  }

  function hashString(value) {
    let hash = 0;
    for (let index = 0; index < value.length; index += 1) {
      hash = ((hash << 5) - hash) + value.charCodeAt(index);
      hash |= 0;
    }
    return Math.abs(hash).toString(36);
  }

  function getTurnNumber(element) {
    const turnElement = element?.closest?.(SELECTORS.conversationTurn);
    const testId = turnElement?.getAttribute?.("data-testid") || "";
    const match = testId.match(/conversation-turn-(\d+)/);
    return match ? Number(match[1]) : null;
  }

  function getQuestionKey(questionElement) {
    const turnNumber = getTurnNumber(questionElement);
    if (Number.isFinite(turnNumber)) return `turn:${turnNumber}`;

    const messageIdElement = questionElement?.closest?.("[data-message-id]");
    const messageId = messageIdElement?.getAttribute?.("data-message-id");
    if (messageId) return `message:${messageId}`;

    return `text:${hashString(getQuestionText(questionElement))}`;
  }

  function getQuestionOrder(questionElement, key) {
    const turnNumber = getTurnNumber(questionElement);
    if (Number.isFinite(turnNumber)) return turnNumber;

    const cachedBlock = state.qaCache.get(key);
    if (cachedBlock) return cachedBlock.order;

    state.nextFallbackOrder += 1;
    return state.nextFallbackOrder;
  }

  function collectAnswerElementsBetween(currentQuestion, nextQuestion) {
    return Array.from(getMessageSearchRoot().querySelectorAll(SELECTORS.assistantMessage)).filter((answerElement) => {
      const followsQuestion = Boolean(
        currentQuestion.compareDocumentPosition(answerElement) & Node.DOCUMENT_POSITION_FOLLOWING
      );
      const precedesNextQuestion = !nextQuestion || Boolean(
        answerElement.compareDocumentPosition(nextQuestion) & Node.DOCUMENT_POSITION_FOLLOWING
      );

      return followsQuestion && precedesNextQuestion;
    });
  }

  function extractHeadingsFromAnswers(answerElements) {
    const headings = [];

    for (const answerElement of answerElements) {
      const searchRoots = answerElement.querySelectorAll(SELECTORS.markdownBody).length
        ? answerElement.querySelectorAll(SELECTORS.markdownBody)
        : [answerElement];

      for (const root of searchRoots) {
        for (const headingElement of root.querySelectorAll("h1, h2, h3, h4, h5, h6")) {
          if (isInsideCodeBlock(headingElement)) continue;
          if (headingElement.closest(SELECTORS.userMessage)) continue;

          const text = normalizeText(headingElement.textContent, 200);
          if (!text) continue;

          headings.push({
            level: Number(headingElement.tagName.slice(1)),
            text,
            element: headingElement,
            y: getElementTopRelativeToScrollContainer(headingElement, state.scrollContainer)
          });
        }
      }
    }

    return headings;
  }

  function sanitizeCachedBlock(qaBlock) {
    if (qaBlock.questionElement && !qaBlock.questionElement.isConnected) {
      qaBlock.questionElement = null;
    }

    qaBlock.answerElements = (qaBlock.answerElements || []).filter((element) => element.isConnected);
    qaBlock.headings = (qaBlock.headings || []).map((heading) => ({
      ...heading,
      element: heading.element?.isConnected ? heading.element : null
    }));
  }

  function sortQABlocks(left, right) {
    if (left.order !== right.order) return left.order - right.order;
    return left.startY - right.startY;
  }

  function refreshQABlocksFromCache() {
    state.qaBlocks = Array.from(state.qaCache.values())
      .map((qaBlock) => {
        sanitizeCachedBlock(qaBlock);
        return qaBlock;
      })
      .sort(sortQABlocks)
      .map((qaBlock, index) => ({
        ...qaBlock,
        index
      }));
  }

  function pruneCachedBlocksAfter(order, keepKey) {
    let removed = false;
    for (const [key, qaBlock] of state.qaCache.entries()) {
      if (key !== keepKey && qaBlock.order > order) {
        removed = true;
        state.qaCache.delete(key);
      }
    }

    if (!removed) return false;
    refreshQABlocksFromCache();
    return true;
  }

  function parseQABlocks() {
    const userMessages = Array.from(getMessageSearchRoot().querySelectorAll(SELECTORS.userMessage));
    const seenKeys = new Set();
    state.scrollContainer = discoverScrollContainer();
    state.conversationContainer = findConversationContainer(userMessages);

    for (const [visibleIndex, questionElement] of userMessages.entries()) {
      const nextQuestion = userMessages[visibleIndex + 1] || null;
      const key = getQuestionKey(questionElement);
      const cachedBlock = state.qaCache.get(key);
      const answerElements = collectAnswerElementsBetween(questionElement, nextQuestion);
      const headings = extractHeadingsFromAnswers(answerElements);
      const startY = getElementTopRelativeToScrollContainer(questionElement, state.scrollContainer);
      const endY = nextQuestion
        ? getElementTopRelativeToScrollContainer(nextQuestion, state.scrollContainer)
        : state.scrollContainer.scrollHeight;
      const cachedHeadings = cachedBlock?.headings || [];
      const shouldUseFreshHeadings = answerElements.length > 0 || headings.length > 0 || !cachedBlock;

      seenKeys.add(key);
      state.qaCache.set(key, {
        key,
        order: getQuestionOrder(questionElement, key),
        questionElement,
        questionText: getQuestionText(questionElement),
        answerElements,
        headings: shouldUseFreshHeadings ? headings : cachedHeadings,
        startY,
        endY,
        isMounted: true,
        isStreaming: false,
        pollingInterval: null,
        lastSeenAt: Date.now()
      });
    }

    for (const [key, qaBlock] of state.qaCache.entries()) {
      if (seenKeys.has(key)) continue;
      qaBlock.isMounted = false;
      qaBlock.isStreaming = false;
      qaBlock.pollingInterval = null;
      qaBlock.questionElement = qaBlock.questionElement?.isConnected ? qaBlock.questionElement : null;
      qaBlock.answerElements = [];
      sanitizeCachedBlock(qaBlock);
    }

    refreshQABlocksFromCache();
    markStreamingBlock();

  }

  function filterHeadings(headings) {
    if (headings.length <= 0) return [];
    if (headings.length <= 10) return headings;

    return headings.filter((heading) => heading.level <= 4);
  }

  function hasTightHeadingSpacing(headings) {
    const headingPositions = headings
      .map((heading) => Math.round(heading.y))
      .filter((position) => Number.isFinite(position))
      .sort((left, right) => left - right);

    for (let index = 1; index < headingPositions.length; index += 1) {
      if (headingPositions[index] - headingPositions[index - 1] < COLLAPSED_HEADING_MIN_SCROLL_GAP) {
        return true;
      }
    }

    return false;
  }

  function getCollapsedHeadingMode(headings) {
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    const collapsedItemCount = state.qaBlocks.length + headings.length;
    const fitsViewport = collapsedItemCount * COLLAPSED_ITEM_HEIGHT <= viewportHeight * COLLAPSED_HEIGHT_LIMIT_RATIO;
    if (!fitsViewport) {
      return "summary";
    }

    if (hasTightHeadingSpacing(headings)) {
      return "summary";
    }

    return "detailed";
  }

  function ensureRoot() {
    removeForeignRoots();
    if (state.root?.isConnected && state.collapsed?.isConnected && state.panel?.isConnected) return;

    const root = document.createElement("div");
    root.className = "autotoc-root is-empty";
    root.dataset.autotocInstance = INSTANCE_ID;

    const hoverZone = document.createElement("div");
    hoverZone.className = "autotoc-hover-zone";

    const collapsed = document.createElement("div");
    collapsed.className = "autotoc-collapsed";
    collapsed.setAttribute("aria-hidden", "true");

    const panel = document.createElement("div");
    panel.className = "autotoc-panel";
    panel.setAttribute("role", "navigation");
    panel.setAttribute("aria-label", "Conversation table of contents");

    hoverZone.append(collapsed, panel);
    root.append(hoverZone);
    document.documentElement.append(root);

    state.root = root;
    state.collapsed = collapsed;
    state.panel = panel;
    syncViewportCenter();
  }

  function syncViewportCenter() {
    if (!state.root) return;
    state.root.style.top = `${Math.round(window.innerHeight / 2)}px`;
  }

  function isAutoToCElement(element) {
    return Boolean(element?.closest?.(ROOT_SELECTOR));
  }

  function isElementVisiblyRendered(element, rect = element.getBoundingClientRect()) {
    if (!element || !rect.width || !rect.height) return false;

    const style = window.getComputedStyle(element);
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      style.opacity !== "0" &&
      rect.bottom > 0 &&
      rect.right > 0 &&
      rect.top < (window.innerHeight || document.documentElement.clientHeight || 0) &&
      rect.left < (window.innerWidth || document.documentElement.clientWidth || 0)
    );
  }

  function isRightRailOverlayCandidate(element, rect) {
    if (!(element instanceof HTMLElement)) return false;
    if (element === document.body || element === document.documentElement) return false;
    if (isAutoToCElement(element)) return false;
    if (element.hasAttribute(NATIVE_MINIMAP_HIDDEN_ATTR)) return false;
    if (!isElementVisiblyRendered(element, rect)) return false;

    const style = window.getComputedStyle(element);
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    const isOverlayPosition = style.position === "fixed" || style.position === "sticky" || style.position === "absolute";
    const nearRightEdge = rect.right >= viewportWidth - 8 || rect.left >= viewportWidth - 180;
    const narrowEnough = rect.width >= 8 && rect.width <= 180;
    const overlapsViewportMiddle = rect.top < viewportHeight * 0.9 && rect.bottom > viewportHeight * 0.1;
    const text = normalizeText(element.textContent, 80);

    return isOverlayPosition && nearRightEdge && narrowEnough && overlapsViewportMiddle && text.length <= 12;
  }

  function isNativeMinimapBarElement(element) {
    if (!(element instanceof HTMLElement)) return false;
    if (isAutoToCElement(element)) return false;
    if (element.querySelector("svg, img, input, textarea, select")) return false;

    const rect = element.getBoundingClientRect();
    if (!isElementVisiblyRendered(element, rect)) return false;
    if (normalizeText(element.textContent, 20)) return false;

    const horizontalBar = (
      rect.width >= 4 &&
      rect.width <= 120 &&
      rect.height >= 2 &&
      rect.height <= 18 &&
      rect.width >= rect.height * 1.35
    );
    const verticalBar = (
      rect.width >= 2 &&
      rect.width <= 16 &&
      rect.height >= 8 &&
      rect.height <= 90 &&
      rect.height >= rect.width * 1.35
    );

    return horizontalBar || verticalBar;
  }

  function collectNativeMinimapCandidates() {
    const candidates = [];
    const elements = Array.from(document.body?.querySelectorAll("aside, nav, ol, ul, section, div") || []);

    for (const element of elements) {
      const rect = element.getBoundingClientRect();
      if (!isRightRailOverlayCandidate(element, rect)) continue;

      const bars = Array.from(element.querySelectorAll("*")).filter(isNativeMinimapBarElement);
      if (bars.length < NATIVE_MINIMAP_MIN_BARS) continue;

      const distinctYPositions = new Set(
        bars.map((bar) => Math.round(bar.getBoundingClientRect().top / 4))
      );
      if (distinctYPositions.size < NATIVE_MINIMAP_MIN_BARS) continue;

      candidates.push({
        element,
        barCount: bars.length,
        area: rect.width * rect.height,
        rect
      });
    }

    candidates.sort((left, right) => left.area - right.area);
    return candidates;
  }

  function suppressNativeRightRailMinimap() {
    if (!document.body) return;

    const selectedCandidates = [];
    for (const candidate of collectNativeMinimapCandidates()) {
      const overlapsSelected = selectedCandidates.some((selected) => (
        selected.element.contains(candidate.element) || candidate.element.contains(selected.element)
      ));
      if (!overlapsSelected) {
        selectedCandidates.push(candidate);
      }
    }

    if (!selectedCandidates.length) return;

    for (const candidate of selectedCandidates) {
      candidate.element.setAttribute(NATIVE_MINIMAP_HIDDEN_ATTR, INSTANCE_ID);
      candidate.element.style.setProperty("display", "none", "important");
      candidate.element.style.setProperty("visibility", "hidden", "important");
      candidate.element.style.setProperty("pointer-events", "none", "important");
      state.hiddenNativeMinimapElements.add(candidate.element);
    }

  }

  function scheduleNativeMinimapSuppression() {
    if (state.nativeMinimapScanTimeout !== null) {
      clearTimeout(state.nativeMinimapScanTimeout);
    }

    state.nativeMinimapScanTimeout = rememberTimeout(window.setTimeout(() => {
      state.nativeMinimapScanTimeout = null;
      suppressNativeRightRailMinimap();
    }, NATIVE_MINIMAP_SCAN_DELAY_MS));
  }

  function setupNativeMinimapSuppression() {
    if (state.nativeMinimapObserver || !document.body) return;

    const observer = new MutationObserver((mutations) => {
      if (mutations.some((mutation) => mutation.type === "childList")) {
        scheduleNativeMinimapSuppression();
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    state.nativeMinimapObserver = observer;
    state.observers.push(observer);
    scheduleNativeMinimapSuppression();
  }

  function restoreHiddenNativeMinimapElements() {
    for (const element of state.hiddenNativeMinimapElements) {
      if (!element.isConnected) continue;
      if (element.getAttribute(NATIVE_MINIMAP_HIDDEN_ATTR) !== INSTANCE_ID) continue;

      element.removeAttribute(NATIVE_MINIMAP_HIDDEN_ATTR);
      element.style.removeProperty("display");
      element.style.removeProperty("visibility");
      element.style.removeProperty("pointer-events");
    }

    state.hiddenNativeMinimapElements.clear();
  }

  function createCollapsedQuestionItem(qaBlock) {
    const item = document.createElement("div");
    item.className = "autotoc-item";
    item.dataset.qaKey = qaBlock.key;

    const icon = document.createElement("div");
    icon.className = qaBlock.isStreaming ? "autotoc-spinner" : "autotoc-icon";

    item.addEventListener("click", () => scrollToBlock(qaBlock));
    item.append(icon);
    return item;
  }

  function createPanelQuestionItem(qaBlock) {
    const item = document.createElement("div");
    item.className = "autotoc-item";
    item.dataset.qaKey = qaBlock.key;

    const label = document.createElement("div");
    label.className = "autotoc-label";
    label.textContent = qaBlock.questionText;
    label.title = qaBlock.questionText;

    item.addEventListener("click", () => scrollToBlock(qaBlock));
    item.append(label);

    if (qaBlock.isStreaming) {
      const spinner = document.createElement("div");
      spinner.className = "autotoc-spinner";
      spinner.setAttribute("aria-hidden", "true");
      item.append(spinner);
    }

    return item;
  }

  function createCollapsedHeadingItem(heading, headingIndex) {
    const item = document.createElement("div");
    item.className = "autotoc-toc-item";
    item.dataset.heading = String(headingIndex);
    item.dataset.level = String(heading.level);

    const dash = document.createElement("div");
    dash.className = "autotoc-dash";

    item.addEventListener("click", (event) => {
      event.stopPropagation();
      scrollToHeading(heading);
    });

    item.append(dash);
    return item;
  }

  function createCollapsedHeadingSummaryItem(headings) {
    const item = document.createElement("div");
    item.className = "autotoc-toc-summary-item";
    item.title = "Show current answer table of contents";

    const icon = document.createElement("div");
    icon.className = "autotoc-list-icon";
    icon.setAttribute("aria-hidden", "true");

    for (let index = 0; index < 3; index += 1) {
      const bar = document.createElement("div");
      bar.className = "autotoc-list-icon-bar";
      icon.append(bar);
    }

    item.addEventListener("click", (event) => {
      event.stopPropagation();
      scrollToHeading(headings[0]);
    });

    item.append(icon);
    return item;
  }

  function createPanelHeadingItem(heading, headingIndex) {
    const item = document.createElement("div");
    item.className = "autotoc-toc-item";
    item.dataset.heading = String(headingIndex);
    item.dataset.level = String(heading.level);

    const label = document.createElement("div");
    label.className = "autotoc-toc-label";
    label.textContent = heading.text;
    label.title = heading.text;

    item.addEventListener("click", (event) => {
      event.stopPropagation();
      scrollToHeading(heading);
    });

    item.append(label);
    return item;
  }

  function renderUI() {
    ensureRoot();
    state.collapsed.replaceChildren();
    state.panel.replaceChildren();
    state.root.classList.toggle("is-empty", state.qaBlocks.length === 0);
    for (const qaBlock of state.qaBlocks) {
      state.collapsed.append(createCollapsedQuestionItem(qaBlock));
      state.panel.append(createPanelQuestionItem(qaBlock));

      if (qaBlock.key === state.activeQAKey && !qaBlock.isStreaming) {
        const filteredHeadings = filterHeadings(qaBlock.headings);
        if (filteredHeadings.length) {
          const collapsedTocGroup = document.createElement("div");
          collapsedTocGroup.className = "autotoc-toc-group";
          const panelTocGroup = document.createElement("div");
          panelTocGroup.className = "autotoc-toc-group";
          const collapsedHeadingMode = getCollapsedHeadingMode(filteredHeadings);

          if (collapsedHeadingMode === "summary") {
            collapsedTocGroup.append(createCollapsedHeadingSummaryItem(filteredHeadings));
          }

          for (const heading of filteredHeadings) {
            const originalIndex = qaBlock.headings.indexOf(heading);
            if (collapsedHeadingMode === "detailed") {
              collapsedTocGroup.append(createCollapsedHeadingItem(heading, originalIndex));
            }
            panelTocGroup.append(createPanelHeadingItem(heading, originalIndex));
          }

          state.collapsed.append(collapsedTocGroup);
          state.panel.append(panelTocGroup);
        }
      }
    }

    renderActiveState();
    syncViewportCenter();
    suppressNativeRightRailMinimap();
  }

  function renderActiveState() {
    removeForeignRoots();
    if (!state.root) return;

    for (const element of state.root.querySelectorAll(".is-active")) {
      element.classList.remove("is-active");
    }

    for (const activeQAItem of state.root.querySelectorAll(".autotoc-item")) {
      if (activeQAItem.dataset.qaKey === state.activeQAKey) {
        activeQAItem.classList.add("is-active");
      }
    }

    if (state.activeHeadingIndex >= 0) {
      for (const activeHeadingItem of state.root.querySelectorAll(`.autotoc-toc-item[data-heading="${state.activeHeadingIndex}"]`)) {
        activeHeadingItem.classList.add("is-active");
      }
    }
  }

  function scheduleActiveQARender() {
    if (state.renderTimeout !== null) {
      clearTimeout(state.renderTimeout);
    }

    state.renderTimeout = rememberTimeout(window.setTimeout(() => {
      state.renderTimeout = null;
      renderUI();
    }, 50));
  }

  function updateActiveFromScroll() {
    if (!state.scrollContainer || !state.qaBlocks.length) {
      state.activeQAIndex = -1;
      state.activeQAKey = null;
      state.activeHeadingIndex = -1;
      renderActiveState();
      return;
    }

    const referenceY = getScrollTop();
    const qaReferenceY = referenceY + QA_ACTIVATION_OFFSET_PX;
    const previousQAIndex = state.activeQAIndex;
    const previousQAKey = state.activeQAKey;
    const previousHeadingIndex = state.activeHeadingIndex;
    let nextQAIndex = -1;
    let nextQAKey = null;

    for (let index = state.qaBlocks.length - 1; index >= 0; index -= 1) {
      if (qaReferenceY >= state.qaBlocks[index].startY - 1) {
        nextQAIndex = state.qaBlocks[index].index;
        nextQAKey = state.qaBlocks[index].key;
        break;
      }
    }

    if (nextQAKey === null && state.qaBlocks.length) {
      const firstBlock = state.qaBlocks[0];
      if (referenceY <= firstBlock.startY) {
        nextQAIndex = firstBlock.index;
        nextQAKey = firstBlock.key;
      }
    }

    state.activeQAIndex = nextQAIndex;
    state.activeQAKey = nextQAKey;
    const activeBlock = state.qaBlocks.find((qaBlock) => qaBlock.key === nextQAKey);
    let nextHeadingIndex = -1;

    if (activeBlock) {
      for (let index = activeBlock.headings.length - 1; index >= 0; index -= 1) {
        const heading = activeBlock.headings[index];
        const headingY = heading.element
          ? getElementTopRelativeToScrollContainer(heading.element, state.scrollContainer)
          : heading.y;
        if (referenceY >= headingY - 1) {
          nextHeadingIndex = index;
          break;
        }
      }
    }

    state.activeHeadingIndex = nextHeadingIndex;
    if (previousQAKey !== state.activeQAKey || previousQAIndex !== state.activeQAIndex) {
      scheduleActiveQARender();
    } else if (previousHeadingIndex !== state.activeHeadingIndex) {
      renderActiveState();
    }
  }

  function setupScrollTracking() {
    if (!state.scrollContainer) return;

    let ticking = false;
    state.scrollHandler = () => {
      if (ticking) return;
      window.requestAnimationFrame(() => {
        updateActiveFromScroll();
        ticking = false;
      });
      ticking = true;
    };

    state.scrollContainer.addEventListener("scroll", state.scrollHandler, { passive: true });
    updateActiveFromScroll();
  }

  function setupViewportCenterTracking() {
    if (state.resizeHandler) return;

    state.resizeHandler = () => {
      syncViewportCenter();
    };

    window.addEventListener("resize", state.resizeHandler, { passive: true });
    syncViewportCenter();
  }

  function scrollToElementOrY(element, y) {
    if (element?.isConnected) {
      element.scrollIntoView?.({ behavior: "smooth", block: "start" });
      return;
    }

    scrollToY(y);
  }

  function activateBlock(qaBlock, headingIndex = -1) {
    state.activeQAIndex = qaBlock.index;
    state.activeQAKey = qaBlock.key;
    state.activeHeadingIndex = headingIndex;
    renderUI();
  }

  function scrollToBlock(qaBlock) {
    const blockY = qaBlock.questionElement?.isConnected
      ? getElementTopRelativeToScrollContainer(qaBlock.questionElement, state.scrollContainer)
      : qaBlock.startY;
    const targetY = Math.max(0, blockY - QUESTION_SCROLL_MARGIN_PX);
    activateBlock(qaBlock);
    scrollToY(targetY);
  }

  function scrollToHeading(heading) {
    scrollToElementOrY(heading.element, heading.y);
  }

  function hasStreamingIndicator() {
    return Boolean(document.querySelector(SELECTORS.streamingIndicator));
  }

  function findBlockForAnswer(answerElement) {
    if (!answerElement) return null;

    const directBlock = state.qaBlocks.find((qaBlock) => (
      qaBlock.answerElements.some((element) => element === answerElement || element.contains(answerElement))
    ));
    if (directBlock) return directBlock;

    for (let index = state.qaBlocks.length - 1; index >= 0; index -= 1) {
      const questionElement = state.qaBlocks[index].questionElement;
      if (!questionElement) continue;
      const followsQuestion = Boolean(
        questionElement.compareDocumentPosition(answerElement) & Node.DOCUMENT_POSITION_FOLLOWING
      );
      if (followsQuestion) return state.qaBlocks[index];
    }

    return null;
  }

  function findStreamingBlock() {
    const streamingElement = document.querySelector(SELECTORS.streamingResult);
    const streamingAnswer = streamingElement?.closest?.(SELECTORS.assistantMessage) || streamingElement;
    const streamingBlock = findBlockForAnswer(streamingAnswer);
    if (streamingBlock) return streamingBlock;

    return hasStreamingIndicator() ? state.qaBlocks[state.qaBlocks.length - 1] : null;
  }

  function markStreamingBlock() {
    if (!state.qaBlocks.length) return;

    const streamingBlock = findStreamingBlock();
    if (!streamingBlock) return;

    pruneCachedBlocksAfter(streamingBlock.order, streamingBlock.key);
    const currentStreamingBlock = state.qaBlocks.find((qaBlock) => qaBlock.key === streamingBlock.key) || streamingBlock;

    currentStreamingBlock.isStreaming = true;
    currentStreamingBlock.headings = [];
    startStreamingPoll(currentStreamingBlock.key);
  }

  function startStreamingPoll(qaKey) {
    const qaBlock = state.qaCache.get(qaKey);
    if (!qaBlock || qaBlock.pollingInterval !== null) return;

    const pollId = rememberInterval(window.setInterval(() => {
      const isStillStreaming = hasStreamingIndicator();
      if (isStillStreaming) return;

      clearInterval(pollId);
      qaBlock.pollingInterval = null;
      qaBlock.isStreaming = false;
      rebuild();
    }, 800));

    qaBlock.pollingInterval = pollId;
  }

  const debouncedRebuild = debounce(() => {
    rebuild();
  }, 300);

  function setupMutationObserver() {
    const target = state.conversationContainer || document.querySelector("main") || document.body;
    if (state.mutationObserver && state.mutationObserverTarget === target) return;

    if (state.mutationObserver) {
      state.mutationObserver.disconnect();
      state.observers = state.observers.filter((observer) => observer !== state.mutationObserver);
      state.mutationObserver = null;
      state.mutationObserverTarget = null;
    }

    const observer = new MutationObserver((mutations) => {
      if (mutations.some((mutation) => mutation.type === "childList" || mutation.type === "characterData")) {
        scheduleNativeMinimapSuppression();
        debouncedRebuild();
      }
    });

    observer.observe(target, {
      childList: true,
      subtree: true,
      characterData: true
    });

    state.mutationObserver = observer;
    state.mutationObserverTarget = target;
    state.observers.push(observer);
  }

  function setupTemporaryBodyObserver() {
    const observer = new MutationObserver((mutations) => {
      if (mutations.some((mutation) => mutation.type === "childList" || mutation.type === "characterData")) {
        scheduleNativeMinimapSuppression();
        debouncedRebuild();
      }
    });

    observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true
    });

    state.observers.push(observer);

    rememberTimeout(window.setTimeout(() => {
      observer.disconnect();
      state.observers = state.observers.filter((entry) => entry !== observer);
    }, 5000));
  }

  function cleanupRuntime({ disposeNavigation = false } = {}) {
    initializationRunId += 1;

    for (const observer of state.observers) {
      observer.disconnect();
    }

    for (const intervalId of state.intervals) {
      clearInterval(intervalId);
    }

    for (const timeoutId of state.timeouts) {
      clearTimeout(timeoutId);
    }

    if (state.scrollContainer && state.scrollHandler) {
      state.scrollContainer.removeEventListener("scroll", state.scrollHandler);
    }

    if (state.resizeHandler) {
      window.removeEventListener("resize", state.resizeHandler);
    }

    if (disposeNavigation) {
      if (navigationHandler) {
        window.removeEventListener("popstate", navigationHandler);
        window.removeEventListener("hashchange", navigationHandler);
        window.removeEventListener("autotoc:navigation", navigationHandler);
        navigationHandler = null;
      }

      if (navigationPollId !== null) {
        clearInterval(navigationPollId);
        navigationPollId = null;
      }
    }

    restoreHiddenNativeMinimapElements();
    state.root?.remove();
    resetState();
  }

  function rebuild() {
    if (state.rebuilding) return;
    state.rebuilding = true;
    for (const intervalId of state.intervals) {
      clearInterval(intervalId);
    }
    state.intervals = [];

    const previousScrollContainer = state.scrollContainer;
    const previousScrollHandler = state.scrollHandler;
    if (previousScrollContainer && previousScrollHandler) {
      previousScrollContainer.removeEventListener("scroll", previousScrollHandler);
    }
    state.scrollHandler = null;

    parseQABlocks();
    setupNativeMinimapSuppression();
    setupMutationObserver();
    updateActiveFromScroll();
    renderUI();
    setupScrollTracking();
    setupViewportCenterTracking();

    state.rebuilding = false;
  }

  function waitForConversationContent() {
    return new Promise((resolve) => {
      if (document.querySelector(SELECTORS.userMessage)) {
        resolve(true);
        return;
      }

      const startedAt = Date.now();
      const pollId = window.setInterval(() => {
        if (document.querySelector(SELECTORS.userMessage)) {
          clearInterval(pollId);
          resolve(true);
          return;
        }

        if (Date.now() - startedAt >= 10000) {
          clearInterval(pollId);
          resolve(false);
        }
      }, 300);
    });
  }

  async function initialize() {
    if (state.initialized) return;

    const runId = initializationRunId + 1;
    initializationRunId = runId;
    state.initialized = true;
    state.conversationId = extractConversationId();
    ensureRoot();
    setupNativeMinimapSuppression();
    suppressNativeRightRailMinimap();

    await waitForConversationContent();
    if (runId !== initializationRunId) return;

    parseQABlocks();
    updateActiveFromScroll();
    renderUI();
    setupScrollTracking();
    setupViewportCenterTracking();
    setupMutationObserver();
    setupTemporaryBodyObserver();
  }

  function scheduleRestart() {
    if (bootTimeout !== null) {
      clearTimeout(bootTimeout);
    }

    cleanupRuntime();

    bootTimeout = window.setTimeout(() => {
      bootTimeout = null;
      initialize();
    }, 500);
  }

  function setupNavigationListener() {
    if (navigationPatched) return;
    navigationPatched = true;

    const onNavigation = () => {
      if (window.location.href === state.currentUrl) return;
      state.currentUrl = window.location.href;
      scheduleRestart();
    };

    for (const method of ["pushState", "replaceState"]) {
      const original = history[method];
      history[method] = function patchedHistoryMethod(...args) {
        const result = original.apply(this, args);
        window.dispatchEvent(new Event("autotoc:navigation"));
        return result;
      };
    }

    window.addEventListener("popstate", onNavigation);
    window.addEventListener("hashchange", onNavigation);
    window.addEventListener("autotoc:navigation", onNavigation);
    navigationHandler = onNavigation;

    navigationPollId = window.setInterval(onNavigation, 500);
  }

  const cleanupCurrentInstance = () => {
    cleanupRuntime({ disposeNavigation: true });
    if (window[GLOBAL_CLEANUP_KEY] === cleanupCurrentInstance) {
      delete window[GLOBAL_CLEANUP_KEY];
    }
  };

  window[GLOBAL_CLEANUP_KEY] = cleanupCurrentInstance;

  removeForeignRoots();
  setupNavigationListener();
  initialize();
})();
