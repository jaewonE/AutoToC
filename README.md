# AutoToC

[ [English](https://github.com/jaewonE/AutoToC) | [한국어](https://github.com/jaewonE/AutoToC/blob/main/README.ko.md) ]

![AutoToC demo](assets/demo.png)

AutoToC is a Chrome extension that adds a right-side sidebar on `chatgpt.com` to display heading markers for the currently active response.

* Click a heading marker to scroll to the location of the corresponding header.
* ChatGPT dynamically loads conversations based on the current scroll position. Conversations that have already been loaded are remembered through caching, but headings from conversations that have not yet been loaded may not appear in the sidebar.
* If a response contains too many headers or if the spacing between headers is too dense, the individual heading icons may be replaced with a single icon.

## Installation

AutoToC is currently used as an unpacked local extension.

1. Clone this repository.
2. Open `chrome://extensions`.
3. Turn on **Developer mode**.
4. Click **Load unpacked**.
5. Select this repository folder.
6. Open or refresh `https://chatgpt.com/`.

No separate build step is required. Chrome directly loads `manifest.json`, `content/content.js`, and `content/content.css`.

## License

This project is distributed under the GNU General Public License v3.0. See [LICENSE](LICENSE) for details.
