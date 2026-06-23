# AutoToC

AutoToC is a Chrome Manifest V3 extension that adds a hoverable table of contents sidebar to ChatGPT conversations.

It is designed for long technical chats where both the question history and the current answer structure matter. The collapsed rail stays on the right edge of the viewport, shows compact question markers, and adds heading markers for the currently active answer. Hovering the rail opens a readable navigation panel with question text and heading labels.

## Features

- Question navigation for the whole ChatGPT conversation.
- Active-answer heading navigation for `h1` through `h6` headings rendered by ChatGPT markdown.
- Compact collapsed rail with question dots and heading bars.
- Hover-expanded panel with readable question titles and heading labels.
- Click navigation for questions and headings.
- Streaming state detection with spinner markers while an answer is still being generated.
- Q&A caching so ChatGPT DOM virtualization does not remove older conversation markers from AutoToC.
- Independent panel scrolling with an 80dvh maximum height.
- Single-instance cleanup so extension reloads do not leave stale AutoToC roots behind.
- Native ChatGPT right-rail minimap suppression when it overlaps the AutoToC collapsed area.
- Verbose `[AutoToC]` console diagnostics for parsing, rendering, mutation handling, scroll activation, streaming state, and native minimap suppression.

## Installation

AutoToC currently ships as an unpacked local extension.

1. Clone this repository.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select this repository folder.
6. Open or reload `https://chatgpt.com/`.

There is no build step. Chrome loads `manifest.json`, `content/content.js`, and `content/content.css` directly.

## Usage

Open a ChatGPT conversation. AutoToC appears on the right edge when the page contains user messages.

- The collapsed rail shows one dot per cached question.
- The active question is highlighted.
- If the active answer contains headings, AutoToC shows heading bars under the active question.
- Hover the rail to open the full panel.
- Click a question in the rail or panel to jump to that question.
- Click a heading bar or heading label to jump to that heading.

When ChatGPT is generating a response, AutoToC marks the streaming answer with a spinner. Once streaming finishes, it rebuilds the Q&A and heading list.

## Heading Display Policy

AutoToC separates the expanded panel policy from the collapsed rail policy.

In the expanded panel:

- If the active answer has 10 or fewer headings, all headings are shown.
- If the active answer has more than 10 headings, only `h1` through `h4` headings are shown.

In the collapsed rail:

- Question dots remain visible for cached questions.
- Heading bars are shown only for the active answer.
- Each heading level uses a different bar length.
- The heading bars are replaced with a single three-bar ToC summary icon when detailed bars would become misleading or too large.

The summary icon is used in either of these cases:

- **Height limit:** `(cached question count + filtered active heading count) * 20px` would exceed `80%` of the viewport height.
- **Tight heading spacing:** adjacent active-heading scroll positions are less than `48px` apart.

The second rule explains a case that can look surprising: 16 headings separated by paragraph content can keep detailed collapsed bars, while 10 consecutive headings with no content between them can become a single summary icon. The trigger is not only the number of headings. AutoToC also checks the actual rendered scroll positions of adjacent headings. Consecutive markdown headings can be physically closer than `48px`, so the collapsed bars are summarized even though the 80% height limit has not been reached.

The expanded panel still keeps the heading list available, so the summary only affects the compact collapsed representation.

## Debugging

AutoToC logs diagnostics to the browser console with the `[AutoToC]` prefix.

To disable diagnostics on `chatgpt.com`, run:

```js
localStorage.setItem("autotocDebug", "0");
```

To re-enable diagnostics:

```js
localStorage.setItem("autotocDebug", "1");
```

Useful messages include:

- `parseQABlocks`: parsed and cached question blocks.
- `render`: rendered question and heading counts.
- `active state`: active question and heading selection.
- `collapsed headings summarized`: whether collapsed headings were summarized by height or tight spacing.
- `native right rail minimap suppressed`: ChatGPT native minimap elements hidden because they overlap AutoToC.

## Troubleshooting

If the sidebar does not appear:

- Confirm the page URL starts with `https://chatgpt.com/`.
- Confirm the extension is enabled in `chrome://extensions`.
- Reload the ChatGPT tab after loading or updating the extension.
- Check the DevTools console for `[AutoToC]` logs.

If collapsed heading bars become a single icon:

- Hover the rail to see the full expanded heading list.
- Check the console for `collapsed headings summarized`.
- The reason is either the 80% viewport height estimate or adjacent heading scroll positions closer than `48px`.

If old markers overlap the current UI after reloading the extension:

- Reload the ChatGPT tab. AutoToC also removes stale AutoToC roots during runtime startup.

## Privacy

AutoToC runs as a content script only on `https://chatgpt.com/*`.

It reads the rendered ChatGPT conversation DOM in the browser to build navigation markers. It does not send conversation content to a remote server and does not define any background service worker or external network integration.

## Project Layout

```text
AutoToC/
  manifest.json
  content/
    content.js
    content.css
  CHANGELOG.md
  README.md
  README.ko.md
```

## Version

Current release: `1.0.0`
