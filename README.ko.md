# AutoToC

AutoToC는 ChatGPT 대화에 hover 가능한 목차 사이드바를 추가하는 Chrome Manifest V3 확장 프로그램입니다.

긴 기술 대화에서는 질문 이력과 현재 답변의 구조를 함께 볼 수 있어야 합니다. AutoToC는 화면 오른쪽에 접힌 레일을 고정하고, 질문 마커와 현재 활성 답변의 heading 마커를 표시합니다. 레일에 마우스를 올리면 질문 텍스트와 heading 라벨을 읽을 수 있는 탐색 패널이 열립니다.

## 주요 기능

- 전체 ChatGPT 대화의 질문 탐색.
- ChatGPT markdown이 렌더링한 현재 활성 답변의 `h1`부터 `h6` heading 탐색.
- 질문 dot과 heading bar를 사용하는 compact collapsed rail.
- 질문 제목과 heading 라벨을 보여주는 hover-expanded panel.
- 질문과 heading 클릭 이동.
- 답변 생성 중 streaming 상태를 spinner로 표시.
- ChatGPT DOM virtualization으로 이전 메시지가 일시적으로 DOM에서 사라져도 AutoToC 마커가 줄어들지 않도록 Q&A 캐시 유지.
- 80dvh 최대 높이를 사용하는 독립 panel 스크롤.
- 확장 프로그램 reload 후 오래된 AutoToC root가 겹치지 않도록 단일 인스턴스 정리.
- AutoToC collapsed 영역과 겹치는 ChatGPT native right-rail minimap 억제.
- parsing, rendering, mutation 처리, scroll activation, streaming 상태, native minimap 억제를 추적하는 `[AutoToC]` console diagnostics.

## 설치

AutoToC는 현재 unpacked local extension 형태로 사용합니다.

1. 이 repository를 clone합니다.
2. `chrome://extensions`를 엽니다.
3. **Developer mode**를 켭니다.
4. **Load unpacked**를 클릭합니다.
5. 이 repository 폴더를 선택합니다.
6. `https://chatgpt.com/`을 열거나 새로고침합니다.

별도의 build step은 없습니다. Chrome이 `manifest.json`, `content/content.js`, `content/content.css`를 직접 로드합니다.

## 사용법

ChatGPT 대화를 열면, 페이지에 사용자 메시지가 있을 때 AutoToC가 오른쪽 가장자리에 표시됩니다.

- collapsed rail은 캐시된 질문마다 dot을 하나씩 표시합니다.
- 활성 질문은 강조됩니다.
- 활성 답변에 heading이 있으면 활성 질문 아래에 heading bar가 표시됩니다.
- rail에 hover하면 전체 panel이 열립니다.
- rail 또는 panel의 질문을 클릭하면 해당 질문으로 이동합니다.
- heading bar 또는 heading label을 클릭하면 해당 heading으로 이동합니다.

ChatGPT가 답변을 생성하는 동안 AutoToC는 streaming 답변에 spinner를 표시합니다. 생성이 끝나면 Q&A와 heading 목록을 다시 구성합니다.

## Heading 표시 정책

AutoToC는 expanded panel 정책과 collapsed rail 정책을 분리합니다.

Expanded panel에서는 다음과 같이 표시합니다.

- 활성 답변의 heading이 10개 이하이면 모든 heading을 표시합니다.
- 활성 답변의 heading이 10개를 초과하면 `h1`부터 `h4` heading만 표시합니다.

Collapsed rail에서는 다음과 같이 표시합니다.

- 캐시된 질문의 dot은 계속 표시합니다.
- heading bar는 활성 답변에 대해서만 표시합니다.
- heading level마다 다른 bar 길이를 사용합니다.
- 자세한 heading bar가 너무 크거나 오해를 만들 수 있으면 하나의 세 줄 ToC summary icon으로 치환합니다.

Summary icon은 다음 두 경우 중 하나에서 사용됩니다.

- **높이 제한:** `(캐시된 질문 수 + 필터링된 활성 heading 수) * 20px` 값이 viewport 높이의 `80%`를 초과하는 경우.
- **좁은 heading 간격:** 인접한 활성 heading의 실제 scroll position 차이가 `48px` 미만인 경우.

두 번째 규칙 때문에 직관과 다른 상황이 생길 수 있습니다. 예를 들어 paragraph content를 사이에 둔 16개의 heading은 collapsed bar로 유지될 수 있지만, content 없이 연속된 10개의 heading은 하나의 summary icon으로 바뀔 수 있습니다. 원인은 heading 개수만이 아닙니다. AutoToC는 인접 heading의 실제 렌더링 scroll position도 검사합니다. Markdown heading이 연속되면 실제 DOM 위치 차이가 `48px`보다 작아질 수 있으므로, 80% 높이 제한에 도달하지 않아도 collapsed bar가 summary icon으로 치환됩니다.

Expanded panel에는 heading 목록이 계속 제공되므로, 이 요약은 compact collapsed 표현에만 적용됩니다.

## 디버깅

AutoToC는 browser console에 `[AutoToC]` prefix로 diagnostics를 출력합니다.

`chatgpt.com`에서 diagnostics를 끄려면 다음을 실행합니다.

```js
localStorage.setItem("autotocDebug", "0");
```

다시 켜려면 다음을 실행합니다.

```js
localStorage.setItem("autotocDebug", "1");
```

주요 메시지는 다음과 같습니다.

- `parseQABlocks`: parsing 및 캐시된 question block.
- `render`: 렌더링된 question 및 heading 수.
- `active state`: 활성 question 및 heading 선택 상태.
- `collapsed headings summarized`: collapsed heading이 높이 또는 좁은 간격 때문에 summary 처리되었는지 여부.
- `native right rail minimap suppressed`: AutoToC와 겹쳐 숨겨진 ChatGPT native minimap 요소.

## 문제 해결

Sidebar가 표시되지 않는 경우:

- URL이 `https://chatgpt.com/`으로 시작하는지 확인합니다.
- `chrome://extensions`에서 확장 프로그램이 활성화되어 있는지 확인합니다.
- 확장 프로그램을 load 또는 update한 뒤 ChatGPT 탭을 새로고침합니다.
- DevTools console에서 `[AutoToC]` 로그를 확인합니다.

Collapsed heading bar가 하나의 icon으로 바뀌는 경우:

- rail에 hover해서 expanded heading 목록을 확인합니다.
- console에서 `collapsed headings summarized` 로그를 확인합니다.
- 원인은 80% viewport height 추정치 초과이거나 인접 heading scroll position 차이가 `48px`보다 작은 경우입니다.

확장 프로그램 reload 뒤 이전 marker가 현재 UI와 겹치는 경우:

- ChatGPT 탭을 새로고침합니다. AutoToC도 runtime startup 중 stale AutoToC root를 제거합니다.

## Privacy

AutoToC는 `https://chatgpt.com/*`에서만 content script로 실행됩니다.

브라우저에 렌더링된 ChatGPT 대화 DOM을 읽어 navigation marker를 만듭니다. 대화 내용을 외부 서버로 전송하지 않으며, background service worker나 외부 network integration을 정의하지 않습니다.

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

## 버전

현재 release: `1.0.0`
