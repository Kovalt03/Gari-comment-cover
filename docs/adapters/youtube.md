# 유튜브 어댑터

유튜브 댓글 영역의 구조와 어댑터가 의존하는 지점을 기록한다.
마크업이 바뀌어 동작이 멈추면 여기부터 확인한다.

확인 환경: 데스크톱 크롬, 한국어 UI, 2026-09-13.
확인 방법은 영상 페이지에서 DevTools 콘솔로 직접 조회.

## 1. 셀렉터

어댑터는 이 표의 값을 상수로 두고, 코드 여기저기에 문자열을 흩뿌리지 않는다.

| 용도 | 셀렉터 | 확인일 |
|---|---|---|
| 댓글 섹션 전체 | `ytd-comments#comments` | 2026-09-13 |
| MutationObserver 관찰 루트 | `ytd-comments#comments ytd-item-section-renderer#sections > div#contents` | 2026-09-13 |
| 댓글 하나 (대댓글 포함) | `ytd-comment-thread-renderer` | 2026-09-13 |
| 댓글 본문 | `#content-text` (`yt-attributed-string`) | 2026-09-13 |
| 댓글 식별자 | `a[href*="lc="]`의 `lc` 파라미터 | 2026-09-13 |
| 대댓글 묶음 | `ytd-comment-replies-renderer` | 2026-09-13 |
| 대댓글 더 보기 버튼 | `#more-replies-sub-thread button` | 2026-09-13 |
| 추가 로드 센티널 | `ytd-comments#comments ytd-continuation-item-renderer` | 2026-09-13 |
| 댓글 툴바 (피드백 버튼 삽입 위치) | `:scope > #comment-container #action-buttons #toolbar` | 2026-09-14 |

전체 경로는 다음과 같다.

```
ytd-app
  div#content
    ytd-page-manager#page-manager
      ytd-watch-flexy
        div#columns > div#primary > div#primary-inner > div#below > div
          ytd-comments#comments
            ytd-item-section-renderer#sections
              div#contents
                ytd-comment-thread-renderer      <- 댓글 하나
                  div#comment-container
                    ytd-comment-view-model#comment
                      #content-text              <- 본문
                  div#replies
                    ytd-comment-replies-renderer
```

## 2. 확인한 것

### 2.1 대댓글도 같은 요소다

대댓글을 펼치면 `ytd-comment-replies-renderer` 안에 `ytd-comment-thread-renderer`가 생긴다.
최상위 댓글과 같은 요소이고, 내부 구조도 `div#comment-container > ytd-comment-view-model#comment`로 동일하다.

펼치기 전 20개였던 `ytd-comment-thread-renderer`가 펼친 뒤 30개가 되는 것으로 확인했다.

어댑터 입장에서는 이게 편하다. 셀렉터 하나로 둘 다 잡힌다.
구분이 필요하면 `closest('ytd-comment-replies-renderer')`로 판별한다.

### 2.2 식별자는 `lc` 파라미터에서 얻는다

댓글마다 퍼머링크가 있고 여기에 댓글 ID가 들어 있다.

```
/watch?v=dQw4w9WgXcQ&lc=Ugzge340dBgB75hWBm54AaABAg
```

대댓글은 부모 ID와 점으로 이어진다.

```
Ugzge340dBgB75hWBm54AaABAg.AHE8_QAWJx9AHKUhQwxI28
```

Polymer 내부 데이터(`element.__data.commentId`)에도 같은 값이 있지만 그쪽은 쓰지 않는다.
내부 구현에 의존하게 되고, 유튜브가 렌더러를 바꾸면 먼저 깨진다.
DOM에 드러난 링크를 쓰는 편이 안전하다.

### 2.3 `document_start` 시점에는 댓글 영역이 없다

이게 어댑터 설계에 가장 크게 영향을 준 확인이다.
아래는 HTML을 받아서 확인한 내용이고, 확장을 실제로 띄워 로그로도 확인했다.
`document_start`로 선언한 스크립트가 `document.readyState === 'loading'`에서 시작했고,
그 시점에 관찰 루트를 찾지 못해 대기 경로로 들어갔다.

`document_start`는 DOM이 만들어지기 전이므로, 서버가 보낸 HTML에 없는 요소는 그 시점에 존재할 수 없다.
그래서 watch 페이지의 원본 HTML을 받아서 직접 확인했다.

```javascript
const html = await fetch(location.href, { credentials: 'include' }).then(r => r.text());
```

| 항목 | 결과 |
|---|---|
| 전체 HTML 크기 | 약 1.3MB |
| `<body>` 안의 태그 수 | 177개 |
| `<ytd-comments` | 없음 |
| `id="comments"` | 없음 |
| `<ytd-watch-flexy` | 없음 |
| `<ytd-app` | 있음 |
| `ytInitialData` | 있음 |

1.3MB 중 대부분이 스크립트와 JSON 데이터다.
실제 마크업은 `<div id="watch-page-skeleton">` 같은 뼈대 몇 개뿐이고,
댓글은 물론 영상 영역(`ytd-watch-flexy`)조차 초기 HTML에 없다.
`ytd-app` 껍데기와 `ytInitialData`만 보내고, 나머지는 Polymer가 클라이언트에서 만든다.

**결론: `document_start` 시점에 댓글 영역은 존재하지 않는다.**

두 가지가 따라온다.

첫째, 숨김을 CSS로 거는 선택이 여기서 정당화된다.
CSS 규칙은 선언해두면 요소가 나중에 생겨도 적용된다. 존재 여부와 무관하다.
반대로 JS로 숨기려 했다면 Polymer가 DOM을 만드는 시점과 경쟁해야 했고,
언제 이기고 언제 지는지 보장할 수 없었을 것이다.

둘째, `getObserverRoot()`는 처음 호출에서 반드시 null을 반환한다.
null을 받으면 재시도하는 경로가 필수다. 예외 상황이 아니라 정상 경로다.

### 2.3.1 댓글 내용은 스크롤해야 로드된다

컨테이너가 생긴 뒤에도 안은 비어 있다.
페이지 로드가 끝난 직후(`readyState === 'complete'`) 확인하면
`ytd-comments#comments`와 `div#contents`는 있지만 `ytd-comment-thread-renderer`는 0개다.
스크롤을 내려야 채워진다.

즉 두 단계로 나뉜다.

```
document_start        댓글 영역 자체가 없음
페이지 로드 완료       컨테이너는 있고 내용은 비어 있음
스크롤                 댓글이 삽입되기 시작
```

### 2.4 `ytd-comments`는 두 개 있다

```javascript
document.querySelectorAll('ytd-comments').length   // 2
```

하나는 `id="comments"`인 본문 아래 댓글 영역이고,
다른 하나는 `ytd-engagement-panel-section-list-renderer` 안에 있는 패널용이다.
확인 시점에 패널 쪽은 비어 있었다.

`ytd-comments`만으로 셀렉터를 잡으면 두 개가 같이 걸린다.
숨김 CSS는 `ytd-comment-thread-renderer`를 기준으로 거는 편이 안전하다.
패널에서 댓글을 열었을 때 어떻게 되는지는 아직 확인하지 않았다. (검증 예정)

### 2.5 영상 전환 시 컨테이너가 재사용된다

사이드바에서 다른 영상으로 이동한 뒤 확인한 결과다.

document에서 다음 이벤트가 순서대로 발생한다.

```
yt-navigate-start
yt-navigate-finish
yt-page-data-updated
```

그리고 중요한 부분은 **노드가 교체되지 않는다**는 것이다.
전환 전에 `div#contents`에 `data-gari-mark` 속성을 붙여두고 전환 후에 확인했더니
같은 노드 객체가 그대로였고 속성도 남아 있었다.

| 항목 | 결과 |
|---|---|
| `ytd-comments#comments` 노드 | 재사용 |
| `div#contents` 노드 | 재사용 |
| 안에 있던 댓글 | 전부 제거됨 (0개) |

어댑터에 주는 의미는 두 가지다.

- MutationObserver를 다시 붙일 필요가 없다. 같은 노드를 계속 보고 있으면 된다
- 대신 **상태는 반드시 초기화해야 한다.** 컨테이너는 그대로인데 내용물이 다른 영상 것으로 바뀐다.
  이전 영상의 판정 캐시와 처리 완료 표시를 그대로 두면 잘못된 판정이 적용된다

`yt-navigate-finish`를 `onNavigate`의 신호로 쓴다.

다만 **이 이벤트는 영상을 바꿀 때만 발생하는 것이 아니다.**
확장을 실제로 띄워서 로그를 보니 최초 페이지 로드 시에도 한 번 발생했다.

```
[gari] 로드됨. readyState = loading
[gari] 댓글 영역 대기 중
[gari] yt-navigate-finish. 상태 초기화 (이전 댓글 0 개)   <- 전환한 적 없음
```

전환 처리에서 초기화만 한다면 문제가 되지 않는다. 비울 상태가 애초에 없기 때문이다.
그러나 전환 처리에서 관찰자를 새로 만들거나 대기를 거는 식이면 중복이 생긴다.
실제로 첫 구현에서 대기 감시자가 두 개 생겨 `관찰 시작` 로그가 두 번 찍혔다.
전환 처리는 여러 번 호출되어도 안전하도록 만들어야 한다.

### 2.6 무한 스크롤은 추가로 삽입한다

확장을 띄운 상태에서 직접 스크롤하며 확인했다.
스크롤로 새 댓글이 로드되면 그대로 `div#contents`에 추가되고, MutationObserver가 잡는다.
기존 노드는 건드리지 않는다.

로그상 댓글 번호가 1부터 40까지 끊기지 않고 이어졌다.
같은 댓글이 두 번 잡히거나 번호가 되돌아가는 일은 없었다.

새로 삽입되는 댓글도 CSS 규칙이 그대로 적용되어 가려진 채로 나타난다.
이 부분은 스크립트가 관여하지 않는다. 규칙이 이미 등록되어 있으므로 요소가 생기는 순간 적용된다.

### 2.7 기존 노드는 제거되지 않는다

한 번 삽입된 `ytd-comment-thread-renderer`에 `data-gari-id`를 붙여두고
스크롤과 정렬 변경을 거친 뒤 남아 있는지 확인했다.

| 동작 | 기존 노드 | 새 노드 |
|---|---|---|
| 계속 스크롤 | 20개 전부 유지 | 추가 로드를 트리거하지 못함 |
| 정렬을 최신순으로 변경 | 20개 전부 유지, 계속 보임 | 20개 추가됨 |

정렬을 바꿨을 때 기존 댓글이 제거되고 새로 그려질 것으로 예상했는데 그렇지 않았다.
같은 `div#contents` 안에 40개가 되고 둘 다 화면에 보였다.

어댑터에 주는 의미는 **처리 완료 표시를 노드에 붙여두면 재사용된다**는 것이다.
노드가 살아 있으니 두 번 판정하지 않는다.

다만 이건 한 번 관측한 결과다.
정렬 변경이 항상 이렇게 동작하는지, 다른 영상에서도 같은지는 재확인이 필요하다. (검증 예정)

### 2.8 툴바에 노드를 넣어도 유지된다

피드백 버튼(`Hide`, `Looks fine`)은 확장이 유튜브 DOM에 직접 추가하는 첫 노드다.
그 전까지는 CSS만 사용했기 때문에 Polymer와 충돌할 여지가 없었다.

툴바 구조는 다음과 같다.

```
ytd-comment-view-model#comment
  div#body > div#main
    ytd-comment-engagement-bar#action-buttons
      div#toolbar
        ytd-toggle-button-renderer#like-button
        span#vote-count-middle
        ytd-toggle-button-renderer#dislike-button
        div#creator-heart
        ytd-button-renderer#reply-button-end
        span.gari-actions                      <- 추가 (버튼 묶음)
```

`#toolbar` 끝에 버튼을 넣고 스크롤과 정렬 변경을 거친 뒤 확인했다.
넣은 4개가 모두 남아 있었다.

셀렉터에 `:scope > #comment-container`를 붙인 이유는 대댓글 때문이다.
부모 댓글 요소 안에 대댓글의 툴바도 들어 있으므로, 범위를 좁히지 않으면 부모에서 대댓글 툴바를 잡는다.
`Unverified` 표식의 CSS도 같은 이유로 `>`로 범위를 제한했다.

좋아요를 누르는 등 툴바 자체가 다시 그려지는 경우는 비로그인 상태라 확인하지 못했다. (검증 예정)
어댑터는 댓글을 펼칠 때마다 버튼 묶음을 다시 만든다. 사라졌다면 이때 복구된다.

### 2.9 추가 로드를 끌어내는 방법

댓글을 자동으로 모으려면 다음 페이지를 불러오게 만들어야 한다.
방식에 따라 되기도 하고 안 되기도 해서, 실제 페이지에서 비교했다.

| 방식 | 결과 |
|---|---|
| 프레임마다 조금씩 내려가기 | 20개 추가 |
| 부드러운 스크롤 (`behavior: 'smooth'`) | 20개 추가 |
| 위로 물러섰다 다시 내려오기 | 20개 추가 |
| 목표 지점으로 한 번에 점프 | 변화 없음 |
| `wheel` · `scroll` 이벤트만 발생 | 변화 없음 |

조건은 **뷰포트가 실제로 거리를 이동하는 것**이다.
이미 아래쪽에 있는 상태에서 그 자리로 다시 스크롤하면 아무 일도 일어나지 않는다.
이벤트를 직접 만들어 보내는 것도 소용없다. 위치가 변해야 한다.

`scrollIntoView`를 쓸 때 이 점이 문제가 된다.
페이지가 이미 댓글 끝 근처에 있으면 거의 움직이지 않아서 로딩이 걸리지 않는다.

### 2.10 연속 로딩 마커는 스크롤 대상이 아니다

```javascript
document.querySelector('ytd-comments#comments ytd-continuation-item-renderer')
// { width: 0, height: 0, offsetParent: null }
```

가로세로가 0이고 레이아웃에서 빠져 있다.
`scrollIntoView`를 불러도 화면이 움직이지 않는다.

이 요소는 "댓글이 더 있다"는 신호로만 쓴다.
사라졌으면 끝까지 본 것이고, 남아 있는데 더 안 오면 뭔가 막힌 것이다.

### 2.11 창에 포커스가 없으면 로딩이 멈춘다

탭이 보이지 않거나(`visibilityState !== 'visible'`) 창이 포커스를 잃으면
(`document.hasFocus() === false`) 스크롤해도 댓글이 오지 않는다.

콘솔에서 수집을 실행할 때 특히 걸린다. DevTools에 포커스가 있으면 페이지는 포커스가 없는 상태다.
자동 스크롤을 시작한 뒤 페이지를 한 번 클릭해야 한다.

## 3. 아직 확인하지 않은 것

- 정렬 변경 시 노드가 유지되는 동작이 항상 같은지 (2.6 참고)
- 패널에서 댓글을 열었을 때(`ytd-engagement-panel-...` 안의 `ytd-comments`) 어떤 구조가 되는지
- 숨김 CSS를 걸었을 때 무한 스크롤 높이 계산에 영향이 있는지
- 로그인 상태와 비로그인 상태의 구조 차이. 이번 확인은 비로그인 상태였다

## 4. 알려진 문제

동작이 깨졌을 때 원인과 대응을 누적한다.

| 증상 | 원인 | 대응 |
|---|---|---|
| | | |
