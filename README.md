# Gari

A Chrome extension that hides comments on your terms. It covers them rather than deleting them,
and you decide what gets covered, not me.

> **English** · [한국어](README.ko.md)
> Work in progress. There is no installable build yet.

## What it is

An extension that folds away comments you would rather not see, before they cross your screen.
What counts as "would rather not see" is learned as you use it: every comment you fold adds to the profile.

Everything is decided on your own machine. No comment text leaves the browser.

## Why

Comments come in roughly three kinds.

1. Spam. Ads, link bait, repeated posts.
2. Nasty stuff. Personal attacks, pile-ons.
3. Things I simply don't want to see. Spoilers, certain topics, jokes I'm tired of.

The third one is the reason for this project. The first two have fairly settled criteria.
The third is different for everyone.

Nothing out there handles it.

- YouTube's blocked-words feature is for channel owners. Viewers can't use it.
- uBlock Origin's user rules are keywords and CSS selectors: no sense of context, and you write every rule yourself.
- Comment-blocking extensions either match keywords or hide the section wholesale. No personalization, plenty of false positives.

All of them are keyword-based or all-or-nothing. They don't read context, and they don't adapt to the person using them.

So here is the bet: represent a comment's meaning as a sentence embedding, learn from how similar it is
to the comments this user has already folded, and you can catch "things this person won't want to see"
that no keyword would have caught. Finding out whether that holds is basically the whole project.

## How

### Start with everything hidden

Timing matters more than accuracy here. If an unpleasant comment flashes on screen even once,
there was no point running the extension.

```
inject CSS at document_start  →  hide the whole comment area
        ↓
MutationObserver picks up inserted comment nodes
        ↓
filter pipeline
        ↓
reveal the ones that pass, in order
```

Nothing is judged and then hidden. It starts hidden, and only what passes gets shown.
Because hidden is the default, a slow or crashed pipeline still can't leak anything through.

The flip side is that a crashed pipeline means you see nothing at all. So once a timeout passes,
the comments stay hidden but a banner appears — "filtering failed, show them anyway?" — and you choose.

### Do the expensive thinking as rarely as possible

Calling an LLM per comment is out of the question. A single video has hundreds of comments
and keeps loading more as you scroll. So the decision is split across four tiers.

| Tier | How | Target latency | Share it should handle |
|---|---|---|---|
| L0 | Cache lookup for comments already judged | under 1ms | most of them on a revisit |
| L1 | Rules: regex, links, repeated characters, blocklist | under 1ms | 30~50% |
| L2 | Local embedding model + a light classifier | 10~50ms, batched | 45~65% |
| L3 | LLM re-check, only for the genuinely unclear ones | a few hundred ms | under 5% |

How far L3 calls can be pushed down while accuracy holds is the number this project is really about.

### It fits you the more you use it

Fold a comment and its embedding goes into a "dislike" profile that feeds the next round of judgments.
There are no labels on day one, so it starts from generic categories — spam, abuse, spoilers —
and shifts weight toward the personal profile as history builds up.
Comments read differently from site to site, so each site gets its own profile.

## Structure

```
+----------------------------------+
|  Site Adapter                    |   one per site
|                                  |
|  find comment nodes              |
|  extract text                    |
|  hide / reveal                   |
+----------------------------------+
                 |
                 |  interface
                 |
+----------------------------------+
|  Core                            |   knows nothing about sites
|                                  |
|  pipeline  L0 -> L1 -> L2 -> L3  |
|  embedding engine (ONNX)         |
|  user profile                    |
|  cache / storage (IndexedDB)     |
+----------------------------------+
```

Core doesn't know about the DOM. It takes text and an ID, which means it can be tested without a browser.
Every piece of code that does know about the DOM lives in an adapter, so when YouTube changes its markup,
that's the only file to fix.

The stack is still tentative.

- Manifest V3 and TypeScript, built with Vite or esbuild
- Inference on ONNX Runtime Web, WebGPU where available and WASM where it isn't
- A multilingual sentence embedding model somewhere in the 20~100MB range, still to be picked
- IndexedDB for storage
- Chrome Built-in AI for L3, pending an availability check, with a fallback either way

## Principles

This isn't a censorship tool. It's a tool for tuning your own feed.

- I don't get to decide what a bad comment is. The person using it does.
- Comments are folded, not deleted. You can always open them back up.
- It tells you why something was folded, because you need to be able to see when it got it wrong.
- All data stays local. If L3 ever calls an external API, that gets its own explicit consent.
- Your YouTube account is never touched. No blocking, no reporting. It only happens on your screen.

One more thing: precision comes before recall.
A comment that slips through gets reported the moment you fold it, but one that was wrongly folded
never gets the chance. Once good comments start disappearing quietly, the tool stops being trustworthy.

## License

[MIT](LICENSE)
