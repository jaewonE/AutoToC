(() => {
  "use strict";

  const SELECTORS = {
    userMessage: '[data-message-author-role="user"]',
    assistantMessage: '[data-message-author-role="assistant"]',
    markdownBody: ".markdown, .prose",
    streamingIndicator: 'button[aria-label="Stop generating"], .result-streaming',
    codeBlock: "pre, code"
  };

  function createDefaultState() {
    return {
      conversationId: null,
      qaBlocks: [],
      activeQAIndex: -1,
      activeHeadingIndex: -1,
      scrollContainer: null,
      conversationContainer: null,
      root: null,
      collapsed: null,
      panel: null,
      observers: [],
      intervals: [],
      timeouts: [],
      scrollHandler: null,
      currentUrl: window.location.href,
      initialized: false,
      rebuilding: false,
      renderTimeout: null
    };
  }

  const state = createDefaultState();
  let navigationPatched = false;
  let bootTimeout = null;
  let navigationPollId = null;
  let initializationRunId = 0;

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

  function getElementTopRelativeToScrollContainer(element, scrollContainer) {
    if (!element || !scrollContainer) return 0;
    const elementRect = element.getBoundingClientRect();
    const containerRect = scrollContainer.getBoundingClientRect();
    return elementRect.top - containerRect.top + scrollContainer.scrollTop;
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

  function findConversationContainer(userMessages) {
    if (!userMessages.length) {
      return document.querySelector("main") || document.body;
    }

    let candidate = userMessages[0].parentElement;
    while (candidate && candidate !== document.body) {
      const count = candidate.querySelectorAll(SELECTORS.userMessage).length;
      if (count === userMessages.length) {
        const nextParent = candidate.parentElement;
        const parentCount = nextParent?.querySelectorAll?.(SELECTORS.userMessage).length || 0;
        if (parentCount !== userMessages.length) {
          return candidate;
        }
      }
      candidate = candidate.parentElement;
    }

    return userMessages[0].parentElement || document.body;
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

  function collectAnswerElementsBetween(currentQuestion, nextQuestion) {
    return Array.from(document.querySelectorAll(SELECTORS.assistantMessage)).filter((answerElement) => {
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
            element: headingElement
          });
        }
      }
    }

    return headings;
  }

  function parseQABlocks() {
    const userMessages = Array.from(document.querySelectorAll(SELECTORS.userMessage));
    state.scrollContainer = discoverScrollContainer();
    state.conversationContainer = findConversationContainer(userMessages);

    state.qaBlocks = userMessages.map((questionElement, index) => {
      const nextQuestion = userMessages[index + 1] || null;
      const answerElements = collectAnswerElementsBetween(questionElement, nextQuestion);
      const startY = getElementTopRelativeToScrollContainer(questionElement, state.scrollContainer);
      const endY = nextQuestion
        ? getElementTopRelativeToScrollContainer(nextQuestion, state.scrollContainer)
        : state.scrollContainer.scrollHeight;

      return {
        index,
        questionElement,
        questionText: getQuestionText(questionElement),
        answerElements,
        headings: extractHeadingsFromAnswers(answerElements),
        startY,
        endY,
        isStreaming: false,
        pollingInterval: null
      };
    });

    markStreamingBlock();
  }

  function filterHeadings(headings) {
    if (headings.length <= 0) return [];
    if (headings.length <= 10) return headings;

    return headings.filter((heading) => heading.level <= 4);
  }

  function ensureRoot() {
    if (state.root?.isConnected && state.collapsed?.isConnected && state.panel?.isConnected) return;

    const root = document.createElement("div");
    root.className = "autotoc-root is-empty";

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
  }

  function createCollapsedQuestionItem(qaBlock) {
    const item = document.createElement("div");
    item.className = "autotoc-item";
    item.dataset.qa = String(qaBlock.index);

    const icon = document.createElement("div");
    icon.className = qaBlock.isStreaming ? "autotoc-spinner" : "autotoc-icon";

    item.addEventListener("click", () => scrollToElement(qaBlock.questionElement));
    item.append(icon);
    return item;
  }

  function createPanelQuestionItem(qaBlock) {
    const item = document.createElement("div");
    item.className = "autotoc-item";
    item.dataset.qa = String(qaBlock.index);

    const label = document.createElement("div");
    label.className = "autotoc-label";
    label.textContent = qaBlock.questionText;
    label.title = qaBlock.questionText;

    item.addEventListener("click", () => scrollToElement(qaBlock.questionElement));
    item.append(label);
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
      scrollToElement(heading.element);
    });

    item.append(dash);
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
      scrollToElement(heading.element);
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

      if (qaBlock.index === state.activeQAIndex && !qaBlock.isStreaming) {
        const filteredHeadings = filterHeadings(qaBlock.headings);
        if (filteredHeadings.length) {
          const collapsedTocGroup = document.createElement("div");
          collapsedTocGroup.className = "autotoc-toc-group";
          const panelTocGroup = document.createElement("div");
          panelTocGroup.className = "autotoc-toc-group";

          for (const heading of filteredHeadings) {
            const originalIndex = qaBlock.headings.indexOf(heading);
            collapsedTocGroup.append(createCollapsedHeadingItem(heading, originalIndex));
            panelTocGroup.append(createPanelHeadingItem(heading, originalIndex));
          }

          state.collapsed.append(collapsedTocGroup);
          state.panel.append(panelTocGroup);
        }
      }
    }

    renderActiveState();
  }

  function renderActiveState() {
    if (!state.root) return;

    for (const element of state.root.querySelectorAll(".is-active")) {
      element.classList.remove("is-active");
    }

    for (const activeQAItem of state.root.querySelectorAll(`.autotoc-item[data-qa="${state.activeQAIndex}"]`)) {
      activeQAItem.classList.add("is-active");
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
      state.activeHeadingIndex = -1;
      renderActiveState();
      return;
    }

    const referenceY = state.scrollContainer.scrollTop + (state.scrollContainer.clientHeight * 2 / 3);
    const previousQAIndex = state.activeQAIndex;
    const previousHeadingIndex = state.activeHeadingIndex;
    let nextQAIndex = -1;

    for (let index = state.qaBlocks.length - 1; index >= 0; index -= 1) {
      if (referenceY >= state.qaBlocks[index].startY) {
        nextQAIndex = state.qaBlocks[index].index;
        break;
      }
    }

    state.activeQAIndex = nextQAIndex;
    const activeBlock = state.qaBlocks[nextQAIndex];
    let nextHeadingIndex = -1;

    if (activeBlock) {
      for (let index = activeBlock.headings.length - 1; index >= 0; index -= 1) {
        const headingY = getElementTopRelativeToScrollContainer(activeBlock.headings[index].element, state.scrollContainer);
        if (referenceY >= headingY) {
          nextHeadingIndex = index;
          break;
        }
      }
    }

    state.activeHeadingIndex = nextHeadingIndex;

    if (previousQAIndex !== state.activeQAIndex) {
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

  function scrollToElement(element) {
    element?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  }

  function markStreamingBlock() {
    const isStreaming = Boolean(document.querySelector(SELECTORS.streamingIndicator));
    if (!isStreaming || !state.qaBlocks.length) return;

    const streamingBlock = state.qaBlocks[state.qaBlocks.length - 1];
    streamingBlock.isStreaming = true;
    streamingBlock.headings = [];
    startStreamingPoll(streamingBlock.index);
  }

  function startStreamingPoll(qaIndex) {
    const qaBlock = state.qaBlocks[qaIndex];
    if (!qaBlock || qaBlock.pollingInterval !== null) return;

    const pollId = rememberInterval(window.setInterval(() => {
      const isStillStreaming = Boolean(document.querySelector(SELECTORS.streamingIndicator));
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
    const observer = new MutationObserver((mutations) => {
      if (mutations.some((mutation) => mutation.type === "childList" || mutation.type === "characterData")) {
        debouncedRebuild();
      }
    });

    observer.observe(target, {
      childList: true,
      subtree: true,
      characterData: true
    });

    state.observers.push(observer);
  }

  function setupTemporaryBodyObserver() {
    const observer = new MutationObserver((mutations) => {
      if (mutations.some((mutation) => mutation.type === "childList" || mutation.type === "characterData")) {
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

  function cleanupRuntime() {
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
    updateActiveFromScroll();
    renderUI();
    setupScrollTracking();

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

    await waitForConversationContent();
    if (runId !== initializationRunId) return;

    parseQABlocks();
    updateActiveFromScroll();
    renderUI();
    setupScrollTracking();
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

    navigationPollId = window.setInterval(onNavigation, 500);
  }

  setupNavigationListener();
  initialize();
})();
