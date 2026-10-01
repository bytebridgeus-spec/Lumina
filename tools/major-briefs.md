# MAJOR FINDINGS — FIX BRIEFS

Every finding below was produced by an independent adversarial reviewer of this
tree. Some may already be fixed in the working copy: **verify first**, and report
a finding as ALREADY-FIXED rather than editing it. A reviewer can be wrong; the
evidence in the tree outranks the claim in this file.

## SLICE seed

YOU OWN EXACTLY THESE FILES. Do not edit any other file:
- src/data/seed.ts

### SEED-1  (major/correctness)  src/data/seed.ts:812

SUMMARY: A `|| true` tail makes the post-author pool filter a no-op, so the post's own author (and the viewer) end up writing comments on other people's posts.

DETAIL:
```ts
const authorPool = users.filter((u) => u.id !== viewer.id && !u.hasActiveStory || true)
```
`&&` binds tighter than `||`, so this is `((u.id !== viewer.id && !u.hasActiveStory) || true)`, which is `true` for every user — the filter is dead. `authorPool` is therefore all 28 users, and it is passed straight into `buildComments(rng, id, authorPool, commentCount)` (line 867) as the pool comment authors are drawn from. I bundled the seed with esbuild and ran `buildSeed()`: 28 of 64 posts have a top-level comment authored by the post's own author, and 14 posts authored by someone else carry a comment authored by `user_theviewer`. Concrete example from the run: `post_0` is authored by `sam.whitfield`, and its newest top-level comment (`createdAt` 400h ago, first in the sorted list) is also authored by `sam.whitfield` and reads "I love how it feels slightly lonely and that is a compliment."

SUGGESTED FIX FROM REVIEWER: Restore the intended filter and drop the no-op, e.g. `const authorPool = users.filter((u) => u.id !== viewer.id)`, and pass the post's `author` into `buildComments` so it can be excluded from the comment-author pool the same way `likerPool` already excludes it (`authorPool.filter((u) => u.id !== author.id)`, line 844).

### SEED-2  (major/data-consistency)  src/data/seed.ts:780

SUMMARY: The pinned comment is always attributed to `authorPool[0]` (Ava Reyes) instead of the author of the post, because `buildComments` never receives the post author.

DETAIL:
```ts
  // A pinned comment from the author on roughly a third of posts.
  if (rng.bool(0.3)) {
    const author = authorPool[0]
    out.unshift({
      id: `c_${postId}_pinned`,
```
`buildComments(rng, postId, authorPool, count)` (line 738) has no `author` parameter, so the "pinned comment from the author" falls back to the first element of `authorPool`. Because of the dead filter on line 812, `authorPool` is all 28 users in seed order, so `authorPool[0]` is always `user_0` = `ava.reyes`. Running `buildSeed()`: 22 posts get a pinned comment and 21 of them are attributed to an account that is not the post's author. Example from the run: `post_8` is authored by `user_theviewer` (Jordan Ellis) and its pinned comment is `c_post_8_pinned`, authored by `ava.reyes`, reading "Prints from this series are in the link in bio."

SUGGESTED FIX FROM REVIEWER: Thread the post's author through: change the signature to `buildComments(rng, postId, authorPool, count, postAuthor)` (or pass `author` as an argument) and set `const author = postAuthor` in the pinned branch; also exclude `postAuthor` from `authorPool` inside `buildComments` so random comments never self-author.

### SEED-3  (major/product-fidelity)  src/data/seed.ts:897

SUMMARY: The home feed is a random shuffle of every non-viewer post, not the followed accounts in reverse-chronological order as the comment and the selector both claim.

DETAIL:
```ts
  // Compose the home feed: mostly followed authors, chronological.
  const followed = ids.filter((id) => byId[id].authorId !== viewer.id)
  const shuffled = rng.shuffle(followed)
  const feedIds = shuffled.slice(0, 26)
```
`followed` filters on "is not authored by the viewer", never on `usersById[...].followedByViewer`, and `rng.shuffle` discards `createdAt` ordering entirely. `useFeedPosts()` in `src/store/selectors.ts:101-105` then just maps `feedIds` in order, under a docstring that says "The home feed, newest first". Running `buildSeed()`: of the 20 distinct authors appearing in `feedIds`, 12 are accounts the viewer does not follow (`followedByViewer === false`, e.g. sofia.lindqvist, jonas.weber, nina.kovacs, theviewer, tom.harding, sam.whitfield, imani.brooks, zoe.kaplan, amara.diallo, rafael.dos, clara.novak, hana.park, elena.rossi), and 14 of the 27 adjacent pairs in `feedIds` have a *newer* `createdAt` than the one before them.

SUGGESTED FIX FROM REVIEWER: Filter on the follow relation and sort by time: `const followed = ids.filter((id) => !usersById[byId[id].authorId]?.followedByViewer).sort((a, b) => byId[b].createdAt - byId[a].createdAt)`, keep `ids.filter((id) => byId[id].authorId === viewer.id)` out of the body, then splice in the suggested units from non-followed authors where the code already does (`feedIds.splice(4, 0, ...)`), instead of splicing strangers into an already-randomised list.

### SEED-4  (major/data-consistency)  src/data/seed.ts:554

SUMMARY: `postCount` is a hand-written realistic number that is never reconciled with the posts actually generated for that author, so the profile header count and the profile grid can never agree.

DETAIL:
```ts
      followerCount: spec.followers,
      followingCount: spec.following,
      postCount: spec.posts,
      privacy: spec.private ? 'private' : 'public',
```
`spec.posts` comes straight from `USER_SPECS` (values 88 … 1_488) and has no relationship to how many posts `buildPosts` actually assigns to that author. The profile header renders `{formatCompactNumber(user.postCount)} posts` (`modules/profile/ProfileHeader.tsx:238`) while the grid under it renders `useAuthorGrid(user.id)` (`ProfilePage.tsx:130`). Running `buildSeed()`: `user_0` (ava.reyes) has `postCount: 1_204` and 1 generated post; `user_1` (kenji.watanabe) has 640 and 0; `user_5` (dante.moretti) has 921 and 2. The store keeps the two independent as well — `addPost` does `postCount: author.postCount + 1` (store line 583) and `deletePost` does `postCount: Math.max(0, author.postCount - 1)` (line 603) without touching `postIds`, which is what the grid is built from.

SUGGESTED FIX FROM REVIEWER: Derive the number the header shows from the same source the grid uses (`usePostsByAuthor(user.id).length`) rather than from the denormalised `postCount` field, or generate enough posts per author that the two agree. If the field is kept for the "realistic" look, stop using it for the on-screen count.

### SEED-5  (major/cross-file-inconsistency)  src/data/seed.ts:830

SUMMARY: The two producers of `Media` disagree about what `kind: 'carousel'` means — the seed puts it on the post and gives the items 'image'; the composer puts it on every item — and `types.ts` documents it as a per-item field.

DETAIL:
`types.ts:47-59` declares `Media.kind: 'image' | 'video' | 'carousel'` on the individual item. The seed (`seed.ts:820-833`):
```ts
const kind: Media['kind'] = roll < 0.16 ? 'carousel' : roll < 0.3 ? 'video' : 'image'
const count = kind === 'carousel' ? rng.int(2, 5) : 1
const media: Media[] = Array.from({ length: count }, (_, mi) =>
  makeMedia(rng, ..., kind === 'carousel' ? 'image' : kind, ...))
```
— `'carousel'` is a POST-level property that is deliberately rewritten to `'image'` on each item, so it never appears on a seeded item. The composer (`useComposer.ts:305-306`) does the opposite:
```ts
const kind: MediaKind = multi && file.kind === 'image' ? 'carousel' : file.kind
```
— every item of a multi-file post is stamped `'carousel'`. So a two-photo post created in the app serialises as `[{kind:'carousel'},{kind:'carousel'}]` and the same post from the seed as `[{kind:'image'},{kind:'image'}]`. Today only `cover.kind === 'video'` is ever read (ExploreGrid.tsx:117, PostCard.tsx:114, PostPage.tsx:263), so the divergence is latent — which is the danger: the field is in the public `Media` type, both producers are `Media` producers, and no consumer can tell which convention it is looking at.

SUGGESTED FIX FROM REVIEWER: Pick one convention and state it on the type. The cleanest is to follow the seed: `kind` describes the item, and "this post is a carousel" is `post.media.length > 1`. Change `useComposer.ts:306` to `const kind: MediaKind = file.kind` and, if a post-level flag is wanted, derive it once (`kind = files.length > 1 ? 'carousel' : files[0].kind` on a post-scoped field) rather than stamping every item. Add a comment to `types.ts:47` saying the seed rewrites carousel items to `'image'`.

## SLICE profile

YOU OWN EXACTLY THESE FILES. Do not edit any other file:
- src/modules/profile/ProfilePage.tsx
- src/modules/profile/ProfileHeader.tsx

### PROFILE-1  (major/correctness)  src/modules/profile/ProfilePage.tsx:112

SUMMARY: The `pending` flag is raised unconditionally on mount, so the profile grid is replaced by twelve skeleton tiles for a frame on every profile render even though the store already holds the data.

DETAIL:
const [pending, setPending] = useState(false)
useEffect(() => {
  setPending(true)
  let settled = false
  const finish = (): void => {
    if (settled) return
    settled = true
    setPending(false)
  }
  const frame = requestAnimationFrame(finish)
  const failsafe = window.setTimeout(finish, 120)
  return () => { ... }
}, [username, tabProp])

and the flag is wired straight into the grid: `<PostGrid posts={authorGrid} loading={pending} emptyKind="posts" />`, where `loading` renders `SKELETON_TILES` (12) shimmer tiles instead of content. The effect has no "only when it actually changes" guard and no dependency on whether the data is already present: `authorGrid` comes from the synchronous Zustand store via `useAuthorGrid(user?.id)`, so it is never loading. The premise in the comment above the hook ("without it a slow grid would keep the previous account's tiles on screen under the new header") cannot happen either, because every render already reads the grid for the *newly resolved* `user`, not the previous one.

SUGGESTED FIX FROM REVIEWER: Skip the pending frame on first mount and only raise it when the resolved account actually changes, e.g. `const first = useRef(true)` / key the effect off `user?.id` after a first-render guard — or drop the flag entirely and let `authorGrid` (already keyed to the resolved user) drive the loading state.

### PROFILE-2  (major/data-consistency)  src/modules/profile/ProfilePage.tsx:301

SUMMARY: The footnote derives the post count from the rendered grid while the header directly above it derives it from `user.postCount`, so the same screen prints two different totals for the same fact.

DETAIL:
{tab === 'posts' && authorGrid.length > 0 ? (
  <p className={styles.footnote}>
    {pluralize(authorGrid.length, 'post')} by{' '}
    <Link to={`/${user.username}`} className={styles.footnoteLink}>

versus, in the header rendered a few hundred pixels higher on the same page (ProfileHeader.tsx:238): `<strong className={styles.statValue}>{formatCompactNumber(user.postCount)}</strong>`. `authorGrid` is the real row count (`useAuthorGrid` filters `s.postIds` by `authorId`); `user.postCount` is a denormalised field seeded straight from the spec (`postCount: spec.posts` in src/data/seed.ts:554, values 96–1,204) while the seed only creates 64 posts across 28 users. The same split shows up a third time in the Insights panel, which uses `userPosts.length` ("Posts published"). Instagram has no such footnote at all.

SUGGESTED FIX FROM REVIEWER: Either drop the footnote (Instagram has no such line) or derive the header stat from the same source as the grid (`useAuthorGrid(user.id).length`) so the two numbers cannot disagree.

### PROFILE-3  (major/correctness)  src/modules/profile/ProfileHeader.tsx:387

SUMMARY: "Followed by X and N others" prints the account's total follower count minus one, which has no relationship to the number of mutual followers being described.

DETAIL:
const OTHERS_OFFSET = 1
...
{formatCompactNumber(Math.max(0, user.followerCount - OTHERS_OFFSET))} others

`mutualName` is resolved as "someone the viewer follows who also follows this account" (`s.users[id] ... .find((other) => other && other.id !== user.id && other.id !== viewerId && other.followedByViewer && other.followsViewer)`, line 127), i.e. the mutual set. The count printed next to it is `user.followerCount`, the account's entire audience. The store carries no list of mutual followers, so the number is not merely stale, it is about four orders of magnitude too large.

SUGGESTED FIX FROM REVIEWER: Count the actual mutual set (the same `s.userIds` scan that resolves `mutualName`) and print `mutuals.length - OTHERS_OFFSET`, or drop the count and render only "Followed by <name>".

### PROFILE-4  (major/cross-file-inconsistency)  src/modules/profile/ProfilePage.tsx:173

SUMMARY: The `highlights` tab is routable but has no entry in `tabItems`, so Tabs computes activeIndex -1: no tab is aria-selected, the underline disappears, and roving tabindex falls back to Posts.

DETAIL:
App.tsx declares `<Route path=":username/highlights/:highlightId" element={<ProfilePage tab="highlights" />} />`, and `ProfilePage.tsx:289` renders a full `HighlightGrid` for `tab === 'highlights'`. But `PAGE_TABS` (ProfilePage.tsx:51) is `['posts','saved','tagged','highlights']` while `tabItems` (ProfilePage.tsx:171-177) is:
```tsx
{ id: 'posts', ... }, { id: 'reels', ... }, { id: 'saved', ... }, { id: 'tagged', ... },
```
There is no `highlights` item, and `Tabs.tsx:70-71` does:
```tsx
const activeIndex = tabs.findIndex((tab) => tab.id === value)
const rovingIndex = activeIndex >= 0 ? activeIndex : 0
```
With `value === 'highlights'`, `activeIndex` is `-1`, so `Tabs.tsx:78-80` measures `items.current[-1]` → `undefined` → `setUnderline(null)`, every button gets `aria-selected={false}`, and `tabIndex` goes to index 0. Separately, `ProfilePage.tsx:70-74`:
```tsx
function tabPath(username, tab) {
  if (tab === 'posts') return `/${username}`
  if (tab === 'reels') return '/reels'
  return `/${username}/${tab}`
}
```
The `reels` tab discards `username` entirely, and `ReelsPage` has no username param — it always renders the global feed.

SUGGESTED FIX FROM REVIEWER: Add `{ id: 'highlights', label: 'Highlights', icon: <Icon name="bookmark" ... /> }` to `tabItems` so the routable tab is reachable and selectable. For the Reels tab, either filter the grid by `user.id` (add a `useReelsByAuthor` selector — `Reel.authorId` exists and is currently unused for filtering) or drop the tab item and the `'reels'` member of `TabValue`, matching the file's own header comment at lines 10-13.

## SLICE menus

YOU OWN EXACTLY THESE FILES. Do not edit any other file:
- src/components/layout/MoreMenu.tsx
- src/components/ui/ContextMenu.tsx
- src/components/ui/Popover.tsx

### MENUS-1  (major/accessibility)  src/components/ui/ContextMenu.tsx:245

SUMMARY: Tab dismisses the context menu via dismiss(false), so focus is never returned to the trigger and is lost to <body>.

DETAIL:
        case 'Tab':
          dismiss(false)
          return
        default:

SUGGESTED FIX FROM REVIEWER: Use `dismiss(true)` for the Tab case so the trigger is refocused exactly as on Escape, matching the file's documented contract.

### MENUS-2  (major/accessibility)  src/components/ui/Popover.tsx:308

SUMMARY: Tab closes the popover with a bare setOpen(false) instead of close(true), so focus is never restored to the trigger.

DETAIL:
      if (event.key === 'Tab') {
        // Let focus move on naturally, but stop tracking an invisible surface.
        setOpen(false)
        return
      }

SUGGESTED FIX FROM REVIEWER: Call `close(true)` (or at minimum focus the first focusable inside `anchorRef.current`) after `setOpen(false)`, matching the Escape branch on line 305.

### MENUS-3  (major/accessibility)  src/components/layout/MoreMenu.tsx:285

SUMMARY: Roving tabindex on the menu items defeats the shell's focus trap: pressing Tab inside the open More menu moves focus out of the scrimmed, scroll-locked overlay onto the page behind.

DETAIL:
MoreMenu.tsx:283-288
      tabIndex={entry.id === activeId ? 0 : -1}
      className={className}
      aria-haspopup={entry.expandable ? 'menu' : undefined}
      aria-expanded={entry.expandable ? entry.expanded : undefined}

AppShell.tsx:301 wraps this in the shell's trap: `useFocusTrap(layerRef, !selfContained)`. That trap (src/lib/hooks.ts:172-195) only intervenes when the active element is `getFocusable(container)[first]` or `[last]`, and `getFocusable` matches `'button:not([disabled])'` — i.e. it counts the `tabIndex={-1}` menu items as focusable and calls the Log out item `last`. With roving tabindex, none of the intermediate items are actually tabbable, so the browser's sequential navigation skips straight past `last` and out of the container.

SUGGESTED FIX FROM REVIEWER: Either have the focus trap filter its focusable list to actual tabbables (`el.tabIndex >= 0`) so `first`/`last` match the roving model, or make the MoreMenu a single tabbable container with `aria-activedescendant` instead of roving `tabIndex`.

### MENUS-4  (major/cross-file-inconsistency)  src/components/layout/MoreMenu.tsx:149

SUMMARY: "Saved collections" opens `addToCollection` with no `postId`, so `AddToCollectionModal` writes the empty string as a real post id into a real collection — and no surface in the app ever lists a collection.

DETAIL:
`MoreMenu.tsx:145-150`:
```tsx
{ id: 'collections', label: 'Saved collections', lead: glyph('archive-box'),
  onSelect: () => act(() => openModal('addToCollection')) },
```
`ModalHost.tsx:1041-1045` then renders `<AddToCollectionModal postId={payload.postId ?? ''} />`, and `AddToCollectionModal.tsx:73` does `addToCollection(postId, collection.id)` → `useAppStore.ts:676-684` writes `[...c.postIds, postId]` with `postId === ''`. The dialog is built entirely around a post that does not exist: `AddToCollectionModal.tsx:44` copies "Choose the collections this post should be filed into", :47 computes `alreadyIn = collections.filter(c => c.postIds.includes('')).length`, and :117 renders `collection.postIds.length` as the row's "N posts" count. The sibling `bookmark` modal kind is the mirror image: `ModalHost.tsx:1035-1039` renders a fully-built `BookmarkModal` (src/modules/post/BookmarkModal.tsx, 173 lines) that `grep -rn "openModal('bookmark'"` finds ZERO call sites for. Both modals iterate `useCollections()` and call the same `createCollection` + `addToCollection` pair. And `useCollections` (selectors.ts:310) has only two consumers — those two modals — so `state.collections[].postIds` is never rendered as a list anywhere: the Profile "Saved" tab (ProfilePage.tsx:274) renders `useSavedPosts()` from `savedPostIds`, a completely separate store field.

SUGGESTED FIX FROM REVIEWER: Split the two jobs. Add a `listCollections` view (route or a sheet) that renders `collections` with their resolved posts via `usePosts(collection.postIds)` — that is what makes the feature real. Change the MoreMenu entry to open that list, not `addToCollection`. Drop the `bookmark` modal kind and `BookmarkModal` (unreachable duplicate of `AddToCollectionModal`), or keep exactly one of the two.

## SLICE stories

YOU OWN EXACTLY THESE FILES. Do not edit any other file:
- src/modules/stories/StoryViewer.tsx
- src/modules/stories/HighlightRail.tsx
- src/components/ui/VideoPlayer.tsx

### STORIES-1  (major/correctness)  src/modules/stories/StoryViewer.tsx:235

SUMMARY: Pausing a story (press-and-hold or Space) restarts the item's full duration on resume instead of continuing from where it stopped.

DETAIL:
src/modules/stories/StoryViewer.tsx:233-238

  /* -- the timer --------------------------------------------------------- */
  useEffect(() => {
    if (!item || paused || closedRef.current) return
    const timer = setTimeout(next, Math.max(MIN_DURATION_MS, item.durationMs))
    return () => clearTimeout(timer)
  }, [item, paused, next])

with (line 171) `const paused = holding || spacePaused || !pageVisible`.

`paused` is a dependency, so when it flips true the timeout is cleared, and when it flips false a brand-new `setTimeout(next, item.durationMs)` is created. Nothing anywhere records the elapsed time of the current item. The progress bar is unaffected because it is a CSS animation that is genuinely paused (`src/modules/stories/StoryProgress.tsx:77 animationPlayState: paused ? 'paused' : 'running'`), so the file's own header claim — "The bar animates for exactly `item.durationMs` and the timer waits exactly `item.durationMs` ... they cannot drift" (src/modules/stories/StoryViewer.tsx:14-17) — is false across a pause.

SUGGESTED FIX FROM REVIEWER: Track the remaining time: record `startedAt` when `item.id` changes and keep a `remainingRef`; on resume set `setTimeout(next, remaining)`. Or, keep a single rAF-driven clock that only advances while `!paused` and derive `next` from it, so the CSS animation duration and the JS clock share the same paused-aware source.

### STORIES-2  (major/accessibility)  src/modules/stories/StoryViewer.tsx:181

SUMMARY: The story viewer declares role="dialog" aria-modal="true" but neither traps focus nor restores it, so tabbing out leaves a keyboard-unclosable full-screen overlay.

DETAIL:
src/modules/stories/StoryViewer.tsx:180-184

  /* -- focus ------------------------------------------------------------- */
  useEffect(() => {
    cardRef.current?.focus({ preventScroll: true })
  }, [])

and src/modules/stories/StoryViewer.tsx:457-465

        <div
          ref={cardRef}
          className={styles.card}
          data-story-card=""
          role="dialog"
          aria-modal="true"
          aria-label={`Story by ${author?.username ?? 'unknown'}`}
          tabIndex={-1}
          onKeyDown={handleKeyDown}

The only Escape handling is `onKeyDown` on this div (src/modules/stories/StoryViewer.tsx:312-315). `useFocusTrap` exists in src/lib/hooks.ts:162 and is used by AppShell, CreateOverlay and ExploreDetail, but is not used here — `grep -rn "useFocusTrap"` returns no hit in src/modules/stories. There is no `document`-level keydown listener and no `previouslyFocused` capture. The overlay itself (src/modules/stories/StoryViewerHost.tsx:67-71) is a `position: fixed; inset: 0` portal with no `aria-hidden` and no inert treatment of the page behind it, and `useBodyScrollLock` (src/modules/stories/StoryViewerHost.tsx:47) locks the body.

SUGGESTED FIX FROM REVIEWER: Call `useFocusTrap(cardRef, true)` from `@/lib/hooks` inside StoryViewer (or HighlightViewer) so Tab is contained and focus is restored on unmount; keep the existing `onKeyDown` for Escape/arrows. Alternatively move the Escape handling to a document-level `useEscapeKey` and mark the background inert while the overlay is open.

### STORIES-3  (major/data-consistency)  src/modules/stories/HighlightRail.tsx:52

SUMMARY: A highlight's playback order is taken from storyBuckets iteration order, not from highlight.storyItemIds, so a highlight plays its stories in the wrong sequence.

DETAIL:
src/modules/stories/HighlightRail.tsx:52-62

  const play = (highlightId: ID, storyItemIds: ID[]): void => {
    const wanted = new Set(storyItemIds)
    const items = Object.values(buckets)
      .flatMap((bucket) => bucket.items)
      .filter((item) => wanted.has(item.id))
    if (items.length === 0) {
      pushToast({ message: 'This highlight has no stories left.', tone: 'error' })
      return
    }
    openHighlight(items, ownerId, highlightId)
  }

`storyItemIds` is only used to build a membership `Set`; its order is discarded. The returned `items` are in `Object.values(buckets)` key order, i.e. the order the buckets happen to sit in the `storyBuckets` record.

The order recorded in `storyItemIds` comes from a different place: `addHighlight` stores it verbatim (src/store/useAppStore.ts:881-892, `storyItemIds` passed straight through) and `NewHighlightModal` builds it from a `Set` of the viewer's tap order — `addHighlight(name, Array.from(selected))` (src/modules/stories/NewHighlightModal.tsx:73), where `selected` is populated by `toggle` in click order (src/modules/stories/NewHighlightModal.tsx:61-68). `NewHighlightModal` also spans every bucket of the account (`Object.values(storyBuckets).filter(...).flatMap((bucket) => bucket.items)`, src/modules/stories/NewHighlightModal.tsx:56-59), so a highlight can and does mix items from several buckets.

SUGGESTED FIX FROM REVIEWER: Preserve the recorded order: build the resolved list by walking `storyItemIds` and looking each id up, e.g. `const byId = new Map(Object.values(buckets).flatMap(b => b.items).map(i => [i.id, i])); const items = storyItemIds.map(id => byId.get(id)).filter(Boolean)`. Sorting by `item.createdAt` is an equally valid canonical order, as long as both the rail and `NewHighlightModal` use it.

### STORIES-4  (major/shared-primitive-misuse)  src/components/ui/VideoPlayer.tsx:97

SUMMARY: The in-app "Reduce motion" switch is CSS-only; VideoPlayer and Carousel each ship a private usePrefersReducedMotion that reads only the OS media query, so the setting does not stop autoplaying video.

DETAIL:
`SettingsPanel.tsx:38-43` writes the preference and `SettingsPanel.tsx:55-65` describes the mechanism as a data attribute plus a stylesheet:
```
html[data-reduce-motion='true'] *, ... {
  animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; ...
}
```
Grep for `data-reduce-motion` outside SettingsPanel.tsx returns NOTHING — no JS in the app reads it. Meanwhile there are three separate implementations of the preference: `src/lib/hooks.ts:63` (exported, zero importers), `src/components/ui/Carousel.tsx:90`, and `src/components/ui/VideoPlayer.tsx:97`. Both component copies read only `window.matchMedia('(prefers-reduced-motion: reduce)')` and are wired into behaviour at `VideoPlayer.tsx:261`:
```tsx
const [playing, setPlaying] = useState(() => autoPlay && !reducedMotion)
```
and `Carousel.tsx:238`:
```tsx
const advancing = autoAdvance && !dragging && !hovered && !focused && !tabHidden && !reducedMotion
```
`ReelPlayer.tsx:147` and `StoryItemView.tsx:67` both pass a bare `autoPlay` to `VideoPlayer`.

SUGGESTED FIX FROM REVIEWER: Make `data-reduce-motion` the single source of truth. Export one `usePrefersReducedMotion` (delete the two private copies and the unused `lib/hooks.ts` export) and have it return `document.documentElement.getAttribute('data-reduce-motion') === 'true' || window.matchMedia('(prefers-reduced-motion: reduce)').matches`, subscribing to a `MutationObserver` on the `data-reduce-motion` attribute so the flip is live. That keeps the OS behaviour and makes the in-app switch authoritative.

## SLICE search

YOU OWN EXACTLY THESE FILES. Do not edit any other file:
- src/modules/search/SearchPage.tsx
- src/modules/search/ResultHashtagRow.tsx
- src/store/selectors.ts

### SEARCH-1  (major/interaction/state)  src/modules/search/SearchPage.tsx:224

SUMMARY: SearchResultList's empty branch returns before rendering the filter SegmentedControl, so selecting a filter that the current query does not satisfy removes the only control that can change it back.

DETAIL:
SearchPage.tsx:224-251
```
  if (items.length === 0) {
    return (
      <div className={cn(styles.results, className)}>
        <div className={styles.empty} role="status">
          ...
        </div>
      </div>
    )
  }

  return (
    <div className={cn(styles.results, className)}>
      <div className={styles.filters}>
        <SegmentedControl
          options={FILTER_OPTIONS}
          value={filter}
```
The empty early-return skips `.filters`. `buildResultItems` only emits a group when `wants(group) && matches.<group>.length > 0` (SearchPage.tsx:150,161,173), so a filter whose group is empty yields `items.length === 0` even though the other groups have matches. The `filter` state lives in SearchPage (line 492) and is never reset by a query change.

SUGGESTED FIX FROM REVIEWER: Render the `.filters` SegmentedControl in the empty branch as well (or hoist it above the `items.length === 0` check so it is always present), and reset `filter` to 'all' in SearchPage whenever `urlQuery` changes. Make the empty copy name the active filter, e.g. `No places for "ava"`, instead of claiming there are no results at all.

### SEARCH-2  (major/correctness/data-consistency)  src/modules/search/SearchPage.tsx:328

SUMMARY: ResultsView paginates the flat item array, so a group heading can be the last row of a page with no rows under it — the exact defect SearchOverlay explicitly guards against.

DETAIL:
SearchPage.tsx:325-329
```
  const [limit, setLimit] = useState(PAGE_SIZE)
  const items = useMemo(() => buildResultItems(matches, filter), [matches, filter])
  const visible = useMemo(() => items.slice(0, limit), [items, limit])
  const hasMore = limit < items.length
```
`items` is a flat list of headers, rows and seeAll buttons. `buildResultItems` emits the Accounts group as `header + 5 users + seeAll = 7` entries when `matches.users.length > GROUP_LIMIT.users` (5) (lines 151-158), so the Hashtags group header lands at index 7. `PAGE_SIZE` is 8, so `items.slice(0, 8)` on the very first render ends on that header. SearchOverlay.tsx:80-91 has the correct behaviour and documents it: `// Never slice off a group's heading — an orphaned "Hashtags" with no rows under it reads as a bug.` That guard is missing here.

SUGGESTED FIX FROM REVIEWER: Reuse the overlay's group-boundary cut in ResultsView: walk back from the end of `items.slice(0, limit)` to the last `header` (or `seeAll`) and slice there, as SearchOverlay.tsx:84-91 does — or raise PAGE_SIZE/paginate per group so a header is never the last item of a page.

### SEARCH-3  (major/data-consistency)  src/modules/search/ResultHashtagRow.tsx:70

SUMMARY: Tag following is stored twice under two different localStorage keys, so the explore tag page and the search hashtag page disagree about whether the same tag is followed.

DETAIL:
ResultHashtagRow.tsx:70
```
const FOLLOW_STORAGE_KEY = 'lumina.followedTags.v1'
```
backed by `readFollowed()`/`writeFollowed()` (lines 81-103) and consumed by `useHashtagFollow` (line 113) in both ResultHashtagRow and SearchPage's HashtagView (SearchPage.tsx:399).

ExplorePage.tsx:68
```
const FOLLOWED_TAGS_KEY = 'lumina:followed-tags'
```
consumed by `useLocalStorage<string[]>(FOLLOWED_TAGS_KEY, [])` at ExplorePage.tsx:243 and toggled by `toggleTagFollow` (line 252). The two tag routes are the same fact: /explore/tags/:tag and /search/hashtag/:tag, and the search hashtag page even links hashtags to `/search/hashtag/${tag}` (ResultHashtagRow.tsx:167) while explore links to `/explore/tags/${name}` (ExplorePage.tsx:324).

SUGGESTED FIX FROM REVIEWER: Use one key and one store for both surfaces. Export the existing `useHashtagFollow`/`TAG`-store pair from ResultHashtagRow (or move it to a shared module) and have ExplorePage's `toggleTagFollow`/`tagFollowed` call it instead of `useLocalStorage`, so a follow written on either route is observed by the other.

### SEARCH-4  (major/contract-drift)  src/store/selectors.ts:78

SUMMARY: `useUserSearch` does not filter `blockedUserIds` while `useSuggestedUsers`, CloseFriendsModal and ShareModal all do, so a blocked account stays in @mention autocomplete and the New-message recipient search.

DETAIL:
Four selectors over the same `users` collection disagree about what "blocked" means. `selectors.ts:57-66` (`useSuggestedUsers`):
```ts
s.userIds.filter((id) => id !== s.session.currentUserId && !s.blockedUserIds.includes(id))
```
`ModalHost.tsx:636-642` (CloseFriendsModal) and `ShareModal.tsx:123` do the same. But `selectors.ts:72-86` (`useUserSearch`):
```ts
return s.userIds
  .filter((id) => id !== s.session.currentUserId)
  .map((id) => s.users[id])
  .filter((u): u is User => Boolean(u) && (u.username.toLowerCase().includes(q) || ...))
```
— no `blockedUserIds` check anywhere. `useUserSearch` is the only user-picking selector used by `CreateStepCaption.tsx:131-132` (`mentionMatches` / `coauthorMatches`, the @mention autocomplete) and `NewMessageModal.tsx:51` (`results`, the recipient search). `User` (types.ts:13-37) has no `isBlocked` field; `blockedUserIds` (declared at useAppStore.ts:102, in the middle of the actions block) is the only record, and `blockUser` (useAppStore.ts:496) does nothing but push onto that array — it does not unfollow, does not set a `User` flag, and does not remove the account's posts from `feedIds` or `postIds`.

SUGGESTED FIX FROM REVIEWER: Add the filter in one place so it cannot drift again: make `useUserSearch` reuse the same predicate as `useSuggestedUsers` (`!s.blockedUserIds.includes(id)`), and consider a shared `visibleUserIds(s)` helper in selectors.ts that all four selectors call. Longer term, `blockUser` should also drop the id from `feedIds` and force `followedByViewer: false`, so the block survives a reload of the post list.

## SLICE shell

YOU OWN EXACTLY THESE FILES. Do not edit any other file:
- src/lib/hooks.ts
- src/components/ui/ModalHost.tsx
- src/components/layout/ActivityPanel.tsx
- src/components/layout/SettingsPanel.tsx

### SHELL-1  (major/state)  src/lib/hooks.ts:212

SUMMARY: useBodyScrollLock saves and restores a single inline value with no reference count, so two simultaneously active locks leave the body permanently scroll-locked.

DETAIL:
```ts
    const { overflow, paddingRight } = document.body.style
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth
    document.body.style.overflow = 'hidden'
    ...
    return () => {
      document.body.style.overflow = overflow
      document.body.style.paddingRight = paddingRight
    }
```
Each active caller snapshots the value that is in place *at the moment it locks* and blindly writes it back on teardown, so the last cleanup to run wins. The story viewer has two active callers at once: `modules/stories/StoryViewerHost.tsx:47` `useBodyScrollLock(isOpen)` and, inside the portal that host renders when open, `modules/stories/StoryViewer.tsx:169` `useBodyScrollLock(true)`. React runs passive effects child-before-parent, so on open StoryViewer locks first (snapshot `''`) and StoryViewerHost locks second (snapshot `'hidden'`); on close the destroys run in the same child-before-parent order, so StoryViewer restores `''` and StoryViewerHost then restores `'hidden'`. The same shape applies to `OverlayLayer` (`AppShell.tsx:300`, non-self-contained overlays) layered under the viewer.

SUGGESTED FIX FROM REVIEWER: Make the lock re-entrant with a module-level counter, e.g. `let locks = 0; let saved: {overflow: string; paddingRight: string} | null = null`; on the first acquire snapshot the styles and apply `hidden`, on each release decrement and only when the count reaches 0 write the snapshot back. That makes overlapping callers (StoryViewerHost + StoryViewer, OverlayLayer + Modal) safe regardless of teardown order.

### SHELL-2  (major/accessibility)  src/components/ui/ModalHost.tsx:398

SUMMARY: Report reasons use role="radio" inside role="radiogroup" with no roving tabindex and no arrow-key handling, so the group is eight tab stops and arrow keys do nothing.

DETAIL:
              <button
                key={item.id}
                type="button"
                role="radio"
                aria-checked={selected}
                className={cn(styles.option, selected && styles.optionSelected)}
                onClick={() => setReason(item.id)}
              >

SUGGESTED FIX FROM REVIEWER: Add roving tabindex (tabIndex={selected ? 0 : -1}) plus an Arrow/Home/End keydown handler on the `.optionList` container, or use the same SegmentedControl/Tabs roving contract already implemented in this slice.

### SHELL-3  (major/data-consistency)  src/components/layout/ActivityPanel.tsx:118

SUMMARY: The panel writes the last-seen stamp into the same state it measures the "since your last visit" window from, so the follower count and the "last active" line are always reset to zero/now on open.

DETAIL:
ActivityPanel.tsx:114-128
  const [lastSeen, setLastSeen] = useLocalStorage<number>(LAST_SEEN_KEY, 0)
  const openedAt = useRef(Date.now()).current

  // Stamp the visit so the next one measures the gap from this one.
  useEffect(() => {
    setLastSeen(Date.now())
  }, [setLastSeen])

  const since = useMemo(() => {
    const stamp = lastSeen > 0 && lastSeen <= Date.now() ? lastSeen : Date.now() - FIRST_VISIT_WINDOW_MS
    return stamp
  }, [lastSeen])

  const lastLogin = lastSeen > 0 ? lastSeen : openedAt

`useLocalStorage` (src/lib/hooks.ts:301-313) returns a setter that calls `setValue`, so `setLastSeen(Date.now())` immediately rewrites the in-memory `lastSeen`. The first render computes `since` from the real stored stamp, but the mount effect then pushes `lastSeen` to `Date.now()`, which re-runs the `since` memo with `stamp === now` and re-runs `lastLogin`, so the "since" boundary and the "last active" boundary are both the current instant on every open after the first.

SUGGESTED FIX FROM REVIEWER: Capture the pre-write stamp before the effect runs — e.g. `const since = useRef(lastSeen > 0 && lastSeen <= Date.now() ? lastSeen : Date.now() - FIRST_VISIT_WINDOW_MS).current` — and compute `newFollowers` and `lastLogin` from that ref, not from the `lastSeen` state that the mount effect overwrites.

### SHELL-4  (major/product-fidelity)  src/components/layout/SettingsPanel.tsx:211

SUMMARY: The "Account privacy" row opens the Close Friends modal, so two adjacent settings rows launch the identical dialog.

DETAIL:
SettingsPanel.tsx:209-224
        <Row
          icon="lock"
          label="Account privacy"
          onSelect={() => {
            onClose()
            openModal('closeFriends')
          }}
        />
        <Row
          icon="users"
          label="Close friends"
          onSelect={() => {
            onClose()
            openModal('closeFriends')
          }}
        />

`openModal('closeFriends')` dispatches to `CloseFriendsModal` (src/components/ui/ModalHost.tsx:1011, body at :631), which is a searchable list of accounts the viewer follows with a "make close friend" toggle — it contains nothing about account privacy. There is no `privacy` member of `ModalKind` (src/types.ts, `ModalKind` union) and no privacy surface mounted anywhere, so this is not a mis-wired key to an existing screen.

SUGGESTED FIX FROM REVIEWER: Add a `privacy` ModalKind with a real Account-privacy surface (private-account toggle, activity status, limit interactions) and point this row at it, leaving `closeFriends` on the Close friends row.

## SLICE explore

YOU OWN EXACTLY THESE FILES. Do not edit any other file:
- src/modules/explore/ExploreDetail.tsx
- src/modules/explore/ExplorePage.tsx
- src/modules/post/ShareModal.tsx

### EXPLORE-1  (major/correctness/product-fidelity)  src/modules/explore/ExploreDetail.tsx:311

SUMMARY: The lightbox renders a 1/N carousel counter but has no media index — the chevrons page to a different post, so N-1 of the promised photos are unreachable.

DETAIL:
ExploreDetail.tsx:227 and 311-315
```
  const cover = post?.media[0] ?? null
  const mediaCount = post?.media.length ?? 0
...
          {mediaCount > 1 ? (
            <span className={styles.count} aria-hidden="true">
              1/{mediaCount}
            </span>
          ) : null}
```
The stage renders `<MediaImage media={cover} .../>` from `media[0]` only. The chevrons and the arrow-key handler both call `step(delta)`, which does `setCursor(sequence[next])` — a different *post* id (line 164). There is no `mediaIndex` state anywhere in the file, so `1/{mediaCount}` is a hardcoded "1" against a real count.

SUGGESTED FIX FROM REVIEWER: Add a `mediaIndex` state alongside `cursor`, reset it in the `useEffect(() => setCursor(postId), [postId])` sync effect, render `cover = post?.media[mediaIndex] ?? null`, make `step` advance the media index when `media.length > 1` and only move to the next post at the end (matching Instagram), and show `{mediaIndex + 1}/{mediaCount}` (and hide the counter when `mediaCount === 1`). Until then, do not render the counter at all.

### EXPLORE-2  (major/correctness)  src/modules/explore/ExplorePage.tsx:100

SUMMARY: sharedTags never checks that a post carries both tags, so the "Related" list is just the global top-6 ranking minus the current tag — identical on every tag page.

DETAIL:
ExplorePage.tsx:98-105
```
function sharedTags(allHashtags: readonly string[], tag: string): string[] {
  const shared = new Map<string, number>()
  for (const other of allHashtags) {
    if (other === tag) continue
    shared.set(other, (shared.get(other) ?? 0) + 1)
  }
  return rankTags(shared)
}
```
`allHashtags` is a flat list of (post, tag) pairs with the post identity discarded (ExplorePage.tsx:119-121), so the loop cannot tell whether `other` ever appeared on a post that also carried `tag`. Every tag in the corpus is incremented exactly once per occurrence regardless of `tag`, which means `sharedTags(x, tag)` returns `rankTags(globalCounts)` minus `tag` for any `tag`. The doc comment above it (lines 93-97) claims the opposite: "counting occurrences counts the posts the two share". The backfill at lines 271-277 then adds from `rankedTags`, the same list, so it can never change the outcome.

SUGGESTED FIX FROM REVIEWER: Derive co-occurrence from the posts, not the flat pair list: build a Map<postId, string[]> from `s.postIds`/`s.posts` (or count over `tagIds` plus their hashtag sets), then for each post carrying `tag`, increment the counts of that post's *other* hashtags. Keep the `rankedTags` backfill for tags that genuinely share nothing.

### EXPLORE-3  (major/correctness)  src/modules/post/ShareModal.tsx:140

SUMMARY: Sharing a reel produces a link to `/p/` because the share modal is opened with an empty postId and the link is always built from the post route.

DETAIL:
function canonicalUrl(postId: ID): string {
  return `${window.location.origin}/p/${postId}`
}
...
  const link = canonicalUrl(postId)
...
  const copyLink = useCallback(async (): Promise<void> => {
    const ok = await copyToClipboard(link)

`postId` is typed as required, but ModalHost hands it an empty string whenever the share was opened for a reel: `case 'share': ... <ShareModal postId={payload.postId ?? ''} reelId={payload.reelId} />` (src/components/ui/ModalHost.tsx:1026), and the reels surface opens it with no postId at all: `openModal('share', { reelId: reel.id })` (src/modules/reels/ReelActions.tsx:168). The same `link` is also handed to the platform share sheet in `shareNatively` (`const payload: ShareData = { ... url: link }`). The app has a real reel route, `/reel/:reelId` (src/App.tsx:114), which is never used here.

SUGGESTED FIX FROM REVIEWER: Derive the path from whichever subject is present, e.g. `const link = reelId ? `${window.location.origin}/reel/${reelId}` : `${window.location.origin}/p/${postId}``, and guard `copyLink`/`shareNatively` when neither id is present.

## SLICE media

YOU OWN EXACTLY THESE FILES. Do not edit any other file:
- src/modules/feed/PostHeader.tsx
- src/modules/reels/ReelPlayer.tsx
- src/modules/reels/ReelPlayer.module.css
- src/modules/misc/NotFoundPage.module.css

### MEDIA-1  (major/correctness)  src/modules/feed/PostHeader.tsx:126

SUMMARY: The overflow menu's "Hide all from @user" item mutes only the single post it was opened on, but labels and toasts it as hiding every post from that account.

DETAIL:
src/modules/feed/PostHeader.tsx:125-133

      {
        id: 'hide-all',
        label: `Hide all from @${username}`,
        icon: <Icon name="eye-off" size={MENU_GLYPH} />,
        onSelect: () => {
          mutePost(post.id)
          notify(`Posts from @${username} are hidden`)
        },
      },

`mutePost` is per-post (src/store/useAppStore.ts:634-643):

  mutePost: (postId) =>
    set((s) => {
      ...
      feedIds: s.feedIds.filter((id) => id !== postId),
      posts: { ...s.posts, [postId]: { ...post, mutedByViewer: true } },

There is no author-level hide anywhere in the store's action list (src/store/useAppStore.ts:112-113 declares only `mutePost` and `restorePost`). The adjacent `'hide'` item at src/modules/feed/PostHeader.tsx:116-124 is the correct per-post action, so the two entries are byte-identical apart from their labels and toasts.

SUGGESTED FIX FROM REVIEWER: Either add a real author-scoped action (e.g. `muteAuthor(authorId)` that filters every `feedIds` entry whose `posts[id].authorId` matches and sets `mutedByViewer` on all of them), or drop the `hide-all` entry and keep the per-post `hide` item with its accurate label and toast.

### MEDIA-2  (major/rendering/layout)  src/modules/reels/ReelPlayer.module.css:80

SUMMARY: The reel's byline / caption / audio chip are inset from the right edge twice over (76px `right` + 76px `padding-right`), so on mobile the copy block is squeezed 152px in instead of the ~70px the action rail actually occupies.

DETAIL:
`.bottom { position: absolute; left: 0; right: 0; ... padding: var(--sp-16) calc(var(--sp-18) + var(--sp-6)) var(--sp-10) var(--sp-6); }` (ReelPlayer.module.css:70-83)

`--sp-18` is 64px and `--sp-6` is 12px (src/styles/tokens.css:125,132), so the same 76px rail clearance is applied twice: once by `right: 0` being overridden to `right: 76px`, and again by `padding-right: 76px`. The rail it is meant to clear is declared in ReelsPage.module.css:90-95 / ReelActions.module.css:13-20 as `right: var(--sp-3)` (6px) with `width: var(--sp-18)` (64px), i.e. it occupies 6px..70px from the stage's right edge.

The sibling rule proves 76px is the intended single clearance — `.overlays` uses `right: calc(var(--sp-18) + var(--sp-6))` with no matching padding and therefore clears the rail exactly.

SUGGESTED FIX FROM REVIEWER: Delete the redundant `right` on `.bottom` and keep the clearance solely in the padding: set `right: 0` (or drop it, since `left: 0` + `width: 100%` is equivalent) and keep `padding-right: calc(var(--sp-18) + var(--sp-6))` on mobile. Then in the `min-width: 768px` block override the padding as well as `right`: `.bottom { right: 0; padding-right: var(--sp-6); }` so the desktop reclaim actually happens.

### MEDIA-3  (major/interaction/product-fidelity)  src/modules/reels/ReelPlayer.tsx:144

SUMMARY: Pausing unmounts the transport, and the still that replaces it has no tap target, so the primary tap-to-resume affordance of the reels surface is dead exactly when the user paused.

DETAIL:
`{active ? (` … `<VideoPlayer ... />` … `) : (` … `<MediaImage media={reel.media} alt={reel.media.alt} fit="cover" className={styles.still} style={FILL} />` … `)}` (ReelPlayer.tsx:144-164)

`VideoPlayer` is the only element on the stage with a click target — it renders `<button type="button" className={styles.tapTarget} onClick={toggle} aria-label={playing ? 'Pause video' : 'Play video'} />`. The `<MediaImage>` branch has no handler, `.stage` has no `onClick`, and ReelPlayer.module.css:82 makes `.bottom` `pointer-events: none` (only the username/caption links opt back in via `pointer-events: auto` at line 99) while `.media` sits below at `z-index: var(--z-base)`.

This contradicts the file's own stated invariant at ReelPlayer.module.css:5-6: "Everything above the media is `pointer-events: none` except the links, so a tap anywhere on the stage reaches the transport's own tap target." When `active` is false there is no transport to reach.

SUGGESTED FIX FROM REVIEWER: Keep an interaction target on the still. Either render the transport with `autoPlay={false}` when paused (so the tap target and its play glyph stay) instead of unmounting it, or give the inactive branch its own resumable button — e.g. render `<VideoPlayer autoPlay={active} …>` unconditionally and drive playback purely from the `autoPlay` prop, or add an `onClick`/button overlay on the `MediaImage` branch that calls an `onRequestPlay` prop wired to `setPaused(false)`.

### MEDIA-4  (major/rendering)  src/modules/misc/NotFoundPage.module.css:48

SUMMARY: `.tileMid` is given a positive z-index while `.tileFront` has none, so the middle photo paints on top of the front photo in the 404 stack.

DETAIL:
src/modules/misc/NotFoundPage.module.css:46-58:

```
.tileMid {
  left: 50%;
  margin-left: -66px;
  bottom: var(--sp-6);
  z-index: var(--z-raised);
  --tilt: 2deg;
}

.tileFront {
  right: 0;
  bottom: var(--sp-13);
  --tilt: 13deg;
}
```

`.tile` is `position: absolute` (line 37-40). In the CSS painting order, positioned descendants with `z-index: auto` are painted in step 8 (in DOM order) while any positioned descendant with a positive z-index is painted later, in step 9 — so `.tileMid` wins over `.tileFront` regardless of the fact that `.tileFront` comes after it in `PHOTO_TILES` (NotFoundPage.tsx:34-37 orders back → mid → front). `.tileBack` likewise has no z-index.

Geometry confirms the overlap: `.stack` is 264px wide and `.tile` is 132px, so `.tileBack` occupies x 0–132, `.tileMid` x 66–198 and `.tileFront` x 132–264. The mid and front tiles overlap across x 132–198, i.e. 66px — exactly half the front card.

SUGGESTED FIX FROM REVIEWER: Drop `z-index: var(--z-raised)` from `.tileMid` so all three tiles stack in DOM order, or give the tiles explicit ordered z-indices: `.tileBack { z-index: 0 } .tileMid { z-index: 1 } .tileFront { z-index: 2 }`.

## SLICE store

YOU OWN EXACTLY THESE FILES. Do not edit any other file:
- src/modules/notifications/NotificationsPage.tsx
- src/modules/auth/SignupPage.tsx
- src/modules/dm/InboxPage.tsx
- src/store/useAppStore.ts

### STORE-1  (major/correctness/state)  src/modules/notifications/NotificationsPage.tsx:84

SUMMARY: The `tab` state is never reset when the route changes between /accounts/notifications and /accounts/activity, and the two filters are intersected, so a leftover "Mentions" tab empties the Follow Requests page entirely.

DETAIL:
`const [tab, setTab] = useState<NotificationTab>('all')` (line 84)

`const requestsOnly = pathname.replace(/\/+$/, '').endsWith('/accounts/activity')` (line 93)

`return tab === 'mentions' ? base.filter((n) => MENTION_KINDS.includes(n.kind)) : base` (lines 104-106), where `MENTION_KINDS = ['mention', 'tag', 'comment_reply']` (line 52).

The only reset effect is keyed on the filter, not the route: `useEffect(() => { setLimit(PAGE_SIZE) }, [tab, requestsOnly])` (lines 110-112). `NotificationsPage` is mounted by two sibling routes (`accounts/notifications` and `accounts/activity`, App.tsx:118-119) that share one element type, so React reuses the same component instance across the navigation and `tab` keeps its value.

SUGGESTED FIX FROM REVIEWER: Add `requestsOnly` to a tab reset, or drop the tabs on the requests route. Simplest: `useEffect(() => { setTab('all'); setLimit(PAGE_SIZE) }, [tab, requestsOnly])` will not work (it fights the user), so instead reset on the route only: `useEffect(() => { setTab('all') }, [requestsOnly])` alongside the existing limit reset. Better still, don't render the Tabs when `requestsOnly` is true — the real Follow Requests surface has no filter tabs — and force `tab = 'all'` in that branch.

### STORE-2  (major/correctness)  src/modules/auth/SignupPage.tsx:203

SUMMARY: Submitting the signup form inside the 400ms username-availability debounce skips the "already taken" check and signs the visitor into the existing account.

DETAIL:
src/modules/auth/SignupPage.tsx:163-169 — availability resolves to `'checking'` for the whole debounce window:

```
  const availability = useMemo<Availability>(() => {
    const candidate = username.trim()
    if (!candidate) return 'idle'
    if (candidate !== debouncedUsername.trim()) return 'checking'
    if (!USERNAME_PATTERN.test(candidate)) return 'invalid'
    return takenUsernames.includes(candidate.toLowerCase()) ? 'taken' : 'available'
  }, [username, debouncedUsername, takenUsernames])
```

src/modules/auth/SignupPage.tsx:198-207 — the submit guard only rejects the handle when availability is literally `'taken'`:

```
    const firstInvalid =
      !EMAIL_PATTERN.test(email.trim())
        ? emailRef
        : !fullName.trim()
          ? fullNameRef
          : !USERNAME_PATTERN.test(handle) || availability === 'taken'
            ? usernameRef
            : requirements.some((requirement) => !requirement.met)
              ? passwordRef
              : null
```

`'checking'` falls through both branches, so `firstInvalid` is null and the timer at line 215 calls `login(handle)`, which (src/store/useAppStore.ts:408-417) looks the username up in `state.users` and, on a match, sets `session.currentUserId` to that account. The debounce is `AVAILABILITY_DEBOUNCE_MS = 400` (line 38) and `useDebounced` restarts its timer on every keystroke, so the window is always open right after a paste.

SUGGESTED FIX FROM REVIEWER: Make the submit path consult the source of truth rather than the debounced presentation state: replace `availability === 'taken'` with a direct `takenUsernames.includes(handle.toLowerCase())` (and treat `availability === 'checking'` as "not yet verified" rather than "valid"). Alternatively, block the submit while `availability === 'checking'` and show the spinner state on the submit button.

### STORE-3  (major/data-consistency)  src/modules/dm/InboxPage.tsx:132

SUMMARY: The inbox recomputes unread counts over non-archived threads only, while the DM badge in the top bar/sidebar counts every thread, so archiving an unread conversation leaves the badge stuck on forever.

DETAIL:
src/modules/dm/InboxPage.tsx:132-135 drops archived threads before the tab badges are computed:

```
  const inboxThreads = useMemo(
    () => threads.filter((thread) => !thread.isArchived),
    [threads],
  )
```

and lines 156-166 iterate `inboxThreads` to build the badge counts, with the header menu at line 246 also confined to `inboxThreads`:

```
          for (const thread of inboxThreads) markThreadRead(thread.id)
```

The DM badge elsewhere in the shell is a second, independent derivation over the unfiltered set — src/store/selectors.ts:232-241:

```
export function useUnreadThreadCount(): number {
  const viewerId = useViewerId()
  return useAppStore(
    (s) =>
      s.threadIds.filter((id) => {
        const t = s.threads[id]
        if (!t) return false
        const last = t.messages[t.messages.length - 1]
        return Boolean(last && last.senderId !== viewerId && last.createdAt > t.lastReadAt)
      }).length,
  )
}
```

That count feeds `Sidebar.tsx:157` and `TopNav.tsx:115` (and `AppShell.tsx:217`). Two facts, two derivations, and the archived set is exactly where they diverge.

SUGGESTED FIX FROM REVIEWER: Decide which definition is correct and make both read it. If an archived thread should stop counting, add `&& !t.isArchived` to `useUnreadThreadCount` in src/store/selectors.ts. If it should keep counting, have InboxPage count over `threads` rather than `inboxThreads`. Either way, extract one shared `isThreadUnread(thread, viewerId)` helper so the two can never drift again.

### STORE-4  (major/contract-drift)  src/store/useAppStore.ts:1299

SUMMARY: `resetAll` resets `theme` to 'system' in state but never calls `applyTheme` and never clears `lumina.theme`, so the DOM, the Settings control and localStorage all disagree after a reset.

DETAIL:
`resetAll` (useAppStore.ts:1299-1306):
```ts
resetAll: () => {
  try { localStorage.removeItem(STORAGE_KEY) } catch { /* best effort */ }
  set(() => ({ ...initial, revision: Date.now() }))
},
```
`initial.theme` is `'system'` (useAppStore.ts:302) but `applyTheme` — the only thing that writes `data-theme` on `<html>` (useAppStore.ts:1311-1321) — is called from exactly three places: `setTheme` (:1249), the boot rehydrate (:1352), and the system-change listener (:1324). None of them is `resetAll`. It also leaves `'lumina.theme'` in localStorage, which is the key `index.html:15` reads pre-paint and which `readStoredTheme` (:1356) reads at boot. Meanwhile `useAppStore.subscribe(schedulePersist)` (:1328) fires on the reset and rewrites `lumina.state.v1` with `theme: 'system'`. So after a reset three sources hold three different values: the DOM keeps the old explicit `data-theme`, `lumina.theme` keeps the old explicit string, and `lumina.state.v1` says `'system'`.

SUGGESTED FIX FROM REVIEWER: Make `resetAll` restore every side effect it resets: call `applyTheme(initial.theme)` and `localStorage.removeItem('lumina.theme')` alongside the `STORAGE_KEY` removal. Better, fold the two theme writes into a single helper next to `applyTheme` so `setTheme` and `resetAll` cannot diverge again.


## COVERAGE

36 of 36 majors are assigned above.

Every major is assigned. Nothing is unassigned.
